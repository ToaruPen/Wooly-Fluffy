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

const DEFAULT_ENGINE_URL = "http://127.0.0.1:10101";
const DEFAULT_TIMEOUT_MS = 2_000;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const readEnvOptionalString = (
  env: Record<string, string | undefined>,
  name: string,
): string | null => {
  const raw = env[name];
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
};

const toInt32OrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  if (parsed < INT32_MIN || parsed > INT32_MAX) {
    return null;
  }
  return parsed;
};

const readEnvOptionalInt32 = (
  env: Record<string, string | undefined>,
  name: string,
): number | null => {
  const raw = env[name];
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return toInt32OrNull(trimmed);
};

const withTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
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

const speakerIdFromSpeakersJson = (speakers: unknown): number => {
  if (!Array.isArray(speakers) || speakers.length === 0) {
    throw new Error("no_speakers");
  }

  let fallbackSpeakerId: number | null = null;
  for (const speaker of speakers) {
    const styles = Array.isArray((speaker as { styles?: unknown })?.styles)
      ? ((speaker as { styles?: unknown }).styles as unknown[])
      : [];
    for (const style of styles) {
      const styleId = toInt32OrNull((style as { id?: unknown })?.id);
      if (styleId === null) {
        continue;
      }
      const rawType = (style as { type?: unknown })?.type;
      const styleType = typeof rawType === "string" ? rawType.trim().toLowerCase() : null;
      if (styleType === "talk") {
        return styleId;
      }
      if (styleType === null || styleType === "") {
        fallbackSpeakerId ??= styleId;
      }
    }
  }

  if (fallbackSpeakerId !== null) {
    return fallbackSpeakerId;
  }
  throw new Error("no_talk_style");
};

const defaultSpeakerIdFromEngine = async (input: {
  baseUrl: string;
  timeoutMs: number;
  fetch: FetchFn;
}): Promise<number> => {
  return await withOneRetry(
    async () => {
      return await withTimeout(input.timeoutMs, async (signal) => {
        const res = await input.fetch(`${input.baseUrl}/speakers`, { method: "GET", signal });
        if (!res.ok) {
          throw new Error(`TTS engine speakers failed: HTTP ${res.status}`);
        }
        const speakers = await res.json();
        return speakerIdFromSpeakersJson(speakers);
      });
    },
    { backoff_ms: 100 },
  );
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
        throw new Error(`TTS engine audio_query failed: HTTP ${audioQueryRes.status}`);
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
        throw new Error(`TTS engine synthesis failed: HTTP ${synthesisRes.status}`);
      }
      const wavArrayBuffer = await synthesisRes.arrayBuffer();
      return { wav: Buffer.from(wavArrayBuffer) };
    },
    { backoff_ms: 100 },
  );
};

export const createVoicevoxCompatibleTtsProvider = (
  options: VoiceVoxTtsProviderOptions = {},
): Providers["tts"] => {
  const baseUrl = normalizeBaseUrl(
    options.engine_url ??
      readEnvOptionalString(process.env, "TTS_ENGINE_URL") ??
      readEnvOptionalString(process.env, "VOICEVOX_ENGINE_URL") ??
      DEFAULT_ENGINE_URL,
  );
  const timeoutMs =
    options.timeout_ms ??
    readEnvInt(process.env, {
      name: "TTS_TIMEOUT_MS",
      defaultValue: readEnvInt(process.env, {
        name: "VOICEVOX_TIMEOUT_MS",
        defaultValue: DEFAULT_TIMEOUT_MS,
        min: 200,
        max: 60_000,
      }),
      min: 200,
      max: 60_000,
    });

  const configuredSpeakerId =
    readEnvOptionalInt32(process.env, "TTS_SPEAKER_ID") ??
    readEnvOptionalInt32(process.env, "VOICEVOX_SPEAKER_ID");
  let cachedSpeakerId: number | null = configuredSpeakerId;

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
    health: async () => {
      const health = await healthFromVoiceVox({ baseUrl, timeoutMs, fetch: fetchFn });
      if (health.status !== "ok") {
        return health;
      }
      if (cachedSpeakerId !== null) {
        return health;
      }
      try {
        cachedSpeakerId = await defaultSpeakerIdFromEngine({ baseUrl, timeoutMs, fetch: fetchFn });
        return health;
      } catch {
        return { status: "unavailable" };
      }
    },
    synthesize: async (input) => {
      if (cachedSpeakerId === null) {
        cachedSpeakerId = await defaultSpeakerIdFromEngine({ baseUrl, timeoutMs, fetch: fetchFn });
      }
      return await synthesizeFromVoiceVox({
        baseUrl,
        timeoutMs,
        fetch: fetchFn,
        text: input.text,
        speakerId: cachedSpeakerId,
      });
    },
  };
};

export const createVoiceVoxTtsProvider = createVoicevoxCompatibleTtsProvider;
