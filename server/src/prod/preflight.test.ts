import { describe, expect, it } from "vitest";
import { nodeFsConstants } from "../file-system.js";

import { runPreflight } from "./preflight.js";

const baseEnv = {
  STAFF_PASSCODE: "test-pass",
  WHISPER_CPP_CLI_PATH: "/usr/local/bin/whisper-cli",
  WHISPER_CPP_MODEL_PATH: "/models/ggml-large.bin",
  TTS_ENGINE_URL: "http://127.0.0.1:10101",
  LLM_PROVIDER_KIND: "local",
  LLM_BASE_URL: "http://127.0.0.1:1234/v1",
  LLM_MODEL: "test-model",
} satisfies Record<string, string>;

const okFsAccess = async (): Promise<void> => {};
const okFetch = async (): Promise<Response> => ({ ok: true, status: 200 }) as Response;

const readFsConstants = async (): Promise<{ X_OK: number; R_OK: number }> => nodeFsConstants();

describe("runPreflight", () => {
  it(
    "fails when STAFF_PASSCODE is missing",
    async () => {
      const { STAFF_PASSCODE: _staffPasscode, ...env } = baseEnv;

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("STAFF_PASSCODE"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when WHISPER_CPP_CLI_PATH is missing",
    async () => {
      const { WHISPER_CPP_CLI_PATH: _cliPath, ...env } = baseEnv;

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_CLI_PATH"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when WHISPER_CPP_CLI_PATH is not executable",
    async () => {
      const fsConstants = await readFsConstants();
      const failingFsAccess = async (path: string, mode: number): Promise<void> => {
        if (path === baseEnv.WHISPER_CPP_CLI_PATH && mode === fsConstants.X_OK) {
          throw new Error("EACCES");
        }
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: okFetch,
        fs_access: failingFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_CLI_PATH"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when WHISPER_CPP_MODEL_PATH is missing",
    async () => {
      const { WHISPER_CPP_MODEL_PATH: _modelPath, ...env } = baseEnv;

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_MODEL_PATH"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when WHISPER_CPP_MODEL_PATH is not readable",
    async () => {
      const fsConstants = await readFsConstants();
      const failingFsAccess = async (path: string, mode: number): Promise<void> => {
        if (path === baseEnv.WHISPER_CPP_MODEL_PATH && mode === fsConstants.R_OK) {
          throw new Error("EACCES");
        }
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: okFetch,
        fs_access: failingFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_MODEL_PATH"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when TTS engine is unreachable",
    async () => {
      const failingFetch: typeof globalThis.fetch = async (input) => {
        if (String(input).endsWith("/version")) {
          throw new Error("offline");
        }
        return { ok: true, status: 200 } as Response;
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: failingFetch,
        fs_access: okFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("TTS_ENGINE_URL"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when TTS engine returns non-ok HTTP status",
    async () => {
      const failingFetch: typeof globalThis.fetch = async (input) => {
        if (String(input).endsWith("/version")) {
          return { ok: false, status: 502 } as Response;
        }
        return { ok: true, status: 200 } as Response;
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: failingFetch,
        fs_access: okFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(
        result.errors.some((error) => error.includes("TTS_ENGINE_URL") && error.includes("502")),
      ).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_PROVIDER_KIND is stub",
    async () => {
      const env = { ...baseEnv, LLM_PROVIDER_KIND: "stub" };

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("LLM_PROVIDER_KIND"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_PROVIDER_KIND is unknown",
    async () => {
      const env = { ...baseEnv, LLM_PROVIDER_KIND: "foo" };

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(
        result.errors.some((error) => error.includes("LLM_PROVIDER_KIND") && error.includes("foo")),
      ).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_BASE_URL is missing for local provider",
    async () => {
      const { LLM_BASE_URL: _baseUrl, ...env } = baseEnv;

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("LLM_BASE_URL"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_MODEL is missing",
    async () => {
      const { LLM_MODEL: _llmModel, ...env } = baseEnv;

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("LLM_MODEL"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when local LLM_BASE_URL is unreachable",
    async () => {
      const failingFetch: typeof globalThis.fetch = async (input) => {
        if (String(input).endsWith("/models")) {
          throw new Error("offline");
        }
        return { ok: true, status: 200 } as Response;
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: failingFetch,
        fs_access: okFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("LLM_BASE_URL"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_API_KEY is missing for external provider",
    async () => {
      const env = {
        ...baseEnv,
        LLM_PROVIDER_KIND: "external",
        LLM_BASE_URL: "https://api.example.com/v1",
      };

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("LLM_API_KEY"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "collects all errors instead of failing fast",
    async () => {
      const env: Record<string, string | undefined> = {};

      const failingFsAccess = async (): Promise<void> => {
        throw new Error("missing");
      };
      const failingFetch: typeof globalThis.fetch = async () => {
        throw new Error("offline");
      };

      const result = await runPreflight({
        env,
        fetch: failingFetch,
        fs_access: failingFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.errors.some((error) => error.includes("STAFF_PASSCODE"))).toBe(true);
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_CLI_PATH"))).toBe(true);
      expect(result.errors.some((error) => error.includes("WHISPER_CPP_MODEL_PATH"))).toBe(true);
      expect(result.errors.some((error) => error.includes("TTS_ENGINE_URL"))).toBe(true);
      expect(result.errors.some((error) => error.includes("LLM_PROVIDER_KIND"))).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "passes when all checks are valid",
    async () => {
      const result = await runPreflight({ env: baseEnv, fetch: okFetch, fs_access: okFsAccess });

      expect(result).toEqual({ ok: true });
    },
    { timeout: 5_000 },
  );

  it(
    "accepts GEMINI_API_KEY for gemini_native and skips LLM_BASE_URL reachability",
    async () => {
      const env = {
        ...baseEnv,
        LLM_PROVIDER_KIND: "gemini_native",
        LLM_MODEL: "gemini-2.5-flash-lite",
        GEMINI_API_KEY: "test-gemini-key",
        LLM_BASE_URL: "",
      };
      let modelCalls = 0;

      const fetchSpy: typeof globalThis.fetch = async (input) => {
        if (String(input).endsWith("/models")) {
          modelCalls += 1;
        }
        return { ok: true, status: 200 } as Response;
      };

      const result = await runPreflight({ env, fetch: fetchSpy, fs_access: okFsAccess });

      expect(result).toEqual({ ok: true });
      expect(modelCalls).toBe(0);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when LLM_BASE_URL returns non-ok HTTP status",
    async () => {
      const failingFetch: typeof globalThis.fetch = async (input) => {
        if (String(input).endsWith("/models")) {
          return { ok: false, status: 503 } as Response;
        }
        return { ok: true, status: 200 } as Response;
      };

      const result = await runPreflight({
        env: baseEnv,
        fetch: failingFetch,
        fs_access: okFsAccess,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(
        result.errors.some((error) => error.includes("LLM_BASE_URL") && error.includes("503")),
      ).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "fails when gemini_native has no API keys at all",
    async () => {
      const env = {
        ...baseEnv,
        LLM_PROVIDER_KIND: "gemini_native",
        LLM_MODEL: "gemini-2.5-flash-lite",
        LLM_BASE_URL: "",
      };

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(
        result.errors.some(
          (error) => error.includes("LLM_API_KEY") && error.includes("gemini_native"),
        ),
      ).toBe(true);
    },
    { timeout: 5_000 },
  );

  it(
    "accepts GOOGLE_API_KEY as fallback for gemini_native",
    async () => {
      const env = {
        ...baseEnv,
        LLM_PROVIDER_KIND: "gemini_native",
        LLM_MODEL: "gemini-2.5-flash-lite",
        GOOGLE_API_KEY: "test-google-key",
        LLM_BASE_URL: "",
      };

      const result = await runPreflight({ env, fetch: okFetch, fs_access: okFsAccess });

      expect(result).toEqual({ ok: true });
    },
    { timeout: 5_000 },
  );
});
