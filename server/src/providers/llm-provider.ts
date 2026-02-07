import type { ChatInput, InnerTaskInput } from "../orchestrator.js";
import type {
  LlmExpression,
  LlmMotionId,
  LlmProviderKind,
  LlmToolCall,
  ProviderHealth,
  Providers,
} from "./types.js";
import { executeToolCalls } from "../tools/tool-executor.js";

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
  kind: Exclude<LlmProviderKind, "stub">;
  base_url: string;
  model: string;
  api_key?: string;
  timeout_ms_chat?: number;
  timeout_ms_inner_task?: number;
  fetch?: FetchFn;
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

const isExpression = (value: unknown): value is LlmExpression =>
  value === "neutral" || value === "happy" || value === "sad" || value === "surprised";

const motionIdAllowlist: Record<LlmMotionId, true> = {
  idle: true,
  greeting: true,
  cheer: true,
};

const isMotionId = (value: unknown): value is LlmMotionId =>
  typeof value === "string" && Object.hasOwn(motionIdAllowlist, value);

const parseChatContent = (
  content: unknown,
): { assistant_text: string; expression: LlmExpression; motion_id: LlmMotionId | null } => {
  if (typeof content !== "string") {
    throw new Error("invalid_llm_content");
  }
  const parsed = JSON.parse(content) as {
    assistant_text?: unknown;
    expression?: unknown;
    motion_id?: unknown;
  };
  if (typeof parsed.assistant_text !== "string") {
    throw new Error("invalid_llm_assistant_text");
  }
  const assistant_text = parsed.assistant_text;
  const expression = isExpression(parsed.expression) ? parsed.expression : "neutral";
  const motion_id = isMotionId(parsed.motion_id) ? parsed.motion_id : null;
  return { assistant_text, expression, motion_id };
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

const createAuthHeader = (
  kind: Exclude<LlmProviderKind, "stub">,
  apiKey?: string,
): Record<string, string> => {
  if (kind !== "external") {
    return {};
  }
  if (!apiKey) {
    throw new Error("missing_llm_api_key");
  }
  return { authorization: `Bearer ${apiKey}` };
};

const TOOL_CALLS_FALLBACK_TEXT = "ちょっと調べてみるね";

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
            'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised", "motion_id": null|"idle"|"greeting"|"cheer" }. Choose motion_id by intent: greetings/hello -> "greeting"; cheering/celebrating or explicit dance request -> "cheer"; otherwise null. Never output any other motion ids.',
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
              'Return JSON only: {"assistant_text": string, "expression": "neutral"|"happy"|"sad"|"surprised", "motion_id": null|"idle"|"greeting"|"cheer" }. Choose motion_id by intent: greetings/hello -> "greeting"; cheering/celebrating or explicit dance request -> "cheer"; otherwise null. Never output any other motion ids.',
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
          motion_id: null,
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

export const createLlmProviderFromEnv = (options?: { fetch?: FetchFn }): Providers["llm"] => {
  const kind = (process.env.LLM_PROVIDER_KIND ?? "stub") as LlmProviderKind;
  if (kind !== "local" && kind !== "external") {
    return {
      kind: "stub",
      chat: {
        call: () => ({
          assistant_text: "うんうん",
          expression: "neutral",
          motion_id: null,
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
