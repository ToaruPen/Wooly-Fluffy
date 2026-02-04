export type ToolCallLite = {
  id: string;
  function: {
    name: string;
  };
};

export const parseKioskToolCallsData = (value: unknown): ToolCallLite[] => {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const toolCalls = record.tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const out: ToolCallLite[] = [];
  for (const item of toolCalls) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const id = obj.id;
    const fn = obj.function;
    if (typeof id !== "string") {
      continue;
    }
    if (!fn || typeof fn !== "object") {
      continue;
    }
    const fnRecord = fn as Record<string, unknown>;
    const name = fnRecord.name;
    if (typeof name !== "string") {
      continue;
    }
    out.push({ id, function: { name } });
  }
  return out;
};
