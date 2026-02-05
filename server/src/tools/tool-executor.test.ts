import { describe, expect, it } from "vitest";

import { executeToolCalls } from "./tool-executor.js";

describe("tool-executor", () => {
  it("does not execute non-allowlisted tools", async () => {
    const fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await executeToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "not_allowed", arguments: "{}" },
        },
      ],
      fetch,
      timeout_ms: 50,
    });

    expect(result.tool_messages).toHaveLength(1);
    expect(result.tool_messages[0]?.tool_call_id).toBe("call_1");
    expect(result.tool_messages[0]?.content).toMatch(/tool_not_allowed/);
  });

  it("returns invalid_arguments when allowlisted tool args are missing required fields", async () => {
    const fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await executeToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: "{}" },
        },
      ],
      fetch,
      timeout_ms: 50,
    });

    expect(result.tool_messages).toHaveLength(1);
    expect(result.tool_messages[0]?.content).toMatch(/invalid_arguments/);
  });

  it("returns invalid_arguments when tool arguments are not valid JSON", async () => {
    const fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await executeToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: "{" },
        },
      ],
      fetch,
      timeout_ms: 50,
    });

    expect(result.tool_messages).toHaveLength(1);
    expect(result.tool_messages[0]?.content).toMatch(/invalid_arguments/);
  });

  it("returns invalid_arguments when tool arguments JSON is not an object", async () => {
    const fetch = async () => {
      throw new Error("fetch should not be called");
    };

    const result = await executeToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '"Tokyo"' },
        },
      ],
      fetch,
      timeout_ms: 50,
    });

    expect(result.tool_messages).toHaveLength(1);
    expect(result.tool_messages[0]?.content).toMatch(/invalid_arguments/);
  });

  it("times out and returns a tool error message", async () => {
    const fetch = async (_input: string, init?: { signal?: AbortSignal }) =>
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });

    const result = await executeToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"location":"Tokyo"}' },
        },
      ],
      fetch,
      timeout_ms: 10,
    });

    expect(result.tool_messages).toHaveLength(1);
    expect(result.tool_messages[0]?.content).toMatch(/tool_timeout|aborted/);
  });
});
