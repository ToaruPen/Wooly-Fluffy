import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { createHttpTestHelpers } from "./test-helpers/http.js";
import { createSseTestHelpers } from "./test-helpers/sse.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;

let chatMode: "content" | "tool_calls" = "content";

const helpers = createHttpTestHelpers(() => port);
const { sendRequest, loginStaff, withStaffCookie } = helpers;
const sseHelpers = createSseTestHelpers(() => port);
const { readSseUntil } = sseHelpers;

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
    delete process.env.LLM_PROVIDER_KIND;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    helpers.resetStaffCookie();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects legacy consent event and keeps session-summary pending list empty", async () => {
    {
      const down = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
      });
      expect(down.status).toBe(200);
      const up = await sendRequest("POST", "/api/v1/kiosk/event", {
        headers: withStaffCookie({ "content-type": "application/json" }),
        body: JSON.stringify({ type: "KIOSK_PTT_UP" }),
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
    expect(consent.status).toBe(400);

    const list = await sendRequest("GET", "/api/v1/staff/session-summaries/pending", {
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
          const down = await sendRequest("POST", "/api/v1/kiosk/event", {
            headers: withStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
          });
          expect(down.status).toBe(200);
          const up = await sendRequest("POST", "/api/v1/kiosk/event", {
            headers: withStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "KIOSK_PTT_UP" }),
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
          const down = await sendRequest("POST", "/api/v1/kiosk/event", {
            headers: withStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "KIOSK_PTT_DOWN" }),
          });
          expect(down.status).toBe(200);
          const up = await sendRequest("POST", "/api/v1/kiosk/event", {
            headers: withStaffCookie({ "content-type": "application/json" }),
            body: JSON.stringify({ type: "KIOSK_PTT_UP" }),
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
