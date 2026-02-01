/* eslint-disable no-restricted-imports */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWhisperCppSttProvider } from "./stt-provider.js";

type ExecFileSync = (
  file: string,
  args: string[],
  options?: {
    timeout?: number;
    killSignal?: NodeJS.Signals;
    encoding?: BufferEncoding;
  }
) => string;

const withCleanEnv = async (run: () => Promise<void> | void) => {
  const prevCli = process.env.WHISPER_CPP_CLI_PATH;
  const prevModel = process.env.WHISPER_CPP_MODEL_PATH;
  try {
    delete process.env.WHISPER_CPP_CLI_PATH;
    delete process.env.WHISPER_CPP_MODEL_PATH;
    await run();
  } finally {
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
};

const withEnv = async (
  env: { WHISPER_CPP_CLI_PATH?: string; WHISPER_CPP_MODEL_PATH?: string },
  run: () => Promise<void> | void
) => {
  const prevCli = process.env.WHISPER_CPP_CLI_PATH;
  const prevModel = process.env.WHISPER_CPP_MODEL_PATH;
  try {
    if (env.WHISPER_CPP_CLI_PATH === undefined) {
      delete process.env.WHISPER_CPP_CLI_PATH;
    } else {
      process.env.WHISPER_CPP_CLI_PATH = env.WHISPER_CPP_CLI_PATH;
    }
    if (env.WHISPER_CPP_MODEL_PATH === undefined) {
      delete process.env.WHISPER_CPP_MODEL_PATH;
    } else {
      process.env.WHISPER_CPP_MODEL_PATH = env.WHISPER_CPP_MODEL_PATH;
    }
    await run();
  } finally {
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
};

describe("stt-provider (whisper.cpp)", () => {
  it("fails fast with a clear error when env vars are missing", async () => {
    await withCleanEnv(() => {
      const stt = createWhisperCppSttProvider();
      expect(() =>
        stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })
      ).toThrow(/WHISPER_CPP_CLI_PATH/);
      expect(() =>
        stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })
      ).toThrow(/WHISPER_CPP_MODEL_PATH/);
    });
  });

  it("reports unavailable health when env vars are missing", async () => {
    await withCleanEnv(() => {
      const stt = createWhisperCppSttProvider();
      expect(stt.health()).toEqual({ status: "unavailable" });
    });
  });

  it("reads config from env vars by default", async () => {
    await withEnv(
      {
        WHISPER_CPP_CLI_PATH: "/definitely-not-a-real-path/whisper-cli",
        WHISPER_CPP_MODEL_PATH: "/definitely-not-a-real-path/model.bin"
      },
      () => {
        const stt = createWhisperCppSttProvider();
        expect(stt.health()).toEqual({ status: "unavailable" });
      }
    );
  });

  it("reports unavailable health when configured paths do not exist", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/definitely-not-a-real-path/whisper-cli",
      model_path: "/definitely-not-a-real-path/model.bin"
    });
    expect(stt.health()).toEqual({ status: "unavailable" });
  });

  it("reports ok health when configured paths exist", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    const modelPath = path.join(tmpRoot, "model.bin");
    fs.writeFileSync(cliPath, "");
    fs.writeFileSync(modelPath, "");

    fs.chmodSync(cliPath, 0o755);

    const stt = createWhisperCppSttProvider({ cli_path: cliPath, model_path: modelPath });
    expect(stt.health()).toEqual({ status: "ok" });
  });

  it("reports unavailable health when cli path is not executable", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    const modelPath = path.join(tmpRoot, "model.bin");
    fs.writeFileSync(cliPath, "");
    fs.writeFileSync(modelPath, "");

    fs.chmodSync(cliPath, 0o644);

    const stt = createWhisperCppSttProvider({ cli_path: cliPath, model_path: modelPath });
    expect(stt.health()).toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when model path is not readable", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    const modelPath = path.join(tmpRoot, "model.bin");
    fs.writeFileSync(cliPath, "");
    fs.writeFileSync(modelPath, "");

    fs.chmodSync(cliPath, 0o755);
    fs.chmodSync(modelPath, 0o000);

    const stt = createWhisperCppSttProvider({ cli_path: cliPath, model_path: modelPath });
    expect(stt.health()).toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when only one configured path exists", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    fs.writeFileSync(cliPath, "");

    const stt = createWhisperCppSttProvider({
      cli_path: cliPath,
      model_path: path.join(tmpRoot, "missing-model.bin")
    });
    expect(stt.health()).toEqual({ status: "unavailable" });
  });

  it("fails fast when only one env var is set", async () => {
    await withEnv(
      { WHISPER_CPP_CLI_PATH: "/path/to/whisper-cli", WHISPER_CPP_MODEL_PATH: undefined },
      () => {
        const stt = createWhisperCppSttProvider();
        expect(() => stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toThrow(
          /WHISPER_CPP_MODEL_PATH/
        );
      }
    );

    await withEnv(
      { WHISPER_CPP_CLI_PATH: undefined, WHISPER_CPP_MODEL_PATH: "/path/to/model.bin" },
      () => {
        const stt = createWhisperCppSttProvider();
        expect(() => stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toThrow(
          /WHISPER_CPP_CLI_PATH/
        );
      }
    );
  });

  it("always deletes the temp wav file (success)", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const createdWavPaths: string[] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFileSync: ((file, args) => {
        void file;
        const fIndex = args.indexOf("-f");
        const wavPath = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof wavPath !== "string") {
          throw new Error("missing_wav_arg");
        }
        createdWavPaths.push(wavPath);
        expect(fs.existsSync(wavPath)).toBe(true);
        const mode = fs.statSync(wavPath).mode & 0o777;
        expect(mode).toBe(0o600);
        return "こんにちは";
      }) satisfies ExecFileSync
    });

    const result = stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    expect(result).toEqual({ text: "こんにちは" });
    expect(createdWavPaths.length).toBe(1);
    expect(fs.existsSync(createdWavPaths[0]!)).toBe(false);
  });

  it("passes timeout_ms to whisper.cpp invocation", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      timeout_ms: 123,
      execFileSync: ((file, _args, options) => {
        void file;
        expect(options?.timeout).toBe(123);
        return "ok";
      }) satisfies ExecFileSync
    });

    expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toEqual({ text: "ok" });
  });

  it("classifies temp write failure as SttProcessError", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const notADir = path.join(tmpRoot, "not-a-dir");
    fs.writeFileSync(notADir, "x");

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: notADir,
      execFileSync: (() => "ok") satisfies ExecFileSync
    });

    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttProcessError");
    }
  });

  it("always deletes the temp wav file (failure)", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const createdWavPaths: string[] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFileSync: ((file, args) => {
        void file;
        const fIndex = args.indexOf("-f");
        const wavPath = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof wavPath === "string") {
          createdWavPaths.push(wavPath);
          expect(fs.existsSync(wavPath)).toBe(true);
        }
        throw new Error("boom");
      }) satisfies ExecFileSync
    });

    expect(() => stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toThrow();
    expect(createdWavPaths.length).toBe(1);
    expect(fs.existsSync(createdWavPaths[0]!)).toBe(false);
  });

  it("classifies timeout as SttTimeoutError", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFileSync: (() => {
        const err = new Error("timeout") as Error & { code?: string };
        err.code = "ETIMEDOUT";
        throw err;
      }) satisfies ExecFileSync
    });

    expect(() => stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toThrow(
      /timed out/
    );
    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttTimeoutError");
    }
  });

  it("classifies missing executable as SttConfigError", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFileSync: (() => {
        const err = new Error("enoent") as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }) satisfies ExecFileSync
    });

    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttConfigError");
    }
  });

  it("uses the builtin execFileSync wrapper when execFileSync is not injected", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/definitely-not-a-real-path/whisper-cli",
      model_path: "/definitely-not-a-real-path/model.bin"
    });

    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttConfigError");
    }
  });

  it("keeps parse errors as SttParseError", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFileSync: (() => "\n") satisfies ExecFileSync
    });

    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttParseError");
    }
  });

  it("classifies non-Error throws as SttProcessError", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFileSync: (() => {
        throw "boom";
      }) satisfies ExecFileSync
    });

    try {
      stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("SttProcessError");
    }
  });

  it("does not fail if temp cleanup throws", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    let wavPath = "";

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFileSync: ((file, args) => {
        void file;
        const fIndex = args.indexOf("-f");
        const p = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof p === "string") {
          wavPath = p;
        }
        return "hi";
      }) satisfies ExecFileSync
    });

    const originalRmSync = fs.rmSync;
    const fsMutable = fs as typeof fs & { rmSync: typeof fs.rmSync };
    try {
      fsMutable.rmSync = () => {
        throw new Error("rm_failed");
      };
      expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).toEqual({
        text: "hi"
      });
    } finally {
      fsMutable.rmSync = originalRmSync;
      if (wavPath) {
        originalRmSync(wavPath, { force: true });
      }
    }
  });
});
