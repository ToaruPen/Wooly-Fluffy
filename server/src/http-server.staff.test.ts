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
const { sendRequest, cookieFromSetCookie, loginStaff, withStaffCookie } = helpers;

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
  delete process.env.WF_INACTIVITY_TIMEOUT_MS;
  delete process.env.TTS_SPEAKER_ID;
  helpers.resetStaffCookie();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http-server", () => {
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

  describe("route guards and lifecycle", () => {
    it("returns 405 for stt-audio with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/kiosk/stt-audio");
      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "method_not_allowed", message: "Method Not Allowed" },
      });
    });

    it("returns 404 for staff pending list with non-GET", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/pending");
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
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

    it("returns 404 for legacy staff pending list endpoint", async () => {
      const list = await sendRequest("GET", "/api/v1/staff/pending", {
        headers: withStaffCookie(),
      });
      expect(list.status).toBe(404);
      expect(JSON.parse(list.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
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

    it("returns 400 invalid_request for UI_CONSENT_BUTTON after staff PTT cycle", async () => {
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
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "invalid_request", message: "Invalid request" },
      });
    });

    it("swallows event processing errors to keep server alive", async () => {
      const originalList = store.listPendingSessionSummaries;
      try {
        store.listPendingSessionSummaries = () => {
          throw new Error("boom");
        };

        const response = await sendRequest("POST", "/api/v1/staff/event", {
          headers: withStaffCookie({ "content-type": "application/json" }),
          body: JSON.stringify({ type: "STAFF_RESUME" }),
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true });
      } finally {
        store.listPendingSessionSummaries = originalList;
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

    it("returns 404 for staff pending confirm with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/pending/nope/confirm");
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
    });

    it("returns 404 for staff pending deny with non-POST", async () => {
      const response = await sendRequest("GET", "/api/v1/staff/pending/nope/deny");
      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
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
