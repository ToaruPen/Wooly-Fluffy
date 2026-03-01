import { createServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { parseSttAudioUploadMultipart } from "./multipart.js";
import {
  createInitialState,
  createKioskSnapshot,
  createStaffSnapshot,
  DEFAULT_ORCHESTRATOR_CONFIG,
  reduceOrchestrator,
  type OrchestratorConfig,
  type OrchestratorEvent,
  type OrchestratorState,
} from "./orchestrator.js";
import { createEffectExecutor } from "./effect-executor.js";
import { createStoreWriteSessionSummaryPending } from "./http/pending-writer.js";
import type { createStore } from "./store.js";
import { isLanAddress } from "./access-control.js";
import type { Providers } from "./providers/types.js";
import { createWhisperCppSttProvider } from "./providers/stt-provider.js";
import { createVoicevoxCompatibleTtsProvider } from "./providers/tts-provider.js";
import { createLlmProviderFromEnv } from "./providers/llm-provider.js";
import { readEnvInt } from "./env.js";
import { createStaffSessionStore, getStaffSessionToken } from "./http/staff-session.js";
import { handleStaffRoutes } from "./http/routes/staff.js";
import { nodeCreateReadStream } from "./file-system.js";
import { tryServeStaticWeb, type StaticWebDeps } from "./static-web.js";

const createErrorBody = (code: string, message: string) =>
  JSON.stringify({ error: { code, message } });

const notFoundBody = createErrorBody("not_found", "Not Found");

const okBody = JSON.stringify({ ok: true });

const sendJson = (res: ServerResponse, statusCode: number, body: string) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
};

const sendError = (res: ServerResponse, statusCode: number, code: string, message: string) => {
  sendJson(res, statusCode, createErrorBody(code, message));
};

const safeSendError = (res: ServerResponse, statusCode: number, code: string, message: string) => {
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
  stt_provider?: Providers["stt"];
  web_dist_path?: string;
  create_read_stream?: StaticWebDeps["createReadStream"];
};

const STAFF_SESSION_TTL_MS_DEFAULT = 180_000;
const SSE_KEEPALIVE_INTERVAL_MS_DEFAULT = 25_000;
const TICK_INTERVAL_MS_DEFAULT = 1_000;

const isPasscodeMatch = (actual: string, expected: string): boolean => {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
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
  keepAliveIntervalMs: number,
  onOpen: (client: SseClient) => void,
  onClose: (client: SseClient) => void,
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
  let isClosed = false;
  const cleanupOnce = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    onClose(client);
    res.end();
  };

  const client: SseClient = {
    send,
    close: cleanupOnce,
  };
  onOpen(client);

  send(snapshotType, snapshotData);

  const writeKeepAlive = () => {
    res.write(": keep-alive\n\n");
  };
  writeKeepAlive();
  keepAlive = setInterval(writeKeepAlive, keepAliveIntervalMs);

  req.on("close", () => {
    cleanupOnce();
  });
};

const parsePath = (url: string): string => {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
};

export const shouldIncludeSpeechMetrics = (url: string): boolean => {
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.searchParams.get("metrics") === "1";
  } catch {
    return false;
  }
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

const mapSessionSummaryToDto = (item: {
  id: string;
  title: string;
  summary_json: unknown;
  status: "pending";
  created_at_ms: number;
  expires_at_ms: number;
}) => {
  const parsedSummary =
    typeof item.summary_json === "object" && item.summary_json !== null
      ? (item.summary_json as Record<string, unknown>)
      : {};

  const topics = Array.isArray(parsedSummary.topics)
    ? parsedSummary.topics.filter((v): v is string => typeof v === "string")
    : [];
  const staffNotes = Array.isArray(parsedSummary.staff_notes)
    ? parsedSummary.staff_notes.filter((v): v is string => typeof v === "string")
    : [];

  return {
    id: item.id,
    title: item.title,
    summary_json: {
      summary: typeof parsedSummary.summary === "string" ? parsedSummary.summary : "",
      topics,
      staff_notes: staffNotes,
    },
    status: item.status,
    created_at_ms: item.created_at_ms,
    expires_at_ms: item.expires_at_ms,
  };
};

export const createHttpServer = (options: CreateHttpServerOptions) => {
  const { store } = options;
  const webDistPath =
    options.web_dist_path ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  const nowMs = options.now_ms ?? (() => Date.now());
  const getRemoteAddress =
    options.get_remote_address ?? ((req: IncomingMessage) => String(req.socket.remoteAddress));

  const staticWebDeps: StaticWebDeps = {
    createReadStream: options.create_read_stream ?? nodeCreateReadStream,
  };
  const staffSessionTtlMs = readEnvInt(process.env, {
    name: "WF_STAFF_SESSION_TTL_MS",
    defaultValue: STAFF_SESSION_TTL_MS_DEFAULT,
    min: 10_000,
    max: 24 * 60 * 60 * 1000,
  });
  const sseKeepAliveIntervalMs = readEnvInt(process.env, {
    name: "WF_SSE_KEEPALIVE_INTERVAL_MS",
    defaultValue: SSE_KEEPALIVE_INTERVAL_MS_DEFAULT,
    min: 1_000,
    max: 5 * 60 * 1000,
  });
  const tickIntervalMs = readEnvInt(process.env, {
    name: "WF_TICK_INTERVAL_MS",
    defaultValue: TICK_INTERVAL_MS_DEFAULT,
    min: 50,
    max: 60_000,
  });

  const orchestratorConfig: OrchestratorConfig = {
    consent_timeout_ms: DEFAULT_ORCHESTRATOR_CONFIG.consent_timeout_ms,
    inactivity_timeout_ms: readEnvInt(process.env, {
      name: "WF_INACTIVITY_TIMEOUT_MS",
      defaultValue: DEFAULT_ORCHESTRATOR_CONFIG.inactivity_timeout_ms,
      min: 10_000,
      max: 60 * 60 * 1000,
    }),
  };

  const staffSessionStore = createStaffSessionStore({
    now_ms: nowMs,
    session_ttl_ms: staffSessionTtlMs,
  });
  const validateStaffSession = staffSessionStore.validate;
  const createStaffSession = staffSessionStore.create;
  const keepaliveStaffSession = staffSessionStore.keepalive;

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

  const getStaffSessionSummaryPendingCount = () => store.listPendingSessionSummaries().length;

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
    const snapshot = createStaffSnapshot(state, 0, getStaffSessionSummaryPendingCount());
    const json = JSON.stringify(snapshot);
    if (json === lastStaffSnapshotJson) {
      return;
    }
    lastStaffSnapshotJson = json;
    for (const [client, token] of Array.from(staffSseSessions)) {
      if (!validateStaffSession(token)) {
        client.close();
        continue;
      }
      client.send("staff.snapshot", snapshot);
    }
  };

  const broadcastStaffSessionSummariesPendingList = () => {
    sweepExpiredStaffSseClients();
    const items = store.listPendingSessionSummaries().map(mapSessionSummaryToDto);
    for (const client of staffSseSessions.keys()) {
      client.send("staff.session_summaries_pending_list", { items });
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
    stt: options.stt_provider ?? createWhisperCppSttProvider(),
    tts: createVoicevoxCompatibleTtsProvider(),
    llm: createLlmProviderFromEnv(),
  };

  let speechTtfaObservationCount = 0;
  let latestSpeechTtfaObservation: {
    emitted_at_ms: number;
    utterance_id: string;
    chat_request_id: string;
    segment_count: number;
    first_segment_length: number;
  } | null = null;

  const effectExecutor = createEffectExecutor({
    providers,
    sendKioskCommand,
    enqueueEvent: (event) => enqueueEvent(event, nowMs()),
    onSttRequested: (request_id) => {
      pendingStt.add(request_id);
    },
    observeSpeechMetric: (metric) => {
      speechTtfaObservationCount += 1;
      latestSpeechTtfaObservation = {
        emitted_at_ms: metric.emitted_at_ms,
        utterance_id: metric.utterance_id,
        chat_request_id: metric.chat_request_id,
        segment_count: metric.segment_count,
        first_segment_length: metric.first_segment_length,
      };
    },
    storeWriteSessionSummaryPending: createStoreWriteSessionSummaryPending({
      store,
      broadcastStaffSnapshotIfChanged,
      broadcastStaffSessionSummariesPendingList,
    }),
  });

  const processEvent = (event: OrchestratorEvent, now: number) => {
    const result = reduceOrchestrator(state, event, now, orchestratorConfig);
    state = result.next_state;
    broadcastSnapshotsIfChanged();

    for (const effect of result.effects) {
      if (effect.type === "KIOSK_RECORD_STOP") {
        sendKioskCommand("kiosk.command.record_stop", {
          stt_request_id: state.in_flight.stt_request_id,
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
    if (req.method === "GET" && parsePath(req.url!) === "/health") {
      void (async () => {
        const [stt, tts, llm] = await Promise.all([
          providers.stt.health(),
          providers.tts.health(),
          providers.llm.health(),
        ]);
        const body: {
          status: "ok";
          providers: {
            stt: Awaited<ReturnType<Providers["stt"]["health"]>>;
            tts: Awaited<ReturnType<Providers["tts"]["health"]>>;
            llm: Awaited<ReturnType<Providers["llm"]["health"]>> & {
              kind: Providers["llm"]["kind"];
            };
          };
          speech_metrics?: {
            ttfa_observation_count: number;
            latest_ttfa_observation: {
              emitted_at_ms: number;
              utterance_id: string;
              chat_request_id: string;
              segment_count: number;
              first_segment_length: number;
            } | null;
          };
        } = {
          status: "ok",
          providers: {
            stt,
            tts,
            llm: { ...llm, kind: providers.llm.kind },
          },
        };
        if (shouldIncludeSpeechMetrics(req.url!)) {
          body.speech_metrics = {
            ttfa_observation_count: speechTtfaObservationCount,
            latest_ttfa_observation: latestSpeechTtfaObservation,
          };
        }
        sendJson(res, 200, JSON.stringify(body));
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

    const openStaffStream = (token: string) => {
      openSse(
        req,
        res,
        "staff.snapshot",
        createStaffSnapshot(state, 0, getStaffSessionSummaryPendingCount()),
        sseKeepAliveIntervalMs,
        (client) => {
          staffClients.add(client);
          staffSseSessions.set(client, token);
        },
        (client) => {
          staffClients.delete(client);
          staffSseSessions.delete(client);
        },
      );
    };

    if (
      handleStaffRoutes({
        req,
        res,
        path,
        now_ms: nowMs,
        store,
        staff_session_ttl_ms: staffSessionTtlMs,
        ok_body: okBody,
        not_found_body: notFoundBody,
        readJson,
        mapSessionSummaryToDto,
        sendJson,
        sendError,
        safeSendError,
        isPasscodeMatch,
        getStaffSessionToken,
        createStaffSession,
        keepaliveStaffSession,
        requireStaffLan,
        requireStaffSession,
        openStaffStream,
        enqueueEvent,
        broadcastStaffSnapshotIfChanged,
        broadcastStaffSessionSummariesPendingList,
      })
    ) {
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
        sseKeepAliveIntervalMs,
        (client) => {
          kioskClients.add(client);
        },
        (client) => {
          kioskClients.delete(client);
        },
      );
      return;
    }

    if (path === "/api/v1/kiosk/event") {
      const remoteAddress = getRemoteAddress(req);
      if (!isLanAddress(remoteAddress)) {
        sendError(res, 403, "forbidden", "Forbidden");
        return;
      }
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      readJson(req, 128_000)
        .then((body) => {
          const parsed = body as { type?: unknown };

          if (parsed.type === "KIOSK_PTT_DOWN") {
            enqueueEvent({ type: "KIOSK_PTT_DOWN" }, nowMs());
            sendJson(res, 200, okBody);
            return;
          }

          if (parsed.type === "KIOSK_PTT_UP") {
            enqueueEvent({ type: "KIOSK_PTT_UP" }, nowMs());
            sendJson(res, 200, okBody);
            return;
          }

          sendError(res, 400, "invalid_request", "Invalid request");
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
            max_file_bytes: 2_500_000,
          }),
        )
        .then((upload) => {
          const stt_request_id = upload.stt_request_id;
          if (!stt_request_id || upload.wav.length === 0) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          if (
            !pendingStt.has(stt_request_id) ||
            state.in_flight.stt_request_id !== stt_request_id
          ) {
            sendError(res, 400, "invalid_request", "Invalid request");
            return;
          }
          pendingStt.delete(stt_request_id);

          effectExecutor.transcribeStt({
            request_id: stt_request_id,
            mode: state.mode,
            wav: upload.wav,
          });
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

    if (req.method === "GET") {
      const result = tryServeStaticWeb(req, res, webDistPath, path, staticWebDeps);
      if (result.handled) {
        return;
      }
    }

    sendJson(res, 404, notFoundBody);
  });

  const tickTimer = setInterval(() => {
    sweepExpiredStaffSseClients();
    enqueueEvent({ type: "TICK" }, nowMs());
  }, tickIntervalMs);
  tickTimer.unref();
  server.on("close", () => {
    clearInterval(tickTimer);
    providers.llm.close?.();
  });

  return server;
};
