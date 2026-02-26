import { describe, expect, it } from "vitest";

import type { ToolCall } from "../orchestrator.js";
import { createAbortableNeverFetch } from "../test-helpers/fetch.js";
import { createOpenAiCompatibleLlmProvider } from "./llm-provider.js";

const STREAM_TEST_TIMEOUT_MS = 5_000;
const LONG_CALL_TEST_TIMEOUT_MS = 10_000;

describe("llm-provider (OpenAI-compatible)", () => {
  it(
    "normalizes trailing slash in base_url",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1/",
        model: "dummy-model",
        fetch: async (input: string) => {
          expect(input).toBe("http://lmstudio.local/v1/chat/completions");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
                  },
                },
              ],
            }),
          };
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toMatchObject({ assistant_text: "Hello" });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "parses assistant_text + expression from JSON content",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (input: string, init?: { method?: string; body?: string }) => {
          expect(input).toBe("http://lmstudio.local/v1/chat/completions");
          expect(init?.method).toBe("POST");

          const bodyText = String(init?.body ?? "");
          expect(bodyText).toContain('"model":"dummy-model"');
          expect(bodyText).toContain('"messages"');

          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      assistant_text: "Hello",
                      expression: "happy",
                      motion_id: null,
                    }),
                  },
                },
              ],
            }),
          };
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "happy",
        motion_id: null,
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "falls back to neutral when expression is invalid",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_text: "Hello",
                    expression: "angry",
                    motion_id: "dance",
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not accept prototype keys as motion_id",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_text: "Hello",
                    expression: "neutral",
                    motion_id: "toString",
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "parses allowlisted motion_id",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_text: "Hello",
                    expression: "neutral",
                    motion_id: "greeting",
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: "greeting",
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "parses allowlisted motion_id thinking",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_text: "Hello",
                    expression: "neutral",
                    motion_id: "thinking",
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: "thinking",
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "coerces non-string motion_id to null",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistant_text: "Hello",
                    expression: "neutral",
                    motion_id: 123,
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "detects tool_calls and returns them",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "get_weather",
                        arguments: '{"location":"Tokyo"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        }),
      });

      const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(result.tool_calls.length).toBe(1);
      expect(result.tool_calls[0]?.function.name).toBe("get_weather");
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "executes allowlisted tool_calls and follows up to return final assistant_text",
    async () => {
      let chatCalls = 0;
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        read_chat_runtime_config: () => ({
          persona_text: "",
          max_output_chars: 320,
          max_output_tokens: 55,
        }),
        fetch: async (input, init) => {
          if (input.endsWith("/chat/completions")) {
            const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
            expect(body.max_tokens).toBe(55);
            chatCalls += 1;
            if (chatCalls === 1) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_1",
                            type: "function",
                            function: {
                              name: "get_weather",
                              arguments: '{"location":"Tokyo"}',
                            },
                          },
                        ],
                      },
                    },
                  ],
                }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ assistant_text: "OK", expression: "neutral" }),
                    },
                  },
                ],
              }),
            };
          }

          if (input.startsWith("https://geocoding-api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
              }),
            };
          }
          if (input.startsWith("https://api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(chatCalls).toBe(2);
      expect(result.assistant_text).toBe("OK");
      expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather"]);
    },
    LONG_CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when follow-up chat completion returns non-2xx",
    async () => {
      let chatCalls = 0;
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (input) => {
          if (input.endsWith("/chat/completions")) {
            chatCalls += 1;
            if (chatCalls === 1) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_1",
                            type: "function",
                            function: {
                              name: "get_weather",
                              arguments: '{"location":"Tokyo"}',
                            },
                          },
                        ],
                      },
                    },
                  ],
                }),
              };
            }
            return { ok: false, status: 500, json: async () => ({}) };
          }

          if (input.startsWith("https://geocoding-api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
              }),
            };
          }
          if (input.startsWith("https://api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/HTTP 500/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when follow-up chat response has no message",
    async () => {
      let chatCalls = 0;
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (input) => {
          if (input.endsWith("/chat/completions")) {
            chatCalls += 1;
            if (chatCalls === 1) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: "call_1",
                            type: "function",
                            function: {
                              name: "get_weather",
                              arguments: '{"location":"Tokyo"}',
                            },
                          },
                        ],
                      },
                    },
                  ],
                }),
              };
            }
            return { ok: true, status: 200, json: async () => ({ choices: [] }) };
          }

          if (input.startsWith("https://geocoding-api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
              }),
            };
          }
          if (input.startsWith("https://api.open-meteo.com/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
            };
          }
          throw new Error(`unexpected url: ${input}`);
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/no message/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "filters malformed tool_calls",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 1, type: "function", function: { name: "x", arguments: "{}" } },
                    { id: "call_bad", type: "nope" },
                    { id: "call_no_args", type: "function", function: { name: "x" } },
                    {
                      id: "call_ok",
                      type: "function",
                      function: { name: "get_weather", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        }),
      });

      const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(result.tool_calls.map((toolCall: ToolCall) => toolCall.id)).toEqual(["call_ok"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "defaults expression to neutral when missing",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: { content: JSON.stringify({ assistant_text: "Hello" }) },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when chat completion returns non-2xx",
    async () => {
      let calls = 0;
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => {
          calls += 1;
          return {
            ok: false,
            status: 500,
            json: async () => ({}),
          };
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/HTTP 500/);
      expect(calls).toBe(1);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when chat response has no message",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
      });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/no message/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when chat content is not a string",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 123 } }] }),
        }),
      });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/invalid_llm_content/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when chat content is invalid JSON",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "not json" } }] }),
        }),
      });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow();
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws when assistant_text is missing",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        }),
      });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/invalid_llm_assistant_text/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "times out chat when fetch does not resolve",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        timeout_ms_chat: 1,
        fetch: createAbortableNeverFetch(),
      });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow();
    },
    STREAM_TEST_TIMEOUT_MS,
  );
});
