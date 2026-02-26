import { describe, expect, it, vi } from "vitest";

import { createGeminiNativeLlmProvider } from "./llm-provider.js";

const GEMINI_REST_TEST_TIMEOUT_MS = 30_000;

describe("llm-provider (Gemini native)", () => {
  it(
    "constructs default models client when gemini_models is omitted",
    async () => {
      const savedFetch = globalThis.fetch;
      const calls: Array<{ url: string; method: string; body?: string }> = [];
      vi.stubGlobal("fetch", (async (input: unknown, init?: { method?: string; body?: string }) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body });

        if (url.includes(":generateContent")) {
          if (calls.filter((c) => c.url.includes(":generateContent")).length === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          functionCall: {
                            name: "get_weather",
                            args: { location: "Tokyo" },
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
            } as Response;
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "晴れです", expression: "happy" }),
              functionCalls: [],
              candidates: [{ content: { parts: [{ text: "ignored" }] } }],
            }),
          } as Response;
        }

        if (url.includes("geocoding-api.open-meteo.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                {
                  name: "Tokyo",
                  country: "Japan",
                  latitude: 35.6762,
                  longitude: 139.6503,
                },
              ],
            }),
          } as Response;
        }

        if (url.includes("https://api.open-meteo.com/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              current: {
                temperature_2m: 20,
                weather_code: 0,
              },
            }),
          } as Response;
        }

        if (url.includes("/v1beta/models/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
          } as Response;
        }

        throw new Error(`unexpected_fetch:${url}`);
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        const chat = await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" });
        expect(chat).toEqual({
          assistant_text: "晴れです",
          expression: "happy",
          motion_id: null,
          tool_calls: [
            {
              id: expect.any(String),
              type: "function",
              function: {
                name: "get_weather",
                arguments: JSON.stringify({ location: "Tokyo" }),
              },
            },
          ],
        });

        await expect(llm.health()).resolves.toEqual({ status: "ok" });
        expect(
          calls.some((c) => c.url.includes("/v1beta/models/gemini-2.5-flash-lite:generateContent")),
        ).toBe(true);
        expect(calls.some((c) => c.url.includes("/v1beta/models/gemini-2.5-flash-lite?key="))).toBe(
          true,
        );
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "passes maxOutputTokens to default gemini models client on both chat calls",
    async () => {
      const savedFetch = globalThis.fetch;
      let generateCalls = 0;
      vi.stubGlobal("fetch", (async (input: unknown, init?: { method?: string; body?: string }) => {
        const url = String(input);

        if (url.includes(":generateContent")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            generationConfig?: { maxOutputTokens?: number };
          };
          expect(body.generationConfig?.maxOutputTokens).toBe(88);

          generateCalls += 1;
          if (generateCalls === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                candidates: [
                  {
                    content: {
                      parts: [
                        { functionCall: { name: "get_weather", args: { location: "Tokyo" } } },
                      ],
                    },
                  },
                ],
              }),
            } as Response;
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
              functionCalls: [],
              candidates: [{ content: { parts: [{ text: "ignored" }] } }],
            }),
          } as Response;
        }

        if (url.includes("geocoding-api.open-meteo.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ results: [{ latitude: 35, longitude: 139, name: "Tokyo" }] }),
          } as Response;
        }

        if (url.includes("api.open-meteo.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ current: { temperature_2m: 12.5, weather_code: 3 } }),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
          read_chat_runtime_config: () => ({
            persona_text: "",
            max_output_chars: 320,
            max_output_tokens: 88,
          }),
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toMatchObject({ assistant_text: "ok" });
        expect(generateCalls).toBe(2);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "throws when default gemini client receives non-ok response",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async () => {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "models/gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).rejects.toThrow(/gemini_request_failed:503/);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "throws when default gemini client receives non-object JSON",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async () => {
        return {
          ok: true,
          status: 200,
          json: async () => "invalid-json",
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).rejects.toThrow(/gemini_response_invalid/);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "handles default gemini response without candidates",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
              functionCalls: [],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "handles default gemini candidates with non-array parts",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
              candidates: [{ content: { parts: null } }],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "handles default gemini candidates with non-object entries",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
              candidates: [null, { content: "invalid-content" }],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "extracts default gemini text from candidate parts",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: '{"assistant_text":"from-candidates","expression":"neutral"}' },
                    ],
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "from-candidates",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "skips invalid candidate content while extracting default gemini text",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                { content: "invalid-content" },
                { content: { parts: null } },
                {
                  content: {
                    parts: [{ text: '{"assistant_text":"fallback","expression":"neutral"}' }],
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "fallback",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "treats default gemini missing candidates and functionCalls as no tool calls",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "fails when default gemini response has no text and no candidates",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).rejects.toThrow(/gemini returned empty text/);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "skips non-object candidates before extracting default gemini text",
    async () => {
      const savedFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                null,
                {
                  content: {
                    parts: [{ text: '{"assistant_text":"from-second","expression":"neutral"}' }],
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "from-second",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "retries chat when default gemini REST returns retryable status",
    async () => {
      const savedFetch = globalThis.fetch;
      let calls = 0;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          calls += 1;
          if (calls === 1) {
            return {
              ok: false,
              status: 503,
              json: async () => ({}),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ assistant_text: "retry-ok", expression: "happy" }),
              functionCalls: [],
            }),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toEqual({
          assistant_text: "retry-ok",
          expression: "happy",
          motion_id: null,
          tool_calls: [],
        });
        expect(calls).toBe(2);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );

  it(
    "retries inner_task when default gemini REST returns retryable status",
    async () => {
      const savedFetch = globalThis.fetch;
      let calls = 0;
      vi.stubGlobal("fetch", (async (input: unknown) => {
        const url = String(input);
        if (url.includes(":generateContent")) {
          calls += 1;
          if (calls === 1) {
            return {
              ok: false,
              status: 429,
              json: async () => ({}),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              text: JSON.stringify({ task: "consent_decision", answer: "yes" }),
            }),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch);

      try {
        const llm = createGeminiNativeLlmProvider({
          model: "gemini-2.5-flash-lite",
          api_key: "test-key",
        });

        await expect(
          llm.inner_task.call({ task: "consent_decision", input: { text: "yes" } }),
        ).resolves.toEqual({
          json_text: JSON.stringify({ task: "consent_decision", answer: "yes" }),
        });
        expect(calls).toBe(2);
      } finally {
        vi.stubGlobal("fetch", savedFetch);
      }
    },
    GEMINI_REST_TEST_TIMEOUT_MS,
  );
});
