import { getWeather } from "./get-weather.js";

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

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

const ALLOWLISTED_TOOL_NAMES = new Set(["get_weather"]);

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

const toToolErrorMessage = (tool_call_id: string, code: string): ToolMessage => ({
  role: "tool",
  tool_call_id,
  content: JSON.stringify({ ok: false, error: { code } }),
});

const parseToolArguments = (args: string): unknown => {
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return null;
  }
};

const extractLocation = (args: unknown): string | null => {
  const obj = args as { location?: unknown } | null;
  if (!obj || typeof obj !== "object") {
    return null;
  }
  return typeof obj.location === "string" && obj.location.trim() ? obj.location : null;
};

export const executeToolCalls = async (input: {
  tool_calls: ToolCall[];
  fetch: FetchFn;
  timeout_ms: number;
}): Promise<{ tool_messages: ToolMessage[] }> => {
  const tool_messages: ToolMessage[] = [];

  for (const toolCall of input.tool_calls) {
    const toolName = toolCall.function.name;
    if (!ALLOWLISTED_TOOL_NAMES.has(toolName)) {
      tool_messages.push(toToolErrorMessage(toolCall.id, "tool_not_allowed"));
      continue;
    }

    const args = parseToolArguments(toolCall.function.arguments);
    const location = extractLocation(args);
    if (!location) {
      tool_messages.push(toToolErrorMessage(toolCall.id, "invalid_arguments"));
      continue;
    }

    try {
      const result = await withTimeout(input.timeout_ms, (signal) =>
        getWeather({ location, fetch: input.fetch, signal }),
      );
      tool_messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({ ok: true, result }),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" ||
          err.message === "aborted" ||
          err.message === "The operation was aborted.");
      tool_messages.push(
        toToolErrorMessage(toolCall.id, isTimeout ? "tool_timeout" : "tool_failed"),
      );
    }
  }

  return { tool_messages };
};
