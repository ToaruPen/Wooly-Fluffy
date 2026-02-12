import { describe, expect, it, vi } from "vitest";
import { createVoicevoxCompatibleTtsProvider } from "./tts-provider.js";

const createAbortableNeverFetch = () => {
  return (_input: string, init?: { method?: string; signal?: AbortSignal }) =>
    new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing_signal"));
        return;
      }
      if (signal.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        },
        { once: true },
      );
    });
};

describe("tts-provider (VOICEVOX-compatible)", () => {
  it("treats blank TTS_ENGINE_URL as unset and falls back to legacy engine url", async () => {
    const prevNew = process.env.TTS_ENGINE_URL;
    const prevLegacy = process.env.VOICEVOX_ENGINE_URL;
    const prevSpeaker = process.env.TTS_SPEAKER_ID;

    try {
      process.env.TTS_ENGINE_URL = "   ";
      process.env.VOICEVOX_ENGINE_URL = "http://voicevox-legacy.local";
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        fetch: async (input) => {
          expect(input).toBe("http://voicevox-legacy.local/version");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "ok" });
    } finally {
      if (prevNew === undefined) {
        delete process.env.TTS_ENGINE_URL;
      } else {
        process.env.TTS_ENGINE_URL = prevNew;
      }
      if (prevLegacy === undefined) {
        delete process.env.VOICEVOX_ENGINE_URL;
      } else {
        process.env.VOICEVOX_ENGINE_URL = prevLegacy;
      }
      if (prevSpeaker === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prevSpeaker;
      }
    }
  });

  it("times out when /speakers body parse hangs", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    let calls = 0;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        timeout_ms: 1,
        fetch: async (input) => {
          calls += 1;
          expect(input).toBe("http://voicevox.local/speakers");
          return {
            ok: true,
            status: 200,
            json: async () => await new Promise<unknown>(() => {}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(calls).toBe(1);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reports ok health when /version returns 200 (speaker id configured)", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          expect(input).toBe("http://voicevox.local/version");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "ok" });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reports ok health when /version returns 200 and speaker id is resolved from /speakers", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const calls: string[] = [];
      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          calls.push(input);
          if (input === "http://voicevox.local/version") {
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (input === "http://voicevox.local/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [{ name: "x", styles: [{ name: "normal", id: -7, type: "talk" }] }],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "ok" });
      expect(calls).toEqual(["http://voicevox.local/version", "http://voicevox.local/speakers"]);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reports unavailable health when /speakers has no talk-compatible style", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          if (input === "http://voicevox.local/version") {
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (input === "http://voicevox.local/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [{ name: "x", styles: [{ name: "song", id: 101, type: "sing" }] }],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reports unavailable health when /version returns non-2xx", async () => {
    const tts = createVoicevoxCompatibleTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async (_input) => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when request throws", async () => {
    const tts = createVoicevoxCompatibleTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async () => {
        throw new Error("offline");
      },
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when request times out", async () => {
    const tts = createVoicevoxCompatibleTtsProvider({
      engine_url: "http://voicevox.local",
      timeout_ms: 1,
      fetch: createAbortableNeverFetch(),
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reads timeout from env when timeout_ms is not provided", async () => {
    const prev = process.env.TTS_TIMEOUT_MS;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      process.env.TTS_TIMEOUT_MS = "234";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: createAbortableNeverFetch(),
      });

      await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 234);
    } finally {
      setTimeoutSpy.mockRestore();
      if (prev === undefined) {
        delete process.env.TTS_TIMEOUT_MS;
      } else {
        process.env.TTS_TIMEOUT_MS = prev;
      }
    }
  });

  it("reads timeout from legacy env when TTS_TIMEOUT_MS is not set", async () => {
    const prevLegacy = process.env.VOICEVOX_TIMEOUT_MS;
    const prevNew = process.env.TTS_TIMEOUT_MS;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      delete process.env.TTS_TIMEOUT_MS;
      process.env.VOICEVOX_TIMEOUT_MS = "345";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: createAbortableNeverFetch(),
      });

      await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 345);
    } finally {
      setTimeoutSpy.mockRestore();
      if (prevLegacy === undefined) {
        delete process.env.VOICEVOX_TIMEOUT_MS;
      } else {
        process.env.VOICEVOX_TIMEOUT_MS = prevLegacy;
      }
      if (prevNew === undefined) {
        delete process.env.TTS_TIMEOUT_MS;
      } else {
        process.env.TTS_TIMEOUT_MS = prevNew;
      }
    }
  });

  it("synthesizes wav via audio_query -> synthesis with speaker=2", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    const calls: Array<{ input: string; init?: unknown }> = [];
    const audioQuery = { foo: "bar" };
    const wav = new Uint8Array([1, 2, 3]).buffer;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          calls.push({ input, init });

          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            expect(init?.method).toBe("POST");
            expect(url.searchParams.get("speaker")).toBe("2");
            expect(url.searchParams.get("text")).toBe("Hello");
            return {
              ok: true,
              status: 200,
              json: async () => audioQuery,
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }

          if (url.pathname === "/synthesis") {
            expect(init?.method).toBe("POST");
            expect(url.searchParams.get("speaker")).toBe("2");
            const body = (init as { body?: unknown } | undefined)?.body;
            expect(body).toBe(JSON.stringify(audioQuery));
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => wav,
            };
          }

          throw new Error(`unexpected url: ${input}`);
        },
      });

      const result = await tts.synthesize({ text: "Hello" });
      expect(result.wav).toEqual(Buffer.from(wav));
      expect(calls.length).toBe(2);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reads speaker id from env for audio_query and synthesis", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    const calls: Array<{ input: string; init?: unknown }> = [];
    const audioQuery = { foo: "bar" };
    const wav = new Uint8Array([4, 5, 6]).buffer;

    try {
      process.env.TTS_SPEAKER_ID = "7";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          calls.push({ input, init });

          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            expect(init?.method).toBe("POST");
            expect(url.searchParams.get("speaker")).toBe("7");
            return {
              ok: true,
              status: 200,
              json: async () => audioQuery,
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }

          if (url.pathname === "/synthesis") {
            expect(init?.method).toBe("POST");
            expect(url.searchParams.get("speaker")).toBe("7");
            const body = (init as { body?: unknown } | undefined)?.body;
            expect(body).toBe(JSON.stringify(audioQuery));
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => wav,
            };
          }

          throw new Error(`unexpected url: ${input}`);
        },
      });

      const result = await tts.synthesize({ text: "Hello" });
      expect(result.wav).toEqual(Buffer.from(wav));
      expect(calls.length).toBe(2);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  }, 2000);

  it("accepts signed speaker id from env", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      process.env.TTS_SPEAKER_ID = "-1";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("-1");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("-1");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
        wav: Buffer.from(new Uint8Array([9]).buffer),
      });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("resolves speaker id from /speakers when env is not set (cached)", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      let speakersCalls = 0;
      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/speakers") {
            speakersCalls += 1;
            return {
              ok: true,
              status: 200,
              json: async () => [{ name: "x", styles: [{ name: "normal", id: -7, type: "talk" }] }],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("-7");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("-7");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await tts.synthesize({ text: "Hello" });
      await tts.synthesize({ text: "Hello" });
      expect(speakersCalls).toBe(1);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("skips non-talk styles and uses talk style from /speakers", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  name: "x",
                  styles: [
                    { name: "song", id: 101, type: "sing" },
                    { name: "normal", id: 102, type: "talk" },
                  ],
                },
              ],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("102");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("102");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
        wav: Buffer.from(new Uint8Array([9]).buffer),
      });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("falls back to first style id when style type is missing", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [
                {
                  name: "x",
                  styles: [{ name: "normal", id: 203 }],
                },
              ],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("203");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("203");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
        wav: Buffer.from(new Uint8Array([9]).buffer),
      });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("throws when /speakers returns non-2xx while resolving default speaker", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          const url = new URL(input);
          if (url.pathname === "/speakers") {
            return {
              ok: false,
              status: 503,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow(/speakers failed: HTTP 503/);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("falls back to legacy speaker env when TTS_SPEAKER_ID is not set", async () => {
    const prevLegacy = process.env.VOICEVOX_SPEAKER_ID;
    const prevNew = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;
      process.env.VOICEVOX_SPEAKER_ID = "7";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("7");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("7");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
        wav: Buffer.from(new Uint8Array([9]).buffer),
      });
    } finally {
      if (prevLegacy === undefined) {
        delete process.env.VOICEVOX_SPEAKER_ID;
      } else {
        process.env.VOICEVOX_SPEAKER_ID = prevLegacy;
      }
      if (prevNew === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prevNew;
      }
    }
  });

  it("falls back to legacy speaker env when TTS_SPEAKER_ID is blank", async () => {
    const prevLegacy = process.env.VOICEVOX_SPEAKER_ID;
    const prevNew = process.env.TTS_SPEAKER_ID;
    try {
      process.env.TTS_SPEAKER_ID = "   ";
      process.env.VOICEVOX_SPEAKER_ID = "11";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input, init) => {
          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            expect(url.searchParams.get("speaker")).toBe("11");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            expect(url.searchParams.get("speaker")).toBe("11");
            expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
        wav: Buffer.from(new Uint8Array([9]).buffer),
      });
    } finally {
      if (prevLegacy === undefined) {
        delete process.env.VOICEVOX_SPEAKER_ID;
      } else {
        process.env.VOICEVOX_SPEAKER_ID = prevLegacy;
      }
      if (prevNew === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prevNew;
      }
    }
  });

  it.each(["1.5", "9007199254740992", "2147483648"])(
    "ignores invalid TTS_SPEAKER_ID (%s) and resolves from speakers",
    async (invalidSpeakerId) => {
      const prev = process.env.TTS_SPEAKER_ID;
      try {
        process.env.TTS_SPEAKER_ID = invalidSpeakerId;

        const tts = createVoicevoxCompatibleTtsProvider({
          engine_url: "http://voicevox.local",
          fetch: async (input, init) => {
            const url = new URL(input);
            if (url.pathname === "/speakers") {
              return {
                ok: true,
                status: 200,
                json: async () => [
                  { name: "x", styles: [{ name: "normal", id: 12, type: "talk" }] },
                ],
                arrayBuffer: async () => new ArrayBuffer(0),
              };
            }
            if (url.pathname === "/audio_query") {
              expect(url.searchParams.get("speaker")).toBe("12");
              expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
              return {
                ok: true,
                status: 200,
                json: async () => ({ query: true }),
                arrayBuffer: async () => new ArrayBuffer(0),
              };
            }
            if (url.pathname === "/synthesis") {
              expect(url.searchParams.get("speaker")).toBe("12");
              expect((init as { method?: unknown } | undefined)?.method).toBe("POST");
              return {
                ok: true,
                status: 200,
                json: async () => ({}),
                arrayBuffer: async () => new Uint8Array([9]).buffer,
              };
            }
            throw new Error(`unexpected url: ${input}`);
          },
        });

        await expect(tts.synthesize({ text: "Hello" })).resolves.toEqual({
          wav: Buffer.from(new Uint8Array([9]).buffer),
        });
      } finally {
        if (prev === undefined) {
          delete process.env.TTS_SPEAKER_ID;
        } else {
          process.env.TTS_SPEAKER_ID = prev;
        }
      }
    },
  );

  it("reports unavailable health when /speakers shape is invalid", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          const url = new URL(input);
          if (url.pathname === "/version") {
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [
                { name: "x", styles: { id: 1 } },
                { name: "y", styles: [{ id: "bad", type: "talk" }] },
              ],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("reports unavailable health when /speakers is empty", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      delete process.env.TTS_SPEAKER_ID;

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          const url = new URL(input);
          if (url.pathname === "/version") {
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/speakers") {
            return {
              ok: true,
              status: 200,
              json: async () => [],
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("throws when audio_query returns non-2xx", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          const url = new URL(input);
          if (url.pathname !== "/audio_query") {
            throw new Error("unexpected");
          }
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow(/audio_query failed/);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("throws when synthesis returns non-2xx", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            return {
              ok: false,
              status: 500,
              json: async () => ({}),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          throw new Error("unexpected");
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow(/synthesis failed/);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("retries once on transient network failure", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    let calls = 0;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async (input) => {
          calls += 1;
          if (calls === 1) {
            throw new Error("fetch failed");
          }

          const url = new URL(input);
          if (url.pathname === "/audio_query") {
            return {
              ok: true,
              status: 200,
              json: async () => ({ query: true }),
              arrayBuffer: async () => new ArrayBuffer(0),
            };
          }
          if (url.pathname === "/synthesis") {
            return {
              ok: true,
              status: 200,
              json: async () => ({}),
              arrayBuffer: async () => new Uint8Array([9]).buffer,
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      const result = await tts.synthesize({ text: "Hello" });
      expect(result.wav).toEqual(Buffer.from(new Uint8Array([9]).buffer));
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("does not retry on AbortError", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    let calls = 0;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async () => {
          calls += 1;
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });

  it("does not retry when error is not an Error instance", async () => {
    const prev = process.env.TTS_SPEAKER_ID;
    let calls = 0;
    try {
      process.env.TTS_SPEAKER_ID = "2";

      const tts = createVoicevoxCompatibleTtsProvider({
        engine_url: "http://voicevox.local",
        fetch: async () => {
          calls += 1;
          throw "nope";
        },
      });

      await expect(tts.synthesize({ text: "Hello" })).rejects.toBeTruthy();
      expect(calls).toBe(1);
    } finally {
      if (prev === undefined) {
        delete process.env.TTS_SPEAKER_ID;
      } else {
        process.env.TTS_SPEAKER_ID = prev;
      }
    }
  });
});
