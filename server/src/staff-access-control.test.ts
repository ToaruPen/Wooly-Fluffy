import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "http";
import type { IncomingHttpHeaders } from "http";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";

let closeServer: (() => Promise<void>) | null = null;
let port: number;
let store: ReturnType<typeof createStore>;

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

const cookieFromSetCookie = (setCookie: string): string => {
  const [first] = setCookie.split(";", 1);
  if (!first) {
    throw new Error("missing_set_cookie");
  }
  return first;
};

const openSse = (path: string, options: { cookie: string; timeoutMs: number }) =>
  new Promise<{ close: Promise<void> }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      const contentTypeHeader = res.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? (contentTypeHeader[0] ?? "")
        : (contentTypeHeader ?? "");
      if ((res.statusCode ?? 0) !== 200 || !String(contentType).includes("text/event-stream")) {
        req.destroy();
        reject(new Error(`unexpected_sse_response:${res.statusCode ?? 0}:${String(contentType)}`));
        return;
      }

      res.resume();

      let isSettled = false;
      const close = new Promise<void>((resolveCloseInner, rejectClose) => {
        const timeout = setTimeout(() => {
          req.destroy();
          rejectClose(new Error("did_not_close"));
        }, options.timeoutMs);

        const finish = () => {
          if (isSettled) {
            return;
          }
          isSettled = true;
          clearTimeout(timeout);
          resolveCloseInner();
        };
        res.on("close", finish);
        res.on("end", finish);
      });

      resolve({ close });
    });

    req.on("error", reject);
    req.setHeader("cookie", options.cookie);
    req.end();
  });

describe("staff access control", () => {
  beforeEach(async () => {
    store = createStore({ db_path: ":memory:" });
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
    }
    store.close();
    delete process.env.STAFF_PASSCODE;
    closeServer = null;
  });

  it("returns 403 for STAFF endpoints when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/pending");
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 403 for kiosk PTT events when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 403 for staff deny when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/deny");
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 403 for staff confirm when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/confirm");
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 401 for STAFF endpoints when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/pending");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 401 for staff deny when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/deny");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 401 for staff confirm when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/pending/nope/confirm");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 403 for staff stream when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/stream");
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 403 for staff event when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 403 for login when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 401 for staff stream when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/stream");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 401 for staff event when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "STAFF_PTT_DOWN" }),
    });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 405 for login with non-POST", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/auth/login");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" },
    });
  });

  it("returns 400 for login with invalid json", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_json", message: "Invalid JSON" },
    });
  });

  it("returns 413 for login with too large body", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const big = "a".repeat(128_001);
    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: big }),
    });
    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "payload_too_large", message: "Payload Too Large" },
    });
  });

  it("returns 400 for login when passcode is not a string", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: 123 }),
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "invalid_request", message: "Invalid request" },
    });
  });

  it("returns 401 for login when passcode is wrong", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "wrong" }),
    });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 500 for login when STAFF_PASSCODE is missing", async () => {
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "anything" }),
    });
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "misconfigured", message: "Server misconfigured" },
    });
  });

  it("returns 405 for keepalive with non-POST", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("GET", "/api/v1/staff/auth/keepalive");
    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" },
    });
  });

  it("returns 403 for keepalive when remoteAddress is not LAN", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "8.8.8.8" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive");
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("returns 401 for keepalive when session is missing", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("returns 401 for keepalive when session token is unknown", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const response = await sendRequest("POST", "/api/v1/staff/auth/keepalive", {
      headers: { cookie: "wf_staff_session=nope" },
    });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("allows login and subsequent STAFF requests with the session cookie", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const login = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    expect(login.status).toBe(200);
    expect(JSON.parse(login.body)).toEqual({ ok: true });

    const setCookie = login.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(typeof first).toBe("string");
    const cookie = cookieFromSetCookie(String(first ?? ""));

    const pending = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: { cookie },
    });
    expect(pending.status).toBe(200);
  });

  it("parses staff session cookie from a noisy cookie header", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const login = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const staff = cookieFromSetCookie(String(first ?? ""));

    const noisyCookie = ` ; foo; =bar; ${staff}; a=b`;
    const pending = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: { cookie: noisyCookie },
    });
    expect(pending.status).toBe(200);
  });

  it("returns 401 when cookie header does not include the staff session cookie", async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    const localServer = createHttpServer({ store, get_remote_address: () => "127.0.0.1" });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const pending = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: { cookie: "a=b" },
    });
    expect(pending.status).toBe(401);
    expect(JSON.parse(pending.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("expires the STAFF session after 180 seconds without keepalive", async () => {
    process.env.STAFF_PASSCODE = "test-pass";

    let nowMs = 0;
    const localServer = createHttpServer({
      store,
      now_ms: () => nowMs,
      get_remote_address: () => "127.0.0.1",
    });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const login = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    const setCookie = login.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = cookieFromSetCookie(String(first ?? ""));

    nowMs = 181_000;
    const pending = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: { cookie },
    });
    expect(pending.status).toBe(401);
    expect(JSON.parse(pending.body)).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
  });

  it("keeps the STAFF session alive when keepalive is called", async () => {
    process.env.STAFF_PASSCODE = "test-pass";

    let nowMs = 0;
    const localServer = createHttpServer({
      store,
      now_ms: () => nowMs,
      get_remote_address: () => "127.0.0.1",
    });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const login = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    const setCookie = login.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = cookieFromSetCookie(String(first ?? ""));

    nowMs = 179_000;
    const keepalive = await sendRequest("POST", "/api/v1/staff/auth/keepalive", {
      headers: { cookie },
    });
    expect(keepalive.status).toBe(200);

    nowMs = 358_999;
    const pending = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: { cookie },
    });
    expect(pending.status).toBe(200);
  });

  it("closes the staff SSE stream after session expires", async () => {
    process.env.STAFF_PASSCODE = "test-pass";

    let nowMs = 0;
    const localServer = createHttpServer({
      store,
      now_ms: () => nowMs,
      get_remote_address: () => "127.0.0.1",
    });
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        localServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
    const address = localServer.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    port = address.port;

    const login = await sendRequest("POST", "/api/v1/staff/auth/login", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "test-pass" }),
    });
    const setCookie = login.headers["set-cookie"];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = cookieFromSetCookie(String(first ?? ""));

    const stream = await openSse("/api/v1/staff/stream", { cookie, timeoutMs: 2500 });
    nowMs = 181_000;
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    await stream.close;
  });
});
