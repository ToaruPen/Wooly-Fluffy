export type PreflightResult = { ok: true } | { ok: false; errors: string[] };

const HTTP_TIMEOUT_MS = 5_000;

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

type FsConstants = { X_OK: number; R_OK: number };

const defaultFsAccess = async (path: string, mode: number): Promise<void> => {
  const fsPromises = await import("node:fs/promises");
  await fsPromises.access(path, mode);
};

const readFsConstants = async (): Promise<FsConstants> => {
  const fs = await import("node:fs");
  return fs.constants;
};

export async function runPreflight(_options?: {
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  fs_access?: (path: string, mode: number) => Promise<void>;
}): Promise<PreflightResult> {
  const env = _options?.env ?? process.env;
  const fsAccess = _options?.fs_access ?? defaultFsAccess;
  const fsConstants = await readFsConstants();
  const fetchFn = _options?.fetch ?? globalThis.fetch;
  const errors: string[] = [];
  if (!(env.STAFF_PASSCODE ?? "").trim()) {
    errors.push("STAFF_PASSCODE is not set");
  }
  const whisperCliPath = (env.WHISPER_CPP_CLI_PATH ?? "").trim();
  if (!whisperCliPath) {
    errors.push("WHISPER_CPP_CLI_PATH is not set");
  } else {
    try {
      await fsAccess(whisperCliPath, fsConstants.X_OK);
    } catch {
      errors.push("WHISPER_CPP_CLI_PATH is not executable");
    }
  }

  const whisperModelPath = (env.WHISPER_CPP_MODEL_PATH ?? "").trim();
  if (!whisperModelPath) {
    errors.push("WHISPER_CPP_MODEL_PATH is not set");
  } else {
    try {
      await fsAccess(whisperModelPath, fsConstants.R_OK);
    } catch {
      errors.push("WHISPER_CPP_MODEL_PATH is not readable");
    }
  }

  const ttsBaseUrl = normalizeBaseUrl(
    (env.TTS_ENGINE_URL ?? env.VOICEVOX_ENGINE_URL ?? "http://127.0.0.1:10101").trim(),
  );
  try {
    const res = await fetchFn(`${ttsBaseUrl}/version`, {
      method: "GET",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      errors.push(`TTS_ENGINE_URL is not reachable: HTTP ${res.status}`);
    }
  } catch {
    errors.push("TTS_ENGINE_URL is not reachable");
  }

  const llmProviderKind = (env.LLM_PROVIDER_KIND ?? "stub").trim();
  if (llmProviderKind === "stub") {
    errors.push("LLM_PROVIDER_KIND=stub is not allowed in production");
  }

  const llmBaseUrl = (env.LLM_BASE_URL ?? "").trim();
  if ((llmProviderKind === "local" || llmProviderKind === "external") && !llmBaseUrl) {
    errors.push("LLM_BASE_URL is not set");
  }

  const llmModel = (env.LLM_MODEL ?? "").trim();
  if (
    (llmProviderKind === "local" ||
      llmProviderKind === "external" ||
      llmProviderKind === "gemini_native") &&
    !llmModel
  ) {
    errors.push("LLM_MODEL is not set");
  }

  if ((llmProviderKind === "local" || llmProviderKind === "external") && llmBaseUrl) {
    const llmBaseUrlNormalized = normalizeBaseUrl(llmBaseUrl);
    try {
      const res = await fetchFn(`${llmBaseUrlNormalized}/models`, {
        method: "GET",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        errors.push(`LLM_BASE_URL is not reachable: HTTP ${res.status}`);
      }
    } catch {
      errors.push("LLM_BASE_URL is not reachable");
    }
  }

  const llmApiKey = (env.LLM_API_KEY ?? "").trim();
  const geminiApiKey = (env.GEMINI_API_KEY ?? "").trim();
  const googleApiKey = (env.GOOGLE_API_KEY ?? "").trim();
  if (llmProviderKind === "external" && !llmApiKey) {
    errors.push("LLM_API_KEY is not set");
  }
  if (llmProviderKind === "gemini_native" && !llmApiKey && !geminiApiKey && !googleApiKey) {
    errors.push("LLM_API_KEY is not set for gemini_native (or GEMINI_API_KEY/GOOGLE_API_KEY)");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
