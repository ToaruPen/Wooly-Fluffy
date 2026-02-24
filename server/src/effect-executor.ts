import type {
  InnerTaskInput,
  Mode,
  OrchestratorEffect,
  OrchestratorEvent,
} from "./orchestrator.js";
import type { Providers } from "./providers/types.js";

type KioskCommandSender = (type: string, data: object) => void;

const isThenable = <T>(value: unknown): value is Promise<T> =>
  typeof (value as { then?: unknown } | null)?.then === "function";

type LlmChatResult = Awaited<ReturnType<Providers["llm"]["chat"]["call"]>>;
type LlmInnerTaskResult = Awaited<ReturnType<Providers["llm"]["inner_task"]["call"]>>;

type StoreWriteSessionSummaryPending = (
  input: Extract<OrchestratorEffect, { type: "STORE_WRITE_SESSION_SUMMARY_PENDING" }>["input"],
) => void;

type StoreWritePendingLegacy = (
  input: Extract<OrchestratorEffect, { type: "STORE_WRITE_PENDING" }> extends never
    ? never
    : Extract<OrchestratorEffect, { type: "STORE_WRITE_PENDING" }>["input"],
) => void;

type EffectExecutor = {
  executeEffects: (effects: OrchestratorEffect[]) => OrchestratorEvent[];
  transcribeStt: (input: { request_id: string; mode: Mode; wav: Buffer }) => void;
};

type SpeechMetric = {
  type: "speech.ttfa.observation";
  emitted_at_ms: number;
  utterance_id: string;
  chat_request_id: string;
  segment_count: number;
  first_segment_length: number;
};

const MIN_SPEECH_SEGMENT_LENGTH = 5;

const splitSpeechSegments = (text: string): string[] => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const raw = trimmed
    .split(/(?<=[。！？.!?])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const merged: string[] = [];
  for (const unit of raw) {
    if (merged.length === 0) {
      merged.push(unit);
      continue;
    }
    const lastIndex = merged.length - 1;
    if (unit.length < MIN_SPEECH_SEGMENT_LENGTH) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${unit}`;
      continue;
    }
    if (merged[lastIndex].length < MIN_SPEECH_SEGMENT_LENGTH) {
      merged[lastIndex] = `${merged[lastIndex]}${unit}`;
      continue;
    }
    merged.push(unit);
  }

  return merged;
};

const extractCompleteSentencePrefix = (text: string): { complete: string; rest: string } => {
  const punctuations = ["。", "！", "？", ".", "!", "?"];
  let lastIndex = -1;
  for (const punctuation of punctuations) {
    lastIndex = Math.max(lastIndex, text.lastIndexOf(punctuation));
  }
  if (lastIndex < 0) {
    return { complete: "", rest: text };
  }
  const end = lastIndex + 1;
  return {
    complete: text.slice(0, end),
    rest: text.slice(end),
  };
};

export const createEffectExecutor = (deps: {
  providers: Providers;
  sendKioskCommand: KioskCommandSender;
  enqueueEvent: (event: OrchestratorEvent) => void;
  onSttRequested: (request_id: string) => void;
  now_ms?: () => number;
  observeSpeechMetric?: (metric: SpeechMetric) => void;
  storeWritePending?: StoreWritePendingLegacy;
  storeWriteSessionSummaryPending: StoreWriteSessionSummaryPending;
}) => {
  let saySeq = 0;
  let currentExpression: string | null = null;
  const streamedChatRequestIds = new Map<string, number>();
  const nowMs = deps.now_ms ?? (() => Date.now());
  const streamedChatRequestTtlMs = 5 * 60 * 1000;

  const pruneStreamedChatRequestIds = () => {
    const now = nowMs();
    for (const [requestId, recordedAt] of streamedChatRequestIds.entries()) {
      if (now - recordedAt >= streamedChatRequestTtlMs) {
        streamedChatRequestIds.delete(requestId);
      }
    }
  };

  const executeEffects = (effects: OrchestratorEffect[]): OrchestratorEvent[] => {
    const events: OrchestratorEvent[] = [];

    pruneStreamedChatRequestIds();
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
              const callPromise = maybe;
              const streamFn = deps.providers.llm.chat.stream;
              if (streamFn) {
                void (async () => {
                  const streamAbortController = new AbortController();
                  let emittedSegmentCount = 0;
                  let firstSegmentLength = 0;
                  let firstSegmentEmittedAtMs: number | null = null;
                  let streamBuffer = "";
                  let isStreamStarted = false;
                  let isStreamEnded = false;
                  let isChatFinalized = false;
                  let isFirstSegmentGateResolved = false;
                  let firstSegmentGateResolve: () => void = () => {};
                  const firstSegmentGate = new Promise<void>((resolve) => {
                    firstSegmentGateResolve = resolve;
                  });
                  const resolveFirstSegmentGate = () => {
                    if (isFirstSegmentGateResolved) {
                      return;
                    }
                    isFirstSegmentGateResolved = true;
                    firstSegmentGateResolve();
                  };
                  const utteranceId = effect.request_id;

                  const sendStreamStart = () => {
                    if (isStreamStarted) {
                      return;
                    }
                    deps.sendKioskCommand("kiosk.command.speech.start", {
                      utterance_id: utteranceId,
                      chat_request_id: effect.request_id,
                    });
                    isStreamStarted = true;
                  };

                  const sendStreamEnd = () => {
                    if (!isStreamStarted || isStreamEnded) {
                      return;
                    }
                    deps.sendKioskCommand("kiosk.command.speech.end", {
                      utterance_id: utteranceId,
                      chat_request_id: effect.request_id,
                    });
                    isStreamEnded = true;
                  };

                  const streamPromise = (async () => {
                    try {
                      for await (const chunk of streamFn(effect.input, {
                        signal: streamAbortController.signal,
                      })) {
                        if (isChatFinalized && emittedSegmentCount === 0) {
                          break;
                        }
                        if (chunk.delta_text.length === 0) {
                          continue;
                        }
                        streamBuffer += chunk.delta_text;
                        const { complete, rest } = extractCompleteSentencePrefix(streamBuffer);
                        streamBuffer = rest;
                        const segments = splitSpeechSegments(complete);
                        for (const segmentText of segments) {
                          sendStreamStart();
                          deps.sendKioskCommand("kiosk.command.speech.segment", {
                            utterance_id: utteranceId,
                            chat_request_id: effect.request_id,
                            segment_index: emittedSegmentCount,
                            text: segmentText,
                            is_last: false,
                          });
                          if (firstSegmentEmittedAtMs === null) {
                            firstSegmentEmittedAtMs = nowMs();
                            firstSegmentLength = segmentText.length;
                            resolveFirstSegmentGate();
                          }
                          emittedSegmentCount += 1;
                        }
                      }

                      if (!isChatFinalized || emittedSegmentCount > 0) {
                        const tailSegments = splitSpeechSegments(streamBuffer);
                        if (tailSegments.length > 0) {
                          for (const [index, segmentText] of tailSegments.entries()) {
                            sendStreamStart();
                            deps.sendKioskCommand("kiosk.command.speech.segment", {
                              utterance_id: utteranceId,
                              chat_request_id: effect.request_id,
                              segment_index: emittedSegmentCount,
                              text: segmentText,
                              is_last: index === tailSegments.length - 1,
                            });
                            if (firstSegmentEmittedAtMs === null) {
                              firstSegmentEmittedAtMs = nowMs();
                              firstSegmentLength = segmentText.length;
                              resolveFirstSegmentGate();
                            }
                            emittedSegmentCount += 1;
                          }
                        }
                      }
                    } catch {
                    } finally {
                      resolveFirstSegmentGate();
                      sendStreamEnd();
                      if (firstSegmentEmittedAtMs !== null && emittedSegmentCount > 0) {
                        deps.observeSpeechMetric?.({
                          type: "speech.ttfa.observation",
                          emitted_at_ms: firstSegmentEmittedAtMs,
                          utterance_id: utteranceId,
                          chat_request_id: effect.request_id,
                          segment_count: emittedSegmentCount,
                          first_segment_length: firstSegmentLength,
                        });
                      }
                    }
                  })();

                  void streamPromise;

                  try {
                    const result = await callPromise;
                    await Promise.race([
                      firstSegmentGate,
                      new Promise<void>((resolve) => {
                        setTimeout(resolve, 0);
                      }),
                    ]);
                    isChatFinalized = true;
                    if (emittedSegmentCount > 0) {
                      streamedChatRequestIds.set(effect.request_id, nowMs());
                    }
                    streamAbortController.abort();
                    deps.enqueueEvent({
                      type: "CHAT_RESULT",
                      request_id: effect.request_id,
                      assistant_text: result.assistant_text,
                      expression: result.expression,
                      motion_id: result.motion_id,
                      tool_calls: result.tool_calls,
                    });
                  } catch {
                    await Promise.race([
                      firstSegmentGate,
                      new Promise<void>((resolve) => {
                        setTimeout(resolve, 0);
                      }),
                    ]);
                    isChatFinalized = true;
                    streamAbortController.abort();
                    deps.enqueueEvent({ type: "CHAT_FAILED", request_id: effect.request_id });
                  }
                })();
              } else {
                void callPromise
                  .then((result) => {
                    deps.enqueueEvent({
                      type: "CHAT_RESULT",
                      request_id: effect.request_id,
                      assistant_text: result.assistant_text,
                      expression: result.expression,
                      motion_id: result.motion_id,
                      tool_calls: result.tool_calls,
                    });
                  })
                  .catch(() => {
                    deps.enqueueEvent({ type: "CHAT_FAILED", request_id: effect.request_id });
                  });
              }
            } else {
              const result = maybe;
              events.push({
                type: "CHAT_RESULT",
                request_id: effect.request_id,
                assistant_text: result.assistant_text,
                expression: result.expression,
                motion_id: result.motion_id,
                tool_calls: result.tool_calls,
              });
            }
          } catch {
            events.push({ type: "CHAT_FAILED", request_id: effect.request_id });
          }
          break;
        }
        case "CALL_INNER_TASK": {
          try {
            const input: InnerTaskInput = (() => {
              switch (effect.task) {
                case "consent_decision":
                  return { task: "consent_decision", input: effect.input };
                case "memory_extract":
                  return { task: "memory_extract", input: effect.input };
                case "session_summary":
                  return { task: "session_summary", input: effect.input };
              }
            })();
            const maybe = deps.providers.llm.inner_task.call(input);
            if (isThenable<LlmInnerTaskResult>(maybe)) {
              void maybe
                .then((result) => {
                  deps.enqueueEvent({
                    type: "INNER_TASK_RESULT",
                    request_id: effect.request_id,
                    json_text: result.json_text,
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
                json_text: result.json_text,
              });
            }
          } catch {
            events.push({ type: "INNER_TASK_FAILED", request_id: effect.request_id });
          }
          break;
        }
        case "SAY": {
          const hasStreamedForChat =
            typeof effect.chat_request_id === "string" &&
            streamedChatRequestIds.delete(effect.chat_request_id);
          saySeq += 1;
          const utteranceId = `say-${saySeq}`;
          const chatRequestId = effect.chat_request_id ?? utteranceId;
          if (!hasStreamedForChat) {
            const segments = splitSpeechSegments(effect.text);
            let firstSegmentEmittedAtMs: number | null = null;

            deps.sendKioskCommand("kiosk.command.speech.start", {
              utterance_id: utteranceId,
              chat_request_id: chatRequestId,
            });
            for (const [segmentIndex, segmentText] of segments.entries()) {
              deps.sendKioskCommand("kiosk.command.speech.segment", {
                utterance_id: utteranceId,
                chat_request_id: chatRequestId,
                segment_index: segmentIndex,
                text: segmentText,
                is_last: segmentIndex === segments.length - 1,
              });
              if (segmentIndex === 0) {
                firstSegmentEmittedAtMs = nowMs();
              }
            }
            deps.sendKioskCommand("kiosk.command.speech.end", {
              utterance_id: utteranceId,
              chat_request_id: chatRequestId,
            });

            if (segments.length > 0 && firstSegmentEmittedAtMs !== null) {
              deps.observeSpeechMetric?.({
                type: "speech.ttfa.observation",
                emitted_at_ms: firstSegmentEmittedAtMs,
                utterance_id: utteranceId,
                chat_request_id: chatRequestId,
                segment_count: segments.length,
                first_segment_length: segments[0].length,
              });
            }
          }

          const base = {
            say_id: hasStreamedForChat ? chatRequestId : utteranceId,
            text: effect.text,
          };
          deps.sendKioskCommand(
            "kiosk.command.speak",
            currentExpression ? { ...base, expression: currentExpression } : base,
          );
          break;
        }
        case "SET_EXPRESSION":
          currentExpression = effect.expression;
          break;
        case "PLAY_MOTION":
          deps.sendKioskCommand("kiosk.command.play_motion", {
            motion_id: effect.motion_id,
            motion_instance_id: effect.motion_instance_id,
          });
          break;
        case "KIOSK_TOOL_CALLS":
          deps.sendKioskCommand("kiosk.command.tool_calls", {
            tool_calls: effect.tool_calls,
          });
          break;
        case "STORE_WRITE_SESSION_SUMMARY_PENDING":
          deps.storeWriteSessionSummaryPending(effect.input);
          break;
        case "STORE_WRITE_PENDING":
          if (!deps.storeWritePending) {
            throw new Error("Legacy STORE_WRITE_PENDING effect is no longer supported");
          }
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
      const maybe = deps.providers.stt.transcribe({
        mode: input.mode,
        wav: input.wav,
      });
      if (isThenable<{ text: string }>(maybe)) {
        void maybe
          .then((result) => {
            deps.enqueueEvent({
              type: "STT_RESULT",
              request_id: input.request_id,
              text: result.text,
            });
          })
          .catch(() => {
            deps.enqueueEvent({ type: "STT_FAILED", request_id: input.request_id });
          });
        return;
      }
      deps.enqueueEvent({
        type: "STT_RESULT",
        request_id: input.request_id,
        text: maybe.text,
      });
    } catch {
      deps.enqueueEvent({ type: "STT_FAILED", request_id: input.request_id });
    }
  };

  return { executeEffects, transcribeStt } satisfies EffectExecutor;
};
