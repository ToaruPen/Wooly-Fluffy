import type { LlmToolCall } from "../types.js";

export const coerceOpenAiToolCalls = (value: unknown): LlmToolCall[] => {
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

export const coerceGeminiToolCalls = (value: unknown): LlmToolCall[] => {
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

export const sanitizeGeminiModelContentForAllowlist = (
  content: unknown,
  allowlist: ReadonlySet<string>,
): unknown => {
  const obj = content as { role?: unknown; parts?: unknown } | null;
  const parts = Array.isArray(obj?.parts) ? (obj?.parts as unknown[]) : null;
  if (!obj || typeof obj !== "object" || !parts) {
    return content;
  }

  const filteredParts = parts.filter((p) => {
    const partObj = p as { functionCall?: unknown } | null;
    const fc = partObj && typeof partObj === "object" ? partObj.functionCall : null;
    if (!fc || typeof fc !== "object") {
      return true;
    }
    const name = (fc as { name?: unknown }).name;
    if (typeof name !== "string") {
      return true;
    }
    return allowlist.has(name);
  });

  return {
    ...obj,
    parts: filteredParts,
  };
};

const parseToolMessageContent = (content: string): unknown => {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return { ok: false, error: { code: "tool_failed" } };
  }
};

type ToolMessage = {
  tool_call_id: string;
  content: string;
};

export const buildGeminiFunctionResponseParts = (input: {
  allowed_tool_calls: LlmToolCall[];
  tool_messages: ToolMessage[];
}): Array<{ functionResponse: { name: string; response: unknown } }> => {
  const toolMessageById = new Map(
    input.tool_messages.map((m) => [m.tool_call_id, m.content] as const),
  );

  return input.allowed_tool_calls.map((call) => {
    const content = toolMessageById.get(call.id) ?? JSON.stringify({ ok: false });
    return {
      functionResponse: {
        name: call.function.name,
        response: parseToolMessageContent(content),
      },
    };
  });
};
