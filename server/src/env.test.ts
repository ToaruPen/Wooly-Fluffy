import { describe, expect, it } from "vitest";
import { readEnvInt } from "./env.js";

describe("env", () => {
  describe("readEnvInt", () => {
    it("returns default when unset", () => {
      const env: Record<string, string | undefined> = {};
      expect(readEnvInt(env, { name: "X", defaultValue: 10 })).toBe(10);
    });

    it("trims and parses integers", () => {
      const env: Record<string, string | undefined> = { X: " 42 " };
      expect(readEnvInt(env, { name: "X", defaultValue: 10 })).toBe(42);
    });

    it("falls back to default on empty/invalid/non-integer", () => {
      expect(readEnvInt({ X: "" }, { name: "X", defaultValue: 10 })).toBe(10);
      expect(readEnvInt({ X: "  " }, { name: "X", defaultValue: 10 })).toBe(10);
      expect(readEnvInt({ X: "nope" }, { name: "X", defaultValue: 10 })).toBe(10);
      expect(readEnvInt({ X: "3.14" }, { name: "X", defaultValue: 10 })).toBe(10);
    });

    it("clamps to min/max", () => {
      expect(readEnvInt({ X: "-1" }, { name: "X", defaultValue: 10, min: 0 })).toBe(0);
      expect(readEnvInt({ X: "999" }, { name: "X", defaultValue: 10, max: 100 })).toBe(100);
      expect(readEnvInt({}, { name: "X", defaultValue: -1, min: 0 })).toBe(0);
    });
  });
});
