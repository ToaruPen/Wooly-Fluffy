import { describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleLlmProvider } from "./llm-provider.js";
import type { ToolCall } from "../orchestrator.js";
import { createAbortableNeverFetch } from "../test-helpers/fetch.js";

const STREAM_TEST_TIMEOUT_MS = 5_000;
const CALL_TEST_TIMEOUT_MS = 5_000;
const LONG_CALL_TEST_TIMEOUT_MS = 10_000;

const createSseBody = (
  events: string[],
  options?: { delimiter?: "\n\n" | "\r\n\r\n" },
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const delimiter = options?.delimiter ?? "\n\n";
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}${delimiter}`));
      }
      controller.close();
    },
  });
};

const collectDeltaTexts = async (
  source: AsyncIterable<{ delta_text: string }> | Iterable<{ delta_text: string }>,
): Promise<string[]> => {
  const chunks: string[] = [];
  for await (const chunk of source) {
    chunks.push(chunk.delta_text);
  }
  return chunks;
};

describe("llm-provider (OpenAI-compatible)", () => {
  it(
    "provides chat.stream and yields delta text",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        read_chat_runtime_config: () => ({
          persona_text: "",
          max_output_chars: 320,
          max_output_tokens: 77,
        }),
        fetch: async (_input: string, init?: { body?: string }) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            stream?: boolean;
            max_tokens?: number;
          };
          expect(body.stream).toBe(true);
          expect(body.max_tokens).toBe(77);
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            body: createSseBody([
              JSON.stringify({ choices: [{ delta: { content: "こんにちは。" } }] }),
              JSON.stringify({ choices: [{ delta: { content: "よろしくね。" } }] }),
              "[DONE]",
            ]),
          };
        },
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );

      expect(chunks).toEqual(["こんにちは。", "よろしくね。"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "parses CRLF-delimited SSE data events for chat.stream",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: createSseBody(
            [
              JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
              JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
              "[DONE]",
            ],
            { delimiter: "\r\n\r\n" },
          ),
        }),
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );

      expect(chunks).toEqual(["A", "B"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "parses final SSE data event without trailing blank line",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: "A" } }] })}\n\n` +
                    `data: ${JSON.stringify({ choices: [{ delta: { content: "B" } }] })}`,
                ),
              );
              controller.close();
            },
          }),
        }),
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );

      expect(chunks).toEqual(["A", "B"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "times out chat.stream when SSE stays open without events",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        timeout_ms_chat: 1,
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: new ReadableStream<Uint8Array>({
            start() {},
          }),
        }),
      });

      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.({
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          }) ?? []) {
          }
        })(),
      ).rejects.toThrow(/timed out/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "fails chat.stream when provider responds with non-ok status",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: false,
          status: 503,
          json: async () => ({}),
          body: createSseBody(["[DONE]"]),
        }),
      });

      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.({
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          }) ?? []) {
          }
        })(),
      ).rejects.toThrow(/HTTP 503/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "aborts chat.stream when linked signal is aborted",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (_input, init) =>
          new Promise<{
            ok: boolean;
            status: number;
            json: () => Promise<unknown>;
            body: ReadableStream<Uint8Array> | null;
          }>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
          }),
      });

      const linkedAbort = new AbortController();
      const streamPromise = (async () => {
        for await (const _chunk of llm.chat.stream?.(
          {
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          },
          { signal: linkedAbort.signal },
        ) ?? []) {
        }
      })();

      linkedAbort.abort();
      await expect(streamPromise).rejects.toThrow(/aborted/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "aborts chat.stream immediately when linked signal is already aborted",
    async () => {
      let hasFetchReceivedAbortedSignal = false;
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (_input, init) => {
          hasFetchReceivedAbortedSignal = init?.signal?.aborted === true;
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        },
      });

      const linkedAbort = new AbortController();
      linkedAbort.abort();
      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.(
            {
              mode: "ROOM",
              personal_name: null,
              text: "hi",
            },
            { signal: linkedAbort.signal },
          ) ?? []) {
          }
        })(),
      ).rejects.toThrow(/aborted/);
      expect(hasFetchReceivedAbortedSignal).toBe(true);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "handles pre-aborted linked signal even when fetch still returns a stream",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: new ReadableStream<Uint8Array>({
            start() {},
          }),
        }),
      });

      const linkedAbort = new AbortController();
      linkedAbort.abort();
      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.(
            {
              mode: "ROOM",
              personal_name: null,
              text: "hi",
            },
            { signal: linkedAbort.signal },
          ) ?? []) {
          }
        })(),
      ).rejects.toThrow(/aborted/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "skips malformed SSE JSON event and continues streaming",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: createSseBody([
            "{ malformed",
            JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
            "[DONE]",
          ]),
        }),
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );
      expect(chunks).toEqual(["A"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "ignores empty SSE data lines and continues to next events",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body: createSseBody([
            "",
            JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
            "[DONE]",
          ]),
        }),
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );
      expect(chunks).toEqual(["B"]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "propagates stream reader read errors",
    async () => {
      const body = {
        getReader: () => ({
          read: async () => {
            throw new Error("read_failed");
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      } as unknown as ReadableStream<Uint8Array>;

      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body,
        }),
      });

      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.({
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          }) ?? []) {
          }
        })(),
      ).rejects.toThrow(/read_failed/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "throws cancel error when reader.cancel fails with non-abort error",
    async () => {
      const body = {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          cancel: async () => {
            throw new Error("cancel_failed");
          },
          releaseLock: () => {},
        }),
      } as unknown as ReadableStream<Uint8Array>;

      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({}),
          body,
        }),
      });

      await expect(
        (async () => {
          for await (const _chunk of llm.chat.stream?.({
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          }) ?? []) {
          }
        })(),
      ).rejects.toThrow(/cancel_failed/);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "includes persona text in stream system instruction when configured",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        read_chat_runtime_config: () => ({
          persona_text: "Be cheerful.",
          max_output_chars: 320,
          max_output_tokens: null,
        }),
        fetch: async (_input: string, init?: { body?: string }) => {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            messages?: Array<{ role?: string; content?: string }>;
          };
          expect(payload.messages?.[0]?.role).toBe("system");
          expect(payload.messages?.[0]?.content).toContain("Persona:\nBe cheerful.");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            body: createSseBody(["[DONE]"], { delimiter: "\n\n" }),
          };
        },
      });

      const chunks = await collectDeltaTexts(
        llm.chat.stream?.({
          mode: "ROOM",
          personal_name: null,
          text: "hi",
        }) ?? [],
      );
      expect(chunks).toEqual([]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

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

  it(
    "executes inner_task for consent_decision",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "executes inner_task for memory_extract",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "masks likely PII and clamps lengths for inner_task(session_summary)",
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
                    task: "session_summary",
                    title: "t".repeat(200),
                    summary_json: {
                      summary: "call me at 090-1234-5678 and aaa@example.com" + "s".repeat(800),
                      topics: ["a".repeat(200), "ok"],
                      staff_notes: ["note".repeat(200)],
                    },
                  }),
                },
              },
            ],
          }),
        }),
      });

      const result = await llm.inner_task.call({
        task: "session_summary",
        input: { messages: [{ role: "user", text: "hi" }] },
      });
      const parsed = JSON.parse(result.json_text) as {
        task: string;
        title: string;
        summary_json: { summary: string; topics: string[]; staff_notes: string[] };
      };
      expect(parsed.task).toBe("session_summary");
      expect(parsed.title.length).toBeLessThanOrEqual(60);
      expect(parsed.summary_json.summary.length).toBeLessThanOrEqual(400);
      expect(parsed.summary_json.summary).not.toContain("090-1234-5678");
      expect(parsed.summary_json.summary).not.toContain("aaa@example.com");
      expect(parsed.summary_json.topics.length).toBeLessThanOrEqual(5);
      expect(parsed.summary_json.topics.every((t) => t.length <= 40)).toBe(true);
      expect(parsed.summary_json.staff_notes.length).toBeLessThanOrEqual(5);
      expect(parsed.summary_json.staff_notes.every((t) => t.length <= 80)).toBe(true);
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "accepts code-fenced JSON for inner_task(session_summary)",
    async () => {
      const payload = {
        task: "session_summary",
        title: "t",
        summary_json: {
          summary: "call me at 090-1234-5678 and aaa@example.com",
          topics: [],
          staff_notes: [],
        },
      };

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
                  content: `Here is the JSON:\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`,
                },
              },
            ],
          }),
        }),
      });

      const result = await llm.inner_task.call({
        task: "session_summary",
        input: { messages: [{ role: "user", text: "hi" }] },
      });

      const parsed = JSON.parse(result.json_text) as {
        task: string;
        title: string;
        summary_json: { summary: string; topics: string[]; staff_notes: string[] };
      };
      expect(parsed.task).toBe("session_summary");
      expect(parsed.title).toBe("t");
      expect(parsed.summary_json.summary).not.toContain("090-1234-5678");
      expect(parsed.summary_json.summary).not.toContain("aaa@example.com");
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "accepts pure code-fenced JSON for inner_task(session_summary)",
    async () => {
      const payload = {
        task: "session_summary",
        title: "t",
        summary_json: {
          summary: "s",
          topics: [],
          staff_notes: [],
        },
      };

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
                  content: `\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n`,
                },
              },
            ],
          }),
        }),
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
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "executes inner_task for session_summary (fail-fast; no fallback)",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async (_input: string, init?: { body?: string }) => {
          const body = String(init?.body ?? "");
          expect(body).toContain("session_summary");
          expect(body.toLowerCase()).toContain("ignore");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      task: "session_summary",
                      title: "t",
                      summary_json: { summary: "s", topics: [], staff_notes: [] },
                    }),
                  },
                },
              ],
            }),
          };
        },
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: {
            messages: [
              { role: "user", text: "hi" },
              { role: "assistant", text: "hello" },
            ],
          },
        }),
      ).resolves.toEqual({
        json_text: JSON.stringify({
          task: "session_summary",
          title: "t",
          summary_json: { summary: "s", topics: [], staff_notes: [] },
        }),
      });
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when inner_task(session_summary) returns invalid schema (fail-fast)",
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
                  content: JSON.stringify({ task: "session_summary", title: "t" }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary topics contains empty string (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "s", topics: [""], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary staff_notes contains empty string (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "s", topics: [], staff_notes: [""] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary title becomes empty after normalization (fail-fast)",
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
                    task: "session_summary",
                    title: "   ",
                    summary_json: { summary: "s", topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary summary becomes empty after normalization (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "   ", topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary topics contains non-string (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "s", topics: [1], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary staff_notes contains non-string (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "s", topics: [], staff_notes: [1] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary summary_json has unexpected keys (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "s", topics: [], staff_notes: [], extra: "x" },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary summary is not a string (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: 1, topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary title is not a string (fail-fast)",
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
                    task: "session_summary",
                    title: 1,
                    summary_json: { summary: "s", topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary summary_json is not an object (fail-fast)",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: null,
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary response JSON is not an object (fail-fast)",
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
                  content: "[]",
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary response has wrong task (fail-fast)",
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
                    task: "memory_extract",
                    title: "t",
                    summary_json: { summary: "s", topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "parses session_summary when JSON contains escaped characters",
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
                    task: "session_summary",
                    title: "t",
                    summary_json: { summary: "a\\b", topics: [], staff_notes: [] },
                  }),
                },
              },
            ],
          }),
        }),
      });

      const result = await llm.inner_task.call({
        task: "session_summary",
        input: { messages: [{ role: "user", text: "hi" }] },
      });

      expect(JSON.parse(result.json_text)).toMatchObject({
        task: "session_summary",
        title: "t",
        summary_json: { summary: expect.any(String), topics: [], staff_notes: [] },
      });
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when session_summary response is truncated JSON (fail-fast)",
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
                  content: '{"task":"session_summary"',
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.inner_task.call({
          task: "session_summary",
          input: { messages: [{ role: "user", text: "hi" }] },
        }),
      ).rejects.toThrow();
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when inner_task returns non-2xx",
    async () => {
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
    },
    CALL_TEST_TIMEOUT_MS,
  );

  it(
    "throws when inner_task content is not a string",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "times out inner_task when fetch does not resolve",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "reports ok health when /models returns 200",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "reports unavailable health when /models returns non-2xx",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      });
      await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "reports unavailable health when request throws",
    async () => {
      const llm = createOpenAiCompatibleLlmProvider({
        kind: "local",
        base_url: "http://lmstudio.local/v1",
        model: "dummy-model",
        fetch: async () => {
          throw new Error("offline");
        },
      });
      await expect(llm.health()).resolves.toEqual({ status: "unavailable" });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it("requires api_key for external providers", () => {
    expect(() =>
      createOpenAiCompatibleLlmProvider({
        kind: "external",
        base_url: "http://api.local/v1",
        model: "dummy-model",
      }),
    ).toThrow(/missing_llm_api_key/);
  });

  it(
    "sets Authorization header for external providers",
    async () => {
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
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "uses global fetch body for chat.stream when fetch option is omitted",
    async () => {
      const originalFetch = globalThis.fetch;
      try {
        vi.stubGlobal("fetch", async (_input: unknown, init?: unknown) => {
          const payload = JSON.parse(
            String((init as { body?: string } | undefined)?.body ?? "{}"),
          ) as { stream?: boolean };
          expect(payload.stream).toBe(true);
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            body: createSseBody([
              JSON.stringify({ choices: [{ delta: { content: "A" } }] }),
              JSON.stringify({ choices: [{ delta: { content: "B" } }] }),
              "[DONE]",
            ]),
          };
        });

        const llm = createOpenAiCompatibleLlmProvider({
          kind: "local",
          base_url: "http://lmstudio.local/v1",
          model: "dummy-model",
        });

        const chunks = await collectDeltaTexts(
          llm.chat.stream?.({
            mode: "ROOM",
            personal_name: null,
            text: "hi",
          }) ?? [],
        );
        expect(chunks).toEqual(["A", "B"]);
      } finally {
        vi.stubGlobal("fetch", originalFetch);
      }
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "uses global fetch when fetch option is omitted",
    async () => {
      const originalFetch = globalThis.fetch;
      try {
        let calls = 0;
        vi.stubGlobal("fetch", async (input: unknown) => {
          calls += 1;
          expect(String(input)).toBe("http://lmstudio.local/v1/models");
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
          };
        });

        const llm = createOpenAiCompatibleLlmProvider({
          kind: "local",
          base_url: "http://lmstudio.local/v1",
          model: "dummy-model",
        });
        await expect(llm.health()).resolves.toEqual({ status: "ok" });
        expect(calls).toBe(1);
      } finally {
        vi.stubGlobal("fetch", originalFetch);
      }
    },
    STREAM_TEST_TIMEOUT_MS,
  );
});
