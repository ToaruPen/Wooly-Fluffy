import type { ChatInput, InnerTaskInput, Mode } from "../orchestrator.js";

export type ProviderHealth = {
  status: "ok" | "unavailable";
};

export type LlmProviderKind = "stub" | "local" | "external";

export type Providers = {
  stt: {
    transcribe: (input: { mode: Mode; audio_present: boolean }) => { text: string };
    health: () => ProviderHealth;
  };
  tts: {
    health: () => ProviderHealth;
  };
  llm: {
    kind: LlmProviderKind;
    chat: {
      call: (input: ChatInput) => { assistant_text: string };
    };
    inner_task: {
      call: (input: InnerTaskInput) => { json_text: string };
    };
    health: () => ProviderHealth;
  };
};
