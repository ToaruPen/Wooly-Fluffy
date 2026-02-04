import { createServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { parseSttAudioUploadMultipart } from "./multipart.js";
import {
  createInitialState,
  createKioskSnapshot,
  createStaffSnapshot,
  reduceOrchestrator,
  type OrchestratorEvent,
  type OrchestratorState
} from "./orchestrator.js";
import { createEffectExecutor } from "./effect-executor.js";
import type { createStore } from "./store.js";
import { isLanAddress } from "./access-control.js";
import type { Providers } from "./providers/types.js";
import { createVoiceVoxTtsProvider } from "./providers/tts-provider.js";
import { createLlmProviderFromEnv } from "./providers/llm-provider.js";

const createErrorBody = (code: string, message: string) =>
  JSON.stringify({ error: { code, message } });

const notFoundBody = createErrorBody("not_found", "Not Found");

const okBody = JSON.stringify({ ok: true });

const sendJson = (res: ServerResponse, statusCode: number, body: string) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
};

const sendError = (
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string
) => {
  sendJson(res, statusCode, createErrorBody(code, message));
};

const safeSendError = (
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string
) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  try {
    sendError(res, statusCode, code, message);
  } catch {
    // Connection may already be closed; do not crash the server.
  }
};

type Store = ReturnType<typeof createStore>;

type CreateHttpServerOptions = {
  store: Store;
  now_ms?: () => number;
  get_remote_address?: (req: IncomingMessage) => string;
};

type StaffSession = {
  expires_at_ms: number;
};

const STAFF_SESSION_COOKIE_NAME = "wf_staff_session";
const STAFF_SESSION_TTL_MS = 180_000;

const parseCookies = (cookieHeader: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
};

const getStaffSessionToken = (req: IncomingMessage): string | null => {
  const cookieHeader = req.headers.cookie;
  const text = (typeof cookieHeader === "string" ? cookieHeader : "").trim();
  if (!text) {
    return null;
  }
  const cookies = parseCookies(text);
  const token = cookies[STAFF_SESSION_COOKIE_NAME];
  return token ? token : null;
};

const isPasscodeMatch = (actual: string, expected: string): boolean => {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

const createSessionCookie = (token: string): string => {
  const maxAge = Math.floor(STAFF_SESSION_TTL_MS / 1000);
  return `${STAFF_SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
};

const writeSseHeaders = (res: ServerResponse) => {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
};

type SseClient = {
  send: (type: string, data: object) => void;
  close: () => void;
};

const openSse = (
  req: IncomingMessage,
  res: ServerResponse,
  snapshotType: string,
  snapshotData: object,
  onOpen: (client: SseClient) => void,
  onClose: (client: SseClient) => void
) => {
  writeSseHeaders(res);

  let seq = 0;
  const send = (type: string, data: object) => {
    seq += 1;
    const payload = JSON.stringify({ type, seq, data });
    res.write(`id: ${seq}\n`);
    res.write(`data: ${payload}\n\n`);
  };

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const cleanupOnce = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    onClose(client);
    res.end();
  };

  const client: SseClient = {
    send,
    close: cleanupOnce
  };
  onOpen(client);

  send(snapshotType, snapshotData);

  const writeKeepAlive = () => {
    res.write(": keep-alive\n\n");
  };
  writeKeepAlive();
  keepAlive = setInterval(writeKeepAlive, 25000);

  req.on("close", () => {
    cleanupOnce();
  });
};

const parsePath = (url: string): string => {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
};

const readBody = async (req: IncomingMessage, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;

  return await new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("close", onClose);
    };

    const finish = (err?: Error) => {
      cleanup();
      if (err) {
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks));
    };

    const onData = (chunk: unknown) => {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > maxBytes) {
        finish(new Error("body_too_large"));
        req.pause();
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      finish();
    };

    const onClose = () => {
      finish(new Error("request_closed"));
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("close", onClose);
  });
};

const readJson = async (req: IncomingMessage, maxBytes: number): Promise<unknown> => {
  const body = await readBody(req, maxBytes);
  const text = body.toString("utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
};

const mapPendingToDto = (item: {
  id: string;
  personal_name: string;
  kind: string;
  value: string;
  source_quote: string | null;
  status: string;
  created_at_ms: number;
  expires_at_ms: number;
}) => ({
  id: item.id,
  personal_name: item.personal_name,
  kind: item.kind,
  value: item.value,
  ...(item.source_quote ? { source_quote: item.source_quote } : {}),
  status: item.status,
  created_at_ms: item.created_at_ms,
  expires_at_ms: item.expires_at_ms
});

export const createHttpServer = (options: CreateHttpServerOptions) => {
  const { store } = options;
  const nowMs = options.now_ms ?? (() => Date.now());
  const getRemoteAddress =
    options.get_remote_address ?? ((req: IncomingMessage) => String(req.socket.remoteAddress));

  const staffSessions = new Map<string, StaffSession>();

  const validateStaffSession = (token: string): boolean => {
    const session = staffSessions.get(token);
    if (!session) {
      return false;
    }
    if (session.expires_at_ms <= nowMs()) {
      staffSessions.delete(token);
      return false;
    }
    return true;
  };

  const createStaffSession = (): string => {
    const token = randomUUID();
    staffSessions.set(token, { expires_at_ms: nowMs() + STAFF_SESSION_TTL_MS });
    return token;
  };

  const keepaliveStaffSession = (token: string): boolean => {
    if (!validateStaffSession(token)) {
      return false;
    }
    staffSessions.set(token, { expires_at_ms: nowMs() + STAFF_SESSION_TTL_MS });
    return true;
  };

  let state: OrchestratorState = createInitialState(nowMs());
  const pendingStt = new Set<string>();

  const eventQueue: Array<{ event: OrchestratorEvent; now: number }> = [];

  const enqueueEvent = (event: OrchestratorEvent, now: number) => {
    eventQueue.push({ event, now });
    try {
      while (eventQueue.length > 0) {
        const item = eventQueue.shift()!;
        processEvent(item.event, item.now);
      }
    } catch (err) {
      // Best-effort: keep server alive.
      console.error(err);
    }
  };

  const kioskClients = new Set<SseClient>();
  const staffClients = new Set<SseClient>();
  const staffSseSessions = new Map<SseClient, string>();

  let lastKioskSnapshotJson = "";
  let lastStaffSnapshotJson = "";

  const broadcastKioskSnapshotIfChanged = () => {
    const snapshot = createKioskSnapshot(state);
    const json = JSON.stringify(snapshot);
    if (json === lastKioskSnapshotJson) {
      return;
    }
    lastKioskSnapshotJson = json;
    for (const client of kioskClients) {
      client.send("kiosk.snapshot", snapshot);
    }
  };

  const broadcastStaffSnapshotIfChanged = () => {
    const pendingCount = store.listPending().length;
    const snapshot = createStaffSnapshot(state, pendingCount);
    const json = JSON.stringify(snapshot);
    if (json === lastStaffSnapshotJson) {
      return;
    }
    lastStaffSnapshotJson = json;
    for (const client of staffClients) {
      client.send("staff.snapshot", snapshot);
    }
  };

  const sweepExpiredStaffSseClients = () => {
    const entries = Array.from(staffSseSessions.entries());
    for (const [client, token] of entries) {
      if (!validateStaffSession(token)) {
        client.close();
      }
    }
  };

  const broadcastSnapshotsIfChanged = () => {
    broadcastKioskSnapshotIfChanged();
    broadcastStaffSnapshotIfChanged();
  };

  const sendKioskCommand = (type: string, data: object) => {
    for (const client of kioskClients) {
      client.send(type, data);
    }
  };

  const providers: Providers = {
    stt: {
      transcribe: (input) => ({
        text: input.mode === "ROOM" ? "パーソナル、たろう" : "りんごがすき"
      }),
      health: () => ({ status: "ok" })
    },
    tts: createVoiceVoxTtsProvider(),
    llm: createLlmProviderFromEnv()
  };

  const effectExecutor = createEffectExecutor({
    providers,
    sendKioskCommand,
    enqueueEvent: (event) => enqueueEvent(event, nowMs()),
    onSttRequested: (request_id) => {
      pendingStt.add(request_id);
    },
    storeWritePending: (input) => {
      store.createPending(input);
      broadcastStaffSnapshotIfChanged();
    }
  });

  const processEvent = (event: OrchestratorEvent, now: number) => {
    const result = reduceOrchestrator(state, event, now);
    state = result.next_state;
    broadcastSnapshotsIfChanged();

    for (const effect of result.effects) {
      if (effect.type === "KIOSK_RECORD_STOP") {
        sendKioskCommand("kiosk.command.record_stop", {
          stt_request_id: state.in_flight.stt_request_id
        });
        continue;
      }

      const events = effectExecutor.executeEffects([effect]);
      for (const nextEvent of events) {
        processEvent(nextEvent, now);
      }
    }
  };

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      void (async () => {
        const [stt, tts, llm] = await Promise.all([
          providers.stt.health(),
          providers.tts.health(),
          providers.llm.health()
        ]);
        sendJson(
          res,
          200,
          JSON.stringify({
            status: "ok",
            providers: {
              stt,
              tts,
              llm: { ...llm, kind: providers.llm.kind }
            }
          })
        );
      })();
      return;
    }

    const path = parsePath(req.url!);

    const requireStaffLan = (): boolean => {
      const remoteAddress = getRemoteAddress(req);
      if (isLanAddress(remoteAddress)) {
        return true;
      }
      sendError(res, 403, "forbidden", "Forbidden");
      return false;
    };

    const requireStaffSession = (): string | null => {
      const token = getStaffSessionToken(req);
      if (!token) {
        sendError(res, 401, "unauthorized", "Unauthorized");
        return null;
      }
      if (!validateStaffSession(token)) {
        sendError(res, 401, "unauthorized", "Unauthorized");
        return null;
      }
      return token;
    };

    if (path === "/api/v1/staff/auth/login") {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }

      readJson(req, 128_000)
        .then((body) => {
          const parsed = body as { passcode?: unknown };
          if (typeof parsed.passcode !== "string") {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          const expected = process.env.STAFF_PASSCODE;
          if (typeof expected !== "string" || expected.length === 0) {
            sendError(res, 500, "misconfigured", "Server misconfigured");
            return;
          }
          if (!isPasscodeMatch(parsed.passcode, expected)) {
            sendError(res, 401, "unauthorized", "Unauthorized");
            return;
          }

          const token = createStaffSession();
          res.setHeader("set-cookie", createSessionCookie(token));
          sendJson(res, 200, okBody);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "body_too_large") {
            safeSendError(res, 413, "payload_too_large", "Payload Too Large");
            return;
          }
          safeSendError(res, 400, "invalid_json", "Invalid JSON");
        });
      return;
    }

    if (path === "/api/v1/staff/auth/keepalive") {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }

      const token = getStaffSessionToken(req);
      if (!token || !keepaliveStaffSession(token)) {
        sendError(res, 401, "unauthorized", "Unauthorized");
        return;
      }

      res.setHeader("set-cookie", createSessionCookie(token));
      sendJson(res, 200, okBody);
      return;
    }

    if (path === "/api/v1/kiosk/stream") {
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      openSse(
        req,
        res,
        "kiosk.snapshot",
        createKioskSnapshot(state),
        (client) => {
          kioskClients.add(client);
        },
        (client) => {
          kioskClients.delete(client);
        }
      );
      return;
    }

    if (path === "/api/v1/staff/stream") {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      const token = requireStaffSession();
      if (!token) {
        return;
      }
      openSse(
        req,
        res,
        "staff.snapshot",
        createStaffSnapshot(state, store.listPending().length),
        (client) => {
          staffClients.add(client);
          staffSseSessions.set(client, token);
        },
        (client) => {
          staffClients.delete(client);
          staffSseSessions.delete(client);
        }
      );
      return;
    }

    if (path === "/api/v1/kiosk/event") {
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      readJson(req, 128_000)
        .then((body) => {
          const parsed = body as { type?: unknown; answer?: unknown };
          if (parsed.type !== "UI_CONSENT_BUTTON") {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          if (parsed.answer !== "yes" && parsed.answer !== "no") {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          enqueueEvent({ type: "UI_CONSENT_BUTTON", answer: parsed.answer }, nowMs());
          sendJson(res, 200, okBody);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "body_too_large") {
            safeSendError(res, 413, "payload_too_large", "Payload Too Large");
            return;
          }
          safeSendError(res, 400, "invalid_json", "Invalid JSON");
        });
      return;
    }

    if (path === "/api/v1/kiosk/tts") {
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }

      readJson(req, 128_000)
        .then((body) => {
          const parsed = body as { text?: unknown };
          if (typeof parsed.text !== "string" || parsed.text.length === 0) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return null;
          }
          return providers.tts.synthesize({ text: parsed.text });
        })
        .then((result) => {
          if (!result) {
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "audio/wav");
          res.end(result.wav);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "body_too_large") {
            safeSendError(res, 413, "payload_too_large", "Payload Too Large");
            return;
          }
          if (err instanceof Error && err.message === "invalid_json") {
            safeSendError(res, 400, "invalid_json", "Invalid JSON");
            return;
          }
          safeSendError(res, 503, "unavailable", "Unavailable");
        });
      return;
    }

    if (path === "/api/v1/staff/event") {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      if (!requireStaffSession()) {
        return;
      }
      readJson(req, 128_000)
        .then((body) => {
          const parsed = body as { type?: unknown };
          const type = parsed.type;
          if (
            type !== "STAFF_PTT_DOWN" &&
            type !== "STAFF_PTT_UP" &&
            type !== "STAFF_FORCE_ROOM" &&
            type !== "STAFF_EMERGENCY_STOP" &&
            type !== "STAFF_RESUME"
          ) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          enqueueEvent({ type } as OrchestratorEvent, nowMs());
          sendJson(res, 200, okBody);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "body_too_large") {
            safeSendError(res, 413, "payload_too_large", "Payload Too Large");
            return;
          }
          safeSendError(res, 400, "invalid_json", "Invalid JSON");
        });
      return;
    }

    if (path === "/api/v1/staff/pending") {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      if (!requireStaffSession()) {
        return;
      }
      const items = store.listPending().map(mapPendingToDto);
      sendJson(res, 200, JSON.stringify({ items }));
      return;
    }

    if (path.startsWith("/api/v1/staff/pending/") && path.endsWith("/confirm")) {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      if (!requireStaffSession()) {
        return;
      }
      const id = path.slice("/api/v1/staff/pending/".length, -"/confirm".length);
      const ok = store.confirmById(id);
      if (!ok) {
        sendJson(res, 404, notFoundBody);
        return;
      }
      broadcastStaffSnapshotIfChanged();
      sendJson(res, 200, okBody);
      return;
    }

    if (path.startsWith("/api/v1/staff/pending/") && path.endsWith("/deny")) {
      if (!requireStaffLan()) {
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      if (!requireStaffSession()) {
        return;
      }
      const id = path.slice("/api/v1/staff/pending/".length, -"/deny".length);
      const ok = store.denyById(id);
      if (!ok) {
        sendJson(res, 404, notFoundBody);
        return;
      }
      broadcastStaffSnapshotIfChanged();
      sendJson(res, 200, okBody);
      return;
    }

    if (path === "/api/v1/kiosk/stt-audio") {
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      const contentTypeHeader = req.headers["content-type"];
      const contentType = String(contentTypeHeader ?? "");
      if (!contentType.includes("multipart/form-data")) {
        sendError(res, 400, "invalid_request", "Invalid request");
        return;
      }

      readBody(req, 2_500_000)
        .then((body) =>
          parseSttAudioUploadMultipart({
            headers: req.headers,
            stream: Readable.from([body]),
            max_file_bytes: 2_500_000
          })
        )
        .then((upload) => {
          const stt_request_id = upload.stt_request_id;
          if (!stt_request_id || upload.wav.length === 0) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          if (!pendingStt.has(stt_request_id) || state.in_flight.stt_request_id !== stt_request_id) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          pendingStt.delete(stt_request_id);

          const event = effectExecutor.transcribeStt({
            request_id: stt_request_id,
            mode: state.mode,
            wav: upload.wav
          });
          enqueueEvent(event, nowMs());
          sendJson(res, 202, okBody);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === "body_too_large") {
            safeSendError(res, 413, "payload_too_large", "Payload Too Large");
            return;
          }
          safeSendError(res, 400, "invalid_request", "Invalid request");
        });
      return;
    }

    sendJson(res, 404, notFoundBody);
  });

  const tickTimer = setInterval(() => {
    sweepExpiredStaffSseClients();
    enqueueEvent({ type: "TICK" }, nowMs());
  }, 1000);
  tickTimer.unref();
  server.on("close", () => {
    clearInterval(tickTimer);
  });

  return server;
};
