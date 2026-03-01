/* eslint-disable no-restricted-imports */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWhisperCppSttProvider } from "./stt-provider.js";

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
  run: () => Promise<void> | void,
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
      return Promise.all([
        expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toThrow(
          /WHISPER_CPP_CLI_PATH/,
        ),
        expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toThrow(
          /WHISPER_CPP_MODEL_PATH/,
        ),
      ]).then(() => {});
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
        WHISPER_CPP_MODEL_PATH: "/definitely-not-a-real-path/model.bin",
      },
      () => {
        const stt = createWhisperCppSttProvider();
        expect(stt.health()).toEqual({ status: "unavailable" });
      },
    );
  });

  it("reports unavailable health when configured paths do not exist", () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/definitely-not-a-real-path/whisper-cli",
      model_path: "/definitely-not-a-real-path/model.bin",
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
      model_path: path.join(tmpRoot, "missing-model.bin"),
    });
    expect(stt.health()).toEqual({ status: "unavailable" });
  });

  it("fails fast when only one env var is set", async () => {
    await withEnv(
      { WHISPER_CPP_CLI_PATH: "/path/to/whisper-cli", WHISPER_CPP_MODEL_PATH: undefined },
      () => {
        const stt = createWhisperCppSttProvider();
        return expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toThrow(
          /WHISPER_CPP_MODEL_PATH/,
        );
      },
    );

    await withEnv(
      { WHISPER_CPP_CLI_PATH: undefined, WHISPER_CPP_MODEL_PATH: "/path/to/model.bin" },
      () => {
        const stt = createWhisperCppSttProvider();
        return expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toThrow(
          /WHISPER_CPP_CLI_PATH/,
        );
      },
    );
  });

  it("reads timeout from env when timeout_ms is not provided", async () => {
    const prevTimeout = process.env.WHISPER_CPP_TIMEOUT_MS;
    try {
      process.env.WHISPER_CPP_TIMEOUT_MS = "1234";

      const stt = createWhisperCppSttProvider({
        cli_path: "/path/to/whisper-cli",
        model_path: "/path/to/model.bin",
        execFile: (async (_file, _args, options) => {
          expect(options?.timeout).toBe(1234);
          return "ok";
        }) satisfies ExecFile,
      });

      await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
        text: "ok",
      });
    } finally {
      if (prevTimeout === undefined) {
        delete process.env.WHISPER_CPP_TIMEOUT_MS;
      } else {
        process.env.WHISPER_CPP_TIMEOUT_MS = prevTimeout;
      }
    }
  });

  it("always deletes the temp wav file (success)", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const createdWavPaths: string[] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (file, args) => {
        void file;
        expect(args).toContain("-np");
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
      }) satisfies ExecFile,
    });

    const result = await stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    expect(result).toEqual({ text: "こんにちは" });
    expect(createdWavPaths.length).toBe(1);
    expect(fs.existsSync(createdWavPaths[0])).toBe(false);
  });

  it("retries without -np when whisper-cli rejects the flag", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const calls: string[][] = [];
    let wavPath: string | undefined;

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (file, args) => {
        void file;
        calls.push(args);

        const fIndex = args.indexOf("-f");
        const currentWavPath = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof currentWavPath !== "string") {
          throw new Error("missing_wav_arg");
        }
        if (wavPath === undefined) {
          wavPath = currentWavPath;
        } else {
          expect(currentWavPath).toBe(wavPath);
        }

        if (args.includes("-np")) {
          const err = new Error("unknown argument") as Error & { stderr?: string };
          err.stderr = "unknown argument: -np";
          throw err;
        }
        return "こんにちは";
      }) satisfies ExecFile,
    });

    const result = await stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") });
    expect(result).toEqual({ text: "こんにちは" });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("-np");
    expect(calls[1]).not.toContain("-np");

    expect(typeof wavPath).toBe("string");
    expect(fs.existsSync(wavPath!)).toBe(false);
  });

  it("detects unsupported flag errors from Buffer stderr/stdout", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const calls: string[][] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (_file, args) => {
        calls.push(args);
        if (args.includes("-np")) {
          const err = new Error("bad option: -np") as Error & {
            stderr?: unknown;
            stdout?: unknown;
          };
          err.stderr = Buffer.from("bad option: -np", "utf8");
          err.stdout = Buffer.from("", "utf8");
          throw err;
        }
        return "ok";
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
      text: "ok",
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("-np");
    expect(calls[1]).not.toContain("-np");
  });

  it("detects unsupported flag errors from stdout string", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const calls: string[][] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (_file, args) => {
        calls.push(args);
        if (args.includes("-np")) {
          const err = new Error("whisper failed") as Error & { stdout?: string };
          err.stdout = "unrecognized option: -np";
          throw err;
        }
        return "ok";
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
      text: "ok",
    });
    expect(calls.length).toBe(2);
  });

  it("fails when both preferred and fallback whisper-cli invocations fail", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const calls: string[][] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (_file, args) => {
        calls.push(args);
        if (args.includes("-np")) {
          const err = new Error("unknown argument: -np") as Error & { stderr?: string };
          err.stderr = "unknown argument: -np";
          throw err;
        }
        throw new Error("boom");
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttProcessError",
      },
    );
    expect(calls.length).toBe(2);
  });

  it("passes timeout_ms to whisper.cpp invocation", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      timeout_ms: 123,
      execFile: (async (file, _args, options) => {
        void file;
        expect(options?.timeout).toBe(123);
        return "ok";
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
      text: "ok",
    });
  });

  it("times out via real subprocess and leaves no temp wav file behind", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    const modelPath = path.join(tmpRoot, "model.bin");

    fs.writeFileSync(
      cliPath,
      "#!/usr/bin/env bash\n" +
        "# Intentionally sleep longer than timeout to exercise execFile timeout path\n" +
        "sleep 0.2\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(modelPath, "x");

    const stt = createWhisperCppSttProvider({
      cli_path: cliPath,
      model_path: modelPath,
      tmp_dir: tmpRoot,
      timeout_ms: 50,
    });

    const start = Date.now();
    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttTimeoutError",
      },
    );
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(1000);

    const files = fs.readdirSync(tmpRoot);
    expect(files.some((f) => f.startsWith("wf-stt-") && f.endsWith(".wav"))).toBe(false);
  });

  it("classifies temp write failure as SttProcessError", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const notADir = path.join(tmpRoot, "not-a-dir");
    fs.writeFileSync(notADir, "x");

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: notADir,
      execFile: (async () => "ok") satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttProcessError",
      },
    );
  });

  it("always deletes the temp wav file (failure)", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const createdWavPaths: string[] = [];

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (file, args) => {
        void file;
        const fIndex = args.indexOf("-f");
        const wavPath = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof wavPath === "string") {
          createdWavPaths.push(wavPath);
          expect(fs.existsSync(wavPath)).toBe(true);
        }
        throw new Error("boom");
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toBeTruthy();
    expect(createdWavPaths.length).toBe(1);
    expect(fs.existsSync(createdWavPaths[0])).toBe(false);
  });

  it("classifies timeout as SttTimeoutError", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFile: (async () => {
        const err = new Error("timeout") as Error & { code?: string };
        err.code = "ETIMEDOUT";
        throw err;
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toThrow(
      /timed out/,
    );
    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttTimeoutError",
      },
    );
  });

  it("classifies missing executable as SttConfigError", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFile: (async () => {
        const err = new Error("enoent") as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttConfigError",
      },
    );
  });

  it("uses the builtin execFile wrapper when execFile is not injected", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/definitely-not-a-real-path/whisper-cli",
      model_path: "/definitely-not-a-real-path/model.bin",
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttConfigError",
      },
    );
  });

  it("uses the builtin execFile wrapper when a runnable cli is configured", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    const cliPath = path.join(tmpRoot, "whisper-cli");
    const modelPath = path.join(tmpRoot, "model.bin");

    fs.writeFileSync(
      cliPath,
      "#!/usr/bin/env bash\n" + "# Minimal fake whisper.cpp CLI for tests\n" + "echo hello\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(modelPath, "x");

    const stt = createWhisperCppSttProvider({
      cli_path: cliPath,
      model_path: modelPath,
      tmp_dir: tmpRoot,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
      text: "hello",
    });

    const files = fs.readdirSync(tmpRoot);
    expect(files.some((f) => f.startsWith("wf-stt-") && f.endsWith(".wav"))).toBe(false);
  });

  it("keeps parse errors as SttParseError", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFile: (async () => "\n") satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttParseError",
      },
    );
  });

  it("classifies non-Error throws as SttProcessError", async () => {
    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      execFile: (async () => {
        throw "boom";
      }) satisfies ExecFile,
    });

    await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).rejects.toMatchObject(
      {
        name: "SttProcessError",
      },
    );
  });

  it("does not fail if temp cleanup throws", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-stt-test-"));
    let wavPath = "";

    const stt = createWhisperCppSttProvider({
      cli_path: "/path/to/whisper-cli",
      model_path: "/path/to/model.bin",
      tmp_dir: tmpRoot,
      execFile: (async (file, args) => {
        void file;
        const fIndex = args.indexOf("-f");
        const p = fIndex >= 0 ? args[fIndex + 1] : undefined;
        if (typeof p === "string") {
          wavPath = p;
        }
        return "hi";
      }) satisfies ExecFile,
    });

    const originalRmSync = fs.rmSync;
    const fsMutable = fs as typeof fs & { rmSync: typeof fs.rmSync };
    try {
      fsMutable.rmSync = () => {
        throw new Error("rm_failed");
      };
      await expect(stt.transcribe({ mode: "ROOM", wav: Buffer.from("dummy") })).resolves.toEqual({
        text: "hi",
      });
    } finally {
      fsMutable.rmSync = originalRmSync;
      if (wavPath) {
        originalRmSync(wavPath, { force: true });
      }
    }
  });
});
