import { describe, expect, it } from "vitest";

import {
  createGeminiNativeLlmProvider,
  createLlmProviderFromEnv,
  createOpenAiCompatibleLlmProvider,
} from "./llm-provider.js";
import type { ToolCall } from "../orchestrator.js";

const createAbortableNeverFetch = () => {
  return (_input: string, init?: { method?: string; signal?: AbortSignal }) =>
    new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<unknown>;
    }>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing_signal"));
        return;
      }
      if (signal.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        },
        { once: true },
      );
    });
};

describe("llm-provider (OpenAI-compatible)", () => {
  it("normalizes trailing slash in base_url", async () => {
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
  });

  it("parses assistant_text + expression from JSON content", async () => {
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
                  }),
                },
              },
            ],
          }),
        };
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      {
        assistant_text: "Hello",
        expression: "happy",
        tool_calls: [],
      },
    );
  });

  it("falls back to neutral when expression is invalid", async () => {
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
                }),
              },
            },
          ],
        }),
      }),
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      {
        assistant_text: "Hello",
        expression: "neutral",
        tool_calls: [],
      },
    );
  });

  it("detects tool_calls and returns them", async () => {
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
  });

  it("executes allowlisted tool_calls and follows up to return final assistant_text", async () => {
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
  });

  it("throws when follow-up chat completion returns non-2xx", async () => {
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

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws when follow-up chat response has no message", async () => {
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

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /no message/,
    );
  });

  it("filters malformed tool_calls", async () => {
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
  });

  it("defaults expression to neutral when missing", async () => {
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

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      { assistant_text: "Hello", expression: "neutral", tool_calls: [] },
    );
  });

  it("throws when chat completion returns non-2xx", async () => {
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

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /HTTP 500/,
    );
    expect(calls).toBe(1);
  });

  it("throws when chat response has no message", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
    });
    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /no message/,
    );
  });

  it("throws when chat content is not a string", async () => {
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
    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /invalid_llm_content/,
    );
  });

  it("throws when chat content is invalid JSON", async () => {
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
  });

  it("throws when assistant_text is missing", async () => {
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
    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /invalid_llm_assistant_text/,
    );
  });

  it("times out chat when fetch does not resolve", async () => {
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
  });

  it("executes inner_task for consent_decision", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async (_input: string, init?: { body?: string }) => {
        const body = String(init?.body ?? "");
        expect(body).toContain("consent_decision");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"task":"consent_decision"}' } }],
          }),
        };
      },
    });

    await expect(
      llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
    ).resolves.toEqual({ json_text: '{"task":"consent_decision"}' });
  });

  it("executes inner_task for memory_extract", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async (_input: string, init?: { body?: string }) => {
        const body = String(init?.body ?? "");
        expect(body).toContain("memory_extract");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"task":"memory_extract"}' } }],
          }),
        };
      },
    });

    await expect(
      llm.inner_task.call({ task: "memory_extract", input: { assistant_text: "yo" } }),
    ).resolves.toEqual({ json_text: '{"task":"memory_extract"}' });
  });

  it("throws when inner_task returns non-2xx", async () => {
    let calls = 0;
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async () => {
        calls += 1;
        return { ok: false, status: 503, json: async () => ({}) };
      },
    });
    await expect(
      llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
    ).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1);
  });

  it("throws when inner_task content is not a string", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: null } }] }),
      }),
    });
    await expect(
      llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
    ).rejects.toThrow(/empty content/);
  });

  it("times out inner_task when fetch does not resolve", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      timeout_ms_inner_task: 1,
      fetch: createAbortableNeverFetch(),
    });
    await expect(
      llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
    ).rejects.toThrow();
  });

  it("reports ok health when /models returns 200", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async (input: string, init?: { method?: string }) => {
        expect(input).toBe("http://lmstudio.local/v1/models");
        expect(init?.method).toBe("GET");
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });

    await expect(llm.health()).resolves.toEqual({ status: "ok" });
  });

  it("reports unavailable health when /models returns non-2xx", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    });
    await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("reports unavailable health when request throws", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "local",
      base_url: "http://lmstudio.local/v1",
      model: "dummy-model",
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("requires api_key for external providers", () => {
    expect(() =>
      createOpenAiCompatibleLlmProvider({
        kind: "external",
        base_url: "http://api.local/v1",
        model: "dummy-model",
      }),
    ).toThrow(/missing_llm_api_key/);
  });

  it("sets Authorization header for external providers", async () => {
    const llm = createOpenAiCompatibleLlmProvider({
      kind: "external",
      base_url: "http://api.local/v1",
      model: "dummy-model",
      api_key: "test-key",
      fetch: async (_input: string, init?: { headers?: Record<string, string> }) => {
        expect(init?.headers?.authorization).toBe("Bearer test-key");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"assistant_text":"hi"}' } }],
          }),
        };
      },
    });
    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toMatchObject({ assistant_text: "hi" });
  });

  it("uses global fetch when fetch option is omitted", async () => {
    const originalFetch = globalThis.fetch;
    try {
      let calls = 0;
      (globalThis as unknown as { fetch: unknown }).fetch = (async (input: unknown) => {
        calls += 1;
        expect(String(input)).toBe("http://lmstudio.local/v1/models");
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }) as unknown;

      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
      });
      await expect(llm.health()).resolves.toEqual({ status: "ok" });
      expect(calls).toBe(1);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch as unknown;
    }
  });
});

describe("llm-provider (Gemini native)", () => {
  it("parses assistant_text + expression from JSON text", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "happy" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      { assistant_text: "Hello", expression: "happy", tool_calls: [] },
    );
  });

  it("parses other expression variants (sad/surprised)", async () => {
    const llmSad = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "sad" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });
    await expect(
      llmSad.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toEqual({ assistant_text: "Hello", expression: "sad", tool_calls: [] });

    const llmSurprised = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "surprised" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });
    await expect(
      llmSurprised.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toEqual({ assistant_text: "Hello", expression: "surprised", tool_calls: [] });
  });

  it("executes allowlisted tool calls and follows up", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async (input: string) => {
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
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [{ name: "get_weather", args: { location: "Tokyo" } }],
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: { name: "get_weather", args: { location: "Tokyo" } },
                      },
                    ],
                  },
                },
              ],
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

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather"]);
  });

  it("falls back when follow-up returns tool calls again", async () => {
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
              functionCalls: [{ name: "get_weather", args: { location: "Tokyo" } }],
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ functionCall: { name: "get_weather", args: { location: "Tokyo" } } }],
                  },
                },
              ],
            };
          }
          return {
            text: "",
            functionCalls: [{ name: "get_weather", args: { location: "Tokyo" } }],
            candidates: [{ content: { role: "model", parts: [{ text: "nope" }] } }],
          };
        },
        get: async () => ({}),
      },
      fetch: async (_input: string) => ({ ok: true, status: 200, json: async () => ({}) }),
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toMatchObject({ assistant_text: "ちょっと調べてみるね" });
  });

  it("times out chat when generateContent does not resolve", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      timeout_ms_chat: 1,
      gemini_models: {
        generateContent: async (params: { config?: Record<string, unknown> }) =>
          new Promise((_, reject) => {
            const signal = params.config?.abortSignal as AbortSignal | undefined;
            if (!signal) {
              reject(new Error("missing_abortSignal"));
              return;
            }
            if (signal.aborted) {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
          }),
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toThrow();
  });

  it("reports ok health when models.get succeeds", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.health()).resolves.toEqual({ status: "ok" });
  });

  it("reports unavailable health when models.get throws", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => {
          throw new Error("offline");
        },
      },
    });

    await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
  });

  it("executes inner_task for consent_decision", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ task: "consent_decision", answer: "unknown" }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(
      llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
    ).resolves.toEqual({ json_text: '{"task":"consent_decision","answer":"unknown"}' });
  });

  it("executes inner_task for memory_extract", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ task: "memory_extract", candidate: null }),
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(
      llm.inner_task.call({ task: "memory_extract", input: { assistant_text: "yo" } }),
    ).resolves.toEqual({ json_text: '{"task":"memory_extract","candidate":null}' });
  });

  it("retries once on 429 and succeeds", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            throw { status: 429 };
          }
          return {
            text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      { assistant_text: "Hello", expression: "neutral", tool_calls: [] },
    );
    expect(calls).toBe(2);
  });

  it("includes blocked tool calls and still completes", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async (input: string) => {
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
      gemini_models: {
        generateContent: async (params) => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [
                { name: "get_weather", args: { location: "Tokyo" } },
                { name: "do_bad", args: {} },
              ],
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      { text: "keep" },
                      "raw",
                      { functionCall: "oops" },
                      { functionCall: { name: 123, args: {} } },
                      { functionCall: { name: "get_weather", args: { location: "Tokyo" } } },
                      { functionCall: { name: "do_bad", args: {} } },
                    ],
                  },
                },
              ],
            };
          }

          const contents = (params as { contents?: unknown })?.contents as unknown[];
          const modelParts = (contents?.[1] as { parts?: unknown[] } | undefined)?.parts ?? [];
          expect(
            modelParts.some((p) => {
              const fc = (p as { functionCall?: { name?: unknown } }).functionCall;
              return typeof fc?.name === "string" && fc.name === "do_bad";
            }),
          ).toBe(false);
          expect(modelParts.length).toBe(5);

          const responseParts = (contents?.[2] as { parts?: unknown[] } | undefined)?.parts ?? [];
          expect(
            responseParts.map((p) => {
              const fr = (p as { functionResponse?: { name?: unknown } }).functionResponse;
              return typeof fr?.name === "string" ? fr.name : null;
            }),
          ).toEqual(["get_weather"]);

          return {
            text: JSON.stringify({ assistant_text: "OK", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather", "do_bad"]);
  });

  it("falls back when all tool calls are blocked", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async () => {
        throw new Error("unexpected fetch");
      },
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          return {
            text: "",
            functionCalls: [{ name: "do_bad", args: {} }],
            candidates: [{ content: { role: "model", parts: [] } }],
          };
        },
        get: async () => ({}),
      },
    });

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(1);
    expect(result.assistant_text).toBe("ちょっと調べてみるね");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["do_bad"]);
  });

  it("handles non-object model content when blocked tool calls are present", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async (input: string) => {
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
      gemini_models: {
        generateContent: async (params) => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [
                { name: "get_weather", args: { location: "Tokyo" } },
                { name: "do_bad", args: {} },
              ],
              candidates: [{ content: "model" }],
            };
          }

          const contents = (params as { contents?: unknown })?.contents as unknown[];
          expect(contents?.[1]).toBe("model");

          return {
            text: JSON.stringify({ assistant_text: "OK", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather", "do_bad"]);
  });

  it("handles model content with non-array parts when blocked tool calls are present", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async (input: string) => {
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
      gemini_models: {
        generateContent: async (params) => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [
                { name: "get_weather", args: { location: "Tokyo" } },
                { name: "do_bad", args: {} },
              ],
              candidates: [{ content: { role: "model", parts: null } }],
            };
          }

          const contents = (params as { contents?: unknown })?.contents as unknown[];
          const modelContent = contents?.[1] as { parts?: unknown } | undefined;
          expect(modelContent?.parts).toBe(null);

          return {
            text: JSON.stringify({ assistant_text: "OK", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather", "do_bad"]);
  });

  it("falls back when tool_calls are returned but candidate content is missing", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async (input: string) => {
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
      gemini_models: {
        generateContent: async () => ({
          text: "",
          functionCalls: [{ name: "get_weather", args: { location: "Tokyo" } }],
          candidates: [],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      {
        assistant_text: "ちょっと調べてみるね",
        expression: "neutral",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"location":"Tokyo"}' },
          },
        ],
      },
    );
  });

  it("coerces tool-call arguments to {} when stringify fails", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [{ name: "get_weather", args: cyclic }],
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

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather"]);
  });

  it("throws when Gemini returns empty text", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: undefined,
          functionCalls: [],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /empty text/,
    );
  });

  it("treats non-array functionCalls as no tool calls", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
          functionCalls: undefined,
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      {
        assistant_text: "Hello",
        expression: "neutral",
        tool_calls: [],
      },
    );
  });

  it("filters malformed tool calls (empty/whitespace name)", async () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => ({
          text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
          functionCalls: [{ name: "", args: {} }, { name: "   ", args: null }, { args: {} }],
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).resolves.toEqual(
      {
        assistant_text: "Hello",
        expression: "neutral",
        tool_calls: [],
      },
    );
  });

  it("uses {} when tool-call args are missing", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      fetch: async () => {
        throw new Error("unexpected fetch");
      },
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            return {
              text: "",
              functionCalls: [{ name: "get_weather" }],
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

    const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
    expect(calls).toBe(2);
    expect(result.assistant_text).toBe("OK");
    expect(result.tool_calls.map((t) => t.function.name)).toEqual(["get_weather"]);
  });

  it("uses default fetch when fetch option is omitted", async () => {
    const originalFetch = globalThis.fetch;
    try {
      (globalThis as unknown as { fetch: unknown }).fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [{ name: "Tokyo", country: "Japan", latitude: 35, longitude: 139 }],
            }),
          };
        }
        if (url.startsWith("https://api.open-meteo.com/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
          };
        }
        throw new Error(`unexpected url: ${url}`);
      }) as unknown;

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
                functionCalls: [{ name: "get_weather", args: { location: "Tokyo" } }],
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

      const result = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(calls).toBe(2);
      expect(result.assistant_text).toBe("OK");
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = originalFetch as unknown;
    }
  });

  it("does not retry on non-retryable HTTP status", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          throw { status: 400 };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("retries once on 5xx from response.status", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) {
            throw { response: { status: 500 } };
          }
          return {
            text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).resolves.toMatchObject({
      assistant_text: "Hello",
    });
    expect(calls).toBe(2);
  });

  it("treats non-numeric response.status as non-retryable", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          throw { response: { status: "500" } };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("throws retry_exhausted after retryable errors keep failing", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          throw { status: 500 };
        },
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /retry_exhausted/,
    );
    expect(calls).toBe(2);
  });

  it("throws the last Error instance when retry is exhausted", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          const err = new Error(`boom_${calls}`);
          (err as unknown as { status?: unknown }).status = 500;
          throw err;
        },
        get: async () => ({}),
      },
    });

    await expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).rejects.toThrow(
      /boom_2/,
    );
    expect(calls).toBe(2);
  });

  it("detects abort-like errors by message variants", async () => {
    const mk = (err: Error) =>
      createGeminiNativeLlmProvider({
        model: "gemini-2.5-flash-lite",
        api_key: "test-key",
        gemini_models: {
          generateContent: async () => {
            throw err;
          },
          get: async () => ({}),
        },
      });

    const err1 = new Error("aborted");
    err1.name = "SomeError";
    await expect(
      mk(err1).chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toThrow(/aborted/);

    const err2 = new Error("The operation was aborted.");
    err2.name = "SomeError";
    await expect(
      mk(err2).chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toThrow(/aborted/);

    const err3 = new Error("request aborted by user");
    err3.name = "SomeError";
    await expect(
      mk(err3).chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toThrow(/aborted/);
  });

  it("aborts during retry sleep when timeout fires", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      timeout_ms_chat: 10,
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          // Fail immediately to enter retry sleep before timeout.
          throw { status: 500 };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("aborts before retry sleep when signal is already aborted", async () => {
    let calls = 0;
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
      timeout_ms_chat: 1,
      gemini_models: {
        generateContent: async () => {
          calls += 1;
          // Ignore abortSignal and fail after timeout.
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw { status: 500 };
        },
        get: async () => ({}),
      },
    });

    await expect(
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
    ).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("constructs default models client when gemini_models is omitted", () => {
    const llm = createGeminiNativeLlmProvider({
      model: "gemini-2.5-flash-lite",
      api_key: "test-key",
    });
    expect(llm.kind).toBe("gemini_native");
  });
});

describe("llm-provider (env)", () => {
  it("defaults to stub when LLM_PROVIDER_KIND is unset", () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    try {
      delete process.env.LLM_PROVIDER_KIND;
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv();
      expect(llm.kind).toBe("stub");
      expect(llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" })).toEqual({
        assistant_text: "うんうん",
        expression: "neutral",
        tool_calls: [],
      });
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_BASE_URL = saved.LLM_BASE_URL;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
    }
  });

  it("returns unavailable provider when configured kind is missing base_url/model", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "local";
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv();
      expect(llm.kind).toBe("local");
      await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/not configured/);
      await expect(
        llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
      ).rejects.toThrow(/not configured/);
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_BASE_URL = saved.LLM_BASE_URL;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
    }
  });

  it("returns unavailable provider when gemini_native is missing model/api key", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "gemini_native";
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const llm = createLlmProviderFromEnv();
      expect(llm.kind).toBe("gemini_native");
      await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/not configured/);
      await expect(
        llm.inner_task.call({ task: "consent_decision", input: { text: "hi" } }),
      ).rejects.toThrow(/not configured/);
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
      process.env.GEMINI_API_KEY = saved.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = saved.GOOGLE_API_KEY;
    }
  });

  it("throws when external env provider is missing api key", () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "external";
      process.env.LLM_BASE_URL = "http://api.local/v1";
      process.env.LLM_MODEL = "dummy-model";
      delete process.env.LLM_API_KEY;

      expect(() => createLlmProviderFromEnv()).toThrow(/missing_llm_api_key/);
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_BASE_URL = saved.LLM_BASE_URL;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
    }
  });

  it("passes fetch option through env provider", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "local";
      process.env.LLM_BASE_URL = "http://lmstudio.local/v1";
      process.env.LLM_MODEL = "dummy-model";
      delete process.env.LLM_API_KEY;

      let calls = 0;
      const llm = createLlmProviderFromEnv({
        fetch: async (input: string) => {
          calls += 1;
          expect(input).toBe("http://lmstudio.local/v1/chat/completions");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: '{"assistant_text":"hi"}' } }],
            }),
          };
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toMatchObject({ assistant_text: "hi" });
      expect(calls).toBe(1);
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_BASE_URL = saved.LLM_BASE_URL;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
    }
  });

  it("uses GEMINI_API_KEY/GOOGLE_API_KEY when LLM_API_KEY is unset", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "gemini_native";
      process.env.LLM_MODEL = "gemini-2.5-flash-lite";
      delete process.env.LLM_API_KEY;
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.GOOGLE_API_KEY;

      const llm = createLlmProviderFromEnv({
        gemini_models: {
          generateContent: async () => ({
            text: JSON.stringify({ assistant_text: "Hello", expression: "neutral" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          }),
          get: async () => ({}),
        },
      });

      expect(llm.kind).toBe("gemini_native");
      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        tool_calls: [],
      });
    } finally {
      process.env.LLM_PROVIDER_KIND = saved.LLM_PROVIDER_KIND;
      process.env.LLM_MODEL = saved.LLM_MODEL;
      process.env.LLM_API_KEY = saved.LLM_API_KEY;
      process.env.GEMINI_API_KEY = saved.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = saved.GOOGLE_API_KEY;
    }
  });
});
