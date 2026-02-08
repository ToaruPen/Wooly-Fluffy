// Best-effort local env loading for development.

// eslint-disable-next-line no-restricted-imports
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

const parseEnvFile = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      continue;
    }
    let value = normalized.slice(eqIndex + 1).trim();
    if (!value) {
      out[key] = "";
      continue;
    }

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const loadEnvFromAppSupport = () => {
  const envPathOverride = process.env.WOOLY_FLUFFY_ENV_PATH;

  const candidates = (() => {
    if (envPathOverride) {
      return [envPathOverride];
    }
    if (process.platform !== "darwin") {
      return [];
    }

    const appSupportDir = join(os.homedir(), "Library", "Application Support", "wooly-fluffy");
    return [join(appSupportDir, "server.env"), join(appSupportDir, ".env")];
  })();

  for (const envPath of candidates) {
    try {
      if (!existsSync(envPath)) {
        continue;
      }
      const text = readFileSync(envPath, "utf8");
      const parsed = parseEnvFile(text);
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      // First match wins.
      return;
    } catch {
      // Best-effort local config; do not log sensitive values.
      continue;
    }
  }
};

loadEnvFromAppSupport();
