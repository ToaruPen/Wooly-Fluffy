import { describe, expect, it } from "vitest";
import {
  createInitialState,
  createKioskSnapshot,
  createStaffSnapshot,
  initialKioskSnapshot,
  initialStaffSnapshot,
  reduceOrchestrator,
  type InnerTaskInput,
  type OrchestratorEvent,
  type OrchestratorEffect,
  type OrchestratorResult,
  type OrchestratorState,
} from "./orchestrator.js";

const getEffect = <T extends OrchestratorEffect["type"]>(
  effects: OrchestratorEffect[],
  type: T,
): Extract<OrchestratorEffect, { type: T }> | undefined =>
  effects.find((effect) => effect.type === type) as
    | Extract<OrchestratorEffect, { type: T }>
    | undefined;

describe("orchestrator", () => {
  it("creates initial snapshots", () => {
    const state = createInitialState(0);

    expect(createKioskSnapshot(state)).toEqual(initialKioskSnapshot);
    expect(createStaffSnapshot(state, 0)).toEqual(initialStaffSnapshot);
  });

  it("handles PTT flow in room", () => {
    const initial = createInitialState(0);
    const pttDown = reduceOrchestrator(initial, { type: "STAFF_PTT_DOWN" }, 100);

    expect(pttDown.next_state.phase).toBe("listening");
    expect(pttDown.effects).toEqual([{ type: "KIOSK_RECORD_START" }]);

    const pttUp = reduceOrchestrator(pttDown.next_state, { type: "STAFF_PTT_UP" }, 200);
    const sttEffect = getEffect(pttUp.effects, "CALL_STT");

    expect(pttUp.next_state.phase).toBe("waiting_stt");
    expect(sttEffect?.request_id).toBe("stt-1");

    const sttResult = reduceOrchestrator(
      pttUp.next_state,
      { type: "STT_RESULT", text: "こんにちは", request_id: sttEffect?.request_id ?? "" },
      210,
    );
    const chatEffect = getEffect(sttResult.effects, "CALL_CHAT");

    expect(sttResult.next_state.phase).toBe("waiting_chat");
    expect(chatEffect?.request_id).toBe("chat-2");
    expect(chatEffect?.input.text).toBe("こんにちは");

    const chatResult = reduceOrchestrator(
      sttResult.next_state,
      {
        type: "CHAT_RESULT",
        assistant_text: "やあ",
        request_id: chatEffect?.request_id ?? "",
        expression: "neutral",
        tool_calls: [],
      },
      220,
    );

    expect(chatResult.next_state.phase).toBe("idle");
    expect(chatResult.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "neutral" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-2" },
      { type: "SAY", text: "やあ", chat_request_id: "chat-2" },
    ]);
  });

  it("does not emit record_start on repeated STAFF_PTT_DOWN while listening", () => {
    const initial = createInitialState(0);
    const staffDown = reduceOrchestrator(initial, { type: "STAFF_PTT_DOWN" }, 100);
    expect(staffDown.next_state.phase).toBe("listening");

    const staffDownAgain = reduceOrchestrator(
      staffDown.next_state,
      { type: "STAFF_PTT_DOWN" },
      110,
    );
    expect(staffDownAgain.next_state.phase).toBe("listening");
    expect(staffDownAgain.effects).toEqual([]);
  });

  it("finalizes session after 5 min idle and requests session_summary once", () => {
    const initial = createInitialState(0);

    const pttDown = reduceOrchestrator(initial, { type: "STAFF_PTT_DOWN" }, 10);
    const pttUp = reduceOrchestrator(pttDown.next_state, { type: "STAFF_PTT_UP" }, 20);
    const sttEffect = getEffect(pttUp.effects, "CALL_STT");
    expect(sttEffect?.request_id).toBe("stt-1");

    const sttResult = reduceOrchestrator(
      pttUp.next_state,
      { type: "STT_RESULT", text: "こんにちは", request_id: "stt-1" },
      30,
    );
    const chatEffect = getEffect(sttResult.effects, "CALL_CHAT");
    expect(chatEffect?.request_id).toBe("chat-2");

    const chatResult = reduceOrchestrator(
      sttResult.next_state,
      {
        type: "CHAT_RESULT",
        assistant_text: "やあ",
        request_id: "chat-2",
        expression: "neutral",
        tool_calls: [],
      },
      40,
    );
    expect(chatResult.next_state.phase).toBe("idle");

    const tick1 = reduceOrchestrator(chatResult.next_state, { type: "TICK" }, 300_041);
    const summaryEffect = getEffect(tick1.effects, "CALL_INNER_TASK");

    expect(summaryEffect?.task).toBe("session_summary");
    if (!summaryEffect || summaryEffect.task !== "session_summary") {
      throw new Error("missing_session_summary_effect");
    }
    expect(summaryEffect.input.messages).toEqual([
      { role: "user", text: "こんにちは" },
      { role: "assistant", text: "やあ" },
    ]);

    const tick2 = reduceOrchestrator(tick1.next_state, { type: "TICK" }, 300_042);
    expect(getEffect(tick2.effects, "CALL_INNER_TASK")).toBeUndefined();
  });

  it("handles PTT flow in room from kiosk events", () => {
    const initial = createInitialState(0);
    const pttDown = reduceOrchestrator(initial, { type: "KIOSK_PTT_DOWN" }, 100);

    expect(pttDown.next_state.phase).toBe("listening");
    expect(pttDown.effects).toEqual([{ type: "KIOSK_RECORD_START" }]);

    const pttUp = reduceOrchestrator(pttDown.next_state, { type: "KIOSK_PTT_UP" }, 200);
    const sttEffect = getEffect(pttUp.effects, "CALL_STT");

    expect(pttUp.next_state.phase).toBe("waiting_stt");
    expect(sttEffect?.request_id).toBe("stt-1");
  });

  it("ignores KIOSK_PTT_UP when not listening", () => {
    const initial = createInitialState(0);
    const result = reduceOrchestrator(initial, { type: "KIOSK_PTT_UP" }, 100);

    expect(result.next_state).toEqual(initial);
    expect(result.effects).toEqual([]);
  });

  it("does not stop listening when KIOSK releases while STAFF is still holding", () => {
    const initial = createInitialState(0);

    const staffDown = reduceOrchestrator(initial, { type: "STAFF_PTT_DOWN" }, 100);
    const kioskDown = reduceOrchestrator(staffDown.next_state, { type: "KIOSK_PTT_DOWN" }, 110);
    const kioskUp = reduceOrchestrator(kioskDown.next_state, { type: "KIOSK_PTT_UP" }, 120);

    expect(kioskUp.next_state.phase).toBe("listening");
    expect(kioskUp.effects).toEqual([]);
  });

  it("does not stop listening until both STAFF/KIOSK PTT are released", () => {
    const initial = createInitialState(0);

    const staffDown = reduceOrchestrator(initial, { type: "STAFF_PTT_DOWN" }, 100);
    expect(staffDown.next_state.phase).toBe("listening");
    expect(staffDown.effects).toEqual([{ type: "KIOSK_RECORD_START" }]);

    const kioskDown = reduceOrchestrator(staffDown.next_state, { type: "KIOSK_PTT_DOWN" }, 110);
    expect(kioskDown.next_state.phase).toBe("listening");
    expect(kioskDown.effects).toEqual([]);

    const staffUp = reduceOrchestrator(kioskDown.next_state, { type: "STAFF_PTT_UP" }, 120);
    expect(staffUp.next_state.phase).toBe("listening");
    expect(staffUp.effects).toEqual([]);

    const kioskUp = reduceOrchestrator(staffUp.next_state, { type: "KIOSK_PTT_UP" }, 130);
    const sttEffect = getEffect(kioskUp.effects, "CALL_STT");

    expect(kioskUp.next_state.phase).toBe("waiting_stt");
    expect(sttEffect?.request_id).toBe("stt-1");
  });

  it("ignores KIOSK_PTT_DOWN while waiting for STT", () => {
    const base = createInitialState(0);
    const waiting: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
      request_seq: 1,
    };

    const result = reduceOrchestrator(waiting, { type: "KIOSK_PTT_DOWN" }, 100);
    expect(result.next_state).toEqual(waiting);
    expect(result.effects).toEqual([]);
  });

  it("emits kiosk tool_calls effect from CHAT_RESULT", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const result = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "ok",
        request_id: "chat-1",
        expression: "neutral",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
      1000,
    );

    expect(result.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "neutral" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      {
        type: "KIOSK_TOOL_CALLS",
        tool_calls: [{ id: "call-1", function: { name: "get_weather" } }],
      },
      { type: "SAY", text: "ok", chat_request_id: "chat-1" },
    ]);
  });

  it("starts thinking motion while waiting_chat", () => {
    const base = createInitialState(0);
    const waitingStt: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
      request_seq: 1,
    };

    const result = reduceOrchestrator(
      waitingStt,
      { type: "STT_RESULT", text: "こんにちは", request_id: "stt-1" },
      1000,
    );

    expect(result.next_state.phase).toBe("waiting_chat");
    expect(getEffect(result.effects, "PLAY_MOTION")).toEqual({
      type: "PLAY_MOTION",
      motion_id: "thinking",
      motion_instance_id: "motion-chat-2-thinking",
    });
    expect(getEffect(result.effects, "CALL_CHAT")?.request_id).toBe("chat-2");
  });

  it("emits PLAY_MOTION effect from CHAT_RESULT when motion_id is allowlisted", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const result = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "やったー",
        request_id: "chat-1",
        expression: "happy",
        motion_id: "cheer",
        tool_calls: [],
      },
      1000,
    );

    expect(result.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "happy" },
      { type: "PLAY_MOTION", motion_id: "cheer", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "やったー", chat_request_id: "chat-1" },
    ]);
  });

  it("falls back to idle motion on CHAT_RESULT without motion_id", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const result = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "了解",
        request_id: "chat-1",
        expression: "neutral",
        tool_calls: [],
      },
      1000,
    );

    expect(result.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "neutral" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "了解", chat_request_id: "chat-1" },
    ]);
  });

  it("falls back to idle motion when CHAT_RESULT motion_id is invalid", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const result = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "ok",
        request_id: "chat-1",
        expression: "neutral",
        motion_id: "toString",
        tool_calls: [],
      },
      1000,
    );

    expect(result.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "neutral" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "ok", chat_request_id: "chat-1" },
    ]);
  });

  it("does not allow thinking motion on CHAT_RESULT", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const result = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "ok",
        request_id: "chat-1",
        expression: "neutral",
        motion_id: "thinking",
        tool_calls: [],
      },
      1000,
    );

    expect(result.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "neutral" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "ok", chat_request_id: "chat-1" },
    ]);
  });

  it("does not switch to personal mode with command", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "STT_RESULT", text: "パーソナル、たろう", request_id: "stt-1" },
      1000,
    );

    const chatEffect = getEffect(result.effects, "CALL_CHAT");

    expect(result.next_state.mode).toBe("ROOM");
    expect(result.next_state.personal_name).toBeNull();
    expect(result.next_state.phase).toBe("waiting_chat");
    expect(chatEffect?.input.text).toBe("パーソナル、たろう");
  });

  it("treats room command as normal utterance", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "STT_RESULT", text: "ルーム", request_id: "stt-1" },
      6000,
    );

    const chatEffect = getEffect(result.effects, "CALL_CHAT");
    expect(result.next_state.phase).toBe("waiting_chat");
    expect(chatEffect?.input.text).toBe("ルーム");
    expect(getEffect(result.effects, "SET_MODE")).toBeUndefined();
    expect(getEffect(result.effects, "SHOW_CONSENT_UI")).toBeUndefined();
  });

  it("runs consent flow via inner task and UI yes", () => {
    const base = createInitialState(0);
    const waitingChat: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_chat",
      request_seq: 1,
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const chatResult = reduceOrchestrator(
      waitingChat,
      {
        type: "CHAT_RESULT",
        assistant_text: "いいね",
        request_id: "chat-1",
        expression: "neutral",
        tool_calls: [],
      },
      1000,
    );
    const memoryEffect = getEffect(chatResult.effects, "CALL_INNER_TASK");

    expect(chatResult.next_state.phase).toBe("waiting_inner_task");
    expect(memoryEffect?.task).toBe("memory_extract");

    const memoryResult = reduceOrchestrator(
      chatResult.next_state,
      {
        type: "INNER_TASK_RESULT",
        request_id: memoryEffect?.request_id ?? "",
        json_text:
          '{"task":"memory_extract","candidate":{"kind":"likes","value":"ぶどう","source_quote":"ぶどうがすき"}}',
      },
      2000,
    );

    expect(memoryResult.next_state.phase).toBe("asking_consent");
    expect(memoryResult.effects).toEqual([
      { type: "SAY", text: "覚えていい？" },
      { type: "SHOW_CONSENT_UI", visible: true },
    ]);

    const consentResult = reduceOrchestrator(
      memoryResult.next_state,
      { type: "UI_CONSENT_BUTTON", answer: "yes" },
      2500,
    );

    expect(consentResult.next_state.memory_candidate).toBeNull();
    expect(consentResult.next_state.consent_deadline_at_ms).toBeNull();
    expect(consentResult.effects).toEqual([
      {
        type: "STORE_WRITE_PENDING",
        input: {
          personal_name: "たろう",
          kind: "likes",
          value: "ぶどう",
          source_quote: "ぶどうがすき",
        },
      },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("runs consent flow via STT and handles unknown", () => {
    const base = createInitialState(0);
    const asking: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "asking_consent",
      consent_deadline_at_ms: 4000,
      memory_candidate: { kind: "food", value: "カレー" },
      request_seq: 2,
    };

    const pttDown = reduceOrchestrator(asking, { type: "STAFF_PTT_DOWN" }, 100);
    const pttUp = reduceOrchestrator(pttDown.next_state, { type: "STAFF_PTT_UP" }, 200);
    const sttEffect = getEffect(pttUp.effects, "CALL_STT");

    const sttResult = reduceOrchestrator(
      pttUp.next_state,
      { type: "STT_RESULT", text: "えっと", request_id: sttEffect?.request_id ?? "" },
      300,
    );
    const innerEffect = getEffect(sttResult.effects, "CALL_INNER_TASK");

    expect(innerEffect?.task).toBe("consent_decision");

    const unknownResult = reduceOrchestrator(
      sttResult.next_state,
      {
        type: "INNER_TASK_RESULT",
        request_id: innerEffect?.request_id ?? "",
        json_text: "{}",
      },
      400,
    );

    expect(unknownResult.next_state.phase).toBe("asking_consent");
    expect(unknownResult.effects).toEqual([]);

    const yesResult = reduceOrchestrator(
      sttResult.next_state,
      {
        type: "INNER_TASK_RESULT",
        request_id: innerEffect?.request_id ?? "",
        json_text: '{"task":"consent_decision","answer":"yes"}',
      },
      500,
    );

    expect(yesResult.effects).toEqual([
      {
        type: "STORE_WRITE_PENDING",
        input: {
          personal_name: "たろう",
          kind: "food",
          value: "カレー",
        },
      },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("ignores UI consent button while listening from consent PTT", () => {
    const base = createInitialState(0);
    const asking: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "asking_consent",
      consent_deadline_at_ms: 4000,
      memory_candidate: { kind: "food", value: "カレー" },
    };

    const pttDown = reduceOrchestrator(asking, { type: "STAFF_PTT_DOWN" }, 100);
    expect(pttDown.next_state.phase).toBe("listening");

    const consentButton = reduceOrchestrator(
      pttDown.next_state,
      { type: "UI_CONSENT_BUTTON", answer: "yes" },
      110,
    );
    expect(consentButton.next_state).toEqual(pttDown.next_state);
    expect(consentButton.effects).toEqual([]);

    const pttUp = reduceOrchestrator(consentButton.next_state, { type: "STAFF_PTT_UP" }, 120);
    const sttEffect = getEffect(pttUp.effects, "CALL_STT");
    expect(pttUp.next_state.phase).toBe("waiting_stt");
    expect(sttEffect?.request_id).toBe("stt-1");
  });

  it("accepts UI consent button while waiting inner consent decision", () => {
    const base = createInitialState(0);
    const waitingInner: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_inner_task",
      consent_deadline_at_ms: 4000,
      memory_candidate: { kind: "food", value: "カレー" },
      in_flight: { ...base.in_flight, consent_inner_task_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      waitingInner,
      { type: "UI_CONSENT_BUTTON", answer: "yes" },
      100,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.memory_candidate).toBeNull();
    expect(result.next_state.consent_deadline_at_ms).toBeNull();
    expect(result.next_state.in_flight.consent_inner_task_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_PENDING",
        input: {
          personal_name: "たろう",
          kind: "food",
          value: "カレー",
        },
      },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("times out consent after 30s", () => {
    const base = createInitialState(0);
    const asking: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "asking_consent",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "play", value: "サッカー" },
    };

    const result = reduceOrchestrator(asking, { type: "TICK" }, 1000);

    expect(result.next_state.memory_candidate).toBeNull();
    expect(result.effects).toEqual([
      { type: "SAY", text: "さっきのことは忘れるね" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("does not timeout consent while listening", () => {
    const base = createInitialState(0);
    const listening: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "listening",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "play", value: "サッカー" },
      is_staff_ptt_held: true,
    };

    const result = reduceOrchestrator(listening, { type: "TICK" }, 1000);

    expect(result.next_state).toEqual(listening);
    expect(result.effects).toEqual([]);
  });

  it("times out consent while waiting inner consent decision", () => {
    const base = createInitialState(0);
    const waitingInner: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_inner_task",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "play", value: "サッカー" },
      in_flight: { ...base.in_flight, consent_inner_task_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(waitingInner, { type: "TICK" }, 1000);

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.memory_candidate).toBeNull();
    expect(result.next_state.consent_deadline_at_ms).toBeNull();
    expect(result.effects).toEqual([
      { type: "SAY", text: "さっきのことは忘れるね" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("uses consent_timeout_ms from config when entering asking_consent", () => {
    const base = createInitialState(0);
    const waiting: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_inner_task",
      in_flight: { ...base.in_flight, memory_extract_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      waiting,
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"memory_extract","candidate":{"kind":"food","value":"カレー"}}',
      },
      1000,
      { consent_timeout_ms: 123, inactivity_timeout_ms: 999_999 },
    );

    expect(result.next_state.phase).toBe("asking_consent");
    expect(result.next_state.consent_deadline_at_ms).toBe(1123);
  });

  it("requests session_summary after inactivity", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      last_action_at_ms: 0,
      phase: "idle",
      session_buffer: { running_summary: "", messages: [{ role: "user", text: "hi" }] },
    };

    const result = reduceOrchestrator(state, { type: "TICK" }, 300000);

    const summaryEffect = getEffect(result.effects, "CALL_INNER_TASK");
    expect(summaryEffect?.request_id).toBe("inner-1");
    expect(summaryEffect?.task).toBe("session_summary");
    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBe("inner-1");
  });

  it("allows PTT while session_summary inner task is in-flight", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      last_action_at_ms: 0,
      phase: "idle",
      session_buffer: { running_summary: "", messages: [{ role: "user", text: "hi" }] },
    };

    const requested = reduceOrchestrator(state, { type: "TICK" }, 300000);
    expect(requested.next_state.phase).toBe("idle");
    expect(requested.next_state.in_flight.session_summary_request_id).toBe("inner-1");

    const ptt = reduceOrchestrator(requested.next_state, { type: "STAFF_PTT_DOWN" }, 300001);
    expect(ptt.next_state.phase).toBe("listening");
    expect(ptt.effects).toEqual([{ type: "KIOSK_RECORD_START" }]);
  });

  it("uses inactivity_timeout_ms from config", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      last_action_at_ms: 0,
      phase: "idle",
      session_buffer: { running_summary: "", messages: [{ role: "user", text: "hi" }] },
    };

    const noReturn = reduceOrchestrator(state, { type: "TICK" }, 10, {
      consent_timeout_ms: 30_000,
      inactivity_timeout_ms: 11,
    });
    expect(getEffect(noReturn.effects, "CALL_INNER_TASK")).toBeUndefined();

    const returns = reduceOrchestrator(state, { type: "TICK" }, 10, {
      consent_timeout_ms: 30_000,
      inactivity_timeout_ms: 10,
    });
    expect(getEffect(returns.effects, "CALL_INNER_TASK")?.task).toBe("session_summary");
  });

  it("includes running_summary ahead of recent messages in session_summary input", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      last_action_at_ms: 0,
      phase: "idle",
      session_buffer: {
        running_summary: "U:aaa | A:bbb",
        messages: [{ role: "user", text: "hi" }],
      },
    };

    const result = reduceOrchestrator(state, { type: "TICK" }, 300000);
    const summaryEffect = getEffect(result.effects, "CALL_INNER_TASK");
    expect(summaryEffect?.task).toBe("session_summary");
    if (!summaryEffect || summaryEffect.task !== "session_summary") {
      throw new Error("missing_session_summary_effect");
    }
    expect(summaryEffect.input.messages[0]).toEqual({
      role: "assistant",
      text: expect.stringMatching(/^\(summary\) /),
    });
    expect(summaryEffect.input.messages[1]).toEqual({ role: "user", text: "hi" });
  });

  it("stores session_summary as pending when inner task returns", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "listening",
      is_staff_ptt_held: true,
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "要約",
      summary_json: {
        summary: "会話の要点を短くまとめました。",
        topics: [],
        staff_notes: [],
      },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("listening");
    expect(result.next_state.is_staff_ptt_held).toBe(true);
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: {
            summary: "会話の要点を短くまとめました。",
            topics: [],
            staff_notes: [],
          },
        },
      },
    ]);

    const pttUp = reduceOrchestrator(result.next_state, { type: "STAFF_PTT_UP" }, 1235);
    expect(pttUp.next_state.phase).toBe("waiting_stt");
    expect(getEffect(pttUp.effects, "CALL_STT")?.request_id).toBe("stt-1");
  });

  it("stores fallback session_summary pending when inner task result is invalid", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text: "{nope" },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when title is blank", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "   ",
      summary_json: { summary: "x", topics: [], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when task is not session_summary", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({ task: "memory_extract", candidate: null });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when parsed json is not an object", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text: "[]" },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when task is not session_summary but keys exist", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "something_else",
      title: "t",
      summary_json: { summary: "ok", topics: [], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when summary_json is null", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({ task: "session_summary", title: "t", summary_json: null });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when title is not a string", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: 123,
      summary_json: { summary: "ok", topics: [], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when summary_json is missing keys", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "t",
      summary_json: { summary: "ok", topics: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when staff_notes is not string[]", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "t",
      summary_json: { summary: "ok", topics: [], staff_notes: [1] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when summary is not a string", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "t",
      summary_json: { summary: 1, topics: [], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when topics is not string[]", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "t",
      summary_json: { summary: "ok", topics: [1], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when summary normalizes to empty", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "idle",
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const json_text = JSON.stringify({
      task: "session_summary",
      title: "t",
      summary_json: { summary: "   ", topics: [], staff_notes: [] },
    });
    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text },
      1234,
    );

    expect(result.next_state.phase).toBe("idle");
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);
  });

  it("stores fallback session_summary pending when inner task fails", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      phase: "listening",
      is_kiosk_ptt_held: true,
      in_flight: { ...base.in_flight, session_summary_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "INNER_TASK_FAILED", request_id: "inner-1" },
      1234,
    );

    expect(result.next_state.phase).toBe("listening");
    expect(result.next_state.is_kiosk_ptt_held).toBe(true);
    expect(result.next_state.in_flight.session_summary_request_id).toBeNull();
    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "要約",
          summary_json: { summary: "要約を生成できませんでした。", topics: [], staff_notes: [] },
        },
      },
    ]);

    const pttUp = reduceOrchestrator(result.next_state, { type: "KIOSK_PTT_UP" }, 1235);
    expect(pttUp.next_state.phase).toBe("waiting_stt");
    expect(getEffect(pttUp.effects, "CALL_STT")?.request_id).toBe("stt-1");
  });

  it("ignores request_id mismatches", () => {
    const base = createInitialState(0);
    const waiting: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const result = reduceOrchestrator(
      waiting,
      { type: "STT_RESULT", text: "やあ", request_id: "stt-99" },
      10,
    );

    expect(result.next_state).toEqual(waiting);
    expect(result.effects).toEqual([]);
  });

  it("handles emergency stop and resume", () => {
    const base = createInitialState(0);
    const listening: OrchestratorState = { ...base, phase: "listening" };

    const stopped = reduceOrchestrator(listening, { type: "STAFF_EMERGENCY_STOP" }, 50);

    expect(stopped.next_state.is_emergency_stopped).toBe(true);
    expect(stopped.effects[0]).toEqual({ type: "KIOSK_RECORD_STOP" });
    expect(getEffect(stopped.effects, "PLAY_MOTION")).toEqual({
      type: "PLAY_MOTION",
      motion_id: "idle",
      motion_instance_id: "motion-emergency-stop",
    });

    const ignored = reduceOrchestrator(stopped.next_state, { type: "STAFF_PTT_DOWN" }, 60);

    expect(ignored.next_state).toEqual(stopped.next_state);
    expect(ignored.effects).toEqual([]);

    const resumed = reduceOrchestrator(stopped.next_state, { type: "STAFF_RESUME" }, 70);

    expect(resumed.next_state.is_emergency_stopped).toBe(false);
    expect(resumed.effects).toEqual([
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("uses fallback on STT/CHAT failures", () => {
    const base = createInitialState(0);
    const waitingStt: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const sttFailed = reduceOrchestrator(
      waitingStt,
      { type: "STT_FAILED", request_id: "stt-1" },
      20,
    );

    expect(sttFailed.effects).toEqual([{ type: "SAY", text: "ごめんね、もう一回言ってね" }]);

    const waitingChat: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const chatFailed = reduceOrchestrator(
      waitingChat,
      { type: "CHAT_FAILED", request_id: "chat-1" },
      30,
    );

    expect(chatFailed.effects).toEqual([
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "ごめんね、もう一回言ってね", chat_request_id: "chat-1" },
    ]);
  });

  it("handles inner task failure and invalid payloads", () => {
    const base = createInitialState(0);
    const waitingInner: OrchestratorState = {
      ...base,
      phase: "waiting_inner_task",
      in_flight: { ...base.in_flight, memory_extract_request_id: "inner-1" },
    };

    const invalid = reduceOrchestrator(
      waitingInner,
      { type: "INNER_TASK_RESULT", request_id: "inner-1", json_text: "{}" },
      10,
    );

    expect(invalid.next_state.phase).toBe("idle");
    expect(invalid.effects).toEqual([]);

    const consentWaiting: OrchestratorState = {
      ...base,
      phase: "waiting_inner_task",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "hobby", value: "ぬりえ" },
      in_flight: { ...base.in_flight, consent_inner_task_request_id: "inner-2" },
    };

    const failed = reduceOrchestrator(
      consentWaiting,
      { type: "INNER_TASK_FAILED", request_id: "inner-2" },
      20,
    );

    expect(failed.next_state.phase).toBe("asking_consent");
    expect(failed.effects).toEqual([]);
  });

  it("handles STAFF_FORCE_ROOM and clears state", () => {
    const base = createInitialState(0);
    const personal: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_chat",
      consent_deadline_at_ms: 1234,
      memory_candidate: { kind: "likes", value: "ぶどう" },
      in_flight: {
        ...base.in_flight,
        chat_request_id: "chat-1",
        memory_extract_request_id: "inner-1",
      },
    };

    const forced = reduceOrchestrator(personal, { type: "STAFF_FORCE_ROOM" }, 2000);

    expect(forced.next_state.mode).toBe("ROOM");
    expect(forced.next_state.personal_name).toBeNull();
    expect(forced.next_state.memory_candidate).toBeNull();
    expect(forced.next_state.in_flight.chat_request_id).toBeNull();
    expect(forced.effects).toEqual([
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-force-room" },
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("handles emergency stop when not listening (no record stop effect)", () => {
    const base = createInitialState(0);

    const stopped = reduceOrchestrator(base, { type: "STAFF_EMERGENCY_STOP" }, 10);

    expect(stopped.next_state.is_emergency_stopped).toBe(true);
    expect(stopped.effects).toEqual([
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-emergency-stop" },
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("ignores PTT events when not in an allowed phase", () => {
    const base = createInitialState(0);
    const busy: OrchestratorState = { ...base, phase: "waiting_stt" };

    expect(reduceOrchestrator(busy, { type: "STAFF_PTT_DOWN" }, 10)).toEqual({
      next_state: busy,
      effects: [],
    });

    expect(reduceOrchestrator(base, { type: "STAFF_PTT_UP" }, 20)).toEqual({
      next_state: base,
      effects: [],
    });
  });

  it("keeps asking consent on STT failure during consent flow", () => {
    const base = createInitialState(0);
    const asking: OrchestratorState = {
      ...base,
      phase: "waiting_stt",
      consent_deadline_at_ms: 9999,
      memory_candidate: { kind: "food", value: "カレー" },
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const failed = reduceOrchestrator(asking, { type: "STT_FAILED", request_id: "stt-1" }, 10);
    expect(failed.next_state.phase).toBe("asking_consent");
    expect(failed.effects).toEqual([{ type: "SAY", text: "ごめんね、もう一回言ってね" }]);
  });

  it("ignores mismatched STT/CHAT failure ids", () => {
    const base = createInitialState(0);

    expect(
      reduceOrchestrator(
        {
          ...base,
          phase: "waiting_stt",
          in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
        },
        { type: "STT_FAILED", request_id: "stt-2" },
        0,
      ).effects,
    ).toEqual([]);

    expect(
      reduceOrchestrator(
        {
          ...base,
          phase: "waiting_chat",
          in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
        },
        { type: "CHAT_FAILED", request_id: "chat-2" },
        0,
      ).effects,
    ).toEqual([]);
  });

  it("handles CHAT_RESULT in ROOM and ignores mismatched ids", () => {
    const base = createInitialState(0);
    const waitingRoom: OrchestratorState = {
      ...base,
      phase: "waiting_chat",
      in_flight: { ...base.in_flight, chat_request_id: "chat-1" },
    };

    const ignored = reduceOrchestrator(
      waitingRoom,
      {
        type: "CHAT_RESULT",
        assistant_text: "ignored",
        request_id: "chat-2",
        expression: "neutral",
        tool_calls: [],
      },
      10,
    );
    expect(ignored.effects).toEqual([]);
    expect(ignored.next_state).toEqual(waitingRoom);

    const ok = reduceOrchestrator(
      waitingRoom,
      {
        type: "CHAT_RESULT",
        assistant_text: "ok",
        request_id: "chat-1",
        expression: "happy",
        tool_calls: [],
      },
      20,
    );
    expect(getEffect(ok.effects, "CALL_INNER_TASK")).toBeUndefined();
    expect(ok.effects).toEqual([
      { type: "SET_EXPRESSION", expression: "happy" },
      { type: "PLAY_MOTION", motion_id: "idle", motion_instance_id: "motion-chat-1" },
      { type: "SAY", text: "ok", chat_request_id: "chat-1" },
    ]);
    expect(ok.next_state.phase).toBe("idle");
  });

  it("handles consent decision: no / explicit unknown / invalid json", () => {
    const base = createInitialState(0);
    const waitingConsent: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_inner_task",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "hobby", value: "ぬりえ" },
      in_flight: { ...base.in_flight, consent_inner_task_request_id: "inner-1" },
    };

    const noResult = reduceOrchestrator(
      waitingConsent,
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"consent_decision","answer":"no"}',
      },
      10,
    );
    expect(noResult.effects).toEqual([{ type: "SHOW_CONSENT_UI", visible: false }]);

    const unknownResult = reduceOrchestrator(
      {
        ...waitingConsent,
        in_flight: { ...waitingConsent.in_flight, consent_inner_task_request_id: "inner-2" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-2",
        json_text: '{"task":"consent_decision","answer":"unknown"}',
      },
      20,
    );
    expect(unknownResult.next_state.phase).toBe("asking_consent");
    expect(unknownResult.effects).toEqual([]);

    const invalidAnswer = reduceOrchestrator(
      {
        ...waitingConsent,
        in_flight: { ...waitingConsent.in_flight, consent_inner_task_request_id: "inner-2b" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-2b",
        json_text: '{"task":"consent_decision","answer":"maybe"}',
      },
      25,
    );
    expect(invalidAnswer.next_state.phase).toBe("asking_consent");
    expect(invalidAnswer.effects).toEqual([]);

    const invalidJson = reduceOrchestrator(
      {
        ...waitingConsent,
        in_flight: { ...waitingConsent.in_flight, consent_inner_task_request_id: "inner-3" },
      },
      { type: "INNER_TASK_RESULT", request_id: "inner-3", json_text: "not json" },
      30,
    );
    expect(invalidJson.next_state.phase).toBe("asking_consent");
    expect(invalidJson.effects).toEqual([]);
  });

  it("includes source_quote when storing via inner task consent decision", () => {
    const base = createInitialState(0);
    const waitingConsent: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_inner_task",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "likes", value: "ぶどう", source_quote: "ぶどう" },
      in_flight: { ...base.in_flight, consent_inner_task_request_id: "inner-1" },
    };

    const result = reduceOrchestrator(
      waitingConsent,
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"consent_decision","answer":"yes"}',
      },
      10,
    );

    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_PENDING",
        input: {
          personal_name: "たろう",
          kind: "likes",
          value: "ぶどう",
          source_quote: "ぶどう",
        },
      },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("handles memory_extract variants (null/invalid/without source_quote) and failures", () => {
    const base = createInitialState(0);
    const waitingInnerBase: OrchestratorState = {
      ...base,
      phase: "waiting_inner_task",
      mode: "PERSONAL",
      personal_name: "たろう",
    };

    const nullCandidate = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-1" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"memory_extract","candidate":null}',
      },
      10,
    );
    expect(nullCandidate.effects).toEqual([]);

    const invalidKind = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-2" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-2",
        json_text: '{"task":"memory_extract","candidate":{"kind":"secret","value":"x"}}',
      },
      20,
    );
    expect(invalidKind.effects).toEqual([]);

    const invalidJson = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-3" },
      },
      { type: "INNER_TASK_RESULT", request_id: "inner-3", json_text: "not json" },
      30,
    );
    expect(invalidJson.effects).toEqual([]);

    const wrongSourceType = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-4" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-4",
        json_text:
          '{"task":"memory_extract","candidate":{"kind":"likes","value":"x","source_quote":1}}',
      },
      40,
    );
    expect(wrongSourceType.effects).toEqual([]);

    const emptyValue = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-4b" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-4b",
        json_text: '{"task":"memory_extract","candidate":{"kind":"likes","value":""}}',
      },
      45,
    );
    expect(emptyValue.effects).toEqual([]);

    const okNoSource = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-5" },
      },
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-5",
        json_text: '{"task":"memory_extract","candidate":{"kind":"likes","value":"x"}}',
      },
      50,
    );
    expect(okNoSource.effects).toEqual([
      { type: "SAY", text: "覚えていい？" },
      { type: "SHOW_CONSENT_UI", visible: true },
    ]);

    const extractFailed = reduceOrchestrator(
      {
        ...waitingInnerBase,
        in_flight: { ...base.in_flight, memory_extract_request_id: "inner-6" },
      },
      { type: "INNER_TASK_FAILED", request_id: "inner-6" },
      60,
    );
    expect(extractFailed.effects).toEqual([]);
  });

  it("covers UI_CONSENT_BUTTON no/early-return and TICK no-op", () => {
    const base = createInitialState(0);
    const early = reduceOrchestrator(base, { type: "UI_CONSENT_BUTTON", answer: "no" }, 0);
    expect(early.effects).toEqual([]);

    const asking: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "asking_consent",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "likes", value: "りんご" },
    };
    const noResult = reduceOrchestrator(asking, { type: "UI_CONSENT_BUTTON", answer: "no" }, 10);
    expect(noResult.effects).toEqual([{ type: "SHOW_CONSENT_UI", visible: false }]);

    const tickEvent: OrchestratorEvent = { type: "TICK" };
    const tickNoop: OrchestratorResult = reduceOrchestrator(base, tickEvent, 10);
    expect(tickNoop.effects).toEqual([]);

    const dummyInnerTaskInput: InnerTaskInput = {
      task: "memory_extract",
      input: { assistant_text: "" },
    };
    expect(dummyInnerTaskInput.input.assistant_text).toBe("");
  });

  it("covers UI_CONSENT_BUTTON yes without source_quote", () => {
    const base = createInitialState(0);
    const asking: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "asking_consent",
      consent_deadline_at_ms: 1000,
      memory_candidate: { kind: "likes", value: "りんご" },
    };

    const result = reduceOrchestrator(asking, { type: "UI_CONSENT_BUTTON", answer: "yes" }, 10);

    expect(result.effects).toEqual([
      {
        type: "STORE_WRITE_PENDING",
        input: { personal_name: "たろう", kind: "likes", value: "りんご" },
      },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("ignores inner task results/failures with unknown request id", () => {
    const base = createInitialState(0);

    const result = reduceOrchestrator(
      base,
      { type: "INNER_TASK_RESULT", request_id: "inner-x", json_text: "{}" },
      0,
    );
    expect(result.effects).toEqual([]);
    expect(result.next_state).toEqual(base);

    const failed = reduceOrchestrator(
      base,
      { type: "INNER_TASK_FAILED", request_id: "inner-y" },
      0,
    );
    expect(failed.effects).toEqual([]);
    expect(failed.next_state).toEqual(base);
  });

  it("treats STAFF_RESUME as no-op when not emergency stopped", () => {
    const base = createInitialState(0);
    const result = reduceOrchestrator(base, { type: "STAFF_RESUME" }, 0);
    expect(result.effects).toEqual([]);
    expect(result.next_state).toEqual(base);
  });

  it("covers default branch with unknown event", () => {
    const base = createInitialState(0);
    const result = reduceOrchestrator(base, { type: "UNKNOWN" } as unknown as never, 0);
    expect(result.effects).toEqual([]);
    expect(result.next_state).toEqual(base);
  });
});
