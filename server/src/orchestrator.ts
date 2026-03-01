import {
  appendToSessionBuffer,
  buildSessionSummaryMessages,
  createEmptySessionBuffer,
  hasSessionBufferContent,
  type SessionBuffer,
} from "./session-buffer.js";
import { maskLikelyPii } from "./safety/pii-mask.js";

export type Mode = "ROOM" | "PERSONAL";

export type Expression = "neutral" | "happy" | "sad" | "surprised";

type ReplyMotionId = "idle" | "greeting" | "cheer";

const replyMotionIdAllowlist: Record<ReplyMotionId, true> = {
  idle: true,
  greeting: true,
  cheer: true,
};

const isReplyMotionId = (value: string): value is ReplyMotionId =>
  Object.hasOwn(replyMotionIdAllowlist, value);

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolCallLite = {
  id: string;
  function: {
    name: string;
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
  session_summary_request_id: string | null;
};

export type OrchestratorState = {
  mode: Mode;
  personal_name: string | null;
  phase: Phase;
  last_action_at_ms: number;
  session_buffer: SessionBuffer;
  consent_deadline_at_ms: number | null;
  memory_candidate: MemoryCandidate | null;
  in_flight: InFlight;
  is_emergency_stopped: boolean;
  is_kiosk_ptt_held: boolean;
  request_seq: number;
};

export type OrchestratorEvent =
  | { type: "KIOSK_PTT_DOWN" }
  | { type: "KIOSK_PTT_UP" }
  | { type: "UI_CONSENT_BUTTON"; answer: "yes" | "no" }
  | { type: "STAFF_RESET_SESSION" }
  | { type: "STAFF_EMERGENCY_STOP" }
  | { type: "STAFF_RESUME" }
  | { type: "STT_RESULT"; text: string; request_id: string }
  | { type: "STT_FAILED"; request_id: string }
  | {
      type: "CHAT_RESULT";
      assistant_text: string;
      request_id: string;
      expression: Expression;
      motion_id?: string | null;
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
  | { task: "memory_extract"; input: { assistant_text: string } }
  | {
      task: "session_summary";
      input: {
        messages: Array<{ role: "user" | "assistant"; text: string }>;
      };
    };

export type OrchestratorEffect =
  | { type: "KIOSK_RECORD_START" }
  | { type: "KIOSK_RECORD_STOP" }
  | { type: "CALL_STT"; request_id: string }
  | { type: "CALL_CHAT"; request_id: string; input: ChatInput }
  | ({ type: "CALL_INNER_TASK"; request_id: string } & InnerTaskInput)
  | { type: "SAY"; text: string; chat_request_id?: string }
  | { type: "KIOSK_TOOL_CALLS"; tool_calls: ToolCallLite[] }
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
    }
  | { type: "STORE_WRITE_SESSION_SUMMARY_PENDING"; input: SessionSummaryPendingInput };

type SessionSummaryJson = {
  summary: string;
  topics: string[];
  staff_notes: string[];
};

export type SessionSummaryPendingInput = {
  title: string;
  summary_json: SessionSummaryJson;
};

const SESSION_SUMMARY_LIMITS = {
  title_max_len: 60,
  title_min_len: 1,
  summary_max_len: 400,
  summary_min_len: 1,
  topics_max: 5,
  topic_max_len: 40,
  staff_notes_max: 5,
  staff_note_max_len: 80,
} as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return true;
};

const clampString = (value: string, maxLen: number): string => value.slice(0, Math.max(0, maxLen));

const normalizeSessionSummaryText = (value: string, maxLen: number): string =>
  clampString(maskLikelyPii(value.trim()), maxLen)
    .trim()
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const FALLBACK_SESSION_SUMMARY_PENDING_INPUT: SessionSummaryPendingInput = {
  title: "要約",
  summary_json: {
    summary: "要約を生成できませんでした。",
    topics: [],
    staff_notes: [],
  },
};

const toToolCallLite = (call: ToolCall): ToolCallLite => ({
  id: call.id,
  function: {
    name: call.function.name,
  },
});

export type OrchestratorResult = {
  next_state: OrchestratorState;
  effects: OrchestratorEffect[];
};

export type OrchestratorConfig = {
  consent_timeout_ms: number;
  inactivity_timeout_ms: number;
};

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  consent_timeout_ms: 30_000,
  inactivity_timeout_ms: 300_000,
};

const FORGET_CONSENT_TEXT = "さっきのことは忘れるね";
const STT_FALLBACK_TEXT = "ごめんね、もう一回言ってね";
const CHAT_FALLBACK_TEXT = "ごめんね、もう一回言ってね";

const createEmptyInFlight = (): InFlight => ({
  stt_request_id: null,
  chat_request_id: null,
  consent_inner_task_request_id: null,
  memory_extract_request_id: null,
  session_summary_request_id: null,
});

export const createInitialState = (now: number): OrchestratorState => ({
  mode: "ROOM",
  personal_name: null,
  phase: "idle",
  last_action_at_ms: now,
  session_buffer: createEmptySessionBuffer(),
  consent_deadline_at_ms: null,
  memory_candidate: null,
  in_flight: createEmptyInFlight(),
  is_emergency_stopped: false,
  is_kiosk_ptt_held: false,
  request_seq: 0,
});

const isConsentUiVisible = (state: OrchestratorState) => state.consent_deadline_at_ms !== null;

export const createKioskSnapshot = (state: OrchestratorState) => ({
  state: {
    mode: state.mode,
    personal_name: state.personal_name,
    phase: state.phase,
    consent_ui_visible: isConsentUiVisible(state),
  },
});

export const createStaffSnapshot = (
  state: OrchestratorState,
  pending_count: number,
  session_summary_pending_count = 0,
) => ({
  state: {
    mode: state.mode,
    personal_name: state.personal_name,
    phase: state.phase,
  },
  pending: {
    count: pending_count,
    session_summary_count: session_summary_pending_count,
  },
});

export const initialKioskSnapshot = createKioskSnapshot(createInitialState(0));
export const initialStaffSnapshot = createStaffSnapshot(createInitialState(0), 0);

const nextRequestId = (
  state: OrchestratorState,
  prefix: string,
): { id: string; state: OrchestratorState } => {
  const nextSeq = state.request_seq + 1;
  return {
    id: `${prefix}-${nextSeq}`,
    state: { ...state, request_seq: nextSeq },
  };
};

const resetForRoom = (state: OrchestratorState, now: number) => ({
  ...state,
  mode: "ROOM" as const,
  personal_name: null,
  phase: "idle" as const,
  last_action_at_ms: now,
  session_buffer: createEmptySessionBuffer(),
  consent_deadline_at_ms: null,
  memory_candidate: null,
  in_flight: createEmptyInFlight(),
  is_kiosk_ptt_held: false,
});

const clearConsentState = (state: OrchestratorState): OrchestratorState => ({
  ...state,
  consent_deadline_at_ms: null,
  memory_candidate: null,
  phase: "idle",
  in_flight: {
    ...state.in_flight,
    consent_inner_task_request_id: null,
  },
});

const parseConsentDecision = (json_text: string): "yes" | "no" | "unknown" => {
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
    if (kind !== "likes" && kind !== "food" && kind !== "play" && kind !== "hobby") {
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
      ...(source_quote ? { source_quote } : {}),
    };
  } catch {
    return null;
  }
};

const parseSessionSummaryPendingInput = (json_text: string): SessionSummaryPendingInput | null => {
  try {
    const parsed = JSON.parse(json_text) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }
    if (!("task" in parsed) || !("title" in parsed) || !("summary_json" in parsed)) {
      return null;
    }
    if (parsed.task !== "session_summary") {
      return null;
    }
    if (typeof parsed.title !== "string") {
      return null;
    }
    if (!isPlainObject(parsed.summary_json)) {
      return null;
    }

    const title = normalizeSessionSummaryText(parsed.title, SESSION_SUMMARY_LIMITS.title_max_len);
    if (title.length < SESSION_SUMMARY_LIMITS.title_min_len) {
      return null;
    }

    const summaryJson = parsed.summary_json;
    if (
      !("summary" in summaryJson) ||
      !("topics" in summaryJson) ||
      !("staff_notes" in summaryJson)
    ) {
      return null;
    }
    const rawSummary = summaryJson.summary;
    const rawTopics = summaryJson.topics;
    const rawStaffNotes = summaryJson.staff_notes;
    if (typeof rawSummary !== "string") {
      return null;
    }
    if (!Array.isArray(rawTopics) || !rawTopics.every((t) => typeof t === "string")) {
      return null;
    }
    if (!Array.isArray(rawStaffNotes) || !rawStaffNotes.every((t) => typeof t === "string")) {
      return null;
    }

    const summary = normalizeSessionSummaryText(rawSummary, SESSION_SUMMARY_LIMITS.summary_max_len);
    if (summary.length < SESSION_SUMMARY_LIMITS.summary_min_len) {
      return null;
    }

    const topics = rawTopics
      .map((t) => normalizeSessionSummaryText(t, SESSION_SUMMARY_LIMITS.topic_max_len))
      .filter((t) => t.length > 0)
      .slice(0, SESSION_SUMMARY_LIMITS.topics_max);

    const staff_notes = rawStaffNotes
      .map((t) => normalizeSessionSummaryText(t, SESSION_SUMMARY_LIMITS.staff_note_max_len))
      .filter((t) => t.length > 0)
      .slice(0, SESSION_SUMMARY_LIMITS.staff_notes_max);

    return {
      title,
      summary_json: {
        summary,
        topics,
        staff_notes,
      },
    };
  } catch {
    return null;
  }
};

export const reduceOrchestrator = (
  state: OrchestratorState,
  event: OrchestratorEvent,
  now: number,
  config: OrchestratorConfig = DEFAULT_ORCHESTRATOR_CONFIG,
): OrchestratorResult => {
  if (state.is_emergency_stopped) {
    if (event.type === "STAFF_RESUME") {
      const resumed = resetForRoom(
        {
          ...state,
          is_emergency_stopped: false,
        },
        now,
      );
      return {
        next_state: resumed,
        effects: [
          { type: "SET_MODE", mode: "ROOM" },
          { type: "SHOW_CONSENT_UI", visible: false },
        ],
      };
    }
    return { next_state: state, effects: [] };
  }

  if (event.type === "STAFF_RESET_SESSION") {
    const nextState = resetForRoom(state, now);
    const effects: OrchestratorEffect[] = [
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-reset-session" },
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ];
    if (state.phase === "listening") {
      effects.unshift({ type: "KIOSK_RECORD_STOP" });
    }
    return { next_state: nextState, effects };
  }

  if (event.type === "STAFF_EMERGENCY_STOP") {
    const nextState = {
      ...resetForRoom(state, now),
      is_emergency_stopped: true,
    };
    const effects: OrchestratorEffect[] = [
      {
        type: "PLAY_MOTION",
        motion_id: "idle",
        motion_instance_id: "motion-emergency-stop",
      },
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ];
    if (state.phase === "listening") {
      effects.unshift({ type: "KIOSK_RECORD_STOP" });
    }
    return { next_state: nextState, effects };
  }

  switch (event.type) {
    case "STAFF_RESUME":
      return { next_state: state, effects: [] };
    case "KIOSK_PTT_DOWN":
      if (state.phase === "idle" || state.phase === "asking_consent") {
        return {
          next_state: { ...state, phase: "listening", is_kiosk_ptt_held: true },
          effects: [{ type: "KIOSK_RECORD_START" }],
        };
      }
      if (state.phase === "listening") {
        return {
          next_state: { ...state, is_kiosk_ptt_held: true },
          effects: [],
        };
      }
      return { next_state: state, effects: [] };
    case "KIOSK_PTT_UP":
      if (state.phase !== "listening") {
        return { next_state: state, effects: [] };
      }
      {
        const released: OrchestratorState = {
          ...state,
          is_kiosk_ptt_held: false,
        };
        const { id, state: withId } = nextRequestId(released, "stt");
        return {
          next_state: {
            ...withId,
            phase: "waiting_stt",
            last_action_at_ms: now,
            is_kiosk_ptt_held: false,
            in_flight: { ...withId.in_flight, stt_request_id: id },
          },
          effects: [{ type: "KIOSK_RECORD_STOP" }, { type: "CALL_STT", request_id: id }],
        };
      }
    case "STT_RESULT": {
      if (state.in_flight.stt_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      const withCleared = {
        ...state,
        in_flight: { ...state.in_flight, stt_request_id: null },
      };
      if (state.consent_deadline_at_ms !== null && state.memory_candidate) {
        const { id, state: withId } = nextRequestId(withCleared, "inner");
        return {
          next_state: {
            ...withId,
            phase: "waiting_inner_task",
            in_flight: {
              ...withId.in_flight,
              consent_inner_task_request_id: id,
            },
          },
          effects: [
            {
              type: "CALL_INNER_TASK",
              request_id: id,
              task: "consent_decision",
              input: { text: event.text },
            },
          ],
        };
      }

      {
        const withMessage: OrchestratorState = {
          ...withCleared,
          last_action_at_ms: now,
          session_buffer: appendToSessionBuffer(withCleared.session_buffer, {
            role: "user",
            text: event.text,
          }),
        };
        const { id, state: withId } = nextRequestId(withMessage, "chat");
        return {
          next_state: {
            ...withId,
            phase: "waiting_chat",
            in_flight: { ...withId.in_flight, chat_request_id: id },
          },
          effects: [
            {
              type: "PLAY_MOTION",
              motion_id: "thinking",
              motion_instance_id: `motion-${id}-thinking`,
            },
            {
              type: "CALL_CHAT",
              request_id: id,
              input: {
                mode: withId.mode,
                personal_name: withId.personal_name,
                text: event.text,
              },
            },
          ],
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
        in_flight: { ...state.in_flight, stt_request_id: null },
      };
      return {
        next_state: nextState,
        effects: [{ type: "SAY", text: STT_FALLBACK_TEXT }],
      };
    }
    case "CHAT_RESULT": {
      if (state.in_flight.chat_request_id !== event.request_id) {
        return { next_state: state, effects: [] };
      }
      const cleared = {
        ...state,
        in_flight: { ...state.in_flight, chat_request_id: null },
      };
      const withMessage: OrchestratorState = {
        ...cleared,
        last_action_at_ms: now,
        session_buffer: appendToSessionBuffer(cleared.session_buffer, {
          role: "assistant",
          text: event.assistant_text,
        }),
      };
      const effects: OrchestratorEffect[] = [
        {
          type: "SET_EXPRESSION",
          expression: event.expression,
        },
      ];

      const motionIdRaw = event.motion_id;
      const nextMotionId: ReplyMotionId =
        typeof motionIdRaw === "string" && isReplyMotionId(motionIdRaw) ? motionIdRaw : "idle";
      effects.push({
        type: "PLAY_MOTION",
        motion_id: nextMotionId,
        motion_instance_id: `motion-${event.request_id}`,
      });
      if (event.tool_calls.length > 0) {
        effects.push({
          type: "KIOSK_TOOL_CALLS",
          tool_calls: event.tool_calls.map(toToolCallLite),
        });
      }
      effects.push({ type: "SAY", text: event.assistant_text, chat_request_id: event.request_id });
      if (cleared.mode === "PERSONAL" && cleared.memory_candidate === null) {
        const { id, state: withId } = nextRequestId(cleared, "inner");
        return {
          next_state: {
            ...withId,
            phase: "waiting_inner_task",
            in_flight: {
              ...withId.in_flight,
              memory_extract_request_id: id,
            },
          },
          effects: [
            ...effects,
            {
              type: "CALL_INNER_TASK",
              request_id: id,
              task: "memory_extract",
              input: { assistant_text: event.assistant_text },
            },
          ],
        };
      }
      return {
        next_state: { ...withMessage, phase: "idle" },
        effects,
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
          in_flight: { ...state.in_flight, chat_request_id: null },
        },
        effects: [
          {
            type: "PLAY_MOTION",
            motion_id: "idle",
            motion_instance_id: `motion-${event.request_id}`,
          },
          { type: "SAY", text: CHAT_FALLBACK_TEXT, chat_request_id: event.request_id },
        ],
      };
    }
    case "INNER_TASK_RESULT": {
      if (state.in_flight.session_summary_request_id === event.request_id) {
        const input =
          parseSessionSummaryPendingInput(event.json_text) ??
          FALLBACK_SESSION_SUMMARY_PENDING_INPUT;
        const nextState: OrchestratorState = {
          ...state,
          in_flight: {
            ...state.in_flight,
            session_summary_request_id: null,
          },
        };
        return {
          next_state: nextState,
          effects: [{ type: "STORE_WRITE_SESSION_SUMMARY_PENDING", input }],
        };
      }

      if (state.in_flight.memory_extract_request_id === event.request_id) {
        const candidate = parseMemoryCandidate(event.json_text);
        if (!candidate) {
          return {
            next_state: {
              ...state,
              phase: "idle",
              in_flight: {
                ...state.in_flight,
                memory_extract_request_id: null,
              },
            },
            effects: [],
          };
        }
        return {
          next_state: {
            ...state,
            phase: "asking_consent",
            consent_deadline_at_ms: now + config.consent_timeout_ms,
            memory_candidate: candidate,
            in_flight: {
              ...state.in_flight,
              memory_extract_request_id: null,
            },
          },
          effects: [
            { type: "SAY", text: "覚えていい？" },
            { type: "SHOW_CONSENT_UI", visible: true },
          ],
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
                consent_inner_task_request_id: null,
              },
            },
            effects: [],
          };
        }
        if (decision === "yes" && state.memory_candidate && state.personal_name) {
          return {
            next_state: clearConsentState({
              ...state,
              in_flight: {
                ...state.in_flight,
                consent_inner_task_request_id: null,
              },
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
                    : {}),
                },
              },
              { type: "SHOW_CONSENT_UI", visible: false },
            ],
          };
        }

        return {
          next_state: clearConsentState({
            ...state,
            in_flight: {
              ...state.in_flight,
              consent_inner_task_request_id: null,
            },
          }),
          effects: [{ type: "SHOW_CONSENT_UI", visible: false }],
        };
      }
      return { next_state: state, effects: [] };
    }
    case "INNER_TASK_FAILED": {
      if (state.in_flight.session_summary_request_id === event.request_id) {
        return {
          next_state: {
            ...state,
            in_flight: {
              ...state.in_flight,
              session_summary_request_id: null,
            },
          },
          effects: [
            {
              type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
              input: FALLBACK_SESSION_SUMMARY_PENDING_INPUT,
            },
          ],
        };
      }
      if (state.in_flight.memory_extract_request_id === event.request_id) {
        return {
          next_state: {
            ...state,
            phase: "idle",
            in_flight: {
              ...state.in_flight,
              memory_extract_request_id: null,
            },
          },
          effects: [],
        };
      }
      if (state.in_flight.consent_inner_task_request_id === event.request_id) {
        return {
          next_state: {
            ...state,
            phase: "asking_consent",
            in_flight: {
              ...state.in_flight,
              consent_inner_task_request_id: null,
            },
          },
          effects: [],
        };
      }
      return { next_state: state, effects: [] };
    }
    case "UI_CONSENT_BUTTON": {
      if (!state.memory_candidate || state.consent_deadline_at_ms === null) {
        return { next_state: state, effects: [] };
      }
      if (state.phase === "listening") {
        return { next_state: state, effects: [] };
      }
      if (event.answer === "yes" && state.personal_name) {
        return {
          next_state: clearConsentState({
            ...state,
            last_action_at_ms: now,
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
                  : {}),
              },
            },
            { type: "SHOW_CONSENT_UI", visible: false },
          ],
        };
      }
      return {
        next_state: clearConsentState({
          ...state,
          last_action_at_ms: now,
        }),
        effects: [{ type: "SHOW_CONSENT_UI", visible: false }],
      };
    }
    case "TICK": {
      if (
        state.phase !== "listening" &&
        state.consent_deadline_at_ms !== null &&
        now >= state.consent_deadline_at_ms
      ) {
        return {
          next_state: clearConsentState(state),
          effects: [
            { type: "SAY", text: FORGET_CONSENT_TEXT },
            { type: "SHOW_CONSENT_UI", visible: false },
          ],
        };
      }
      if (
        state.phase === "idle" &&
        state.in_flight.session_summary_request_id === null &&
        now - state.last_action_at_ms >= config.inactivity_timeout_ms &&
        hasSessionBufferContent(state.session_buffer)
      ) {
        const messages = buildSessionSummaryMessages(state.session_buffer);
        const { id, state: withId } = nextRequestId(state, "inner");
        return {
          next_state: {
            ...withId,
            phase: "idle",
            session_buffer: createEmptySessionBuffer(),
            in_flight: {
              ...withId.in_flight,
              session_summary_request_id: id,
            },
          },
          effects: [
            {
              type: "CALL_INNER_TASK",
              request_id: id,
              task: "session_summary",
              input: { messages },
            },
          ],
        };
      }
      return { next_state: state, effects: [] };
    }
    default:
      return { next_state: state, effects: [] };
  }
};
