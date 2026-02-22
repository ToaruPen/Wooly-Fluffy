import { describe, expect, it, vi } from "vitest";

import { createStore } from "./store.js";

const hoisted = vi.hoisted(() => ({
  llmCloseSpy: vi.fn(),
}));

vi.mock("./providers/llm-provider.js", () => ({
  createLlmProviderFromEnv: () => ({
    kind: "stub" as const,
    close: hoisted.llmCloseSpy,
    chat: {
      call: () => ({
        assistant_text: "ok",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      }),
    },
    inner_task: {
      call: () => ({
        json_text: JSON.stringify({ task: "noop", summary: "" }),
      }),
    },
    health: () => ({ status: "ok" as const }),
  }),
}));

describe("http-server close lifecycle", () => {
  it("closes llm provider on server shutdown without hanging", async () => {
    const { createHttpServer } = await import("./http-server.js");
    const store = createStore({ db_path: ":memory:" });
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    hoisted.llmCloseSpy.mockReset();

    const server = createHttpServer({ store });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const closePromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      await Promise.race([
        closePromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("server_close_timeout"));
          }, 1_000);
        }),
      ]);

      expect(hoisted.llmCloseSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      clearIntervalSpy.mockRestore();
      store.close();
    }
  }, 10_000);
});
