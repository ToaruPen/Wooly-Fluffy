/* eslint-disable no-restricted-imports */

import { execFileSync as execFileSyncBuiltin } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mode } from "../orchestrator.js";
import type { ProviderHealth, Providers } from "./types.js";

type ExecFileSync = (
  file: string,
  args: string[],
  options?: {
    timeout?: number;
    killSignal?: NodeJS.Signals;
    encoding?: BufferEncoding;
  }
) => string;

export type WhisperCppSttProviderOptions = {
  cli_path?: string;
  model_path?: string;
  timeout_ms?: number;
  tmp_dir?: string;
  execFileSync?: ExecFileSync;
};

const createConfigError = (): Error => {
  const err = new Error(
    "whisper.cpp is not configured: set WHISPER_CPP_CLI_PATH and WHISPER_CPP_MODEL_PATH"
  );
  err.name = "SttConfigError";
  return err;
};

const classifyExecError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    if (code === "ETIMEDOUT") {
      const err = new Error("whisper.cpp timed out");
      err.name = "SttTimeoutError";
      return err;
    }
    if (code === "ENOENT") {
      const err = new Error(
        "whisper.cpp executable not found (check WHISPER_CPP_CLI_PATH)"
      );
      err.name = "SttConfigError";
      return err;
    }
    const err = new Error("whisper.cpp failed");
    err.name = "SttProcessError";
    return err;
  }

  const err = new Error("whisper.cpp failed");
  err.name = "SttProcessError";
  return err;
};

const healthFromPaths = (cliPath: string | null, modelPath: string | null): ProviderHealth => {
  if (!cliPath || !modelPath) {
    return { status: "unavailable" };
  }
  try {
    if (!fs.existsSync(cliPath) || !fs.existsSync(modelPath)) {
      return { status: "unavailable" };
    }
    fs.accessSync(cliPath, fs.constants.X_OK);
    fs.accessSync(modelPath, fs.constants.R_OK);
    return { status: "ok" };
  } catch {
    return { status: "unavailable" };
  }
};

export const createWhisperCppSttProvider = (
  options: WhisperCppSttProviderOptions = {}
): Providers["stt"] => {
  const cliPath = options.cli_path ?? process.env.WHISPER_CPP_CLI_PATH ?? null;
  const modelPath = options.model_path ?? process.env.WHISPER_CPP_MODEL_PATH ?? null;
  const timeoutMs = options.timeout_ms ?? 15_000;
  const tmpDir = options.tmp_dir ?? os.tmpdir();
  const execFileSync: ExecFileSync =
    options.execFileSync ??
    ((file, args, execOptions) =>
      execFileSyncBuiltin(file, args, { ...execOptions, encoding: "utf8" }));

  const resolveConfigured = (): { cli: string; model: string } => {
    if (!cliPath || !modelPath) {
      throw createConfigError();
    }
    return { cli: cliPath, model: modelPath };
  };

  const transcribe: Providers["stt"]["transcribe"] = (input: {
    mode: Mode;
    wav: Buffer;
  }) => {
    void input.mode;
    const configured = resolveConfigured();
    const wavPath = path.join(tmpDir, `wf-stt-${randomUUID()}.wav`);
    try {
      try {
        fs.writeFileSync(wavPath, input.wav, { mode: 0o600 });
      } catch (cause: unknown) {
        throw classifyExecError(cause);
      }

      let stdout: string;
      try {
        stdout = execFileSync(
          configured.cli,
          ["-m", configured.model, "-f", wavPath, "-l", "ja", "-nt"],
          { timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" }
        );
      } catch (cause: unknown) {
        throw classifyExecError(cause);
      }
      const text = stdout.trim();
      if (!text) {
        const err = new Error("whisper.cpp returned empty output");
        err.name = "SttParseError";
        throw err;
      }
      return { text };
    } finally {
      try {
        fs.rmSync(wavPath, { force: true });
      } catch {
        // Best-effort cleanup; do not log sensitive data.
      }
    }
  };

  return {
    transcribe,
    health: () => healthFromPaths(cliPath, modelPath)
  };
};
