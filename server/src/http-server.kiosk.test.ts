import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "http";
import type { IncomingHttpHeaders } from "http";
import type { Server } from "http";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { createHttpTestHelpers } from "./test-helpers/http.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;

const helpers = createHttpTestHelpers(() => port);
const { sendRequest, sendRequestBuffer, cookieFromSetCookie, loginStaff, withStaffCookie } =
  helpers;

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
            void onFirstMessage().catch((err: unknown) => {
              req?.destroy();
              finish(err instanceof Error ? err : new Error("onFirstMessage_failed"));
            });
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
    }, SSE_TEST_TIMEOUT_MS);

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
    }, SSE_TEST_TIMEOUT_MS);

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

const SSE_TEST_TIMEOUT_MS = 10_000;
const POST_CONFIRM_OBSERVE_MS = 500;

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

  await loginStaff();
});

afterEach(async () => {
  await closeServerWithTimeout(server, 7000);

  store.close();
  delete process.env.STAFF_PASSCODE;
  delete process.env.TEST_STT_THROW;
  delete process.env.TEST_STT_HEALTH;
  delete process.env.TEST_STT_DELAY_MS;
  delete process.env.WF_STAFF_SESSION_TTL_MS;
  delete process.env.WF_SSE_KEEPALIVE_INTERVAL_MS;
  delete process.env.WF_TICK_INTERVAL_MS;
  delete process.env.WF_INACTIVITY_TIMEOUT_MS;
  delete process.env.TTS_SPEAKER_ID;
  helpers.resetStaffCookie();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http-server", () => {
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

  describe("stream endpoints", () => {
    it(
      "streams kiosk snapshot on connect",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it("returns 405 for kiosk stream with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/kiosk/stream");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it(
      "streams staff snapshot on connect",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it("returns 405 for staff stream with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/stream");

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });
  });

  describe("orchestrator and snapshot flows", () => {
    it(
      "streams kiosk record_start command on PTT down",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it(
      "streams kiosk record_start command on kiosk PTT down",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it(
      "streams kiosk record_stop command on kiosk PTT up",
      async () => {
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
        expect(
          (messages[4]?.data as { stt_request_id?: unknown } | undefined)?.stt_request_id,
        ).toBe("stt-1");
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it("speaks fallback text when stt provider throws", async () => {
      process.env.TEST_STT_THROW = "1";

      const messages = await readSseDataMessages("/api/v1/kiosk/stream", 10, async () => {
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
      expect(messages.some((m) => m.type === "kiosk.command.speech.start")).toBe(true);
      expect(messages.some((m) => m.type === "kiosk.command.speech.segment")).toBe(true);
      expect(messages.some((m) => m.type === "kiosk.command.speech.end")).toBe(true);

      const health = await sendRequest("GET", "/health");
      expect(health.status).toBe(200);
    }, 10_000);

    it(
      "does not block /health while stt transcription is in flight",
      async () => {
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
        expect(elapsed).toBeLessThan(450);

        // Avoid in-flight promise resolving after teardown.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 550);
        });
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it("returns 404 for legacy staff pending endpoints", async () => {
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

    it(
      "broadcasts session summary pending list update after confirm",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it(
      "broadcasts session summary pending list update after deny",
      async () => {
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

    it(
      "does not broadcast session summary list to expired staff stream session",
      async () => {
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
            let didConfirmComplete = false;
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
                        didConfirmComplete = true;
                        timeout = setTimeout(() => {
                          req.destroy();
                          finish();
                        }, POST_CONFIRM_OBSERVE_MS);
                      })().catch((err) => {
                        finish(err instanceof Error ? err : new Error("confirm_failed"));
                      });
                    }

                    if (didTriggerPreviously && parsed.type === "staff.snapshot") {
                      hasLeakedSnapshot = true;
                      if (didConfirmComplete) {
                        req.destroy();
                        finish(new Error("expired_stream_snapshot_leak"));
                        return;
                      }
                    }

                    if (parsed.type === "staff.session_summaries_pending_list") {
                      hasLeakedPendingList = true;
                      if (didConfirmComplete) {
                        req.destroy();
                        finish(new Error("expired_stream_pending_list_leak"));
                        return;
                      }
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
      },
      SSE_TEST_TIMEOUT_MS,
    );

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
});
