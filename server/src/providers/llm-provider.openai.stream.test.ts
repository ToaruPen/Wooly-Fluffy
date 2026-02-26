import { describe, expect, it } from "vitest";

import { createOpenAiCompatibleLlmProvider } from "./llm-provider.js";

const STREAM_TEST_TIMEOUT_MS = 5_000;
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
});
