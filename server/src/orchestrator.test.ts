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
      { type: "SAY", text: "やあ" },
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
      {
        type: "KIOSK_TOOL_CALLS",
        tool_calls: [{ id: "call-1", function: { name: "get_weather" } }],
      },
      { type: "SAY", text: "ok" },
    ]);
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
      { type: "SAY", text: "やったー" },
    ]);
  });

  it("ignores invalid motion_id in CHAT_RESULT (including prototype keys)", () => {
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
      { type: "SAY", text: "ok" },
    ]);
  });

  it("switches to personal mode with command", () => {
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

    expect(result.next_state.mode).toBe("PERSONAL");
    expect(result.next_state.personal_name).toBe("たろう");
    expect(result.effects).toEqual([
      { type: "SET_MODE", mode: "PERSONAL", personal_name: "たろう" },
    ]);
  });

  it("returns to room on room command and clears consent", () => {
    const base = createInitialState(0);
    const state: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      phase: "waiting_stt",
      consent_deadline_at_ms: 5000,
      memory_candidate: { kind: "likes", value: "りんご" },
      in_flight: { ...base.in_flight, stt_request_id: "stt-1" },
    };

    const result = reduceOrchestrator(
      state,
      { type: "STT_RESULT", text: "ルーム", request_id: "stt-1" },
      6000,
    );

    expect(result.next_state.mode).toBe("ROOM");
    expect(result.next_state.personal_name).toBeNull();
    expect(result.next_state.memory_candidate).toBeNull();
    expect(result.effects).toEqual([
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
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

  it("returns to room after inactivity", () => {
    const base = createInitialState(0);
    const personal: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      last_action_at_ms: 0,
    };

    const result = reduceOrchestrator(personal, { type: "TICK" }, 300000);

    expect(result.next_state.mode).toBe("ROOM");
    expect(result.effects).toEqual([
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("uses inactivity_timeout_ms from config", () => {
    const base = createInitialState(0);
    const personal: OrchestratorState = {
      ...base,
      mode: "PERSONAL",
      personal_name: "たろう",
      last_action_at_ms: 0,
    };

    const noReturn = reduceOrchestrator(personal, { type: "TICK" }, 10, {
      consent_timeout_ms: 30_000,
      inactivity_timeout_ms: 11,
    });
    expect(noReturn.next_state.mode).toBe("PERSONAL");

    const returns = reduceOrchestrator(personal, { type: "TICK" }, 10, {
      consent_timeout_ms: 30_000,
      inactivity_timeout_ms: 10,
    });
    expect(returns.next_state.mode).toBe("ROOM");
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

    expect(chatFailed.effects).toEqual([{ type: "SAY", text: "ごめんね、もう一回言ってね" }]);
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
      { type: "SET_MODE", mode: "ROOM" },
      { type: "SHOW_CONSENT_UI", visible: false },
    ]);
  });

  it("handles emergency stop when not listening (no record stop effect)", () => {
    const base = createInitialState(0);

    const stopped = reduceOrchestrator(base, { type: "STAFF_EMERGENCY_STOP" }, 10);

    expect(stopped.next_state.is_emergency_stopped).toBe(true);
    expect(stopped.effects).toEqual([
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
      { type: "SAY", text: "ok" },
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
