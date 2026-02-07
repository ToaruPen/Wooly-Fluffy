import type { ChatInput, InnerTaskInput } from "../orchestrator.js";
import type {
  LlmExpression,
  LlmProviderKind,
  LlmToolCall,
  ProviderHealth,
  Providers,
} from "./types.js";
import { executeToolCalls } from "../tools/tool-executor.js";
import { GoogleGenAI } from "@google/genai";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type FetchFn = (
  input: string,
  init?: {
    method?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

type OpenAiCompatibleLlmProviderOptions = {
  kind: "local" | "external";
  base_url: string;
  model: string;
  api_key?: string;
  timeout_ms_chat?: number;
  timeout_ms_inner_task?: number;
  fetch?: FetchFn;
};

type GeminiNativeGenerateContentConfig = {
  abortSignal?: AbortSignal;
  systemInstruction?: string;
  responseMimeType?: string;
  responseJsonSchema?: unknown;
  tools?: unknown;
};

type GeminiNativeModelsClient = {
  generateContent: (params: {
    model: string;
    contents: unknown;
    config?: GeminiNativeGenerateContentConfig;
  }) => Promise<{
    text?: unknown;
    functionCalls?: unknown;
    candidates?: Array<{ content?: unknown }>;
  }>;
  get: (params: { model: string; config?: { abortSignal?: AbortSignal } }) => Promise<unknown>;
};

type GeminiNativeLlmProviderOptions = {
  model: string;
  api_key: string;
  timeout_ms_chat?: number;
  timeout_ms_inner_task?: number;
  timeout_ms_health?: number;
  fetch?: FetchFn;
  gemini_models?: GeminiNativeModelsClient;
};

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const withTimeout = async <T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const isAbortLikeError = (err: unknown): boolean => {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    err.name === "AbortError" ||
    err.message === "aborted" ||
    err.message === "The operation was aborted." ||
    err.message.toLowerCase().includes("aborted")
  );
};

const sleepMs = async (input: { ms: number; signal: AbortSignal }): Promise<void> => {
  if (input.signal.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, Math.max(0, input.ms));
    input.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      },
      { once: true },
    );
  });
};

const coerceHttpStatusFromError = (err: unknown): number | null => {
  const anyErr = err as { status?: unknown; response?: { status?: unknown } };
  const status = anyErr?.status;
  if (typeof status === "number") {
    return status;
  }
  const status2 = anyErr?.response?.status;
  return typeof status2 === "number" ? status2 : null;
};

const isRetryableHttpStatus = (status: number): boolean => status === 429 || status >= 500;

const withRetry = async <T>(input: {
  signal: AbortSignal;
  max_attempts: number;
  run: () => Promise<T>;
}): Promise<T> => {
  // Explicit retry policy for external providers.
  // Keep bounded and cancelable.
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < input.max_attempts) {
    attempt += 1;
    try {
      return await input.run();
    } catch (err) {
      lastErr = err;
      if (isAbortLikeError(err)) {
        throw err;
      }
      const status = coerceHttpStatusFromError(err);
      const isRetryable = status !== null && isRetryableHttpStatus(status);
      if (!isRetryable) {
        throw err;
      }
      if (attempt >= input.max_attempts) {
        break;
      }
      // Small, deterministic delay (no jitter) to keep tests stable.
      await sleepMs({ ms: 150 * attempt, signal: input.signal });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("retry_exhausted");
};

const isExpression = (value: unknown): value is LlmExpression =>
  value === "neutral" || value === "happy" || value === "sad" || value === "surprised";

const parseChatContent = (
  content: unknown,
): { assistant_text: string; expression: LlmExpression } => {
  if (typeof content !== "string") {
    throw new Error("invalid_llm_content");
  }
  const parsed = JSON.parse(content) as {
    assistant_text?: unknown;
    expression?: unknown;
  };
  if (typeof parsed.assistant_text !== "string") {
    throw new Error("invalid_llm_assistant_text");
  }
  const assistant_text = parsed.assistant_text;
  const expression = isExpression(parsed.expression) ? parsed.expression : "neutral";
  return { assistant_text, expression };
};

const coerceToolCalls = (value: unknown): LlmToolCall[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: LlmToolCall[] = [];
  for (const item of value) {
    const obj = item as {
      id?: unknown;
      type?: unknown;
      function?: unknown;
    };
    if (typeof obj?.id !== "string") {
      continue;
    }
    if (obj.type !== "function") {
      continue;
    }
    const fn = obj.function as { name?: unknown; arguments?: unknown };
    if (!fn || typeof fn.name !== "string" || typeof fn.arguments !== "string") {
      continue;
    }
    out.push({
      id: obj.id,
      type: "function",
      function: { name: fn.name, arguments: fn.arguments },
    });
  }
  return out;
};

const createAuthHeader = (kind: "local" | "external", apiKey?: string): Record<string, string> => {
  if (kind !== "external") {
    return {};
  }
  if (!apiKey) {
    throw new Error("missing_llm_api_key");
  }
  return { authorization: `Bearer ${apiKey}` };
};

const TOOL_CALLS_FALLBACK_TEXT = "ちょっと調べてみるね";

const GEMINI_CHAT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_weather",
        description: "Get current weather for a location.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
          additionalProperties: false,
        },
      },
    ],
  },
] as const;

const GEMINI_TOOL_NAME_ALLOWLIST = new Set(["get_weather"]);

const CHAT_JSON_SCHEMA = {
  type: "object",
  properties: {
    assistant_text: { type: "string" },
    expression: { type: "string", enum: ["neutral", "happy", "sad", "surprised"] },
  },
  required: ["assistant_text", "expression"],
  additionalProperties: false,
} as const;

const createGeminiModelsClient = (apiKey: string): GeminiNativeModelsClient => {
  const ai = new GoogleGenAI({ apiKey });
  return ai.models as unknown as GeminiNativeModelsClient;
};

const extractGeminiText = (response: { text?: unknown }): string => {
  const t = response.text;
  if (typeof t !== "string") {
    throw new Error("gemini returned empty text");
  }
  return t;
};

const coerceGeminiToolCalls = (value: unknown): LlmToolCall[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: LlmToolCall[] = [];
  let i = 0;
  for (const item of value) {
    const obj = item as { name?: unknown; args?: unknown };
    if (!obj || typeof obj.name !== "string" || !obj.name.trim()) {
      continue;
    }
    const args = obj.args ?? {};
    let argumentsText = "{}";
    try {
      argumentsText = JSON.stringify(args);
    } catch {
      argumentsText = "{}";
    }
    i += 1;
    out.push({
      id: `call_${i}`,
      type: "function",
      function: { name: obj.name, arguments: argumentsText },
    });
  }
  return out;
};

const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
        additionalProperties: false,
      },
    },
  },
] as const;

const LLM_RETRY_POLICY = {
  // Explicit policy: no retries. (1 attempt total)
  max_attempts: 1 as const,
  strategy: "none" as const,
};

const GEMINI_RETRY_POLICY = {
  // Explicit policy: 1 retry on retryable HTTP statuses (429/5xx).
  // Keep bounded; caller timeouts are still the primary guard.
  max_attempts: 2 as const,
  strategy: "retry_1_on_429_5xx" as const,
};

export const createOpenAiCompatibleLlmProvider = (
  options: OpenAiCompatibleLlmProviderOptions,
): Providers["llm"] => {
  const baseUrl = normalizeBaseUrl(options.base_url);
  const model = options.model;
  const timeoutChatMs = options.timeout_ms_chat ?? 12_000;
  const timeoutInnerTaskMs = options.timeout_ms_inner_task ?? 4_000;

  const fetchFn: FetchFn =
    options.fetch ??
    ((input, init) =>
      fetch(input, {
        method: init?.method,
        signal: init?.signal,
        headers: init?.headers,
        body: init?.body,
      }).then((res) => ({
        ok: res.ok,
        status: res.status,
        json: () => res.json() as Promise<unknown>,
      })));

  const authHeader = createAuthHeader(options.kind, options.api_key);

  const callChat: Providers["llm"]["chat"]["call"] = async (input: ChatInput) => {
    const url = `${baseUrl}/chat/completions`;
    const userMessage = {
      role: "user",
      content: JSON.stringify({
        mode: input.mode,
        personal_name: input.personal_name,
        text: input.text,
      }),
    };

    const body = {
      model,
      messages: [
        {
          role: "system",
          content:
            'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised"}.',
        },
        userMessage,
      ],
      tools: CHAT_TOOLS,
    };

    const res = await withTimeout(timeoutChatMs, (signal) =>
      fetchFn(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) {
      throw new Error(
        `llm chat failed: HTTP ${res.status} (retry_strategy=${LLM_RETRY_POLICY.strategy}, max_attempts=${LLM_RETRY_POLICY.max_attempts})`,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
    };
    const first = json.choices?.[0]?.message;
    if (!first) {
      throw new Error("llm chat returned no message");
    }
    const tool_calls = coerceToolCalls(first.tool_calls);
    if (tool_calls.length > 0) {
      const toolResult = await executeToolCalls({
        tool_calls,
        fetch: fetchFn,
        timeout_ms: Math.min(2_000, timeoutChatMs),
      });

      const followUpBody = {
        model,
        messages: [
          {
            role: "system",
            content:
              'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised"}.',
          },
          userMessage,
          {
            role: "assistant",
            content: null,
            tool_calls,
          },
          ...toolResult.tool_messages,
        ],
        tools: CHAT_TOOLS,
      };

      const followUpRes = await withTimeout(timeoutChatMs, (signal) =>
        fetchFn(url, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify(followUpBody),
        }),
      );
      if (!followUpRes.ok) {
        throw new Error(
          `llm chat failed: HTTP ${followUpRes.status} (retry_strategy=${LLM_RETRY_POLICY.strategy}, max_attempts=${LLM_RETRY_POLICY.max_attempts})`,
        );
      }

      const followUpJson = (await followUpRes.json()) as {
        choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
      };
      const followUpMessage = followUpJson.choices?.[0]?.message;
      if (!followUpMessage) {
        throw new Error("llm chat returned no message");
      }
      const tool_calls_2 = coerceToolCalls(followUpMessage.tool_calls);
      if (tool_calls_2.length > 0) {
        return {
          assistant_text: TOOL_CALLS_FALLBACK_TEXT,
          expression: "neutral",
          tool_calls,
        };
      }
      const parsed2 = parseChatContent(followUpMessage.content);
      return { ...parsed2, tool_calls };
    }
    const parsed = parseChatContent(first.content);
    return { ...parsed, tool_calls: [] };
  };

  const callInnerTask: Providers["llm"]["inner_task"]["call"] = async (input: InnerTaskInput) => {
    const url = `${baseUrl}/chat/completions`;
    const task = input.task;
    const body = {
      model,
      messages: [
        {
          role: "system",
          content:
            task === "consent_decision"
              ? 'Return JSON only: {"task":"consent_decision","answer":"yes"|"no"|"unknown"}.'
              : 'Return JSON only: {"task":"memory_extract","candidate": null | {"kind":"likes"|"food"|"play"|"hobby","value": string,"source_quote"?: string}}.',
        },
        { role: "user", content: JSON.stringify(input) },
      ],
    };

    const res = await withTimeout(timeoutInnerTaskMs, (signal) =>
      fetchFn(url, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(body),
      }),
    );
    if (!res.ok) {
      throw new Error(
        `llm inner_task failed: HTTP ${res.status} (retry_strategy=${LLM_RETRY_POLICY.strategy}, max_attempts=${LLM_RETRY_POLICY.max_attempts})`,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("llm inner_task returned empty content");
    }
    return { json_text: content };
  };

  const health: Providers["llm"]["health"] = async (): Promise<ProviderHealth> => {
    try {
      const res = await withTimeout(800, (signal) =>
        fetchFn(`${baseUrl}/models`, {
          method: "GET",
          signal,
          headers: { ...authHeader },
        }),
      );
      return res.ok ? { status: "ok" } : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  };

  return {
    kind: options.kind,
    chat: { call: callChat },
    inner_task: { call: callInnerTask },
    health,
  };
};

export const createGeminiNativeLlmProvider = (
  options: GeminiNativeLlmProviderOptions,
): Providers["llm"] => {
  const model = options.model;
  const timeoutChatMs = options.timeout_ms_chat ?? 12_000;
  const timeoutInnerTaskMs = options.timeout_ms_inner_task ?? 4_000;
  const timeoutHealthMs = options.timeout_ms_health ?? 1_500;

  const fetchFn: FetchFn =
    options.fetch ??
    ((input, init) =>
      fetch(input, {
        method: init?.method,
        signal: init?.signal,
        headers: init?.headers,
        body: init?.body,
      }).then((res) => ({
        ok: res.ok,
        status: res.status,
        json: () => res.json() as Promise<unknown>,
      })));

  const geminiModels = options.gemini_models ?? createGeminiModelsClient(options.api_key);

  const callChat: Providers["llm"]["chat"]["call"] = async (input: ChatInput) => {
    const userContent = {
      role: "user",
      parts: [
        {
          text: JSON.stringify({
            mode: input.mode,
            personal_name: input.personal_name,
            text: input.text,
          }),
        },
      ],
    };

    const res1 = await withTimeout(timeoutChatMs, (signal) =>
      withRetry({
        signal,
        max_attempts: GEMINI_RETRY_POLICY.max_attempts,
        run: () =>
          geminiModels.generateContent({
            model,
            contents: [userContent],
            config: {
              abortSignal: signal,
              systemInstruction:
                'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised"}.',
              responseMimeType: "application/json",
              responseJsonSchema: CHAT_JSON_SCHEMA,
              tools: GEMINI_CHAT_TOOLS,
            },
          }),
      }),
    );

    const tool_calls = coerceGeminiToolCalls(res1.functionCalls);
    if (tool_calls.length === 0) {
      const parsed = parseChatContent(extractGeminiText(res1));
      return { ...parsed, tool_calls: [] };
    }

    const allowed_tool_calls = tool_calls.filter((c) =>
      GEMINI_TOOL_NAME_ALLOWLIST.has(c.function.name),
    );
    const blocked_tool_calls = tool_calls.filter(
      (c) => !GEMINI_TOOL_NAME_ALLOWLIST.has(c.function.name),
    );

    const toolResult = await executeToolCalls({
      tool_calls: allowed_tool_calls,
      fetch: fetchFn,
      timeout_ms: Math.min(2_000, timeoutChatMs),
    });

    const toolMessageById = new Map(
      toolResult.tool_messages.map((m) => [m.tool_call_id, m.content] as const),
    );
    for (const toolCall of blocked_tool_calls) {
      toolMessageById.set(
        toolCall.id,
        JSON.stringify({ ok: false, error: { code: "tool_not_allowed" } }),
      );
    }

    const functionResponseParts = tool_calls.map((call) => {
      const content = toolMessageById.get(call.id) ?? JSON.stringify({ ok: false });
      let response: unknown = { ok: false };
      try {
        response = JSON.parse(content) as unknown;
      } catch {
        response = { ok: false, error: { code: "tool_failed" } };
      }
      return {
        functionResponse: {
          name: call.function.name,
          response,
        },
      };
    });

    const modelContent = res1.candidates?.[0]?.content;
    if (!modelContent) {
      // Tool-call flow should never hard-fail the conversation.
      // Fall back to a safe assistant response and keep the session alive.
      return {
        assistant_text: TOOL_CALLS_FALLBACK_TEXT,
        expression: "neutral",
        tool_calls,
      };
    }

    const res2 = await withTimeout(timeoutChatMs, (signal) =>
      withRetry({
        signal,
        max_attempts: GEMINI_RETRY_POLICY.max_attempts,
        run: () =>
          geminiModels.generateContent({
            model,
            contents: [
              userContent,
              modelContent,
              {
                role: "user",
                parts: functionResponseParts,
              },
            ],
            config: {
              abortSignal: signal,
              systemInstruction:
                'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised"}.',
              responseMimeType: "application/json",
              responseJsonSchema: CHAT_JSON_SCHEMA,
              tools: GEMINI_CHAT_TOOLS,
            },
          }),
      }),
    );

    const tool_calls_2 = coerceGeminiToolCalls(res2.functionCalls);
    if (tool_calls_2.length > 0) {
      return {
        assistant_text: TOOL_CALLS_FALLBACK_TEXT,
        expression: "neutral",
        tool_calls,
      };
    }

    const parsed2 = parseChatContent(extractGeminiText(res2));
    return { ...parsed2, tool_calls };
  };

  const callInnerTask: Providers["llm"]["inner_task"]["call"] = async (input: InnerTaskInput) => {
    const task = input.task;
    const schema =
      task === "consent_decision"
        ? {
            type: "object",
            properties: {
              task: { type: "string", enum: ["consent_decision"] },
              answer: { type: "string", enum: ["yes", "no", "unknown"] },
            },
            required: ["task", "answer"],
            additionalProperties: false,
          }
        : {
            type: "object",
            properties: {
              task: { type: "string", enum: ["memory_extract"] },
              candidate: {
                type: ["object", "null"],
                properties: {
                  kind: { type: "string", enum: ["likes", "food", "play", "hobby"] },
                  value: { type: "string" },
                  source_quote: { type: "string" },
                },
                required: ["kind", "value"],
                additionalProperties: false,
              },
            },
            required: ["task", "candidate"],
            additionalProperties: false,
          };

    const res = await withTimeout(timeoutInnerTaskMs, (signal) =>
      withRetry({
        signal,
        max_attempts: GEMINI_RETRY_POLICY.max_attempts,
        run: () =>
          geminiModels.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [{ text: JSON.stringify(input) }],
              },
            ],
            config: {
              abortSignal: signal,
              systemInstruction:
                task === "consent_decision"
                  ? 'Return JSON only: {"task":"consent_decision","answer":"yes"|"no"|"unknown"}.'
                  : 'Return JSON only: {"task":"memory_extract","candidate": null | {"kind":"likes"|"food"|"play"|"hobby","value": string,"source_quote"?: string}}.',
              responseMimeType: "application/json",
              responseJsonSchema: schema,
            },
          }),
      }),
    );

    return { json_text: extractGeminiText(res) };
  };

  const health: Providers["llm"]["health"] = async (): Promise<ProviderHealth> => {
    try {
      await withTimeout(timeoutHealthMs, (signal) =>
        geminiModels.get({
          model,
          config: { abortSignal: signal },
        }),
      );
      return { status: "ok" };
    } catch {
      return { status: "unavailable" };
    }
  };

  return {
    kind: "gemini_native",
    chat: { call: callChat },
    inner_task: { call: callInnerTask },
    health,
  };
};

export const createLlmProviderFromEnv = (options?: {
  fetch?: FetchFn;
  gemini_models?: GeminiNativeModelsClient;
}): Providers["llm"] => {
  const kind = (process.env.LLM_PROVIDER_KIND ?? "stub") as LlmProviderKind;
  if (kind === "gemini_native") {
    const model = process.env.LLM_MODEL;
    const apiKey =
      process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!model || !apiKey) {
      return {
        kind,
        chat: {
          call: async () => {
            throw new Error(
              "llm is not configured: set LLM_MODEL and LLM_API_KEY (or GEMINI_API_KEY/GOOGLE_API_KEY)",
            );
          },
        },
        inner_task: {
          call: async () => {
            throw new Error(
              "llm is not configured: set LLM_MODEL and LLM_API_KEY (or GEMINI_API_KEY/GOOGLE_API_KEY)",
            );
          },
        },
        health: async () => ({ status: "unavailable" }),
      };
    }
    return createGeminiNativeLlmProvider({
      model,
      api_key: apiKey,
      fetch: options?.fetch,
      gemini_models: options?.gemini_models,
    });
  }

  if (kind !== "local" && kind !== "external") {
    return {
      kind: "stub",
      chat: {
        call: () => ({
          assistant_text: "うんうん",
          expression: "neutral",
          tool_calls: [],
        }),
      },
      inner_task: {
        call: (input) => {
          if (input.task === "consent_decision") {
            return {
              json_text: JSON.stringify({ task: "consent_decision", answer: "unknown" }),
            };
          }
          return {
            json_text: JSON.stringify({
              task: "memory_extract",
              candidate: { kind: "likes", value: "りんご", source_quote: "りんごがすき" },
            }),
          };
        },
      },
      health: () => ({ status: "ok" }),
    };
  }

  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!baseUrl || !model) {
    return {
      kind,
      chat: {
        call: async () => {
          throw new Error("llm is not configured: set LLM_BASE_URL and LLM_MODEL");
        },
      },
      inner_task: {
        call: async () => {
          throw new Error("llm is not configured: set LLM_BASE_URL and LLM_MODEL");
        },
      },
      health: async () => ({ status: "unavailable" }),
    };
  }

  return createOpenAiCompatibleLlmProvider({
    kind,
    base_url: baseUrl,
    model,
    api_key: process.env.LLM_API_KEY,
    fetch: options?.fetch,
  });
};
