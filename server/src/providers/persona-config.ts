// eslint-disable-next-line no-restricted-imports
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { parse as parseYaml } from "yaml";
import { maxValue, minValue, number, object, optional, pipe, safeParse, unknown } from "valibot";

type PersonaPolicy = {
  chat?: {
    max_output_chars?: number;
    max_output_tokens?: number;
  };
  watch?: {
    debounce_ms?: number;
  };
  persona?: {
    max_bytes?: number;
  };
};

export type PersonaConfigSnapshot = {
  persona_text: string;
  chat_max_output_chars: number | null;
  chat_max_output_tokens: number | null;
};

export type PersonaConfigLoader = {
  read: () => PersonaConfigSnapshot;
  close: () => void;
  paths: {
    persona_path: string;
    policy_path: string;
  };
};

type PersonaConfigDeps = {
  env: NodeJS.ProcessEnv;
  platform: string;
  homedir: () => string;
  readFileSync: typeof readFileSync;
  statSync: typeof statSync;
  createWatcher: (
    paths: string[],
    onDirty: () => void,
    debounceMs: number,
  ) => { close: () => void };
};

const DEFAULT_PERSONA_MAX_BYTES = 10 * 1024;
const DEFAULT_WATCH_DEBOUNCE_MS = 120;

const policySchema = object({
  chat: optional(
    object({
      max_output_chars: optional(pipe(number(), minValue(1), maxValue(4_000))),
      max_output_tokens: optional(pipe(number(), minValue(1), maxValue(8_192))),
    }),
  ),
  watch: optional(
    object({
      debounce_ms: optional(pipe(number(), minValue(0), maxValue(3_000))),
    }),
  ),
  persona: optional(
    object({
      max_bytes: optional(pipe(number(), minValue(1), maxValue(256_000))),
    }),
  ),
});

const defaultCreateWatcher = (
  paths: string[],
  onDirty: () => void,
  debounceMs: number,
): { close: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher: FSWatcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: false,
    awaitWriteFinish: {
      stabilityThreshold: Math.max(0, debounceMs),
      pollInterval: 50,
    },
  });
  const markDirty = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(
      () => {
        onDirty();
      },
      Math.max(0, debounceMs),
    );
    timer.unref?.();
  };
  watcher.on("add", markDirty);
  watcher.on("change", markDirty);
  watcher.on("unlink", markDirty);
  watcher.on("error", markDirty);
  return {
    close: () => {
      if (timer) {
        clearTimeout(timer);
      }
      void watcher.close();
    },
  };
};

const defaultDeps = (): PersonaConfigDeps => ({
  env: process.env,
  platform: process.platform,
  homedir: os.homedir,
  readFileSync,
  statSync,
  createWatcher: defaultCreateWatcher,
});

const safeStat = (
  d: PersonaConfigDeps,
  filePath: string,
): { mtimeMs: number; size: number } | null => {
  try {
    const st = d.statSync(filePath);
    if (!st.isFile()) {
      return null;
    }
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
};

const safeReadText = (d: PersonaConfigDeps, filePath: string): string | null => {
  try {
    return d.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
};

const normalizePolicy = (input: unknown): PersonaPolicy => {
  const parsed = safeParse(policySchema, input);
  if (!parsed.success) {
    return {};
  }
  return parsed.output as PersonaPolicy;
};

const readPolicyYaml = (
  d: PersonaConfigDeps,
  policyPath: string,
): { policy: PersonaPolicy; mtimeMs: number | null } => {
  const st = safeStat(d, policyPath);
  if (!st) {
    return { policy: {}, mtimeMs: null };
  }
  const text = safeReadText(d, policyPath);
  if (text === null) {
    return { policy: {}, mtimeMs: st.mtimeMs };
  }
  try {
    const raw = parseYaml(text) as unknown;
    if (safeParse(unknown(), raw).success) {
      return { policy: normalizePolicy(raw), mtimeMs: st.mtimeMs };
    }
    return { policy: {}, mtimeMs: st.mtimeMs };
  } catch {
    return { policy: {}, mtimeMs: st.mtimeMs };
  }
};

export const createPersonaConfigLoader = (
  deps: Partial<PersonaConfigDeps> = {},
): PersonaConfigLoader => {
  const d = { ...defaultDeps(), ...deps } satisfies PersonaConfigDeps;

  const appSupportDir =
    d.platform === "darwin"
      ? join(d.homedir(), "Library", "Application Support", "wooly-fluffy")
      : join(d.homedir(), ".config", "wooly-fluffy");

  const personaPath = d.env.WOOLY_FLUFFY_PERSONA_PATH ?? join(appSupportDir, "persona.md");
  const policyPath = d.env.WOOLY_FLUFFY_POLICY_PATH ?? join(appSupportDir, "policy.yaml");

  let personaText = "";
  let personaMtimeMs: number | null = null;
  let policyMtimeMs: number | null = null;
  let policy: PersonaPolicy = {};
  let dirty = true;

  const watchDebounceMs = (() => {
    const raw = d.env.WOOLY_FLUFFY_PERSONA_WATCH_DEBOUNCE_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return DEFAULT_WATCH_DEBOUNCE_MS;
    }
    return Math.max(0, Math.min(3_000, parsed));
  })();

  const watcher = d.createWatcher(
    [personaPath, policyPath],
    () => {
      dirty = true;
    },
    watchDebounceMs,
  );

  const reloadIfNeeded = () => {
    const policyRead = readPolicyYaml(d, policyPath);
    const personaStat = safeStat(d, personaPath);
    if (
      !dirty &&
      policyRead.mtimeMs === policyMtimeMs &&
      (personaStat?.mtimeMs ?? null) === personaMtimeMs
    ) {
      return;
    }
    dirty = false;

    if (policyRead.mtimeMs !== policyMtimeMs) {
      policyMtimeMs = policyRead.mtimeMs;
      policy = policyRead.policy;
    }

    if (!personaStat) {
      personaText = "";
      personaMtimeMs = null;
      return;
    }
    if (personaMtimeMs !== null && personaMtimeMs === personaStat.mtimeMs) {
      return;
    }
    personaMtimeMs = personaStat.mtimeMs;

    const maxBytes = policy.persona?.max_bytes ?? DEFAULT_PERSONA_MAX_BYTES;
    if (personaStat.size > maxBytes) {
      personaText = "";
      return;
    }

    const text = safeReadText(d, personaPath);
    if (text === null) {
      personaText = "";
      return;
    }
    personaText = text.trim();
  };

  return {
    read: () => {
      reloadIfNeeded();
      return {
        persona_text: personaText,
        chat_max_output_chars: policy.chat?.max_output_chars ?? null,
        chat_max_output_tokens: policy.chat?.max_output_tokens ?? null,
      };
    },
    close: () => {
      watcher.close();
    },
    paths: {
      persona_path: personaPath,
      policy_path: policyPath,
    },
  };
};
