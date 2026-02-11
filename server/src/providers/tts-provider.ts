import type { ProviderHealth, Providers } from "./types.js";

import { readEnvInt } from "../env.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

type FetchFn = (
  input: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

type VoiceVoxTtsProviderOptions = {
  engine_url?: string;
  timeout_ms?: number;
  fetch?: FetchFn;
};

const DEFAULT_SPEAKER_ID = 2;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const withTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const sleep = async (ms: number): Promise<void> =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const shouldRetry = (err: unknown): boolean => {
  if (!(err instanceof Error)) {
    return false;
  }
  // Abort = caller-enforced timeout; do not retry.
  if (err.name === "AbortError") {
    return false;
  }

  // Network-ish failures: retry once.
  const msg = err.message;
  return (
    msg.includes("fetch failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("EAI_AGAIN")
  );
};

const withOneRetry = async <T>(
  run: () => Promise<T>,
  options: { backoff_ms: number },
): Promise<T> => {
  try {
    return await run();
  } catch (err) {
    if (!shouldRetry(err)) {
      throw err;
    }
    await sleep(options.backoff_ms);
    return await run();
  }
};

const healthFromVoiceVox = async (input: {
  baseUrl: string;
  timeoutMs: number;
  fetch: FetchFn;
}): Promise<ProviderHealth> => {
  try {
    const res = await withTimeout(input.timeoutMs, (signal) =>
      input.fetch(`${input.baseUrl}/version`, { method: "GET", signal }),
    );
    return res.ok ? { status: "ok" } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
};

const synthesizeFromVoiceVox = async (input: {
  baseUrl: string;
  timeoutMs: number;
  fetch: FetchFn;
  text: string;
  speakerId: number;
}): Promise<{ wav: Buffer }> => {
  return await withOneRetry(
    async () => {
      const queryParams = new URLSearchParams({
        text: input.text,
        speaker: String(input.speakerId),
      });
      const audioQueryRes = await withTimeout(input.timeoutMs, (signal) =>
        input.fetch(`${input.baseUrl}/audio_query?${queryParams.toString()}`, {
          method: "POST",
          signal,
        }),
      );
      if (!audioQueryRes.ok) {
        throw new Error(`VOICEVOX audio_query failed: HTTP ${audioQueryRes.status}`);
      }

      const audioQuery = await audioQueryRes.json();

      const synthesisParams = new URLSearchParams({ speaker: String(input.speakerId) });
      const synthesisRes = await withTimeout(input.timeoutMs, (signal) =>
        input.fetch(`${input.baseUrl}/synthesis?${synthesisParams.toString()}`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(audioQuery),
        }),
      );
      if (!synthesisRes.ok) {
        throw new Error(`VOICEVOX synthesis failed: HTTP ${synthesisRes.status}`);
      }
      const wavArrayBuffer = await synthesisRes.arrayBuffer();
      return { wav: Buffer.from(wavArrayBuffer) };
    },
    { backoff_ms: 100 },
  );
};

export const createVoiceVoxTtsProvider = (
  options: VoiceVoxTtsProviderOptions = {},
): Providers["tts"] => {
  const baseUrl = normalizeBaseUrl(
    options.engine_url ?? process.env.VOICEVOX_ENGINE_URL ?? "http://127.0.0.1:50021",
  );
  const timeoutMs =
    options.timeout_ms ??
    readEnvInt(process.env, {
      name: "VOICEVOX_TIMEOUT_MS",
      defaultValue: 2_000,
      min: 200,
      max: 60_000,
    });
  const rawSpeakerId = readEnvInt(process.env, {
    name: "VOICEVOX_SPEAKER_ID",
    defaultValue: DEFAULT_SPEAKER_ID,
  });
  const speakerId = rawSpeakerId >= 0 ? rawSpeakerId : DEFAULT_SPEAKER_ID;

  const fetchFn: FetchFn =
    options.fetch ??
    ((input, init) =>
      fetch(input, {
        method: init?.method,
        signal: init?.signal,
        headers: init?.headers,
        body: init?.body,
      }).then((res) => ({
        ok: res.ok,
        status: res.status,
        json: () => res.json() as Promise<unknown>,
        arrayBuffer: () => res.arrayBuffer(),
      })));

  return {
    health: () => healthFromVoiceVox({ baseUrl, timeoutMs, fetch: fetchFn }),
    synthesize: (input) =>
      synthesizeFromVoiceVox({
        baseUrl,
        timeoutMs,
        fetch: fetchFn,
        text: input.text,
        speakerId,
      }),
  };
};
