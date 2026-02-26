import { describe, expect, it, vi } from "vitest";

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
