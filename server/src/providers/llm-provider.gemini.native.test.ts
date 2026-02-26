import { describe, expect, it, vi } from "vitest";

import { createGeminiNativeLlmProvider } from "./llm-provider.js";

const PROVIDER_TEST_TIMEOUT_MS = 10_000;
const PROVIDER_SHORT_TIMEOUT_MS = 5_000;

describe("llm-provider (Gemini native)", () => {
  it(
    "parses assistant_text + expression from JSON text",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "happy",
        motion_id: null,
        tool_calls: [],
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "parses other expression variants (sad/surprised)",
    async () => {
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
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "sad",
        motion_id: null,
        tool_calls: [],
      });

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
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "surprised",
        motion_id: null,
        tool_calls: [],
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "executes allowlisted tool calls and follows up",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "falls back when follow-up returns tool calls again",
    async () => {
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
                      parts: [
                        { functionCall: { name: "get_weather", args: { location: "Tokyo" } } },
                      ],
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "times out chat when generateContent does not resolve",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "reports ok health when models.get succeeds",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "reports unavailable health when models.get throws",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "executes inner_task for consent_decision",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "executes inner_task for memory_extract",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "executes inner_task for session_summary (fail-fast; no fallback)",
    async () => {
      const llm = createGeminiNativeLlmProvider({
        model: "gemini-2.5-flash-lite",
        api_key: "test-key",
        gemini_models: {
          generateContent: async (params) => {
            const config = (
              params as { config?: { systemInstruction?: unknown; responseJsonSchema?: unknown } }
            ).config;
            expect(String(config?.systemInstruction ?? "").toLowerCase()).toContain("ignore");
            const schemaText = JSON.stringify(config?.responseJsonSchema ?? {});
            expect(schemaText).toContain("session_summary");
            return {
              text: JSON.stringify({
                task: "session_summary",
                title: "t",
                summary_json: { summary: "s", topics: [], staff_notes: [] },
              }),
              functionCalls: [],
              candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
            };
          },
          get: async () => ({}),
        },
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).resolves.toEqual({
        json_text: JSON.stringify({
          task: "session_summary",
          title: "t",
          summary_json: { summary: "s", topics: [], staff_notes: [] },
        }),
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "throws when gemini inner_task(session_summary) returns invalid schema (fail-fast)",
    async () => {
      const llm = createGeminiNativeLlmProvider({
        model: "gemini-2.5-flash-lite",
        api_key: "test-key",
        gemini_models: {
          generateContent: async () => ({
            text: JSON.stringify({ task: "session_summary", title: "t" }),
            functionCalls: [],
            candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          }),
          get: async () => ({}),
        },
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    PROVIDER_SHORT_TIMEOUT_MS,
  );

  it(
    "retries once on 429 and succeeds",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
      expect(calls).toBe(2);
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "includes blocked tool calls and still completes",
    async () => {
      let calls = 0;
      const llm = createGeminiNativeLlmProvider({
        model: "gemini-2.5-flash-lite",
        api_key: "test-key",
        read_chat_runtime_config: () => ({
          persona_text: "",
          max_output_chars: 320,
          max_output_tokens: 66,
        }),
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
            const config = params.config as { maxOutputTokens?: number };
            expect(config.maxOutputTokens).toBe(66);
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "falls back when all tool calls are blocked",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "handles non-object model content when blocked tool calls are present",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "handles model content with non-array parts when blocked tool calls are present",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "falls back when tool_calls are returned but candidate content is missing",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "ちょっと調べてみるね",
        expression: "neutral",
        motion_id: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"location":"Tokyo"}' },
          },
        ],
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "coerces tool-call arguments to {} when stringify fails",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "throws when Gemini returns empty text",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/empty text/);
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "treats non-array functionCalls as no tool calls",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "filters malformed tool calls (empty/whitespace name)",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toEqual({
        assistant_text: "Hello",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      });
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "uses {} when tool-call args are missing",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "uses default fetch when fetch option is omitted",
    async () => {
      const originalFetch = globalThis.fetch;
      try {
        vi.stubGlobal("fetch", async (input: unknown) => {
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
        });

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
        vi.stubGlobal("fetch", originalFetch);
      }
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "does not retry on non-retryable HTTP status",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "retries once on 5xx from response.status",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "treats non-numeric response.status as non-retryable",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "throws retry_exhausted after retryable errors keep failing",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/retry_exhausted/);
      expect(calls).toBe(2);
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "throws the last Error instance when retry is exhausted",
    async () => {
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

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).rejects.toThrow(/boom_2/);
      expect(calls).toBe(2);
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "detects abort-like errors by message variants",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "aborts during retry sleep when timeout fires",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "aborts before retry sleep when signal is already aborted",
    async () => {
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
    },
    PROVIDER_TEST_TIMEOUT_MS,
  );
});
