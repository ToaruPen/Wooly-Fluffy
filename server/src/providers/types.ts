import type { ChatInput, Expression, InnerTaskInput, Mode, ToolCall } from "../orchestrator.js";

export type ProviderHealth = {
  status: "ok" | "unavailable";
};

type MaybePromise<T> = T | Promise<T>;

export type LlmProviderKind = "stub" | "local" | "external" | "gemini_native";

export type LlmExpression = Expression;

export type LlmToolCall = ToolCall;

export type LlmMotionId = "idle" | "greeting" | "cheer";

export type Providers = {
  stt: {
    transcribe: (input: { mode: Mode; wav: Buffer }) => MaybePromise<{ text: string }>;
    health: () => MaybePromise<ProviderHealth>;
  };
  tts: {
    health: () => MaybePromise<ProviderHealth>;
    synthesize: (input: { text: string }) => Promise<{ wav: Buffer }>;
  };
  llm: {
    kind: LlmProviderKind;
    chat: {
      call: (input: ChatInput) => MaybePromise<{
        assistant_text: string;
        expression: LlmExpression;
        motion_id: LlmMotionId | null;
        tool_calls: LlmToolCall[];
      }>;
    };
    inner_task: {
      call: (input: InnerTaskInput) => MaybePromise<{ json_text: string }>;
    };
    health: () => MaybePromise<ProviderHealth>;
  };
};
