import os from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { parse as parseYaml } from "yaml";
import { maxValue, minValue, number, object, optional, pipe, safeParse } from "valibot";
import {
  nodeFileSystemAdapter,
  type FileSystemAdapter,
  type FileSystemStat,
} from "../file-system.js";

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

type PersonaConfigSnapshot = {
  persona_text: string;
  chat_max_output_chars: number | null;
  chat_max_output_tokens: number | null;
};

type PersonaConfigLoader = {
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
  fileSystem: FileSystemAdapter;
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
  const watcher: FSWatcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: false,
    awaitWriteFinish: {
      stabilityThreshold: Math.max(0, debounceMs),
      pollInterval: 50,
    },
  });
  watcher.on("add", onDirty);
  watcher.on("change", onDirty);
  watcher.on("unlink", onDirty);
  watcher.on("error", onDirty);
  return {
    close: () => {
      void watcher.close();
    },
  };
};

const defaultDeps = (): PersonaConfigDeps => ({
  env: process.env,
  platform: process.platform,
  homedir: os.homedir,
  fileSystem: nodeFileSystemAdapter,
  createWatcher: defaultCreateWatcher,
});

const safeStat = (
  d: PersonaConfigDeps,
  filePath: string,
): { mtimeMs: number; size: number } | null => {
  try {
    const st: FileSystemStat = d.fileSystem.statFileSync(filePath);
    if (!st.isFile) {
      return null;
    }
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
};

const safeReadText = (d: PersonaConfigDeps, filePath: string): string | null => {
  try {
    return d.fileSystem.readTextFileSync(filePath);
  } catch {
    return null;
  }
};

const normalizePolicy = (input: unknown): PersonaPolicy => {
  const parsed = safeParse(policySchema, input);
  if (!parsed.success) {
    return {};
  }
  const output = parsed.output as PersonaPolicy;
  const chat = output.chat
    ? {
        max_output_chars:
          typeof output.chat.max_output_chars === "number" &&
          Number.isInteger(output.chat.max_output_chars)
            ? output.chat.max_output_chars
            : undefined,
        max_output_tokens:
          typeof output.chat.max_output_tokens === "number" &&
          Number.isInteger(output.chat.max_output_tokens)
            ? output.chat.max_output_tokens
            : undefined,
      }
    : undefined;

  return {
    chat,
    watch: output.watch,
    persona: output.persona,
  };
};

const readPolicyYaml = (
  d: PersonaConfigDeps,
  policyPath: string,
  knownStat?: { mtimeMs: number; size: number } | null,
): { policy: PersonaPolicy; mtimeMs: number | null } => {
  const st = knownStat === undefined ? safeStat(d, policyPath) : knownStat;
  if (!st) {
    return { policy: {}, mtimeMs: null };
  }
  const text = safeReadText(d, policyPath);
  if (text === null) {
    return { policy: {}, mtimeMs: st.mtimeMs };
  }
  try {
    const raw = parseYaml(text) as unknown;
    return { policy: normalizePolicy(raw), mtimeMs: st.mtimeMs };
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
  let isDirty = true;

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
      isDirty = true;
    },
    watchDebounceMs,
  );

  const reloadIfNeeded = () => {
    const personaStat = safeStat(d, personaPath);
    const policyStat = safeStat(d, policyPath);
    const nextPolicyMtimeMs = policyStat?.mtimeMs ?? null;
    const isPolicyChanged = nextPolicyMtimeMs !== policyMtimeMs;
    if (!isDirty && !isPolicyChanged && (personaStat?.mtimeMs ?? null) === personaMtimeMs) {
      return;
    }
    isDirty = false;

    if (isPolicyChanged) {
      const policyRead = readPolicyYaml(d, policyPath, policyStat);
      policyMtimeMs = policyRead.mtimeMs;
      policy = policyRead.policy;
      personaMtimeMs = null;
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
