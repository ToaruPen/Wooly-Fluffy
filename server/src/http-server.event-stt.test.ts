import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "http";
import type { Server } from "http";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { ServerResponse } from "http";
import { createHttpTestHelpers } from "./test-helpers/http.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;

const helpers = createHttpTestHelpers(() => port);
const { sendRequest, loginStaff, withStaffCookie } = helpers;

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

    it("accepts STAFF_RESET_SESSION staff event", async () => {
      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_RESET_SESSION" }),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
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

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: { code: "not_found", message: "Not Found" },
      });
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
});
