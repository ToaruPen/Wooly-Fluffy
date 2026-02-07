import { describe, expect, it, vi } from "vitest";

vi.mock("../tools/tool-executor.js", () => {
  return {
    executeToolCalls: async () => {
      return {
        tool_messages: [
          // Invalid JSON to cover fallback parsing.
          { role: "tool", tool_call_id: "call_1", content: "not-json" },
          // Intentionally omit call_2 to cover missing-id default.
        ],
      };
    },
  };
});

describe("llm-provider (Gemini native) tool message parsing", () => {
  it("falls back when tool message JSON is invalid or missing", async () => {
    const { createGeminiNativeLlmProvider } = await import("./llm-provider.js");

    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [
                { name: "get_weather", args: { location: "Tokyo" } },
                { name: "get_weather", args: { location: "Tokyo" } },
              ],
              candidates: [{ content: { role: "model", parts: [] } }],
            };
          }
          return {
            text: JSON.stringify({ assistant_text: "OK", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toMatchObject({ assistant_text: "OK" });
  });
});
