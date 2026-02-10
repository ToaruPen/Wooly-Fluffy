import { afterEach, describe, expect, it } from "vitest";

import { readViteBool, readViteInt } from "./env";

const saveEnv = (key: string): unknown => (import.meta.env as Record<string, unknown>)[key];
const setEnv = (key: string, value: unknown) => {
  (import.meta.env as Record<string, unknown>)[key] = value;
};

afterEach(() => {
  // Best-effort cleanup; individual tests restore specific keys.
});

describe("env", () => {
  it("readViteInt returns default for missing/empty/invalid and clamps valid integers", () => {
    const key = "VITE__TEST_INT";
    const original = saveEnv(key);
    try {
      setEnv(key, undefined);
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);

      setEnv(key, "");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);

      setEnv(key, "   ");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);

      setEnv(key, "nope");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);

      setEnv(key, "1.5");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);

      setEnv(key, "0");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(1);

      setEnv(key, "999");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(10);

      setEnv(key, "7");
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(7);

      // Non-string values should be treated as missing.
      setEnv(key, true);
      expect(readViteInt({ name: key, defaultValue: 5, min: 1, max: 10 })).toBe(5);
    } finally {
      setEnv(key, original);
    }
  });

  it("readViteBool supports boolean and common string values", () => {
    const key = "VITE__TEST_BOOL";
    const original = saveEnv(key);
    const isDevOriginal = import.meta.env.DEV;
    try {
      setEnv(key, undefined);
      expect(readViteBool({ name: key, defaultValue: false })).toBe(false);

      // Vite exposes some built-in values as booleans (e.g. DEV).
      import.meta.env.DEV = false;
      expect(readViteBool({ name: "DEV", defaultValue: true })).toBe(false);
      import.meta.env.DEV = true;
      expect(readViteBool({ name: "DEV", defaultValue: false })).toBe(true);

      setEnv(key, "true");
      expect(readViteBool({ name: key, defaultValue: false })).toBe(true);

      setEnv(key, " 1 ");
      expect(readViteBool({ name: key, defaultValue: false })).toBe(true);

      setEnv(key, "false");
      expect(readViteBool({ name: key, defaultValue: true })).toBe(false);

      setEnv(key, "0");
      expect(readViteBool({ name: key, defaultValue: true })).toBe(false);

      setEnv(key, "");
      expect(readViteBool({ name: key, defaultValue: true })).toBe(true);

      setEnv(key, "nope");
      expect(readViteBool({ name: key, defaultValue: true })).toBe(true);

      // Non-string/non-boolean values should be treated as missing.
      setEnv(key, 123);
      expect(readViteBool({ name: key, defaultValue: true })).toBe(true);
    } finally {
      setEnv(key, original);
      import.meta.env.DEV = isDevOriginal;
    }
  });
});
