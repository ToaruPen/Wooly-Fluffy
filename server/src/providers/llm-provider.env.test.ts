import { describe, expect, it, vi } from "vitest";

import { createLlmProviderFromEnv } from "./llm-provider.js";
import * as personaConfigModule from "./persona-config.js";

const restoreEnv = (key: keyof NodeJS.ProcessEnv, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

const ENV_PROVIDER_TEST_TIMEOUT_MS = 10_000;

describe("llm-provider (env)", () => {
  it("does not create persona config loader for stub env provider", () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
    };
    const spy = vi.spyOn(personaConfigModule, "createPersonaConfigLoader");
    try {
      delete process.env.LLM_PROVIDER_KIND;
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv();
      expect(llm.kind).toBe("stub");
      llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(spy).not.toHaveBeenCalled();
      llm.close?.();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
    }
  }, 10_000);

  it("closes persona config loader via llm.close", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };
    const closeSpy = vi.fn();
    const spy = vi.spyOn(personaConfigModule, "createPersonaConfigLoader").mockReturnValue({
      read: () => ({
        persona_text: "",
        chat_max_output_chars: null,
        chat_max_output_tokens: null,
      }),
      close: closeSpy,
      paths: {
        persona_path: "/tmp/persona.md",
        policy_path: "/tmp/policy.yaml",
      },
    });

    try {
      process.env.LLM_PROVIDER_KIND = "local";
      process.env.LLM_BASE_URL = "http://lmstudio.local/v1";
      process.env.LLM_MODEL = "dummy-model";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/policy.yaml";
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv({
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"assistant_text":"hi","expression":"neutral"}' } }],
          }),
        }),
      });

      expect(spy).not.toHaveBeenCalled();
      await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" });
      expect(spy).toHaveBeenCalledTimes(1);
      llm.close?.();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it(
    "defaults to stub when LLM_PROVIDER_KIND is unset",
    async () => {
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
          motion_id: null,
          tool_calls: [],
        });

        const sessionSummary = await llm.inner_task.call({
          task: "session_summary",
          input: { messages: [] },
        });
        expect(JSON.parse(sessionSummary.json_text)).toMatchObject({
          task: "session_summary",
          title: "要約",
          summary_json: {
            summary: expect.any(String),
            topics: [],
            staff_notes: [],
          },
        });

        const consentDecision = await llm.inner_task.call({
          task: "consent_decision",
          input: { text: "hi" },
        });
        expect(JSON.parse(consentDecision.json_text)).toEqual({
          task: "consent_decision",
          answer: "unknown",
        });

        const memoryExtract = await llm.inner_task.call({
          task: "memory_extract",
          input: { assistant_text: "hi" },
        });
        expect(JSON.parse(memoryExtract.json_text)).toEqual({
          task: "memory_extract",
          candidate: { kind: "likes", value: "りんご", source_quote: "りんごがすき" },
        });
      } finally {
        restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
        restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
        restoreEnv("LLM_MODEL", saved.LLM_MODEL);
        restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      }
    },
    ENV_PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "returns unavailable provider when configured kind is missing base_url/model",
    async () => {
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
        restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
        restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
        restoreEnv("LLM_MODEL", saved.LLM_MODEL);
        restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      }
    },
    ENV_PROVIDER_TEST_TIMEOUT_MS,
  );

  it(
    "returns unavailable provider when gemini_native is missing model/api key",
    async () => {
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
        restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
        restoreEnv("LLM_MODEL", saved.LLM_MODEL);
        restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
        restoreEnv("GEMINI_API_KEY", saved.GEMINI_API_KEY);
        restoreEnv("GOOGLE_API_KEY", saved.GOOGLE_API_KEY);
      }
    },
    ENV_PROVIDER_TEST_TIMEOUT_MS,
  );

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
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
    }
  });

  it(
    "passes fetch option through env provider",
    async () => {
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
        restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
        restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
        restoreEnv("LLM_MODEL", saved.LLM_MODEL);
        restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      }
    },
    ENV_PROVIDER_TEST_TIMEOUT_MS,
  );

  it("clamps assistant_text by LLM_CHAT_MAX_OUTPUT_CHARS", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_CHAT_MAX_OUTPUT_CHARS: process.env.LLM_CHAT_MAX_OUTPUT_CHARS,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };
    try {
      process.env.LLM_PROVIDER_KIND = "local";
      process.env.LLM_BASE_URL = "http://lmstudio.local/v1";
      process.env.LLM_MODEL = "dummy-model";
      process.env.LLM_CHAT_MAX_OUTPUT_CHARS = "5";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/missing-persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/missing-policy.yaml";
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv({
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({ assistant_text: "123456789", expression: "neutral" }),
                },
              },
            ],
          }),
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hi" }),
      ).resolves.toMatchObject({ assistant_text: "12345" });
    } finally {
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("LLM_CHAT_MAX_OUTPUT_CHARS", saved.LLM_CHAT_MAX_OUTPUT_CHARS);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it("injects persona file text into OpenAI-compatible system prompt", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };

    try {
      process.env.LLM_PROVIDER_KIND = "local";
      process.env.LLM_BASE_URL = "http://lmstudio.local/v1";
      process.env.LLM_MODEL = "dummy-model";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/missing-persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/missing-policy.yaml";
      delete process.env.LLM_API_KEY;

      const llm = createLlmProviderFromEnv({
        fetch: async (_input: string, init?: { body?: string }) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            messages?: Array<{ role?: string; content?: string }>;
          };
          const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
          expect(system).toContain("あなたは語尾をやわらかくする。");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ assistant_text: "hi", expression: "neutral" }),
                  },
                },
              ],
            }),
          };
        },
        read_chat_runtime_config: () => ({
          persona_text: "あなたは語尾をやわらかくする。",
          max_output_chars: 320,
          max_output_tokens: null,
        }),
      });

      await llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" });
    } finally {
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_BASE_URL", saved.LLM_BASE_URL);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it("applies chat maxLength to Gemini responseJsonSchema and persona to systemInstruction", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_CHAT_MAX_OUTPUT_CHARS: process.env.LLM_CHAT_MAX_OUTPUT_CHARS,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };

    try {
      process.env.LLM_PROVIDER_KIND = "gemini_native";
      process.env.LLM_MODEL = "gemini-2.5-flash-lite";
      process.env.LLM_API_KEY = "test-key";
      process.env.LLM_CHAT_MAX_OUTPUT_CHARS = "7";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/missing-persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/missing-policy.yaml";

      const llm = createLlmProviderFromEnv({
        gemini_models: {
          generateContent: async (params) => {
            const config = params.config as {
              systemInstruction?: string;
              responseJsonSchema?: {
                properties?: { assistant_text?: { maxLength?: number } };
              };
            };
            expect(config.systemInstruction ?? "").toContain("一人称はぼく。");
            expect(config.responseJsonSchema?.properties?.assistant_text?.maxLength).toBe(7);
            return {
              text: JSON.stringify({ assistant_text: "123456789", expression: "neutral" }),
              functionCalls: [],
              candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
            };
          },
          get: async () => ({}),
        },
        read_chat_runtime_config: () => ({
          persona_text: "一人称はぼく。",
          max_output_chars: 7,
          max_output_tokens: null,
        }),
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
      ).resolves.toMatchObject({ assistant_text: "1234567" });
    } finally {
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("LLM_CHAT_MAX_OUTPUT_CHARS", saved.LLM_CHAT_MAX_OUTPUT_CHARS);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it("treats invalid LLM_CHAT_MAX_OUTPUT_TOKENS as unset", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_CHAT_MAX_OUTPUT_TOKENS: process.env.LLM_CHAT_MAX_OUTPUT_TOKENS,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };

    try {
      process.env.LLM_PROVIDER_KIND = "gemini_native";
      process.env.LLM_MODEL = "gemini-2.5-flash-lite";
      process.env.LLM_API_KEY = "test-key";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/missing-persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/missing-policy.yaml";

      for (const rawValue of ["not-a-number", "64.5", "64abc", "1e2", "   "]) {
        process.env.LLM_CHAT_MAX_OUTPUT_TOKENS = rawValue;

        const llm = createLlmProviderFromEnv({
          gemini_models: {
            generateContent: async (params) => {
              const config = params.config as { maxOutputTokens?: number };
              expect(config.maxOutputTokens).toBeUndefined();
              return {
                text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
                functionCalls: [],
                candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
              };
            },
            get: async () => ({}),
          },
        });

        await expect(
          llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
        ).resolves.toMatchObject({ assistant_text: "ok" });
      }
    } finally {
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("LLM_CHAT_MAX_OUTPUT_TOKENS", saved.LLM_CHAT_MAX_OUTPUT_TOKENS);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it("uses numeric LLM_CHAT_MAX_OUTPUT_TOKENS for gemini chat config", async () => {
    const saved = {
      LLM_PROVIDER_KIND: process.env.LLM_PROVIDER_KIND,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_CHAT_MAX_OUTPUT_TOKENS: process.env.LLM_CHAT_MAX_OUTPUT_TOKENS,
      WOOLY_FLUFFY_PERSONA_PATH: process.env.WOOLY_FLUFFY_PERSONA_PATH,
      WOOLY_FLUFFY_POLICY_PATH: process.env.WOOLY_FLUFFY_POLICY_PATH,
    };

    try {
      process.env.LLM_PROVIDER_KIND = "gemini_native";
      process.env.LLM_MODEL = "gemini-2.5-flash-lite";
      process.env.LLM_API_KEY = "test-key";
      process.env.LLM_CHAT_MAX_OUTPUT_TOKENS = "77";
      process.env.WOOLY_FLUFFY_PERSONA_PATH = "/tmp/missing-persona.md";
      process.env.WOOLY_FLUFFY_POLICY_PATH = "/tmp/missing-policy.yaml";

      const llm = createLlmProviderFromEnv({
        gemini_models: {
          generateContent: async (params) => {
            const config = params.config as { maxOutputTokens?: number };
            expect(config.maxOutputTokens).toBe(77);
            return {
              text: JSON.stringify({ assistant_text: "ok", expression: "neutral" }),
              functionCalls: [],
              candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
            };
          },
          get: async () => ({}),
        },
      });

      await expect(
        llm.chat.call({ mode: "ROOM", personal_name: null, text: "hello" }),
      ).resolves.toMatchObject({ assistant_text: "ok" });
    } finally {
      restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
      restoreEnv("LLM_MODEL", saved.LLM_MODEL);
      restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
      restoreEnv("LLM_CHAT_MAX_OUTPUT_TOKENS", saved.LLM_CHAT_MAX_OUTPUT_TOKENS);
      restoreEnv("WOOLY_FLUFFY_PERSONA_PATH", saved.WOOLY_FLUFFY_PERSONA_PATH);
      restoreEnv("WOOLY_FLUFFY_POLICY_PATH", saved.WOOLY_FLUFFY_POLICY_PATH);
    }
  }, 10_000);

  it(
    "uses GEMINI_API_KEY/GOOGLE_API_KEY when LLM_API_KEY is unset",
    async () => {
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
          motion_id: null,
          tool_calls: [],
        });
      } finally {
        restoreEnv("LLM_PROVIDER_KIND", saved.LLM_PROVIDER_KIND);
        restoreEnv("LLM_MODEL", saved.LLM_MODEL);
        restoreEnv("LLM_API_KEY", saved.LLM_API_KEY);
        restoreEnv("GEMINI_API_KEY", saved.GEMINI_API_KEY);
        restoreEnv("GOOGLE_API_KEY", saved.GOOGLE_API_KEY);
      }
    },
    ENV_PROVIDER_TEST_TIMEOUT_MS,
  );
});
