import { describe, expect, it, vi } from "vitest";
import { loadEnvFromAppSupport, parseEnvFile } from "./local-env.js";

describe("local-env", () => {
  describe("parseEnvFile", () => {
    it("parses simple KEY=VALUE and ignores comments/invalid lines", () => {
      const parsed = parseEnvFile(
        [
          "",
          "  # comment",
          "FOO=bar",
          "export BAR=baz",
          "NOEQ",
          "=noval",
          "  = spaced",
          "foo=lower",
          "A-B=bad",
          "9BAD=no",
        ].join("\n"),
      );
      expect(parsed).toEqual({ FOO: "bar", BAR: "baz" });
    });

    it("handles empty values and quoted values", () => {
      const parsed = parseEnvFile(
        ["EMPTY=", "SINGLE='hello world'", 'DOUBLE="hello world"', "UNBALANCED='x"].join("\n"),
      );
      expect(parsed).toEqual({
        EMPTY: "",
        SINGLE: "hello world",
        DOUBLE: "hello world",
        UNBALANCED: "'x",
      });
    });
  });

  describe("loadEnvFromAppSupport", () => {
    it("does nothing when no candidates exist", () => {
      const env: Record<string, string | undefined> = {};
      loadEnvFromAppSupport({
        env,
        platform: "linux",
        homedir: () => "/home/x",
        existsSync: () => {
          throw new Error("should_not_be_called");
        },
        readFileSync: () => {
          throw new Error("should_not_be_called");
        },
      });
      expect(env).toEqual({});
    });

    it("skips missing files", () => {
      const env: Record<string, string | undefined> = {
        WOOLY_FLUFFY_ENV_PATH: "/tmp/missing.env",
      };
      loadEnvFromAppSupport({
        env,
        platform: "linux",
        homedir: () => "/home/x",
        existsSync: () => false,
        readFileSync: () => {
          throw new Error("should_not_read");
        },
      });
      expect(env).toEqual({ WOOLY_FLUFFY_ENV_PATH: "/tmp/missing.env" });
    });

    it("loads override path and fills only missing keys", () => {
      const env: Record<string, string | undefined> = {
        WOOLY_FLUFFY_ENV_PATH: "/tmp/server.env",
        KEEP: "present",
      };
      loadEnvFromAppSupport({
        env,
        platform: "linux",
        homedir: () => "/home/x",
        existsSync: (p: any) => p === "/tmp/server.env",
        readFileSync: (_p: any, _options?: any): any => "KEEP=override\nNEW=1\n",
      });
      expect(env.KEEP).toBe("present");
      expect(env.NEW).toBe("1");
    });

    it("continues on read errors and uses first successful candidate", () => {
      const env: Record<string, string | undefined> = {};
      const exists = vi.fn((p: string) => p.includes("server.env") || p.includes(".env"));
      const read = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("read_failed");
        })
        .mockImplementationOnce(() => "A=1\n");

      loadEnvFromAppSupport({
        env,
        platform: "darwin",
        homedir: () => "/Users/test",
        existsSync: (p: any) => exists(String(p)),
        readFileSync: (p: any, _options?: any): any => read(String(p)),
      });

      expect(env.A).toBe("1");
      expect(read).toHaveBeenCalledTimes(2);
    });
  });
});
