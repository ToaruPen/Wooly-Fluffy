export type Mode = "ROOM" | "PERSONAL";

export type Expression = "neutral" | "happy" | "sad" | "surprised";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type Phase =
  | "idle"
  | "listening"
  | "waiting_stt"
  | "waiting_chat"
  | "asking_consent"
  | "waiting_inner_task";

export type MemoryKind = "likes" | "food" | "play" | "hobby";

export type MemoryCandidate = {
  kind: MemoryKind;
  value: string;
  source_quote?: string;
};

export type InFlight = {
  stt_request_id: string | null;
  chat_request_id: string | null;
  consent_inner_task_request_id: string | null;
  memory_extract_request_id: string | null;
};

export type OrchestratorState = {
  mode: Mode;
  personal_name: string | null;
  phase: Phase;
  last_action_at_ms: number;
  consent_deadline_at_ms: number | null;
  memory_candidate: MemoryCandidate | null;
  in_flight: InFlight;
  is_emergency_stopped: boolean;
  request_seq: number;
};

export type OrchestratorEvent =
  | { type: "STAFF_PTT_DOWN" }
  | { type: "STAFF_PTT_UP" }
  | { type: "UI_CONSENT_BUTTON"; answer: "yes" | "no" }
  | { type: "STAFF_FORCE_ROOM" }
  | { type: "STAFF_EMERGENCY_STOP" }
  | { type: "STAFF_RESUME" }
  | { type: "STT_RESULT"; text: string; request_id: string }
  | { type: "STT_FAILED"; request_id: string }
  | {
      type: "CHAT_RESULT";
      assistant_text: string;
      request_id: string;
      expression: Expression;
      tool_calls: ToolCall[];
    }
  | { type: "CHAT_FAILED"; request_id: string }
  | { type: "INNER_TASK_RESULT"; json_text: string; request_id: string }
  | { type: "INNER_TASK_FAILED"; request_id: string }
  | { type: "TICK" };

export type ChatInput = {
  mode: Mode;
  personal_name: string | null;
  text: string;
};

export type InnerTaskInput =
  | { task: "consent_decision"; input: { text: string } }
  | { task: "memory_extract"; input: { assistant_text: string } };

export type OrchestratorEffect =
  | { type: "KIOSK_RECORD_START" }
  | { type: "KIOSK_RECORD_STOP" }
  | { type: "CALL_STT"; request_id: string }
  | { type: "CALL_CHAT"; request_id: string; input: ChatInput }
  | { type: "CALL_INNER_TASK"; request_id: string } & InnerTaskInput
  | { type: "SAY"; text: string }
  | { type: "SET_EXPRESSION"; expression: Expression }
  | { type: "PLAY_MOTION"; motion_id: string; motion_instance_id: string }
  | { type: "SET_MODE"; mode: Mode; personal_name?: string }
  | { type: "SHOW_CONSENT_UI"; visible: boolean }
  | {
      type: "STORE_WRITE_PENDING";
      input: {
        personal_name: string;
        kind: MemoryKind;
        value: string;
        source_quote?: string;
      };
    };

export type OrchestratorResult = {
  next_state: OrchestratorState;
  effects: OrchestratorEffect[];
};

const CONSENT_TIMEOUT_MS = 30_000;
const INACTIVITY_TIMEOUT_MS = 300_000;

const FORGET_CONSENT_TEXT = "さっきのことは忘れるね";
const STT_FALLBACK_TEXT = "ごめんね、もう一回言ってね";
const CHAT_FALLBACK_TEXT = "ごめんね、もう一回言ってね";

const createEmptyInFlight = (): InFlight => ({
  stt_request_id: null,
  chat_request_id: null,
  consent_inner_task_request_id: null,
  memory_extract_request_id: null
});

export const createInitialState = (now: number): OrchestratorState => ({
  mode: "ROOM",
  personal_name: null,
  phase: "idle",
  last_action_at_ms: now,
  consent_deadline_at_ms: null,
  memory_candidate: null,
  in_flight: createEmptyInFlight(),
  is_emergency_stopped: false,
  request_seq: 0
});

const isConsentUiVisible = (state: OrchestratorState) =>
  state.consent_deadline_at_ms !== null;

export const createKioskSnapshot = (state: OrchestratorState) => ({
  state: {
    mode: state.mode,
    personal_name: state.personal_name,
    phase: state.phase,
    consent_ui_visible: isConsentUiVisible(state)
  }
});

export const createStaffSnapshot = (
  state: OrchestratorState,
  pending_count: number
) => ({
  state: {
    mode: state.mode,
    personal_name: state.personal_name,
    phase: state.phase
  },
  pending: {
    count: pending_count
  }
});

export const initialKioskSnapshot = createKioskSnapshot(createInitialState(0));
export const initialStaffSnapshot = createStaffSnapshot(createInitialState(0), 0);

const normalizeText = (text: string) =>
  text
    .replace(/\u3000/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const extractPersonalName = (text: string): string | null => {
  const normalized = normalizeText(text);
  const match = normalized.match(/^パーソナル(?:[、,\s]+)([^\s、,。．.!?]+)/);
  if (!match) {
    return null;
  }
  return match[1];
};

const isRoomCommand = (text: string): boolean => {
  const normalized = normalizeText(text);
  return normalized === "ルーム" || normalized === "ルームに戻る";
};

const nextRequestId = (
  state: OrchestratorState,
  prefix: string
): { id: string; state: OrchestratorState } => {
  const nextSeq = state.request_seq + 1;
  return {
    id: `${prefix}-${nextSeq}`,
    state: { ...state, request_seq: nextSeq }
  };
};

const resetForRoom = (state: OrchestratorState, now: number) => ({
  ...state,
  mode: "ROOM" as const,
  personal_name: null,
  phase: "idle" as const,
  last_action_at_ms: now,
  consent_deadline_at_ms: null,
  memory_candidate: null,
  in_flight: createEmptyInFlight()
});

const clearConsentState = (state: OrchestratorState): OrchestratorState => ({
  ...state,
  consent_deadline_at_ms: null,
  memory_candidate: null,
  phase: "idle",
  in_flight: {
    ...state.in_flight,
    consent_inner_task_request_id: null
  }
});

const parseConsentDecision = (
  json_text: string
): "yes" | "no" | "unknown" => {
  try {
    const parsed = JSON.parse(json_text) as {
      task?: string;
      answer?: string;
    };
    if (parsed.task !== "consent_decision") {
      return "unknown";
    }
    if (parsed.answer === "yes" || parsed.answer === "no" || parsed.answer === "unknown") {
      return parsed.answer;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
};

const parseMemoryCandidate = (json_text: string): MemoryCandidate | null => {
  try {
    const parsed = JSON.parse(json_text) as {
      task?: string;
      candidate?: {
        kind?: string;
        value?: string;
        source_quote?: string;
      } | null;
    };
    if (parsed.task !== "memory_extract") {
      return null;
    }
    if (!parsed.candidate) {
      return null;
    }
    const { kind, value, source_quote } = parsed.candidate;
    if (
      kind !== "likes" &&
      kind !== "food" &&
      kind !== "play" &&
      kind !== "hobby"
    ) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }
    if (source_quote !== undefined && typeof source_quote !== "string") {
      return null;
    }
    return {
      kind,
      value,
      ...(source_quote ? { source_quote } : {})
    };
  } catch {
    return null;
  }
};

export const reduceOrchestrator = (
  state: OrchestratorState,
  event: OrchestratorEvent,
  now: number
): OrchestratorResult => {
  if (state.is_emergency_stopped) {
    if (event.type === "STAFF_RESUME") {
      const resumed = resetForRoom(
        {
          ...state,
          is_emergency_stopped: false
        },
        now
      );
      return {
        next_state: resumed,
        effects: [
          { type: "SET_MODE", mode: "ROOM" },
          { type: "SHOW_CONSENT_UI", visible: false }
        ]
      };
    }
    return { next_state: state, effects: [] };
  }

  if (event.type === "STAFF_FORCE_ROOM") {
    const nextState = resetForRoom(state, now);
    return {
      next_state: nextState,
      effects: [
        { type: "SET_MODE", mode: "ROOM" },
        { type: "SHOW_CONSENT_UI", visible: false }
      ]
    };
  }

  if (event.type === "STAFF_EMERGENCY_STOP") {
    const nextState = {
      ...resetForRoom(state, now),
      is_emergency_stopped: true
    };
    const effects: OrchestratorEffect[] = [
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false }
    ];
    if (state.phase === "listening") {
      effects.unshift({ type: "KIOSK_RECORD_STOP" });
    }
    return { next_state: nextState, effects };
  }

  switch (event.type) {
    case "STAFF_RESUME":
      return { next_state: state, effects: [] };
    case "STAFF_PTT_DOWN":
      if (state.phase !== "idle" && state.phase !== "asking_consent") {
        return { next_state: state, effects: [] };
      }
      return {
        next_state: { ...state, phase: "listening" },
        effects: [{ type: "KIOSK_RECORD_START" }]
      };
    case "STAFF_PTT_UP":
      if (state.phase !== "listening") {
        return { next_state: state, effects: [] };
      }
      {
        const { id, state: withId } = nextRequestId(state, "stt");
        return {
          next_state: {
            ...withId,
            phase: "waiting_stt",
            last_action_at_ms: now,
            in_flight: { ...withId.in_flight, stt_request_id: id }
          },
          effects: [
            { type: "KIOSK_RECORD_STOP" },
            { type: "CALL_STT", request_id: id }
          ]
        };
      }
    case "STT_RESULT": {
      if (state.in_flight.stt_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      const withCleared = {
        ...state,
        in_flight: { ...state.in_flight, stt_request_id: null }
      };
      if (isRoomCommand(event.text)) {
        const nextState = resetForRoom(withCleared, now);
        return {
          next_state: nextState,
          effects: [
            { type: "SET_MODE", mode: "ROOM" },
            { type: "SHOW_CONSENT_UI", visible: false }
          ]
        };
      }

      if (state.consent_deadline_at_ms !== null && state.memory_candidate) {
        const { id, state: withId } = nextRequestId(withCleared, "inner");
        return {
          next_state: {
            ...withId,
            phase: "waiting_inner_task",
            in_flight: {
              ...withId.in_flight,
              consent_inner_task_request_id: id
            }
          },
          effects: [
            {
              type: "CALL_INNER_TASK",
              request_id: id,
              task: "consent_decision",
              input: { text: event.text }
            }
          ]
        };
      }

      const personalName = extractPersonalName(event.text);
      if (personalName) {
        const nextState: OrchestratorState = {
          ...withCleared,
          mode: "PERSONAL",
          personal_name: personalName,
          phase: "idle",
          consent_deadline_at_ms: null,
          memory_candidate: null
        };
        return {
          next_state: nextState,
          effects: [{ type: "SET_MODE", mode: "PERSONAL", personal_name: personalName }]
        };
      }

      {
        const { id, state: withId } = nextRequestId(withCleared, "chat");
        return {
          next_state: {
            ...withId,
            phase: "waiting_chat",
            in_flight: { ...withId.in_flight, chat_request_id: id }
          },
          effects: [
            {
              type: "CALL_CHAT",
              request_id: id,
              input: {
                mode: withId.mode,
                personal_name: withId.personal_name,
                text: event.text
              }
            }
          ]
        };
      }
    }
    case "STT_FAILED": {
      if (state.in_flight.stt_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      const nextState: OrchestratorState = {
        ...state,
        phase: state.consent_deadline_at_ms ? "asking_consent" : "idle",
        in_flight: { ...state.in_flight, stt_request_id: null }
      };
      return {
        next_state: nextState,
        effects: [{ type: "SAY", text: STT_FALLBACK_TEXT }]
      };
    }
    case "CHAT_RESULT": {
      if (state.in_flight.chat_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      const cleared = {
        ...state,
        in_flight: { ...state.in_flight, chat_request_id: null }
      };
      const effects: OrchestratorEffect[] = [
        { type: "SET_EXPRESSION", expression: event.expression },
        { type: "SAY", text: event.assistant_text }
      ];
      if (cleared.mode === "PERSONAL" && cleared.memory_candidate === null) {
        const { id, state: withId } = nextRequestId(cleared, "inner");
        return {
          next_state: {
            ...withId,
            phase: "waiting_inner_task",
            in_flight: {
              ...withId.in_flight,
              memory_extract_request_id: id
            }
          },
          effects: [
            ...effects,
            {
              type: "CALL_INNER_TASK",
              request_id: id,
              task: "memory_extract",
              input: { assistant_text: event.assistant_text }
            }
          ]
        };
      }
      return {
        next_state: { ...cleared, phase: "idle" },
        effects
      };
    }
    case "CHAT_FAILED": {
      if (state.in_flight.chat_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      return {
        next_state: {
          ...state,
          phase: "idle",
          in_flight: { ...state.in_flight, chat_request_id: null }
        },
        effects: [{ type: "SAY", text: CHAT_FALLBACK_TEXT }]
      };
    }
    case "INNER_TASK_RESULT": {
      if (state.in_flight.memory_extract_request_id === event.request_id) {
        const candidate = parseMemoryCandidate(event.json_text);
        if (!candidate) {
          return {
            next_state: {
              ...state,
              phase: "idle",
              in_flight: {
                ...state.in_flight,
                memory_extract_request_id: null
              }
            },
            effects: []
          };
        }
        return {
          next_state: {
            ...state,
            phase: "asking_consent",
            consent_deadline_at_ms: now + CONSENT_TIMEOUT_MS,
            memory_candidate: candidate,
            in_flight: {
              ...state.in_flight,
              memory_extract_request_id: null
            }
          },
          effects: [
            { type: "SAY", text: "覚えていい？" },
            { type: "SHOW_CONSENT_UI", visible: true }
          ]
        };
      }

      if (state.in_flight.consent_inner_task_request_id === event.request_id) {
        const decision = parseConsentDecision(event.json_text);
        if (decision === "unknown") {
          return {
            next_state: {
              ...state,
              phase: "asking_consent",
              in_flight: {
                ...state.in_flight,
                consent_inner_task_request_id: null
              }
            },
            effects: []
          };
        }
        if (decision === "yes" && state.memory_candidate && state.personal_name) {
          return {
            next_state: clearConsentState({
              ...state,
              in_flight: {
                ...state.in_flight,
                consent_inner_task_request_id: null
              }
            }),
            effects: [
              {
                type: "STORE_WRITE_PENDING",
                input: {
                  personal_name: state.personal_name,
                  kind: state.memory_candidate.kind,
                  value: state.memory_candidate.value,
                  ...(state.memory_candidate.source_quote
                    ? { source_quote: state.memory_candidate.source_quote }
                    : {})
                }
              },
              { type: "SHOW_CONSENT_UI", visible: false }
            ]
          };
        }

        return {
          next_state: clearConsentState({
            ...state,
            in_flight: {
              ...state.in_flight,
              consent_inner_task_request_id: null
            }
          }),
          effects: [{ type: "SHOW_CONSENT_UI", visible: false }]
        };
      }
      return { next_state: state, effects: [] };
    }
    case "INNER_TASK_FAILED": {
      if (state.in_flight.memory_extract_request_id === event.request_id) {
        return {
          next_state: {
            ...state,
            phase: "idle",
            in_flight: {
              ...state.in_flight,
              memory_extract_request_id: null
            }
          },
          effects: []
        };
      }
      if (state.in_flight.consent_inner_task_request_id === event.request_id) {
        return {
          next_state: {
            ...state,
            phase: "asking_consent",
            in_flight: {
              ...state.in_flight,
              consent_inner_task_request_id: null
            }
          },
          effects: []
        };
      }
      return { next_state: state, effects: [] };
    }
    case "UI_CONSENT_BUTTON": {
      if (!state.memory_candidate || state.consent_deadline_at_ms === null) {
        return { next_state: state, effects: [] };
      }
      if (event.answer === "yes" && state.personal_name) {
        return {
          next_state: clearConsentState({
            ...state,
            last_action_at_ms: now
          }),
          effects: [
            {
              type: "STORE_WRITE_PENDING",
              input: {
                personal_name: state.personal_name,
                kind: state.memory_candidate.kind,
                value: state.memory_candidate.value,
                ...(state.memory_candidate.source_quote
                  ? { source_quote: state.memory_candidate.source_quote }
                  : {})
              }
            },
            { type: "SHOW_CONSENT_UI", visible: false }
          ]
        };
      }
      return {
        next_state: clearConsentState({
          ...state,
          last_action_at_ms: now
        }),
        effects: [{ type: "SHOW_CONSENT_UI", visible: false }]
      };
    }
    case "TICK": {
      if (
        state.consent_deadline_at_ms !== null &&
        now >= state.consent_deadline_at_ms
      ) {
        return {
          next_state: clearConsentState(state),
          effects: [
            { type: "SAY", text: FORGET_CONSENT_TEXT },
            { type: "SHOW_CONSENT_UI", visible: false }
          ]
        };
      }
      if (
        state.mode === "PERSONAL" &&
        now - state.last_action_at_ms >= INACTIVITY_TIMEOUT_MS
      ) {
        const nextState = resetForRoom(state, now);
        return {
          next_state: nextState,
          effects: [
            { type: "SET_MODE", mode: "ROOM" },
            { type: "SHOW_CONSENT_UI", visible: false }
          ]
        };
      }
      return { next_state: state, effects: [] };
    }
    default:
      return { next_state: state, effects: [] };
  }
};
