/* eslint-disable no-restricted-imports */

import { execFile as execFileBuiltin } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mode } from "../orchestrator.js";
import type { ProviderHealth, Providers } from "./types.js";

import { readEnvInt } from "../env.js";

type ExecFile = (
  file: string,
  args: string[],
  options?: {
    timeout?: number;
    killSignal?: NodeJS.Signals;
    encoding?: BufferEncoding;
    maxBuffer?: number;
  },
) => Promise<string>;

type WhisperCppSttProviderOptions = {
  cli_path?: string;
  model_path?: string;
  timeout_ms?: number;
  tmp_dir?: string;
  execFile?: ExecFile;
};

const createConfigError = (): Error => {
  const err = new Error(
    "whisper.cpp is not configured: set WHISPER_CPP_CLI_PATH and WHISPER_CPP_MODEL_PATH",
  );
  err.name = "SttConfigError";
  return err;
};

const classifyExecError = (cause: unknown): Error => {
  if (cause instanceof Error) {
    const meta = cause as Error & { code?: unknown; killed?: unknown; signal?: unknown };
    const code = meta.code;
    if (code === "ETIMEDOUT" || (meta.killed === true && meta.signal === "SIGKILL")) {
      const err = new Error("whisper.cpp timed out");
      err.name = "SttTimeoutError";
      return err;
    }
    if (code === "ENOENT") {
      const err = new Error("whisper.cpp executable not found (check WHISPER_CPP_CLI_PATH)");
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

const isUnsupportedFlagError = (cause: unknown, flag: string): boolean => {
  if (!(cause instanceof Error)) {
    return false;
  }
  const meta = cause as Error & { stderr?: unknown; stdout?: unknown };

  const stderr =
    typeof meta.stderr === "string"
      ? meta.stderr
      : Buffer.isBuffer(meta.stderr)
        ? meta.stderr.toString("utf8")
        : "";
  const stdout =
    typeof meta.stdout === "string"
      ? meta.stdout
      : Buffer.isBuffer(meta.stdout)
        ? meta.stdout.toString("utf8")
        : "";

  const text = `${cause.message}\n${stderr}\n${stdout}`;
  if (!text.includes(flag)) {
    return false;
  }
  return (
    /(unknown|unrecognized|invalid)\s+(arguments?|options?|flags?)/i.test(text) ||
    /\bbad option\b/i.test(text)
  );
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
  options: WhisperCppSttProviderOptions = {},
): Providers["stt"] => {
  const cliPath = options.cli_path ?? process.env.WHISPER_CPP_CLI_PATH ?? null;
  const modelPath = options.model_path ?? process.env.WHISPER_CPP_MODEL_PATH ?? null;
  const timeoutMs =
    options.timeout_ms ??
    readEnvInt(process.env, {
      name: "WHISPER_CPP_TIMEOUT_MS",
      defaultValue: 15_000,
      min: 1_000,
      max: 120_000,
    });
  const tmpDir = options.tmp_dir ?? os.tmpdir();
  const execFile: ExecFile =
    options.execFile ??
    ((file, args, execOptions) =>
      new Promise<string>((resolve, reject) => {
        execFileBuiltin(
          file,
          args,
          {
            ...execOptions,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
          },
          (err, stdout) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(String(stdout));
          },
        );
      }));

  const resolveConfigured = (): { cli: string; model: string } => {
    if (!cliPath || !modelPath) {
      throw createConfigError();
    }
    return { cli: cliPath, model: modelPath };
  };

  const transcribe: Providers["stt"]["transcribe"] = async (input: { mode: Mode; wav: Buffer }) => {
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

      const execOptions = { timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" } as const;
      const baseArgs = ["-m", configured.model, "-f", wavPath, "-l", "ja", "-nt"];
      const preferredArgs = [...baseArgs, "-np"];

      try {
        stdout = await execFile(configured.cli, preferredArgs, execOptions);
      } catch (cause: unknown) {
        if (!isUnsupportedFlagError(cause, "-np")) {
          throw classifyExecError(cause);
        }
        try {
          stdout = await execFile(configured.cli, baseArgs, execOptions);
        } catch (fallbackCause: unknown) {
          throw classifyExecError(fallbackCause);
        }
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
    health: () => healthFromPaths(cliPath, modelPath),
  };
};
