import { request } from "http";
import type { IncomingHttpHeaders, Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;
let staffCookie = "";

let chatMode: "content" | "tool_calls" = "content";

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
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

const readSseUntil = (
  path: string,
  predicate: (message: { type: string; seq: number; data: unknown }) => boolean,
  onFirstMessage?: () => Promise<void>,
  options?: { timeout_ms?: number },
) =>
  new Promise<Array<{ type: string; seq: number; data: unknown }>>((resolve, reject) => {
    let isDone = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

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
    const req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
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
              req.destroy();
              finish(err instanceof Error ? err : new Error("onFirstMessage_failed"));
            });
          }
          if (predicate(parsed)) {
            res.destroy();
            finish(undefined, messages);
            return;
          }
        }
      });
    });

    timeout = setTimeout(() => {
      req.destroy();
      finish(new Error("sse_timeout"));
    }, options?.timeout_ms ?? 2500);

    req.on("error", (err) => {
      finish(err instanceof Error ? err : new Error("request_error"));
    });
    req.end();
  });

describe("http-server (async llm provider)", () => {
  beforeEach(async () => {
    process.env.STAFF_PASSCODE = "test-pass";
    process.env.LLM_PROVIDER_KIND = "local";
    process.env.LLM_BASE_URL = "http://lmstudio.local/v1";
    process.env.LLM_MODEL = "dummy-model";
    chatMode = "content";

    vi.stubGlobal("fetch", (async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (!url.endsWith("/chat/completions")) {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const bodyText = String(init?.body ?? "");
      if (bodyText.includes("memory_extract")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    '{"task":"memory_extract","candidate":{"kind":"likes","value":"りんご","source_quote":"りんごがすき"}}',
                },
              },
            ],
          }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      if (chatMode === "tool_calls") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "call_ok",
                      type: "function",
                      function: { name: "get_weather", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"assistant_text":"ok","expression":"neutral"}',
              },
            },
          ],
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }) as unknown as typeof fetch);

    store = createStore({ db_path: ":memory:" });
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
    delete process.env.LLM_PROVIDER_KIND;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    staffCookie = "";

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    const consent = await sendRequest("POST", "/api/v1/kiosk/event", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "UI_CONSENT_BUTTON", answer: "yes" }),
    });
    expect(consent.status).toBe(200);

    const list = await sendRequest("GET", "/api/v1/staff/pending", {
      headers: withStaffCookie(),
    });
    expect(list.status).toBe(200);
    const parsed = JSON.parse(list.body) as { items: Array<{ id: string }> };
    expect(parsed.items.length).toBe(0);
  });

  it("streams kiosk.command.tool_calls without arguments", async () => {
    chatMode = "tool_calls";

    const messages = await readSseUntil(
      "/api/v1/kiosk/stream",
      (message) => message.type === "kiosk.command.tool_calls",
      async () => {
        // 1st utterance: enter PERSONAL
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

        // 2nd utterance: triggers async chat with tool_calls
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
            stt_request_id: "stt-2",
            audio: Buffer.from("dummy", "utf8"),
          });
          const audio = await sendRequest("POST", "/api/v1/kiosk/stt-audio", {
            headers: { "content-type": multipart.contentType },
            body: multipart.body,
          });
          expect(audio.status).toBe(202);
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      },
      { timeout_ms: 2500 },
    );

    const toolMessage = messages.find((message) => message.type === "kiosk.command.tool_calls");
    expect(toolMessage).toBeTruthy();
    expect(toolMessage?.data).toEqual({
      tool_calls: [{ id: "call_ok", function: { name: "get_weather" } }],
    });
  });
});
