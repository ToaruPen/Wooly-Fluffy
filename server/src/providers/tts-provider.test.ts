import { describe, expect, it } from "vitest";
import { createVoiceVoxTtsProvider } from "./tts-provider.js";

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
        { once: true }
      );
    });
};

describe("tts-provider (VOICEVOX)", () => {
  it("reports ok health when /version returns 200", async () => {
    const tts = createVoiceVoxTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async (input) => {
        expect(input).toBe("http://voicevox.local/version");
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    await expect(tts.health()).resolves.toEqual({ status: "ok" });
  });

  it("reports unavailable health when /version returns non-2xx", async () => {
    const tts = createVoiceVoxTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async (_input) => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0)
      })
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when request throws", async () => {
    const tts = createVoiceVoxTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async () => {
        throw new Error("offline");
      }
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when request times out", async () => {
    const tts = createVoiceVoxTtsProvider({
      engine_url: "http://voicevox.local",
      timeout_ms: 1,
      fetch: createAbortableNeverFetch()
    });

    await expect(tts.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("synthesizes wav via audio_query -> synthesis with speaker=2", async () => {
    const calls: Array<{ input: string; init?: unknown }> = [];
    const audioQuery = { foo: "bar" };
    const wav = new Uint8Array([1, 2, 3]).buffer;

    const tts = createVoiceVoxTtsProvider({
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
            arrayBuffer: async () => new ArrayBuffer(0)
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
            arrayBuffer: async () => wav
          };
        }

        throw new Error(`unexpected url: ${input}`);
      }
    });

    const result = await tts.synthesize({ text: "Hello" });
    expect(result.wav).toEqual(Buffer.from(wav));
    expect(calls.length).toBe(2);
  });

  it("throws when audio_query returns non-2xx", async () => {
    const tts = createVoiceVoxTtsProvider({
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
          arrayBuffer: async () => new ArrayBuffer(0)
        };
      }
    });

    await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow(/audio_query failed/);
  });

  it("throws when synthesis returns non-2xx", async () => {
    const tts = createVoiceVoxTtsProvider({
      engine_url: "http://voicevox.local",
      fetch: async (input) => {
        const url = new URL(input);
        if (url.pathname === "/audio_query") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ query: true }),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
        if (url.pathname === "/synthesis") {
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0)
          };
        }
        throw new Error("unexpected");
      }
    });

    await expect(tts.synthesize({ text: "Hello" })).rejects.toThrow(/synthesis failed/);
  });
});
