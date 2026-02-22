import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPersonaConfigLoader } from "./persona-config.js";

describe("persona-config", () => {
  it("loads persona text and policy chat limits from files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-persona-config-"));
    const personaPath = join(dir, "persona.md");
    const policyPath = join(dir, "policy.yaml");
    await writeFile(personaPath, " ぼくはやさしく話すよ。 ", "utf8");
    await writeFile(
      policyPath,
      [
        "chat:",
        "  max_output_chars: 180",
        "  max_output_tokens: 64",
        "persona:",
        "  max_bytes: 10240",
      ].join("\n"),
      "utf8",
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
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("ぼくはやさしく話すよ。");
      expect(snapshot.chat_max_output_chars).toBe(180);
      expect(snapshot.chat_max_output_tokens).toBe(64);
    } finally {
      loader.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reloads persona on file update without restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-persona-config-"));
    const personaPath = join(dir, "persona.md");
    const policyPath = join(dir, "policy.yaml");
    await writeFile(personaPath, "first persona", "utf8");
    await writeFile(policyPath, "chat:\n  max_output_chars: 200\n", "utf8");

    const env: NodeJS.ProcessEnv = {
      WOOLY_FLUFFY_PERSONA_PATH: personaPath,
      WOOLY_FLUFFY_POLICY_PATH: policyPath,
      WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS: "0",
    };
    const loader = createPersonaConfigLoader({
      env,
      platform: "darwin",
      homedir: () => "/Users/test",
    });
    try {
      expect(loader.read().persona_text).toBe("first persona");
      await writeFile(personaPath, "second persona", "utf8");
      expect(loader.read().persona_text).toBe("second persona");
    } finally {
      loader.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to empty persona when file exceeds max_bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wf-persona-config-"));
    const personaPath = join(dir, "persona.md");
    const policyPath = join(dir, "policy.yaml");
    await writeFile(personaPath, "0123456789", "utf8");
    await writeFile(policyPath, "persona:\n  max_bytes: 5\n", "utf8");

    const env: NodeJS.ProcessEnv = {
      WOOLY_FLUFFY_PERSONA_PATH: personaPath,
      WOOLY_FLUFFY_POLICY_PATH: policyPath,
      WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS: "0",
    };
    const loader = createPersonaConfigLoader({
      env,
      platform: "darwin",
      homedir: () => "/Users/test",
    });
    try {
      const snapshot = loader.read();
      expect(snapshot.persona_text).toBe("");
      expect(snapshot.chat_max_output_chars).toBeNull();
    } finally {
      loader.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
