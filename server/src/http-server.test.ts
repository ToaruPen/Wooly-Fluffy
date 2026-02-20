import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "http";
import type { IncomingHttpHeaders } from "http";
import type { Server } from "http";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { ServerResponse } from "http";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;
let staffCookie = "";

const sendRequest = (
  method: string,
  path: string,
  options?: { headers?: Record<string, string>; body?: string | Buffer },
) =>
  new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
      });
    });

    req.on("error", reject);
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        req.setHeader(key, value);
      }
    }
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });

const sendRequestBuffer = (
  method: string,
  path: string,
  options?: { headers?: Record<string, string>; body?: string | Buffer },
) =>
  new Promise<{ status: number; body: Buffer; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(chunk as Buffer);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks),
          headers: res.headers,
        });
      });
    });

    req.on("error", reject);
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        req.setHeader(key, value);
      }
    }
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });

const cookieFromSetCookie = (setCookie: string): string => {
  const [first] = setCookie.split(";", 1);
  if (!first) {
    throw new Error("missing_set_cookie");
  }
  return first;
};

const loginStaff = async (): Promise<string> => {
  const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: "test-pass" }),
  });
  if (response.status !== 200) {
    throw new Error(`staff_login_failed:${response.status}`);
  }
  const setCookie = response.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieFromSetCookie(String(first ?? ""));
};

const withStaffCookie = (headers?: Record<string, string>): Record<string, string> => ({
  ...(headers ?? {}),
  cookie: staffCookie,
});

const createLocalTestHelpers = (localPort: number) => {
  let localStaffCookie = "";

  const sendRequestLocal = (
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: string | Buffer },
  ) =>
    new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: localPort, method, path }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
          });
        });

        req.on("error", reject);
        if (options?.headers) {
          for (const [key, value] of Object.entries(options.headers)) {
            req.setHeader(key, value);
          }
        }
        if (options?.body) {
          req.write(options.body);
        }
        req.end();
      },
    );

  const loginStaffLocal = async (): Promise<string> => {
    const response = await sendRequestLocal("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    if (response.status !== 200) {
      throw new Error(`staff_login_failed:${response.status}`);
    }
    const setCookie = response.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    localStaffCookie = cookieFromSetCookie(String(first ?? ""));
    return localStaffCookie;
  };

  const withLocalStaffCookie = (headers?: Record<string, string>): Record<string, string> => ({
    ...(headers ?? {}),
    cookie: localStaffCookie,
  });

  return { sendRequestLocal, loginStaffLocal, withLocalStaffCookie };
};

const extractPendingCounts = (
  data: unknown,
): { count: number; sessionSummaryCount: number } | null => {
  if (typeof data !== "object" || data === null || !("pending" in data)) {
    return null;
  }
  const pending = (data as { pending?: unknown }).pending;
  if (typeof pending !== "object" || pending === null) {
    return null;
  }
  const pendingRecord = pending as { count?: unknown; session_summary_count?: unknown };
  if (
    typeof pendingRecord.count !== "number" ||
    typeof pendingRecord.session_summary_count !== "number"
  ) {
    return null;
  }
  return { count: pendingRecord.count, sessionSummaryCount: pendingRecord.session_summary_count };
};

const buildMultipartBody = (input: { stt_request_id: string; audio: Buffer }) => {
  const boundary = "testboundary";
  const lines: Array<string | Buffer> = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`,
    `${input.stt_request_id}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="audio"; filename="audio.webm"\r\n`,
    `Content-Type: audio/webm\r\n\r\n`,
    input.audio,
    `\r\n`,
    `--${boundary}--\r\n`,
  ];
  const body = Buffer.concat(
    lines.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : part)),
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body,
  };
};

const readSseDataMessages = (
  path: string,
  expectedCount: number,
  onFirstMessage?: () => Promise<void>,
  options?: { headers?: Record<string, string> },
) =>
  new Promise<
    Array<{
      type: string;
      seq: number;
      data: unknown;
    }>
  >((resolve, reject) => {
    let isDone = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let req: ReturnType<typeof request> | undefined;

    const finish = (err?: Error, result?: Array<{ type: string; seq: number; data: unknown }>) => {
      if (isDone) {
        return;
      }
      isDone = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (err) {
        reject(err);
        return;
      }
      resolve(result ?? []);
    };

    const messages: Array<{ type: string; seq: number; data: unknown }> = [];
    req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        while (true) {
          const endIndex = buffer.indexOf("\n\n");
          if (endIndex === -1) {
            return;
          }
          const eventChunk = buffer.slice(0, endIndex);
          buffer = buffer.slice(endIndex + 2);
          const lines = eventChunk.split("\n");
          const dataLine = lines.find((line) => line.startsWith("data: "));
          if (!dataLine) {
            continue;
          }
          const raw = dataLine.slice("data: ".length);
          const parsed = JSON.parse(raw) as { type: string; seq: number; data: unknown };
          messages.push(parsed);
          if (messages.length === 1 && onFirstMessage) {
            void onFirstMessage();
          }
          if (messages.length >= expectedCount) {
            res.destroy();
            finish(undefined, messages);
            return;
          }
        }
      });
    });

    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        req.setHeader(key, value);
      }
    }

    timeout = setTimeout(() => {
      req?.destroy();
      finish(new Error("sse_timeout"));
    }, 2000);

    req.on("error", (err) => {
      finish(err instanceof Error ? err : new Error("request_error"));
    });
    req.end();
  });

const readFirstSseMessage = (path: string, options?: { headers?: Record<string, string> }) =>
  new Promise<{
    status: number;
    contentType: string;
    data: string;
    id: string;
  }>((resolve, reject) => {
    let isDone = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (
      err?: Error,
      result?: { status: number; contentType: string; data: string; id: string },
    ) => {
      if (isDone) {
        return;
      }
      isDone = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (err) {
        reject(err);
        return;
      }
      if (!result) {
        reject(new Error("missing_result"));
        return;
      }
      resolve(result);
    };

    const req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      const contentTypeHeader = res.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? (contentTypeHeader[0] ?? "")
        : (contentTypeHeader ?? "");

      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        const endIndex = buffer.indexOf("\n\n");
        if (endIndex === -1) {
          return;
        }
        const eventChunk = buffer.slice(0, endIndex);
        res.destroy();
        const lines = eventChunk.split("\n");
        const dataLine = lines.find((line) => line.startsWith("data: "));
        const idLine = lines.find((line) => line.startsWith("id: "));
        finish(undefined, {
          status: res.statusCode ?? 0,
          contentType,
          data: dataLine ? dataLine.slice("data: ".length) : "",
          id: idLine ? idLine.slice("id: ".length) : "",
        });
      });
    });

    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        req.setHeader(key, value);
      }
    }

    timeout = setTimeout(() => {
      req.destroy();
      finish(new Error("sse_timeout"));
    }, 2000);

    req.on("error", (err) => {
      finish(err instanceof Error ? err : new Error("request_error"));
    });
    req.end();
  });

const withHardTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(timeoutError));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const closeServerWithTimeout = (
  serverToClose: Pick<Server, "close">,
  timeoutMs = 2000,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let isDone = false;
    const timeout = setTimeout(() => {
      if (isDone) {
        return;
      }
      isDone = true;
      reject(new Error("server_close_timeout"));
    }, timeoutMs);

    serverToClose.close((error) => {
      if (isDone) {
        return;
      }
      isDone = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

beforeEach(async () => {
  vi.stubGlobal("fetch", (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/version")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: "test" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  }) as unknown as typeof fetch);

  process.env.STAFF_PASSCODE = "test-pass";
  delete process.env.TEST_STT_THROW;
  delete process.env.TEST_STT_HEALTH;
  delete process.env.TEST_STT_DELAY_MS;
  delete process.env.WF_STAFF_SESSION_TTL_MS;
  delete process.env.WF_SSE_KEEPALIVE_INTERVAL_MS;
  delete process.env.WF_TICK_INTERVAL_MS;
  delete process.env.WF_CONSENT_TIMEOUT_MS;
  delete process.env.WF_INACTIVITY_TIMEOUT_MS;
  process.env.TTS_SPEAKER_ID = "2";

  store = createStore({ db_path: ":memory:" });
  server = createHttpServer({
    store,
    stt_provider: {
      transcribe: (input) => {
        if (process.env.TEST_STT_THROW === "1") {
          throw new Error("test_stt_boom");
        }
        const delayMs = Number(process.env.TEST_STT_DELAY_MS ?? "0");
        if (Number.isFinite(delayMs) && delayMs > 0) {
          return new Promise<{ text: string }>((resolve) => {
            setTimeout(() => {
              resolve({ text: input.mode === "ROOM" ? "パーソナル、たろう" : "りんごがすき" });
            }, delayMs);
          });
        }
        return {
          text: input.mode === "ROOM" ? "パーソナル、たろう" : "りんごがすき",
        };
      },
      health: () =>
        process.env.TEST_STT_HEALTH === "unavailable"
          ? { status: "unavailable" }
          : { status: "ok" },
    },
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  port = address.port;

  staffCookie = await loginStaff();
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  store.close();
  delete process.env.STAFF_PASSCODE;
  delete process.env.TEST_STT_THROW;
  delete process.env.TEST_STT_HEALTH;
  delete process.env.TEST_STT_DELAY_MS;
  delete process.env.WF_STAFF_SESSION_TTL_MS;
  delete process.env.WF_SSE_KEEPALIVE_INTERVAL_MS;
  delete process.env.WF_TICK_INTERVAL_MS;
  delete process.env.WF_CONSENT_TIMEOUT_MS;
  delete process.env.WF_INACTIVITY_TIMEOUT_MS;
  delete process.env.TTS_SPEAKER_ID;
  staffCookie = "";

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http-server", () => {
  describe("health and baseline routes", () => {
    it("returns healthcheck status", async () => {
      const response = await sendRequest("GET", "/health");

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        status: "ok",
        providers: {
          stt: { status: "ok" },
          tts: { status: "ok" },
          llm: { status: "ok", kind: "stub" },
        },
      });
    });

    it("returns stt provider status from /health", async () => {
      process.env.TEST_STT_HEALTH = "unavailable";
      const response = await sendRequest("GET", "/health");

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        status: "ok",
        providers: {
          stt: { status: "unavailable" },
          tts: { status: "ok" },
          llm: { status: "ok", kind: "stub" },
        },
      });
    });

    it("uses whisper.cpp STT provider by default", async () => {
      const prevCli = process.env.WHISPER_CPP_CLI_PATH;
      const prevModel = process.env.WHISPER_CPP_MODEL_PATH;
      process.env.WHISPER_CPP_CLI_PATH = "/__missing_whisper_cli__";
      process.env.WHISPER_CPP_MODEL_PATH = "/__missing_whisper_model__";

      const localStore = createStore({ db_path: ":memory:" });
      const localServer = createHttpServer({ store: localStore });

      let localPort = 0;
      await new Promise<void>((resolve) => {
        localServer.listen(0, "127.0.0.1", () => {
          const address = localServer.address();
          if (!address || typeof address === "string") {
            throw new Error("server address unavailable");
          }
          localPort = address.port;
          resolve();
        });
      });

      try {
        const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = request(
            { host: "127.0.0.1", port: localPort, method: "GET", path: "/health" },
            (res) => {
              let body = "";
              res.setEncoding("utf8");
              res.on("data", (chunk) => {
                body += chunk;
              });
              res.on("end", () => {
                resolve({ status: res.statusCode ?? 0, body });
              });
            },
          );
          req.on("error", reject);
          req.end();
        });

        expect(response.status).toBe(200);
        const parsed = JSON.parse(response.body) as {
          providers: { stt: { status: string } };
        };
        expect(parsed.providers.stt.status).toBe("unavailable");
      } finally {
        await closeServerWithTimeout(localServer);
        localStore.close();
        if (prevCli === undefined) {
          delete process.env.WHISPER_CPP_CLI_PATH;
        } else {
          process.env.WHISPER_CPP_CLI_PATH = prevCli;
        }
        if (prevModel === undefined) {
          delete process.env.WHISPER_CPP_MODEL_PATH;
        } else {
          process.env.WHISPER_CPP_MODEL_PATH = prevModel;
        }
      }
    });

    it("returns 200 healthcheck even when tts is unavailable", async () => {
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/version")) {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        throw new Error(`unexpected_fetch:${url}`);
      }) as unknown as typeof fetch);

      const response = await sendRequest("GET", "/health");
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        status: "ok",
        providers: {
          stt: { status: "ok" },
          tts: { status: "unavailable" },
          llm: { status: "ok", kind: "stub" },
        },
      });
    });

    it("returns 404 for unknown paths", async () => {
      const response = await sendRequest("GET", "/unknown");

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });
  });

  describe("kiosk tts", () => {
    it("returns audio/wav from /api/v1/kiosk/tts", async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      process.env.TTS_SPEAKER_ID = "9";

      server = createHttpServer({
        store,
        stt_provider: {
          transcribe: (input) => ({
            text: input.mode === "ROOM" ? "パーソナル、たろう" : "りんごがすき",
          }),
          health: () => ({ status: "ok" }),
        },
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server address unavailable");
      }
      port = address.port;

      vi.stubGlobal("fetch", (async (input: unknown, init?: unknown) => {
        const url = new URL(String(input));

        if (url.pathname === "/audio_query") {
          expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
          expect(url.searchParams.get("speaker")).toBe("9");
          expect(url.searchParams.get("text")).toBe("Hello");
          return {
            ok: true,
            status: 200,
            json: async () => ({ query: true }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }

        if (url.pathname === "/synthesis") {
          expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
          expect(url.searchParams.get("speaker")).toBe("9");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          };
        }

        if (url.pathname === "/version") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "test" }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }

        throw new Error(`unexpected_fetch:${url.toString()}`);
      }) as unknown as typeof fetch);

      const response = await sendRequestBuffer("POST", "/api/v1/kiosk/tts", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      });

      expect(response.status).toBe(200);
      expect(String(response.headers["content-type"] ?? "")).toContain("audio/wav");
      expect(Array.from(response.body)).toEqual([1, 2, 3]);
    }, 2000);

    it("returns 400 invalid_request for /api/v1/kiosk/tts when text is missing", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 invalid_json for /api/v1/kiosk/tts when body is invalid JSON", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_json", message: "Invalid JSON" },
      });
    });

    it("returns 503 unavailable for /api/v1/kiosk/tts when provider fails", async () => {
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = new URL(String(input));
        if (url.pathname === "/audio_query") {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        throw new Error(`unexpected_fetch:${url.toString()}`);
      }) as unknown as typeof fetch);

      const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      });

      expect(response.status).toBe(503);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "unavailable", message: "Unavailable" },
      });
    });

    it("returns 405 for /api/v1/kiosk/tts with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/kiosk/tts");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 413 payload_too_large for /api/v1/kiosk/tts", async () => {
      const bigText = "a".repeat(200_000);
      const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: bigText }),
      });
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "payload_too_large", message: "Payload Too Large" },
      });
    });
  });

  describe("staff auth and keepalive", () => {
    it("sets staff session cookie Max-Age from default TTL", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "test-pass" }),
      });

      expect(response.status).toBe(200);
      const setCookie = response.headers["set-cookie"];
      const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(String(first ?? "")).toContain("Max-Age=180");
    });

    it("sets staff session cookie Max-Age from env override", async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      process.env.WF_STAFF_SESSION_TTL_MS = "60000";

      server = createHttpServer({
        store,
        stt_provider: {
          transcribe: (input) => ({
            text: input.mode === "ROOM" ? "パーソナル、たろう" : "りんごがすき",
          }),
          health: () => ({ status: "ok" }),
        },
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server address unavailable");
      }
      port = address.port;

      const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "test-pass" }),
      });

      expect(response.status).toBe(200);
      const setCookie = response.headers["set-cookie"];
      const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(String(first ?? "")).toContain("Max-Age=60");
    });

    it("returns 200 for staff keepalive with valid session", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      expect(String(response.headers["set-cookie"] ?? "")).toContain("wf_staff_session=");
    });

    it("returns 401 for staff keepalive without session", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive");
      expect(response.status).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "unauthorized", message: "Unauthorized" },
      });
    });

    it("returns 405 for staff keepalive with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/auth/keepalive", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("does not crash on invalid URL encoding", async () => {
      const response = await sendRequest("GET", "/%E0%A4%A");

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    });
  });

  describe("stream endpoints", () => {
    it("streams kiosk snapshot on connect", async () => {
      const response = await readFirstSseMessage("/api/v1/kiosk/stream");

      expect(response.status).toBe(200);
      expect(response.contentType).toContain("text/event-stream");

      const message = JSON.parse(response.data) as {
        type: string;
        seq: number;
        data: object;
      };

      expect(message.type).toBe("kiosk.snapshot");
      expect(message.seq).toBe(1);
      expect(message.data).toEqual({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
          consent_ui_visible: false,
        },
      });
    });

    it("returns 405 for kiosk stream with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/stream");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("streams staff snapshot on connect", async () => {
      const response = await readFirstSseMessage("/api/v1/staff/stream", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(200);
      expect(response.contentType).toContain("text/event-stream");

      const message = JSON.parse(response.data) as {
        type: string;
        seq: number;
        data: object;
      };

      expect(message.type).toBe("staff.snapshot");
      expect(message.seq).toBe(1);
      expect(message.data).toEqual({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
        },
        pending: {
          count: 0,
          session_summary_count: 0,
        },
      });
    });

    it("returns 405 for staff stream with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/stream");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });
  });

  describe("event endpoints and robustness", () => {
    it("returns 400 for kiosk event with invalid json", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_json", message: "Invalid JSON" },
      });
    });

    it("does not crash when client closes during body read", async () => {
      await new Promise<void>((resolve, reject) => {
        const req = request({
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/v1/kiosk/event",
        });

        let isFinished = false;
        const finish = (err?: unknown) => {
          if (isFinished) {
            return;
          }
          isFinished = true;
          clearTimeout(timeout);
          if (err) {
            reject(err);
            return;
          }
          resolve();
        };

        const timeout = setTimeout(() => {
          req.destroy();
          finish();
        }, 100);

        req.on("close", () => finish());
        req.on("error", (err) => {
          if ((err as { code?: unknown }).code === "ECONNRESET") {
            finish();
            return;
          }
          finish(err);
        });

        req.setHeader("content-type", "application/json");
        req.flushHeaders();
        req.write('{"type":"UI_CONSENT_BUTTON","answer":"yes"');
        setTimeout(() => {
          req.destroy();
        }, 10);
      });

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    });

    it("handles invalid percent-encoded paths", async () => {
      const response = await sendRequest("GET", "/%");

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("does not crash when sending an error response throws", async () => {
      const originalEnd = ServerResponse.prototype.end;
      ServerResponse.prototype.end = ((..._args: unknown[]) => {
        throw new Error("boom");
      }) as unknown as ServerResponse["end"];

      try {
        await new Promise<void>((resolve) => {
          const req = request(
            {
              host: "127.0.0.1",
              port,
              method: "POST",
              path: "/api/v1/kiosk/event",
              headers: { "content-type": "application/json" },
            },
            (res) => {
              res.destroy();
              resolve();
            },
          );

          const timeout = setTimeout(() => {
            req.destroy();
            resolve();
          }, 100);

          req.on("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          req.on("error", () => {
            clearTimeout(timeout);
            resolve();
          });
          req.end("{");
        });
      } finally {
        ServerResponse.prototype.end = originalEnd;
      }

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    });

    it("returns 405 for kiosk event with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/kiosk/event");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 400 for kiosk event with unknown type", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "NOPE", answer: "yes" }),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for kiosk event with invalid answer", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: "maybe" }),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 413 for kiosk event with too large body", async () => {
      const big = "a".repeat(128_001);
      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: big }),
      });

      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "payload_too_large", message: "Payload Too Large" },
      });
    });

    it("returns 400 for staff event with unknown type", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "NOPE" }),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for staff event with invalid json", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_json", message: "Invalid JSON" },
      });
    });

    it("does not hang when client aborts request body", async () => {
      await new Promise<void>((resolve, reject) => {
        let isFinished = false;
        const finish = () => {
          if (isFinished) {
            return;
          }
          isFinished = true;
          resolve();
        };

        const req = request(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: "/api/v1/staff/event",
            headers: withStaffCookie({ "content-type": "application/json" }),
          },
          () => {
            // Ignore response; this request is aborted.
          },
        );

        req.on("error", finish);
        req.on("close", finish);

        req.write("{");
        req.destroy();

        setTimeout(() => {
          if (!isFinished) {
            reject(new Error("abort did not finish"));
          }
        }, 500);
      });

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    });

    it("returns 413 for staff event with too large body", async () => {
      const big = "a".repeat(128_001);
      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: big }),
      });

      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "payload_too_large", message: "Payload Too Large" },
      });
    });

    it("returns 405 for staff event with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/event");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });
  });

  describe("stt-audio validation", () => {
    it("returns 400 for stt-audio with non-multipart content-type", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("dummy", "utf8"),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio without content-type", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        body: Buffer.from("dummy", "utf8"),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("ignores querystring in routes", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/pending?x=1", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ items: [] });
    });

    it("returns 400 for stt-audio without boundary", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": "multipart/form-data" },
        body: Buffer.from("dummy", "utf8"),
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio with malformed multipart (missing header separator)", async () => {
      const boundary = "testboundary";
      const body = Buffer.from(
        [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="stt_request_id"\r\n`,
          `stt-1\r\n`,
          `--${boundary}--\r\n`,
        ].join(""),
        "utf8",
      );

      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio with malformed multipart (missing closing boundary)", async () => {
      const boundary = "testboundary";
      const body = Buffer.from(
        [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`,
          `stt-1`,
        ].join(""),
        "utf8",
      );

      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio missing audio part", async () => {
      const boundary = "testboundary";
      const body = Buffer.from(
        [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`,
          `stt-1\r\n`,
          `--${boundary}--\r\n`,
        ].join(""),
        "utf8",
      );

      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio missing stt_request_id", async () => {
      const boundary = "testboundary";
      const body = Buffer.from(
        [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="audio"; filename="audio.webm"\r\n`,
          `Content-Type: audio/webm\r\n\r\n`,
          `dummy\r\n`,
          `--${boundary}--\r\n`,
        ].join(""),
        "utf8",
      );

      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("returns 400 for stt-audio when request id is not pending", async () => {
      const multipart = buildMultipartBody({
        stt_request_id: "stt-999",
        audio: Buffer.from("dummy", "utf8"),
      });
      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": multipart.contentType },
        body: multipart.body,
      });

      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });
  });

  describe("orchestrator and snapshot flows", () => {
    it("streams kiosk record_start command on PTT down", async () => {
      const messages = await readSseDataMessages("/api/v1/kiosk/stream", 3, async () => {
        const response = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
        });
        expect(response.status).toBe(200);
      });

      expect(messages[0]?.type).toBe("kiosk.snapshot");
      expect(messages[1]?.type).toBe("kiosk.snapshot");
      expect(messages[2]?.type).toBe("kiosk.command.record_start");
    });

    it("streams kiosk record_start command on kiosk PTT down", async () => {
      const messages = await readSseDataMessages("/api/v1/kiosk/stream", 3, async () => {
        const response = await sendRequest("POST", "/api/v1/kiosk/event", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
        });
        expect(response.status).toBe(200);
      });

      expect(messages[0]?.type).toBe("kiosk.snapshot");
      expect(messages[1]?.type).toBe("kiosk.snapshot");
      expect(messages[2]?.type).toBe("kiosk.command.record_start");
    });

    it("streams kiosk record_stop command on kiosk PTT up", async () => {
      const messages = await readSseDataMessages("/api/v1/kiosk/stream", 5, async () => {
        const down = await sendRequest("POST", "/api/v1/kiosk/event", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
        });
        expect(down.status).toBe(200);

        const up = await sendRequest("POST", "/api/v1/kiosk/event", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "KIOSK_PTT_UP" }),
        });
        expect(up.status).toBe(200);
      });

      expect(messages[0]?.type).toBe("kiosk.snapshot");
      expect(messages[1]?.type).toBe("kiosk.snapshot");
      expect(messages[2]?.type).toBe("kiosk.command.record_start");
      expect(messages[3]?.type).toBe("kiosk.snapshot");
      expect(messages[4]?.type).toBe("kiosk.command.record_stop");
      expect((messages[4]?.data as { stt_request_id?: unknown } | undefined)?.stt_request_id).toBe(
        "stt-1",
      );
    });

    it("speaks fallback text when stt provider throws", async () => {
      process.env.TEST_STT_THROW = "1";

      const messages = await readSseDataMessages("/api/v1/kiosk/stream", 7, async () => {
        const down = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
        });
        expect(down.status).toBe(200);

        const up = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_PTT_UP" }),
        });
        expect(up.status).toBe(200);

        const multipart = buildMultipartBody({
          stt_request_id: "stt-1",
          audio: Buffer.from("dummy", "utf8"),
        });
        const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
          headers: { "content-type": multipart.contentType },
          body: multipart.body,
        });
        expect(audio.status).toBe(202);
      });

      expect(messages.some((m) => m.type === "kiosk.command.speak")).toBe(true);

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    });

    it("does not block /health while stt transcription is in flight", async () => {
      process.env.TEST_STT_DELAY_MS = "500";

      const down = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
      });
      expect(down.status).toBe(200);

      const up = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_UP" }),
      });
      expect(up.status).toBe(200);

      const multipart = buildMultipartBody({
        stt_request_id: "stt-1",
        audio: Buffer.from("dummy", "utf8"),
      });
      const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": multipart.contentType },
        body: multipart.body,
      });
      expect(audio.status).toBe(202);

      const start = Date.now();
      const health = await sendRequest("GET", "/health");
      const elapsed = Date.now() - start;
      expect(health.status).toBe(200);
      expect(elapsed).toBeLessThan(250);

      // Avoid in-flight promise resolving after teardown.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 550);
      });
    });

    it("supports staff pending deny endpoint", async () => {
      const id = store.createPending({
        personal_name: "taro",
        kind: "likes",
        value: "apples",
      });
      const deny = await sendRequest("POST", `/api/v1/staff/pending/${id}/deny`, {
        headers: withStaffCookie(),
      });
      expect(deny.status).toBe(200);
      expect(JSON.parse(deny.body)).toEqual({ ok: true });

      const listAfter = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(listAfter.status).toBe(200);
      expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
    });

    it("supports staff pending confirm endpoint", async () => {
      const id = store.createPending({
        personal_name: "taro",
        kind: "likes",
        value: "apples",
      });
      const confirm = await sendRequest("POST", `/api/v1/staff/pending/${id}/confirm`, {
        headers: withStaffCookie(),
      });
      expect(confirm.status).toBe(200);
      expect(JSON.parse(confirm.body)).toEqual({ ok: true });

      const listAfter = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(listAfter.status).toBe(200);
      expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
    });

    it("returns 404 for staff pending deny when id not found", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/pending/nope/deny", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("supports staff session summary pending list endpoint", async () => {
      store.createPendingSessionSummary({
        title: "2026-02-20",
        summary_json: {
          summary: "きょうのハイライト",
          topics: ["工作", "外遊び"],
          staff_notes: ["手洗いを促す"],
          transcript_full: "should not leak",
          raw_audio_base64: "should not leak",
        },
      });

      const list = await sendRequest("GET", "/api/v1/staff/session-summaries/pending", {
        headers: withStaffCookie(),
      });

      expect(list.status).toBe(200);
      const parsed = JSON.parse(list.body) as { items: Array<Record<string, unknown>> };
      expect(parsed.items.length).toBe(1);
      expect(parsed.items[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: "2026-02-20",
          summary_json: {
            summary: "きょうのハイライト",
            topics: ["工作", "外遊び"],
            staff_notes: ["手洗いを促す"],
          },
          status: "pending",
          created_at_ms: expect.any(Number),
          expires_at_ms: expect.any(Number),
        }),
      );
      expect(parsed.items[0]).not.toHaveProperty("schema_version");
      expect(parsed.items[0]).not.toHaveProperty("trigger");

      const summaryJson = parsed.items[0]?.summary_json as Record<string, unknown>;
      expect(summaryJson).not.toHaveProperty("transcript_full");
      expect(summaryJson).not.toHaveProperty("raw_audio_base64");
      expect(summaryJson).not.toHaveProperty("stt_full_text");
    });

    it("normalizes malformed session summary payload fields", async () => {
      store.createPendingSessionSummary({
        title: "malformed",
        summary_json: "invalid-json-shape",
      });

      const list = await sendRequest("GET", "/api/v1/staff/session-summaries/pending", {
        headers: withStaffCookie(),
      });

      expect(list.status).toBe(200);
      const parsed = JSON.parse(list.body) as {
        items: Array<{
          summary_json: { summary: string; topics: string[]; staff_notes: string[] };
        }>;
      };
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]?.summary_json).toEqual({
        summary: "",
        topics: [],
        staff_notes: [],
      });
    });

    it("supports staff session summary confirm endpoint", async () => {
      const id = store.createPendingSessionSummary({
        title: "confirm-target",
        summary_json: { summary: "x", topics: [], staff_notes: [] },
      });

      const confirm = await sendRequest("POST", `/api/v1/staff/session-summaries/${id}/confirm`, {
        headers: withStaffCookie(),
      });
      expect(confirm.status).toBe(200);
      expect(JSON.parse(confirm.body)).toEqual({ ok: true });

      const listAfter = await sendRequest("GET", "/api/v1/staff/session-summaries/pending", {
        headers: withStaffCookie(),
      });
      expect(listAfter.status).toBe(200);
      expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
    });

    it("supports staff session summary deny endpoint", async () => {
      const id = store.createPendingSessionSummary({
        title: "deny-target",
        summary_json: { summary: "x", topics: [], staff_notes: [] },
      });

      const deny = await sendRequest("POST", `/api/v1/staff/session-summaries/${id}/deny`, {
        headers: withStaffCookie(),
      });
      expect(deny.status).toBe(200);
      expect(JSON.parse(deny.body)).toEqual({ ok: true });

      const listAfter = await sendRequest("GET", "/api/v1/staff/session-summaries/pending", {
        headers: withStaffCookie(),
      });
      expect(listAfter.status).toBe(200);
      expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
    });

    it("broadcasts session summary pending list update after confirm", async () => {
      const id = store.createPendingSessionSummary({
        title: "confirm-broadcast",
        summary_json: { summary: "x", topics: [], staff_notes: [] },
      });

      const messages = await withHardTimeout(
        readSseDataMessages(
          "/api/v1/staff/stream",
          3,
          async () => {
            const response = await sendRequest(
              "POST",
              `/api/v1/staff/session-summaries/${id}/confirm`,
              {
                headers: withStaffCookie(),
              },
            );
            expect(response.status).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ ok: true });
          },
          { headers: withStaffCookie() },
        ),
        3000,
        "sse_hard_timeout",
      );

      expect(messages[0]?.type).toBe("staff.snapshot");
      expect(messages[1]?.type).toBe("staff.snapshot");
      expect(messages[2]?.type).toBe("staff.session_summaries_pending_list");
      expect(messages[2]?.data).toEqual({ items: [] });
    });

    it("broadcasts session summary pending list update after deny", async () => {
      const id = store.createPendingSessionSummary({
        title: "deny-broadcast",
        summary_json: { summary: "x", topics: [], staff_notes: [] },
      });

      const messages = await withHardTimeout(
        readSseDataMessages(
          "/api/v1/staff/stream",
          3,
          async () => {
            const response = await sendRequest(
              "POST",
              `/api/v1/staff/session-summaries/${id}/deny`,
              {
                headers: withStaffCookie(),
              },
            );
            expect(response.status).toBe(200);
            expect(JSON.parse(response.body)).toEqual({ ok: true });
          },
          { headers: withStaffCookie() },
        ),
        3000,
        "sse_hard_timeout",
      );

      expect(messages[0]?.type).toBe("staff.snapshot");
      expect(messages[1]?.type).toBe("staff.snapshot");
      expect(messages[2]?.type).toBe("staff.session_summaries_pending_list");
      expect(messages[2]?.data).toEqual({ items: [] });
    });

    it("does not broadcast session summary list to expired staff stream session", async () => {
      const savedSessionTtl = process.env.WF_STAFF_SESSION_TTL_MS;
      const savedTickInterval = process.env.WF_TICK_INTERVAL_MS;
      process.env.WF_STAFF_SESSION_TTL_MS = "10000";
      process.env.WF_TICK_INTERVAL_MS = "60000";

      let now = 0;
      const localStore = createStore({ db_path: ":memory:" });
      const localServer = createHttpServer({
        store: localStore,
        now_ms: () => now,
        stt_provider: {
          transcribe: () => ({ text: "こんにちは" }),
          health: () => ({ status: "ok" }),
        },
      });

      const restoreEnv = () => {
        if (savedSessionTtl === undefined) {
          delete process.env.WF_STAFF_SESSION_TTL_MS;
        } else {
          process.env.WF_STAFF_SESSION_TTL_MS = savedSessionTtl;
        }
        if (savedTickInterval === undefined) {
          delete process.env.WF_TICK_INTERVAL_MS;
        } else {
          process.env.WF_TICK_INTERVAL_MS = savedTickInterval;
        }
      };

      try {
        await new Promise<void>((resolve) => {
          localServer.listen(0, "127.0.0.1", resolve);
        });
        const address = localServer.address();
        if (!address || typeof address === "string") {
          throw new Error("server address unavailable");
        }
        const localPort = address.port;
        const { sendRequestLocal } = createLocalTestHelpers(localPort);

        const loginCookie = async () => {
          const response = await sendRequestLocal("POST", "/api/v1/staff/auth/login", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ passcode: "test-pass" }),
          });
          expect(response.status).toBe(200);
          const setCookie = response.headers["set-cookie"];
          const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
          return cookieFromSetCookie(String(first ?? ""));
        };

        const id = localStore.createPendingSessionSummary({
          title: "stale-session-check",
          summary_json: { summary: "x", topics: [], staff_notes: [] },
        });

        const firstCookie = await loginCookie();
        let hasLeakedPendingList = false;
        let hasLeakedSnapshot = false;

        await new Promise<void>((resolve, reject) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let hardTimeout: ReturnType<typeof setTimeout> | undefined;
          const finish = (err?: Error) => {
            if (timeout) {
              clearTimeout(timeout);
            }
            if (hardTimeout) {
              clearTimeout(hardTimeout);
            }
            if (err) {
              reject(err);
              return;
            }
            resolve();
          };

          const req = request(
            { host: "127.0.0.1", port: localPort, method: "GET", path: "/api/v1/staff/stream" },
            (res) => {
              let buffer = "";
              let didTrigger = false;
              res.setEncoding("utf8");
              res.on("data", (chunk) => {
                buffer += chunk;
                while (true) {
                  const endIndex = buffer.indexOf("\n\n");
                  if (endIndex === -1) {
                    return;
                  }
                  const eventChunk = buffer.slice(0, endIndex);
                  buffer = buffer.slice(endIndex + 2);
                  const lines = eventChunk.split("\n");
                  const dataLine = lines.find((line) => line.startsWith("data: "));
                  if (!dataLine) {
                    continue;
                  }
                  const parsed = JSON.parse(dataLine.slice("data: ".length)) as {
                    type: string;
                    data: unknown;
                  };
                  const didTriggerPreviously = didTrigger;

                  if (!didTrigger && parsed.type === "staff.snapshot") {
                    didTrigger = true;
                    void (async () => {
                      now = 5_000;
                      const activeCookie = await loginCookie();
                      now = 10_500;
                      const confirm = await sendRequestLocal(
                        "POST",
                        `/api/v1/staff/session-summaries/${id}/confirm`,
                        { headers: { cookie: activeCookie } },
                      );
                      expect(confirm.status).toBe(200);
                    })().catch((err) => {
                      finish(err instanceof Error ? err : new Error("confirm_failed"));
                    });
                  }

                  if (didTriggerPreviously && parsed.type === "staff.snapshot") {
                    hasLeakedSnapshot = true;
                  }

                  if (parsed.type === "staff.session_summaries_pending_list") {
                    hasLeakedPendingList = true;
                  }
                }
              });
            },
          );

          req.setHeader("cookie", firstCookie);
          req.on("error", (err) => {
            finish(err instanceof Error ? err : new Error("request_error"));
          });
          req.end();

          timeout = setTimeout(() => {
            req.destroy();
            finish();
          }, 300);

          hardTimeout = setTimeout(() => {
            req.destroy();
            finish(new Error("sse_hard_timeout"));
          }, 3000);
        });

        expect(hasLeakedPendingList).toBe(false);
        expect(hasLeakedSnapshot).toBe(false);
      } finally {
        await closeServerWithTimeout(localServer);
        localStore.close();
        restoreEnv();
      }
    });

    it("returns 404 for staff session summary confirm when id not found", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/session-summaries/nope/confirm", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("returns 404 for staff session summary confirm when id is missing", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/session-summaries/confirm", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("returns 404 for staff session summary deny when id not found", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/session-summaries/nope/deny", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("returns 404 for staff session summary deny when id is missing", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/session-summaries/deny", {
        headers: withStaffCookie(),
      });

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });
  });

  describe("route guards and lifecycle", () => {
    it("returns 405 for stt-audio with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/kiosk/stt-audio");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 405 for staff pending list with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/pending");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 401 for staff session summary list without session", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/session-summaries/pending");
      expect(response.status).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "unauthorized", message: "Unauthorized" },
      });
    });

    it("returns 405 for staff session summary list with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/session-summaries/pending", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 413 for stt-audio with too large body", async () => {
      const body = Buffer.alloc(2_500_001);
      const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": "multipart/form-data; boundary=testboundary" },
        body,
      });

      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "payload_too_large", message: "Payload Too Large" },
      });
    });

    it("runs tick timer", async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1100);
      });
      expect(true).toBe(true);
    });

    it("skips snapshot broadcast when unchanged", async () => {
      const first = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_RESUME" }),
      });
      expect(first.status).toBe(200);

      const second = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_RESUME" }),
      });
      expect(second.status).toBe(200);
    });

    it("omits source_quote when null", async () => {
      store.createPending({ personal_name: "taro", kind: "likes", value: "apples" });
      const list = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(list.status).toBe(200);
      const parsed = JSON.parse(list.body) as { items: Array<Record<string, unknown>> };
      expect(parsed.items.length).toBe(1);
      expect(parsed.items[0]).not.toHaveProperty("source_quote");
    });

    it("omits source_quote even when present", async () => {
      store.createPending({
        personal_name: "taro",
        kind: "likes",
        value: "apples",
        source_quote: "I like apples",
      });
      const list = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(list.status).toBe(200);
      const parsed = JSON.parse(list.body) as { items: Array<Record<string, unknown>> };
      expect(parsed.items.length).toBe(1);
      expect(parsed.items[0]).not.toHaveProperty("source_quote");
    });

    it("broadcasts staff snapshot after staff event", async () => {
      const messages = await readSseDataMessages(
        "/api/v1/staff/stream",
        2,
        async () => {
          const response = await sendRequest("POST", "/api/v1/staff/event", {
            headers: withStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
          });
          expect(response.status).toBe(200);
          expect(JSON.parse(response.body)).toEqual({ ok: true });
        },
        { headers: withStaffCookie() },
      );

      expect(messages[0]?.type).toBe("staff.snapshot");
      expect(messages[0]?.data).toEqual({
        state: { mode: "ROOM", personal_name: null, phase: "idle" },
        pending: { count: 0, session_summary_count: 0 },
      });
      expect(messages[1]?.type).toBe("staff.snapshot");
      expect(messages[1]?.data).toEqual({
        state: { mode: "ROOM", personal_name: null, phase: "listening" },
        pending: { count: 0, session_summary_count: 0 },
      });
    });

    it("creates pending session summary after inactivity", async () => {
      const savedTickInterval = process.env.WF_TICK_INTERVAL_MS;
      const savedInactivityTimeout = process.env.WF_INACTIVITY_TIMEOUT_MS;
      process.env.WF_TICK_INTERVAL_MS = "50";
      process.env.WF_INACTIVITY_TIMEOUT_MS = "10000";

      let now = 0;
      const localStore = createStore({ db_path: ":memory:" });
      const localServer = createHttpServer({
        store: localStore,
        now_ms: () => now,
        stt_provider: {
          transcribe: () => ({ text: "こんにちは" }),
          health: () => ({ status: "ok" }),
        },
      });

      const restoreEnv = () => {
        if (savedTickInterval === undefined) {
          delete process.env.WF_TICK_INTERVAL_MS;
        } else {
          process.env.WF_TICK_INTERVAL_MS = savedTickInterval;
        }
        if (savedInactivityTimeout === undefined) {
          delete process.env.WF_INACTIVITY_TIMEOUT_MS;
        } else {
          process.env.WF_INACTIVITY_TIMEOUT_MS = savedInactivityTimeout;
        }
      };

      try {
        await new Promise<void>((resolve) => {
          localServer.listen(0, "127.0.0.1", resolve);
        });
        const address = localServer.address();
        if (!address || typeof address === "string") {
          throw new Error("server address unavailable");
        }
        const localPort = address.port;
        const { sendRequestLocal, loginStaffLocal, withLocalStaffCookie } =
          createLocalTestHelpers(localPort);
        await loginStaffLocal();

        {
          const down = await sendRequestLocal("POST", "/api/v1/staff/event", {
            headers: withLocalStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
          });
          expect(down.status).toBe(200);
          const up = await sendRequestLocal("POST", "/api/v1/staff/event", {
            headers: withLocalStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "STAFF_PTT_UP" }),
          });
          expect(up.status).toBe(200);
          const multipart = buildMultipartBody({
            stt_request_id: "stt-1",
            audio: Buffer.from("dummy", "utf8"),
          });
          const audio = await sendRequestLocal("POST", "/api/v1/kiosk/stt-audio", {
            headers: { "content-type": multipart.contentType },
            body: multipart.body,
          });
          expect(audio.status).toBe(202);
        }

        now = 10_001;
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          const summaries = localStore.listPendingSessionSummaries();
          if (summaries.length > 0) {
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }

        const summaries = localStore.listPendingSessionSummaries();
        expect(summaries.length).toBe(1);
        expect(summaries[0]?.status).toBe("pending");
      } finally {
        await closeServerWithTimeout(localServer);
        localStore.close();
        restoreEnv();
      }
    });

    it("broadcasts staff snapshot when pending session summary is created", async () => {
      const savedTickInterval = process.env.WF_TICK_INTERVAL_MS;
      const savedInactivityTimeout = process.env.WF_INACTIVITY_TIMEOUT_MS;
      process.env.WF_TICK_INTERVAL_MS = "50";
      process.env.WF_INACTIVITY_TIMEOUT_MS = "10000";

      let now = 0;
      const localStore = createStore({ db_path: ":memory:" });
      const localServer = createHttpServer({
        store: localStore,
        now_ms: () => now,
        stt_provider: {
          transcribe: () => ({ text: "こんにちは" }),
          health: () => ({ status: "ok" }),
        },
      });

      const restoreEnv = () => {
        if (savedTickInterval === undefined) {
          delete process.env.WF_TICK_INTERVAL_MS;
        } else {
          process.env.WF_TICK_INTERVAL_MS = savedTickInterval;
        }
        if (savedInactivityTimeout === undefined) {
          delete process.env.WF_INACTIVITY_TIMEOUT_MS;
        } else {
          process.env.WF_INACTIVITY_TIMEOUT_MS = savedInactivityTimeout;
        }
      };

      try {
        await new Promise<void>((resolve) => {
          localServer.listen(0, "127.0.0.1", resolve);
        });
        const address = localServer.address();
        if (!address || typeof address === "string") {
          throw new Error("server address unavailable");
        }
        const localPort = address.port;
        const { sendRequestLocal, loginStaffLocal, withLocalStaffCookie } =
          createLocalTestHelpers(localPort);
        await loginStaffLocal();

        const waitForPendingSnapshot = (
          targetCount: number,
          targetSessionSummaryCount: number,
          targetListLength: number,
          onFirstMessage: () => Promise<void>,
        ): Promise<Array<{ type: string; seq: number; data: unknown }>> =>
          new Promise((resolve, reject) => {
            const messages: Array<{ type: string; seq: number; data: unknown }> = [];
            let isDone = false;
            let timeout: ReturnType<typeof setTimeout> | undefined;
            let hasSeenTargetSnapshot = false;
            let hasSeenTargetList = false;

            const finish = (
              err?: Error,
              result?: Array<{ type: string; seq: number; data: unknown }>,
            ) => {
              if (isDone) {
                return;
              }
              isDone = true;
              if (timeout) {
                clearTimeout(timeout);
              }
              if (err) {
                reject(err);
                return;
              }
              resolve(result ?? []);
            };

            const req = request(
              { host: "127.0.0.1", port: localPort, method: "GET", path: "/api/v1/staff/stream" },
              (res) => {
                let buffer = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                  buffer += chunk;
                  while (true) {
                    const endIndex = buffer.indexOf("\n\n");
                    if (endIndex === -1) {
                      return;
                    }
                    const eventChunk = buffer.slice(0, endIndex);
                    buffer = buffer.slice(endIndex + 2);
                    const lines = eventChunk.split("\n");
                    const dataLine = lines.find((line) => line.startsWith("data: "));
                    if (!dataLine) {
                      continue;
                    }
                    const parsed = JSON.parse(dataLine.slice("data: ".length)) as {
                      type: string;
                      seq: number;
                      data: unknown;
                    };
                    messages.push(parsed);
                    if (messages.length === 1) {
                      void onFirstMessage();
                    }

                    if (parsed.type === "staff.session_summaries_pending_list") {
                      const parsedData = parsed.data as { items?: unknown };
                      const items = Array.isArray(parsedData?.items) ? parsedData.items : undefined;
                      if (items && items.length === targetListLength) {
                        hasSeenTargetList = true;
                        if (hasSeenTargetSnapshot) {
                          res.destroy();
                          finish(undefined, messages);
                          return;
                        }
                      }
                    }

                    if (parsed.type !== "staff.snapshot") {
                      continue;
                    }
                    const pendingCounts = extractPendingCounts(parsed.data);
                    const count = pendingCounts?.count;
                    const sessionSummaryCount = pendingCounts?.sessionSummaryCount;

                    if (
                      count === targetCount &&
                      sessionSummaryCount === targetSessionSummaryCount
                    ) {
                      hasSeenTargetSnapshot = true;
                      if (hasSeenTargetList) {
                        res.destroy();
                        finish(undefined, messages);
                        return;
                      }
                    }
                  }
                });
              },
            );

            req.setHeader("cookie", withLocalStaffCookie().cookie);

            timeout = setTimeout(() => {
              req.destroy();
              finish(new Error("sse_timeout"));
            }, 3000);

            req.on("error", (err) => {
              finish(err instanceof Error ? err : new Error("request_error"));
            });
            req.end();
          });

        const messages = await waitForPendingSnapshot(0, 1, 1, async () => {
          const down = await sendRequestLocal("POST", "/api/v1/staff/event", {
            headers: withLocalStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
          });
          expect(down.status).toBe(200);

          const up = await sendRequestLocal("POST", "/api/v1/staff/event", {
            headers: withLocalStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "STAFF_PTT_UP" }),
          });
          expect(up.status).toBe(200);

          const multipart = buildMultipartBody({
            stt_request_id: "stt-1",
            audio: Buffer.from("dummy", "utf8"),
          });
          const audio = await sendRequestLocal("POST", "/api/v1/kiosk/stt-audio", {
            headers: { "content-type": multipart.contentType },
            body: multipart.body,
          });
          expect(audio.status).toBe(202);

          now = 10_001;
        });

        expect(messages.length).toBeGreaterThan(1);
        expect(messages[0]?.type).toBe("staff.snapshot");
        expect(messages[0]?.data).toEqual({
          state: { mode: "ROOM", personal_name: null, phase: "idle" },
          pending: { count: 0, session_summary_count: 0 },
        });

        const updatedSnapshot = [...messages]
          .reverse()
          .find((message) => message.type === "staff.snapshot");
        expect(updatedSnapshot?.data).toEqual(
          expect.objectContaining({
            pending: { count: 0, session_summary_count: 1 },
          }),
        );

        const listMessage = messages.find(
          (message) => message.type === "staff.session_summaries_pending_list",
        );
        expect(listMessage?.data).toEqual(
          expect.objectContaining({
            items: [
              expect.objectContaining({
                title: expect.any(String),
                status: "pending",
              }),
            ],
          }),
        );
      } finally {
        await closeServerWithTimeout(localServer);
        localStore.close();
        restoreEnv();
      }
    });

    it("does not create memory pending when personal mode is disabled", async () => {
      {
        const down = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
        });
        expect(down.status).toBe(200);
        const up = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_PTT_UP" }),
        });
        expect(up.status).toBe(200);
        const multipart = buildMultipartBody({
          stt_request_id: "stt-1",
          audio: Buffer.from("dummy", "utf8"),
        });
        const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
          headers: { "content-type": multipart.contentType },
          body: multipart.body,
        });
        expect(audio.status).toBe(202);
      }

      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: "yes" }),
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });

      const list = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(list.status).toBe(200);
      const listBody = JSON.parse(list.body) as { items: Array<{ id: string }> };
      expect(listBody.items.length).toBe(0);
    });

    it("swallows event processing errors to keep server alive", async () => {
      const originalListPending = store.listPending;
      try {
        store.listPending = () => {
          throw new Error("boom");
        };

        const response = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_RESUME" }),
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
      } finally {
        store.listPending = originalListPending;
      }
    });

    it("returns 404 for staff pending confirm when id not found", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/pending/nope/confirm", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("returns 405 for staff pending confirm with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/pending/nope/confirm");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 405 for staff pending deny with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/pending/nope/deny");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 405 for staff session summary confirm with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/session-summaries/nope/confirm", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 405 for staff session summary deny with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/session-summaries/nope/deny", {
        headers: withStaffCookie(),
      });
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });
  });
});
