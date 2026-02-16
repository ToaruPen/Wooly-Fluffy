export type SessionMessage = {
  role: "user" | "assistant";
  text: string;
};

export type SessionBuffer = {
  running_summary: string;
  messages: SessionMessage[];
};

export type SessionBufferLimits = {
  max_messages: number;
  max_message_chars: number;
  max_total_chars: number;
  max_running_summary_chars: number;
  fold_excerpt_chars: number;
};

export const DEFAULT_SESSION_BUFFER_LIMITS: SessionBufferLimits = {
  max_messages: 100,
  max_message_chars: 400,
  max_total_chars: 20_000,
  max_running_summary_chars: 8_000,
  fold_excerpt_chars: 80,
};

export const createEmptySessionBuffer = (): SessionBuffer => ({
  running_summary: "",
  messages: [],
});

const clampText = (text: string, maxChars: number): string => {
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
};

const normalizeWhitespace = (text: string): string =>
  text
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const excerptForFold = (text: string, maxChars: number): string =>
  clampText(normalizeWhitespace(text), maxChars);

const totalChars = (buffer: SessionBuffer): number => {
  let sum = buffer.running_summary.length;
  for (const msg of buffer.messages) {
    sum += msg.text.length;
  }
  return sum;
};

const foldOne = (buffer: SessionBuffer, limits: SessionBufferLimits): SessionBuffer => {
  const first = buffer.messages[0]!;
  const rest = buffer.messages.slice(1);
  const tag = first.role === "user" ? "U" : "A";
  const piece = `${tag}:${excerptForFold(first.text, limits.fold_excerpt_chars)}`;
  const nextSummary =
    buffer.running_summary.length === 0 ? piece : `${buffer.running_summary} | ${piece}`;
  let running_summary = nextSummary;
  if (running_summary.length > limits.max_running_summary_chars) {
    running_summary = running_summary.slice(-limits.max_running_summary_chars);
  }
  return {
    running_summary,
    messages: rest,
  };
};

const enforceLimits = (buffer: SessionBuffer, limits: SessionBufferLimits): SessionBuffer => {
  let next: SessionBuffer = buffer;
  while (next.messages.length > limits.max_messages && next.messages.length > 0) {
    next = foldOne(next, limits);
  }
  while (totalChars(next) > limits.max_total_chars && next.messages.length > 0) {
    next = foldOne(next, limits);
  }
  while (next.running_summary.length > limits.max_total_chars) {
    next = {
      ...next,
      running_summary: next.running_summary.slice(-limits.max_total_chars),
    };
  }
  return next;
};

export const appendToSessionBuffer = (
  buffer: SessionBuffer,
  message: SessionMessage,
  limits: SessionBufferLimits = DEFAULT_SESSION_BUFFER_LIMITS,
): SessionBuffer => {
  const clamped: SessionMessage = {
    role: message.role,
    text: clampText(message.text, limits.max_message_chars),
  };
  const next: SessionBuffer = {
    ...buffer,
    messages: [...buffer.messages, clamped],
  };
  return enforceLimits(next, limits);
};

export const buildSessionSummaryMessages = (
  buffer: SessionBuffer,
  limits: SessionBufferLimits = DEFAULT_SESSION_BUFFER_LIMITS,
): SessionMessage[] => {
  if (buffer.running_summary.length === 0) {
    return buffer.messages;
  }
  const summaryText = clampText(`(summary) ${buffer.running_summary}`, limits.max_message_chars);
  return [{ role: "assistant", text: summaryText }, ...buffer.messages];
};

export const hasSessionBufferContent = (buffer: SessionBuffer): boolean =>
  buffer.running_summary.length > 0 || buffer.messages.length > 0;
