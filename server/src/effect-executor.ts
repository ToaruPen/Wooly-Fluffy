import type {
  InnerTaskInput,
  Mode,
  OrchestratorEffect,
  OrchestratorEvent
} from "./orchestrator.js";
import type { Providers } from "./providers/types.js";

type KioskCommandSender = (type: string, data: object) => void;

const isThenable = <T>(value: unknown): value is Promise<T> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

type LlmChatResult = Awaited<ReturnType<Providers["llm"]["chat"]["call"]>>;
type LlmInnerTaskResult = Awaited<ReturnType<Providers["llm"]["inner_task"]["call"]>>;

type StoreWritePending = (
  input: Extract<OrchestratorEffect, { type: "STORE_WRITE_PENDING" }>["input"]
) => void;

type EffectExecutor = {
  executeEffects: (effects: OrchestratorEffect[]) => OrchestratorEvent[];
  transcribeStt: (input: {
    request_id: string;
    mode: Mode;
    wav: Buffer;
  }) => OrchestratorEvent;
};

export const createEffectExecutor = (deps: {
  providers: Providers;
  sendKioskCommand: KioskCommandSender;
  enqueueEvent: (event: OrchestratorEvent) => void;
  onSttRequested: (request_id: string) => void;
  storeWritePending: StoreWritePending;
}) => {
  let saySeq = 0;
  let currentExpression: string | null = null;

  const executeEffects = (effects: OrchestratorEffect[]): OrchestratorEvent[] => {
    const events: OrchestratorEvent[] = [];
    for (const effect of effects) {
      switch (effect.type) {
        case "KIOSK_RECORD_START":
          deps.sendKioskCommand("kiosk.command.record_start", {});
          break;
        case "KIOSK_RECORD_STOP":
          deps.sendKioskCommand("kiosk.command.record_stop", {});
          break;
        case "CALL_STT":
          deps.onSttRequested(effect.request_id);
          break;
        case "CALL_CHAT": {
          try {
            const maybe = deps.providers.llm.chat.call(effect.input);
            if (isThenable<LlmChatResult>(maybe)) {
              void maybe
                .then((result) => {
                  deps.enqueueEvent({
                    type: "CHAT_RESULT",
                    request_id: effect.request_id,
                    assistant_text: result.assistant_text,
                    expression: result.expression,
                    tool_calls: result.tool_calls
                  });
                })
                .catch(() => {
                  deps.enqueueEvent({ type: "CHAT_FAILED", request_id: effect.request_id });
                });
            } else {
              const result = maybe;
              events.push({
                type: "CHAT_RESULT",
                request_id: effect.request_id,
                assistant_text: result.assistant_text,
                expression: result.expression,
                tool_calls: result.tool_calls
              });
            }
          } catch {
            events.push({ type: "CHAT_FAILED", request_id: effect.request_id });
          }
          break;
        }
        case "CALL_INNER_TASK": {
          const input: InnerTaskInput =
            effect.task === "consent_decision"
              ? { task: "consent_decision", input: effect.input }
              : { task: "memory_extract", input: effect.input };
          try {
            const maybe = deps.providers.llm.inner_task.call(input);
            if (isThenable<LlmInnerTaskResult>(maybe)) {
              void maybe
                .then((result) => {
                  deps.enqueueEvent({
                    type: "INNER_TASK_RESULT",
                    request_id: effect.request_id,
                    json_text: result.json_text
                  });
                })
                .catch(() => {
                  deps.enqueueEvent({ type: "INNER_TASK_FAILED", request_id: effect.request_id });
                });
            } else {
              const result = maybe;
              events.push({
                type: "INNER_TASK_RESULT",
                request_id: effect.request_id,
                json_text: result.json_text
              });
            }
          } catch {
            events.push({ type: "INNER_TASK_FAILED", request_id: effect.request_id });
          }
          break;
        }
        case "SAY": {
          saySeq += 1;
          const base = {
            say_id: `say-${saySeq}`,
            text: effect.text
          };
          deps.sendKioskCommand(
            "kiosk.command.speak",
            currentExpression ? { ...base, expression: currentExpression } : base
          );
          break;
        }
        case "SET_EXPRESSION":
          currentExpression = effect.expression;
          break;
        case "PLAY_MOTION":
          deps.sendKioskCommand("kiosk.command.play_motion", {
            motion_id: effect.motion_id,
            motion_instance_id: effect.motion_instance_id
          });
          break;
        case "STORE_WRITE_PENDING":
          deps.storeWritePending(effect.input);
          break;
        case "SET_MODE":
        case "SHOW_CONSENT_UI":
          break;
        default:
          break;
      }
    }
    return events;
  };

  const transcribeStt: EffectExecutor["transcribeStt"] = (input) => {
    try {
      const result = deps.providers.stt.transcribe({
        mode: input.mode,
        wav: input.wav
      });
      return {
        type: "STT_RESULT",
        request_id: input.request_id,
        text: result.text
      };
    } catch {
      return { type: "STT_FAILED", request_id: input.request_id };
    }
  };

  return { executeEffects, transcribeStt } satisfies EffectExecutor;
};
