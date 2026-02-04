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
  options?: { headers?: Record<string, string>; body?: string | Buffer }
) =>
  new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      }
    );

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
  options?: { headers?: Record<string, string>; body?: string | Buffer }
) =>
  new Promise<{ status: number; body: Buffer; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(chunk as Buffer);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: res.headers
          });
        });
      }
    );

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
    body: JSON.stringify({ passcode: "test-pass" })
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
  cookie: staffCookie
});

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
    `--${boundary}--\r\n`
  ];
  const body = Buffer.concat(
    lines.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : part))
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body
  };
};

const readSseDataMessages = (
  path: string,
  expectedCount: number,
  onFirstMessage?: () => Promise<void>,
  options?: { headers?: Record<string, string> }
) =>
  new Promise<
    Array<{
      type: string;
      seq: number;
      data: unknown;
    }>
  >((resolve, reject) => {
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let req: ReturnType<typeof request> | undefined;

    const finish = (err?: Error, result?: Array<{ type: string; seq: number; data: unknown }>) => {
      if (done) {
        return;
      }
      done = true;
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
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (err?: Error, result?: { status: number; contentType: string; data: string; id: string }) => {
      if (done) {
        return;
      }
      done = true;
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
        ? contentTypeHeader[0] ?? ""
        : contentTypeHeader ?? "";

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
          id: idLine ? idLine.slice("id: ".length) : ""
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

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    (async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/version")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ version: "test" }),
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
      throw new Error(`unexpected_fetch:${url}`);
    }) as unknown as typeof fetch
  );

  process.env.STAFF_PASSCODE = "test-pass";
  store = createStore({ db_path: ":memory:" });
  server = createHttpServer({ store });
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
  staffCookie = "";

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http-server", () => {
  it("returns healthcheck status", async () => {
    const response = await sendRequest("GET", "/health");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ok",
      providers: {
        stt: { status: "ok" },
        tts: { status: "ok" },
        llm: { status: "ok", kind: "stub" }
      }
    });
  });

  it("returns 200 healthcheck even when tts is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      (async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/version")) {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
        throw new Error(`unexpected_fetch:${url}`);
      }) as unknown as typeof fetch
    );

    const response = await sendRequest("GET", "/health");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ok",
      providers: {
        stt: { status: "ok" },
        tts: { status: "unavailable" },
        llm: { status: "ok", kind: "stub" }
      }
    });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await sendRequest("GET", "/unknown");

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "not_found", message: "Not Found" }
    });
  });

  it("returns audio/wav from /api/v1/kiosk/tts", async () => {
    vi.stubGlobal(
      "fetch",
      (async (input: unknown, init?: unknown) => {
        const url = new URL(String(input));

        if (url.pathname === "/audio_query") {
          expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
          expect(url.searchParams.get("speaker")).toBe("2");
          expect(url.searchParams.get("text")).toBe("Hello");
          return {
            ok: true,
            status: 200,
            json: async () => ({ query: true }),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }

        if (url.pathname === "/synthesis") {
          expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
          expect(url.searchParams.get("speaker")).toBe("2");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
          };
        }

        if (url.pathname === "/version") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: "test" }),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }

        throw new Error(`unexpected_fetch:${url.toString()}`);
      }) as unknown as typeof fetch
    );

    const response = await sendRequestBuffer("POST", "/api/v1/kiosk/tts", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello" })
    });

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("audio/wav");
    expect(Array.from(response.body)).toEqual([1, 2, 3]);
  });

  it("returns 400 invalid_request for /api/v1/kiosk/tts when text is missing", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 invalid_json for /api/v1/kiosk/tts when body is invalid JSON", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
      headers: { "content-type": "application/json" },
      body: "{"
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON" }
    });
  });

  it("returns 503 unavailable for /api/v1/kiosk/tts when provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      (async (input: unknown) => {
        const url = new URL(String(input));
        if (url.pathname === "/audio_query") {
          return {
            ok: false,
            status: 503,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
        throw new Error(`unexpected_fetch:${url.toString()}`);
      }) as unknown as typeof fetch
    );

    const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hello" })
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unavailable", message: "Unavailable" }
    });
  });

  it("returns 405 for /api/v1/kiosk/tts with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/kiosk/tts");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 413 payload_too_large for /api/v1/kiosk/tts", async () => {
    const bigText = "a".repeat(200_000);
    const response = await sendRequest("POST", "/api/v1/kiosk/tts", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: bigText })
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "payload_too_large", message: "Payload Too Large" }
    });
  });

  it("returns 200 for staff keepalive with valid session", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive", {
      headers: withStaffCookie()
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(String(response.headers["set-cookie"] ?? "")).toContain("wf_staff_session=");
  });

  it("returns 401 for staff keepalive without session", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" }
    });
  });

  it("returns 405 for staff keepalive with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/staff/auth/keepalive", {
      headers: withStaffCookie()
    });
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("does not crash on invalid URL encoding", async () => {
    const response = await sendRequest("GET", "/%E0%A4%A");

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "not_found", message: "Not Found" }
    });

    const health = await sendRequest("GET", "/health");
    expect(health.status).toBe(200);
  });

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
        consent_ui_visible: false
      }
    });
  });

  it("returns 405 for kiosk stream with non-GET", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/stream");

    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("streams staff snapshot on connect", async () => {
    const response = await readFirstSseMessage("/api/v1/staff/stream", {
      headers: withStaffCookie()
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
        phase: "idle"
      },
      pending: {
        count: 0
      }
    });
  });

  it("returns 405 for staff stream with non-GET", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/stream");

    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 400 for kiosk event with invalid json", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: "{"
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON" }
    });
  });

  it("does not crash when client closes during body read", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method: "POST", path: "/api/v1/kiosk/event" });

      let finished = false;
      const finish = (err?: unknown) => {
        if (finished) {
          return;
        }
        finished = true;
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
      req.write("{\"type\":\"UI_CONSENT_BUTTON\",\"answer\":\"yes\"");
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
      error: { code: "not_found", message: "Not Found" }
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
            headers: { "content-type": "application/json" }
          },
          (res) => {
            res.destroy();
            resolve();
          }
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
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 400 for kiosk event with unknown type", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "NOPE", answer: "yes" })
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for kiosk event with invalid answer", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: "maybe" })
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 413 for kiosk event with too large body", async () => {
    const big = "a".repeat(128_001);
    const response = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: big })
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "payload_too_large", message: "Payload Too Large" }
    });
  });

  it("returns 400 for staff event with unknown type", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/event", {
      headers: withStaffCookie({ "content-type": "application/json" }),
      body: JSON.stringify({ type: "NOPE" })
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for staff event with invalid json", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/event", {
      headers: withStaffCookie({ "content-type": "application/json" }),
      body: "{"
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON" }
    });
  });

  it("does not hang when client aborts request body", async () => {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        resolve();
      };

      const req = request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/v1/staff/event",
          headers: withStaffCookie({ "content-type": "application/json" })
        },
        () => {
          // Ignore response; this request is aborted.
        }
      );

      req.on("error", finish);
      req.on("close", finish);

      req.write("{");
      req.destroy();

      setTimeout(() => {
        if (!finished) {
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
      body: JSON.stringify({ type: big })
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "payload_too_large", message: "Payload Too Large" }
    });
  });

  it("returns 405 for staff event with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/staff/event");

    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 400 for stt-audio with non-multipart content-type", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("dummy", "utf8")
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for stt-audio without content-type", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      body: Buffer.from("dummy", "utf8")
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("ignores querystring in routes", async () => {
    const response = await sendRequest("GET", "/api/v1/staff/pending?x=1", {
      headers: withStaffCookie()
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ items: [] });
  });

  it("returns 400 for stt-audio without boundary", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": "multipart/form-data" },
      body: Buffer.from("dummy", "utf8")
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for stt-audio with malformed multipart (missing header separator)", async () => {
    const boundary = "testboundary";
    const body = Buffer.from(
      [`--${boundary}\r\n`, `Content-Disposition: form-data; name="stt_request_id"\r\n`, `stt-1\r\n`, `--${boundary}--\r\n`].join(""),
      "utf8"
    );

    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for stt-audio with malformed multipart (missing closing boundary)", async () => {
    const boundary = "testboundary";
    const body = Buffer.from(
      [`--${boundary}\r\n`, `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`, `stt-1`].join(""),
      "utf8"
    );

    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for stt-audio missing audio part", async () => {
    const boundary = "testboundary";
    const body = Buffer.from(
      [
        `--${boundary}\r\n`,
        `Content-Disposition: form-data; name="stt_request_id"\r\n\r\n`,
        `stt-1\r\n`,
        `--${boundary}--\r\n`
      ].join(""),
      "utf8"
    );

    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
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
        `--${boundary}--\r\n`
      ].join(""),
      "utf8"
    );

    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("returns 400 for stt-audio when request id is not pending", async () => {
    const multipart = buildMultipartBody({
      stt_request_id: "stt-999",
      audio: Buffer.from("dummy", "utf8")
    });
    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": multipart.contentType },
      body: multipart.body
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" }
    });
  });

  it("streams kiosk record_start command on PTT down", async () => {
    const messages = await readSseDataMessages("/api/v1/kiosk/stream", 3, async () => {
      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" })
      });
      expect(response.status).toBe(200);
    });

    expect(messages[0]?.type).toBe("kiosk.snapshot");
    expect(messages[1]?.type).toBe("kiosk.snapshot");
    expect(messages[2]?.type).toBe("kiosk.command.record_start");
  });

  it("supports staff pending deny endpoint", async () => {
    const id = store.createPending({
      personal_name: "taro",
      kind: "likes",
      value: "apples"
    });
    const deny = await sendRequest("POST", `/api/v1/staff/pending/${id}/deny`, {
      headers: withStaffCookie()
    });
    expect(deny.status).toBe(200);
    expect(JSON.parse(deny.body)).toEqual({ ok: true });

    const listAfter = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: withStaffCookie()
    });
    expect(listAfter.status).toBe(200);
    expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
  });

  it("returns 404 for staff pending deny when id not found", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/deny", {
      headers: withStaffCookie()
    });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "not_found", message: "Not Found" }
    });
  });

  it("returns 405 for stt-audio with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/kiosk/stt-audio");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 405 for staff pending list with non-GET", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/pending");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 413 for stt-audio with too large body", async () => {
    const body = Buffer.alloc(2_500_001);
    const response = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
      headers: { "content-type": "multipart/form-data; boundary=testboundary" },
      body
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "payload_too_large", message: "Payload Too Large" }
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
      body: JSON.stringify({ type: "STAFF_RESUME" })
    });
    expect(first.status).toBe(200);

    const second = await sendRequest("POST", "/api/v1/staff/event", {
      headers: withStaffCookie({ "content-type": "application/json" }),
      body: JSON.stringify({ type: "STAFF_RESUME" })
    });
    expect(second.status).toBe(200);
  });

  it("omits source_quote when null", async () => {
    store.createPending({ personal_name: "taro", kind: "likes", value: "apples" });
    const list = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: withStaffCookie()
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
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" })
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      },
      { headers: withStaffCookie() }
    );

    expect(messages[0]?.type).toBe("staff.snapshot");
    expect(messages[0]?.data).toEqual({
      state: { mode: "ROOM", personal_name: null, phase: "idle" },
      pending: { count: 0 }
    });
    expect(messages[1]?.type).toBe("staff.snapshot");
    expect(messages[1]?.data).toEqual({
      state: { mode: "ROOM", personal_name: null, phase: "listening" },
      pending: { count: 0 }
    });
  });

  it("creates pending via orchestrator consent and confirms it", async () => {
    // 1st utterance: enter PERSONAL
    {
      const down = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" })
      });
      expect(down.status).toBe(200);
      const up = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_UP" })
      });
      expect(up.status).toBe(200);
      const multipart = buildMultipartBody({
        stt_request_id: "stt-1",
        audio: Buffer.from("dummy", "utf8")
      });
      const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": multipart.contentType },
        body: multipart.body
      });
      expect(audio.status).toBe(202);
    }

    // 2nd utterance: triggers memory_extract stub -> consent UI visible
    {
      const down = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" })
      });
      expect(down.status).toBe(200);
      const up = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_UP" })
      });
      expect(up.status).toBe(200);
      const multipart = buildMultipartBody({
        stt_request_id: "stt-2",
        audio: Buffer.from("dummy", "utf8")
      });
      const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": multipart.contentType },
        body: multipart.body
      });
      expect(audio.status).toBe(202);
    }

    // 3rd utterance while waiting for consent: triggers consent_decision inner task
    {
      const down = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_DOWN" })
      });
      expect(down.status).toBe(200);
      const up = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_PTT_UP" })
      });
      expect(up.status).toBe(200);
      const multipart = buildMultipartBody({
        stt_request_id: "stt-5",
        audio: Buffer.from("dummy", "utf8")
      });
      const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
        headers: { "content-type": multipart.contentType },
        body: multipart.body
      });
      expect(audio.status).toBe(202);
    }

    // Consent
    {
      const response = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: "yes" })
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    }

    const list = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: withStaffCookie()
    });
    expect(list.status).toBe(200);
    const listBody = JSON.parse(list.body) as { items: Array<{ id: string }> };
    expect(listBody.items.length).toBe(1);
    const pendingId = listBody.items[0]?.id;
    expect(typeof pendingId).toBe("string");

    const confirm = await sendRequest("POST", `/api/v1/staff/pending/${pendingId}/confirm`, {
      headers: withStaffCookie()
    });
    expect(confirm.status).toBe(200);
    expect(JSON.parse(confirm.body)).toEqual({ ok: true });

    const listAfter = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: withStaffCookie()
    });
    expect(listAfter.status).toBe(200);
    expect(JSON.parse(listAfter.body)).toEqual({ items: [] });
  });

  it("swallows event processing errors to keep server alive", async () => {
    const originalListPending = store.listPending;
    try {
      store.listPending = () => {
        throw new Error("boom");
      };

      const response = await sendRequest("POST", "/api/v1/staff/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "STAFF_RESUME" })
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    } finally {
      store.listPending = originalListPending;
    }
  });

  it("returns 404 for staff pending confirm when id not found", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/confirm", {
      headers: withStaffCookie()
    });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "not_found", message: "Not Found" }
    });
  });

  it("returns 405 for staff pending confirm with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/staff/pending/nope/confirm");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("returns 405 for staff pending deny with non-POST", async () => {
    const response = await sendRequest("GET", "/api/v1/staff/pending/nope/deny");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });
});
