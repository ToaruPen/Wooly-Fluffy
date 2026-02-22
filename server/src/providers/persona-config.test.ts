import { describe, expect, it } from "vitest";

import type { FileSystemAdapter } from "../file-system.js";
import { createPersonaConfigLoader } from "./persona-config.js";

type MemoryFile = {
  text: string;
  mtimeMs: number;
};

const createMemoryFileSystem = () => {
  const files = new Map<string, MemoryFile>();
  const readFailurePaths = new Set<string>();
  const nonFilePaths = new Set<string>();
  let clock = 1;
  let readCount = 0;
  const readCountsByPath = new Map<string, number>();

  const setFile = (filePath: string, text: string): void => {
    files.set(filePath, { text, mtimeMs: clock });
    clock += 1;
  };

  const adapter: FileSystemAdapter = {
    readTextFileSync: (filePath) => {
      readCount += 1;
      readCountsByPath.set(filePath, (readCountsByPath.get(filePath) ?? 0) + 1);
      if (readFailurePaths.has(filePath)) {
        throw new Error("read_failed");
      }
      const file = files.get(filePath);
      if (!file) {
        throw new Error("file_not_found");
      }
      return file.text;
    },
    statFileSync: (filePath) => {
      const file = files.get(filePath);
      if (!file) {
        throw new Error("file_not_found");
      }
      return {
        isFile: !nonFilePaths.has(filePath),
        size: Buffer.byteLength(file.text, "utf8"),
        mtimeMs: file.mtimeMs,
      };
    },
  };

  return {
    setFile,
    adapter,
    setReadFailure: (filePath: string, isEnabled: boolean) => {
      if (isEnabled) {
        readFailurePaths.add(filePath);
        return;
      }
      readFailurePaths.delete(filePath);
    },
    setIsFile: (filePath: string, isFile: boolean) => {
      if (isFile) {
        nonFilePaths.delete(filePath);
        return;
      }
      nonFilePaths.add(filePath);
    },
    getReadCount: () => readCount,
    getReadCountFor: (filePath: string) => readCountsByPath.get(filePath) ?? 0,
  };
};

describe("persona-config", () => {
  it("loads persona text and policy chat limits from files", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, " ぼくはやさしく話すよ。 ");
    fs.setFile(
      policyPath,
      [
        "chat:",
        "  max_output_chars: 180",
        "  max_output_tokens: 64",
        "persona:",
        "  max_bytes: 10240",
      ].join("\n"),
    );

    const env: NodeJS.ProcessEnv = {
      WOOLY_FLUFFY_PERSONA_PATH: personaPath,
      WOOLY_FLUFFY_POLICY_PATH: policyPath,
      WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS: "0",
    };

    const loader = createPersonaConfigLoader({
      env,
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("ぼくはやさしく話すよ。");
      expect(snapshot.chat_max_output_chars).toBe(180);
      expect(snapshot.chat_max_output_tokens).toBe(64);
    } finally {
      loader.close();
    }
  }, 5_000);

  it("reloads persona on file update without restart", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "first persona");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 200\n");

    const env: NodeJS.ProcessEnv = {
      WOOLY_FLUFFY_PERSONA_PATH: personaPath,
      WOOLY_FLUFFY_POLICY_PATH: policyPath,
      WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS: "0",
    };
    const loader = createPersonaConfigLoader({
      env,
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().persona_text).toBe("first persona");
      fs.setFile(personaPath, "second persona");
      expect(loader.read().persona_text).toBe("second persona");
    } finally {
      loader.close();
    }
  }, 5_000);

  it("falls back to empty persona when file exceeds max_bytes", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "0123456789");
    fs.setFile(policyPath, "persona:\n  max_bytes: 5\n");

    const env: NodeJS.ProcessEnv = {
      WOOLY_FLUFFY_PERSONA_PATH: personaPath,
      WOOLY_FLUFFY_POLICY_PATH: policyPath,
      WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS: "0",
    };
    const loader = createPersonaConfigLoader({
      env,
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("");
      expect(snapshot.chat_max_output_chars).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("keeps cached persona when persona and policy mtimes are unchanged", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "cached persona");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 120\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().persona_text).toBe("cached persona");
      const beforePersonaReadCount = fs.getReadCountFor(personaPath);
      const beforePolicyReadCount = fs.getReadCountFor(policyPath);
      expect(loader.read().persona_text).toBe("cached persona");
      expect(fs.getReadCountFor(personaPath)).toBe(beforePersonaReadCount);
      expect(fs.getReadCountFor(policyPath)).toBe(beforePolicyReadCount);
    } finally {
      loader.close();
    }
  }, 5_000);

  it("ignores fractional chat limits in policy schema", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(
      policyPath,
      ["chat:", "  max_output_chars: 120.5", "  max_output_tokens: 64.25"].join("\n"),
    );

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
      expect(snapshot.chat_max_output_tokens).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("re-evaluates persona size when policy changes without persona mtime change", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "0123456789");
    fs.setFile(policyPath, "persona:\n  max_bytes: 20\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().persona_text).toBe("0123456789");
      fs.setFile(policyPath, "persona:\n  max_bytes: 5\n");
      expect(loader.read().persona_text).toBe("");
    } finally {
      loader.close();
    }
  }, 5_000);

  it("marks dirty via watcher and skips persona re-read when mtime is unchanged", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "same persona");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 120\n");

    const watcherHooks: { trigger: () => void } = {
      trigger: () => {},
    };
    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: (_paths, onDirty) => {
        watcherHooks.trigger = onDirty;
        return { close: () => {} };
      },
    });
    try {
      expect(loader.read().persona_text).toBe("same persona");
      const beforePersonaReadCount = fs.getReadCountFor(personaPath);
      watcherHooks.trigger();
      expect(loader.read().persona_text).toBe("same persona");
      expect(fs.getReadCountFor(personaPath)).toBe(beforePersonaReadCount);
    } finally {
      loader.close();
    }
  }, 5_000);

  it("falls back to empty persona when stat succeeds but read fails", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "will fail to read");
    fs.setFile(policyPath, "persona:\n  max_bytes: 999\n");
    fs.setReadFailure(personaPath, true);

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().persona_text).toBe("");
    } finally {
      loader.close();
    }
  }, 5_000);

  it("falls back to empty policy when policy file read fails", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 140\n");
    fs.setReadFailure(policyPath, true);

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
      expect(snapshot.chat_max_output_tokens).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("falls back to empty policy on YAML parse errors", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(policyPath, "invalid: [yaml");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("falls back to empty policy when policy file is missing", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/missing-policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
      expect(snapshot.chat_max_output_tokens).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("uses Linux default persona and policy paths when env overrides are absent", async () => {
    const fs = createMemoryFileSystem();
    const personaPath = "/home/test/.config/wooly-fluffy/persona.md";
    const policyPath = "/home/test/.config/wooly-fluffy/policy.yaml";
    fs.setFile(personaPath, "linux persona");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 90\n");

    const loader = createPersonaConfigLoader({
      env: {},
      platform: "linux",
      homedir: () => "/home/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.paths.persona_path).toBe(personaPath);
      expect(loader.paths.policy_path).toBe(policyPath);
      expect(loader.read().persona_text).toBe("linux persona");
    } finally {
      loader.close();
    }
  }, 5_000);

  it("ignores policy when stat exists but path is not a file", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 999\n");
    fs.setIsFile(policyPath, false);

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("drops policy when policy path becomes non-file after initial load", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 101\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().chat_max_output_chars).toBe(101);
      fs.setIsFile(policyPath, false);
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
      expect(snapshot.chat_max_output_tokens).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("ignores invalid policy schema values", async () => {
    const personaPath = "/tmp/persona.md";
    const policyPath = "/tmp/policy.yaml";

    const fs = createMemoryFileSystem();
    fs.setFile(personaPath, "hello");
    fs.setFile(policyPath, "chat:\n  max_output_chars: bad\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("hello");
      expect(snapshot.chat_max_output_chars).toBeNull();
      expect(snapshot.chat_max_output_tokens).toBeNull();
    } finally {
      loader.close();
    }
  }, 5_000);

  it("creates and closes default watcher without crashing", async () => {
    const fs = createMemoryFileSystem();
    const personaPath = "/tmp/persona-default-watch.md";
    const policyPath = "/tmp/policy-default-watch.yaml";
    fs.setFile(personaPath, "watch persona");
    fs.setFile(policyPath, "chat:\n  max_output_chars: 40\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: personaPath,
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
    });
    try {
      expect(loader.read().persona_text).toBe("watch persona");
    } finally {
      loader.close();
    }
  }, 5_000);

  it("uses null-safe mtime comparison when persona file is missing", async () => {
    const policyPath = "/tmp/policy-missing-persona.yaml";
    const fs = createMemoryFileSystem();
    fs.setFile(policyPath, "chat:\n  max_output_chars: 50\n");

    const loader = createPersonaConfigLoader({
      env: {
        WOOLY_FLUFFY_PERSONA_PATH: "/tmp/missing-persona.md",
        WOOLY_FLUFFY_POLICY_PATH: policyPath,
      },
      platform: "darwin",
      homedir: () => "/Users/test",
      fileSystem: fs.adapter,
      createWatcher: () => ({ close: () => {} }),
    });
    try {
      expect(loader.read().persona_text).toBe("");
      expect(loader.read().persona_text).toBe("");
    } finally {
      loader.close();
    }
  }, 5_000);
});
