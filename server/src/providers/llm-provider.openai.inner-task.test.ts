import { describe, expect, it } from "vitest";

import { createAbortableNeverFetch } from "../test-helpers/fetch.js";
import { createOpenAiCompatibleLlmProvider } from "./llm-provider.js";

const CALL_TEST_TIMEOUT_MS = 5_000;
const STREAM_TEST_TIMEOUT_MS = 5_000;

describe("llm-provider (OpenAI-compatible)", () => {
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
});
