import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "http";
import type { Server } from "http";
import { createHttpServer, shouldIncludeSpeechMetrics } from "./http-server.js";
import { createStore } from "./store.js";
import { createHttpTestHelpers } from "./test-helpers/http.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;

const helpers = createHttpTestHelpers(() => port);
const { sendRequest, loginStaff } = helpers;

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
  describe("health and baseline routes", () => {
    it("returns false for malformed metrics URL values", () => {
      expect(shouldIncludeSpeechMetrics("http://[bad")).toBe(false);
    });

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

    it("includes speech metrics when requested via health query", async () => {
      const response = await sendRequest("GET", "/health?metrics=1");

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        status: "ok",
        providers: {
          stt: { status: "ok" },
          tts: { status: "ok" },
          llm: { status: "ok", kind: "stub" },
        },
        speech_metrics: {
          ttfa_observation_count: 0,
          latest_ttfa_observation: null,
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
});
