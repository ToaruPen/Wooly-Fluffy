import { describe, expect, it } from "vitest";
import type { OrchestratorEffect, OrchestratorEvent } from "./orchestrator.js";
import { createEffectExecutor as createEffectExecutorBase } from "./effect-executor.js";
import type { Providers } from "./providers/types.js";

type CreateEffectExecutorDeps = Parameters<typeof createEffectExecutorBase>[0];

const createEffectExecutor = (
  deps: Omit<CreateEffectExecutorDeps, "storeWriteSessionSummaryPending"> &
    Partial<Pick<CreateEffectExecutorDeps, "storeWriteSessionSummaryPending">>,
) =>
  createEffectExecutorBase({
    ...deps,
    storeWriteSessionSummaryPending: deps.storeWriteSessionSummaryPending ?? (() => {}),
  });

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createStubProviders = (overrides?: {
  chatCall?: Providers["llm"]["chat"]["call"];
  innerTaskCall?: Providers["llm"]["inner_task"]["call"];
  sttTranscribe?: Providers["stt"]["transcribe"];
}): Providers => ({
  stt: {
    transcribe: overrides?.sttTranscribe ?? (() => ({ text: "dummy" })),
    health: () => ({ status: "ok" }),
  },
  tts: {
    health: () => ({ status: "ok" }),
    synthesize: async (_input) => ({ wav: Buffer.from("dummy") }),
  },
  llm: {
    kind: "stub",
    chat: {
      call:
        overrides?.chatCall ??
        (async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        })),
    },
    inner_task: {
      call: overrides?.innerTaskCall ?? (async () => ({ json_text: "{}" })),
    },
    health: () => ({ status: "ok" }),
  },
});

describe("effect-executor", () => {
  it("sends kiosk record_start/record_stop commands", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => sent.push({ type, data }),
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.executeEffects([{ type: "KIOSK_RECORD_START" }, { type: "KIOSK_RECORD_STOP" }]);

    expect(sent).toEqual([
      { type: "kiosk.command.record_start", data: {} },
      { type: "kiosk.command.record_stop", data: {} },
    ]);
  });

  it("sends kiosk.command.tool_calls", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => sent.push({ type, data }),
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "KIOSK_TOOL_CALLS",
        tool_calls: [{ id: "call-1", function: { name: "get_weather" } }],
      },
    ]);
    expect(events).toEqual([]);
    expect(sent).toEqual([
      {
        type: "kiosk.command.tool_calls",
        data: {
          tool_calls: [{ id: "call-1", function: { name: "get_weather" } }],
        },
      },
    ]);
  });

  it("calls onSttRequested for CALL_STT", () => {
    const providers = createStubProviders();

    const requested: string[] = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: (id) => requested.push(id),
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([{ type: "CALL_STT", request_id: "stt-1" }]);
    expect(events).toEqual([]);
    expect(requested).toEqual(["stt-1"]);
  });

  it("enqueues INNER_TASK_RESULT for CALL_INNER_TASK", async () => {
    const providers = createStubProviders({
      innerTaskCall: async () => ({ json_text: '{"task":"consent_decision"}' }),
    });

    const queued: OrchestratorEvent[] = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => queued.push(event),
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_INNER_TASK",
        request_id: "inner-1",
        task: "consent_decision",
        input: { text: "hi" },
      },
    ]);

    expect(events).toEqual([]);
    await flushMicrotasks();
    expect(queued).toEqual([
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"consent_decision"}',
      },
    ]);
  });

  it("forwards session_summary input for CALL_INNER_TASK", async () => {
    const providers = createStubProviders({
      innerTaskCall: async (input) => {
        expect(input).toEqual({
          task: "session_summary",
          input: {
            messages: [
              { role: "user", text: "hi" },
              { role: "assistant", text: "hello" },
            ],
          },
        });
        return { json_text: "{}" };
      },
    });

    const queued: OrchestratorEvent[] = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => queued.push(event),
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_INNER_TASK",
        request_id: "inner-ss-1",
        task: "session_summary",
        input: {
          messages: [
            { role: "user", text: "hi" },
            { role: "assistant", text: "hello" },
          ],
        },
      },
    ]);

    expect(events).toEqual([]);
    await flushMicrotasks();
    expect(queued).toEqual([
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-ss-1",
        json_text: "{}",
      },
    ]);
  }, 5_000);

  it("enqueues INNER_TASK_FAILED when CALL_INNER_TASK provider throws", async () => {
    const providers = createStubProviders({
      innerTaskCall: async () => {
        throw new Error("boom");
      },
    });

    const queued: OrchestratorEvent[] = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => queued.push(event),
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_INNER_TASK",
        request_id: "inner-9",
        task: "memory_extract",
        input: { assistant_text: "hey" },
      },
    ]);

    expect(events).toEqual([]);
    await flushMicrotasks();
    expect(queued).toEqual([{ type: "INNER_TASK_FAILED", request_id: "inner-9" }]);
  });

  it("returns INNER_TASK_RESULT synchronously when CALL_INNER_TASK provider is sync", () => {
    const providers = createStubProviders({
      innerTaskCall: () => ({ json_text: '{"task":"consent_decision"}' }),
    });

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_INNER_TASK",
        request_id: "inner-1",
        task: "consent_decision",
        input: { text: "hi" },
      },
    ]);

    expect(events).toEqual([
      {
        type: "INNER_TASK_RESULT",
        request_id: "inner-1",
        json_text: '{"task":"consent_decision"}',
      },
    ]);
  });

  it("returns INNER_TASK_FAILED synchronously when CALL_INNER_TASK provider throws sync", () => {
    const providers = createStubProviders({
      innerTaskCall: () => {
        throw new Error("boom");
      },
    });

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_INNER_TASK",
        request_id: "inner-9",
        task: "memory_extract",
        input: { assistant_text: "hey" },
      },
    ]);
    expect(events).toEqual([{ type: "INNER_TASK_FAILED", request_id: "inner-9" }]);
  });

  it("calls storeWritePending for STORE_WRITE_PENDING", () => {
    const providers = createStubProviders();

    const writes: Array<object> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: (input) => {
        writes.push(input);
      },
    });

    executor.executeEffects([
      {
        type: "STORE_WRITE_PENDING",
        input: { personal_name: "taro", kind: "likes", value: "apples" },
      },
    ]);

    expect(writes).toEqual([{ personal_name: "taro", kind: "likes", value: "apples" }]);
  });

  it("throws when STORE_WRITE_PENDING is emitted without legacy handler", () => {
    const providers = createStubProviders();

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
    });

    expect(() => {
      executor.executeEffects([
        {
          type: "STORE_WRITE_PENDING",
          input: { personal_name: "taro", kind: "likes", value: "apples" },
        },
      ]);
    }).toThrow("Legacy STORE_WRITE_PENDING effect is no longer supported");
  });

  it("calls storeWriteSessionSummaryPending for STORE_WRITE_SESSION_SUMMARY_PENDING", () => {
    const providers = createStubProviders();

    const writes: Array<object> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
      storeWriteSessionSummaryPending: (input) => {
        writes.push(input);
      },
    });

    executor.executeEffects([
      {
        type: "STORE_WRITE_SESSION_SUMMARY_PENDING",
        input: {
          title: "t",
          summary_json: { summary: "s", topics: [], staff_notes: [] },
        },
      },
    ]);

    expect(writes).toEqual([
      { title: "t", summary_json: { summary: "s", topics: [], staff_notes: [] } },
    ]);
  });

  it("sends kiosk.command.speak without expression by default", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.executeEffects([{ type: "SAY", text: "hello" }]);

    expect(sent).toEqual([
      {
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "say-1",
          segment_index: 0,
          text: "hello",
          is_last: true,
        },
      },
      {
        type: "kiosk.command.speech.end",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speak",
        data: { say_id: "say-1", text: "hello" },
      },
    ]);
  });

  it("uses provided chat_request_id for speech events", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.executeEffects([{ type: "SAY", text: "hello", chat_request_id: "chat-42" }]);

    expect(sent).toEqual([
      {
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "chat-42" },
      },
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "chat-42",
          segment_index: 0,
          text: "hello",
          is_last: true,
        },
      },
      {
        type: "kiosk.command.speech.end",
        data: { utterance_id: "say-1", chat_request_id: "chat-42" },
      },
      {
        type: "kiosk.command.speak",
        data: { say_id: "say-1", text: "hello" },
      },
    ]);
  });

  it("splits sentence by punctuation and merges short fragments", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.executeEffects([{ type: "SAY", text: "はい。よろしくお願いします。了解！" }]);

    const segments = sent.filter((x) => x.type === "kiosk.command.speech.segment");
    expect(segments).toEqual([
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "say-1",
          segment_index: 0,
          text: "はい。よろしくお願いします。了解！",
          is_last: true,
        },
      },
    ]);
  });

  it("does not emit speech.segment or TTFA metric for blank text", () => {
    const providers = createStubProviders();
    const sent: Array<{ type: string; data: object }> = [];
    const metrics: Array<Record<string, unknown>> = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
      observeSpeechMetric: (metric) => {
        metrics.push(metric as Record<string, unknown>);
      },
    });

    executor.executeEffects([{ type: "SAY", text: "   " }]);

    expect(sent).toEqual([
      {
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speech.end",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speak",
        data: { say_id: "say-1", text: "   " },
      },
    ]);
    expect(metrics).toEqual([]);
  });

  it("records TTFA observation without text payload", () => {
    const providers = createStubProviders();
    const metrics: Array<Record<string, unknown>> = [];
    const sent: Array<{ type: string; data: object }> = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
      now_ms: () => 12_345,
      observeSpeechMetric: (metric) => {
        metrics.push(metric as Record<string, unknown>);
      },
    });

    executor.executeEffects([{ type: "SAY", text: "こんにちは。よろしくね。" }]);

    const segments = sent.filter((x) => x.type === "kiosk.command.speech.segment");
    expect(segments).toEqual([
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "say-1",
          segment_index: 0,
          text: "こんにちは。",
          is_last: false,
        },
      },
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "say-1",
          segment_index: 1,
          text: "よろしくね。",
          is_last: true,
        },
      },
    ]);

    expect(metrics).toEqual([
      {
        type: "speech.ttfa.observation",
        emitted_at_ms: 12_345,
        utterance_id: "say-1",
        chat_request_id: "say-1",
        segment_count: 2,
        first_segment_length: 6,
      },
    ]);
  });

  it("ignores unknown effect types", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.executeEffects([{ type: "NOPE" } as unknown as OrchestratorEffect]);

    expect(sent).toEqual([]);
  });

  it("ignores state-only effects (SET_MODE / SHOW_CONSENT_UI)", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      { type: "SET_MODE", mode: "PERSONAL", personal_name: "taro" },
      { type: "SHOW_CONSENT_UI", visible: true },
    ]);

    expect(events).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("enqueues CHAT_RESULT for CALL_CHAT", async () => {
    const providers = createStubProviders({
      chatCall: async () => ({
        assistant_text: "ok",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      }),
    });

    const queued: OrchestratorEvent[] = [];

    const sent: Array<{ type: string; data: object }> = [];
    const requestedStt: string[] = [];
    const pendingWrites: Array<object> = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: (event) => queued.push(event),
      onSttRequested: (id) => {
        requestedStt.push(id);
      },
      storeWritePending: (input) => {
        pendingWrites.push(input);
      },
    });

    const effects: OrchestratorEffect[] = [
      {
        type: "CALL_CHAT",
        request_id: "chat-1",
        input: { mode: "ROOM", personal_name: null, text: "hi" },
      },
    ];

    const events = executor.executeEffects(effects);
    expect(events).toEqual([]);
    await flushMicrotasks();
    expect(queued).toEqual([
      {
        type: "CHAT_RESULT",
        request_id: "chat-1",
        assistant_text: "ok",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      },
    ]);
    expect(sent).toEqual([]);
    expect(requestedStt).toEqual([]);
    expect(pendingWrites).toEqual([]);
  });

  it("enqueues CHAT_FAILED when CALL_CHAT provider throws", async () => {
    const providers = createStubProviders({
      chatCall: async () => {
        throw new Error("boom");
      },
    });

    const queued: OrchestratorEvent[] = [];

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => queued.push(event),
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const effects: OrchestratorEffect[] = [
      {
        type: "CALL_CHAT",
        request_id: "chat-9",
        input: { mode: "ROOM", personal_name: null, text: "hi" },
      },
    ];

    const events = executor.executeEffects(effects);
    expect(events).toEqual([]);
    await flushMicrotasks();
    expect(queued).toEqual([{ type: "CHAT_FAILED", request_id: "chat-9" }]);
  });

  it("returns CHAT_RESULT synchronously when CALL_CHAT provider is sync", () => {
    const providers = createStubProviders({
      chatCall: () => ({
        assistant_text: "ok",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      }),
    });

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_CHAT",
        request_id: "chat-1",
        input: { mode: "ROOM", personal_name: null, text: "hi" },
      },
    ]);

    expect(events).toEqual([
      {
        type: "CHAT_RESULT",
        request_id: "chat-1",
        assistant_text: "ok",
        expression: "neutral",
        motion_id: null,
        tool_calls: [],
      },
    ]);
  });

  it("returns CHAT_FAILED synchronously when CALL_CHAT provider throws sync", () => {
    const providers = createStubProviders({
      chatCall: () => {
        throw new Error("boom");
      },
    });

    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const events = executor.executeEffects([
      {
        type: "CALL_CHAT",
        request_id: "chat-9",
        input: { mode: "ROOM", personal_name: null, text: "hi" },
      },
    ]);
    expect(events).toEqual([{ type: "CHAT_FAILED", request_id: "chat-9" }]);
  });

  it("adds expression to kiosk.command.speak after SET_EXPRESSION", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const effects = [
      { type: "SET_EXPRESSION" as const, expression: "happy" as const },
      { type: "SAY" as const, text: "hello" },
    ];

    executor.executeEffects(effects);
    expect(sent).toEqual([
      {
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speech.segment",
        data: {
          utterance_id: "say-1",
          chat_request_id: "say-1",
          segment_index: 0,
          text: "hello",
          is_last: true,
        },
      },
      {
        type: "kiosk.command.speech.end",
        data: { utterance_id: "say-1", chat_request_id: "say-1" },
      },
      {
        type: "kiosk.command.speak",
        data: { say_id: "say-1", text: "hello", expression: "happy" },
      },
    ]);
  });

  it("converts PLAY_MOTION into kiosk.command.play_motion", () => {
    const providers = createStubProviders();

    const sent: Array<{ type: string; data: object }> = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: (type, data) => {
        sent.push({ type, data });
      },
      enqueueEvent: () => {},
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    const effects = [
      {
        type: "PLAY_MOTION" as const,
        motion_id: "dance",
        motion_instance_id: "m-1",
      },
    ];

    executor.executeEffects(effects);
    expect(sent).toEqual([
      {
        type: "kiosk.command.play_motion",
        data: { motion_id: "dance", motion_instance_id: "m-1" },
      },
    ]);
  });

  it("converts STT provider result into STT_RESULT", () => {
    const providers = createStubProviders({
      sttTranscribe: () => ({ text: "hi" }),
    });

    const enqueued: unknown[] = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => {
        enqueued.push(event);
      },
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.transcribeStt({
      request_id: "stt-1",
      mode: "ROOM",
      wav: Buffer.from("dummy"),
    });
    expect(enqueued).toEqual([{ type: "STT_RESULT", request_id: "stt-1", text: "hi" }]);
  });

  it("converts STT provider error into STT_FAILED", () => {
    const providers = createStubProviders({
      sttTranscribe: () => {
        throw new Error("boom");
      },
    });

    const enqueued: unknown[] = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => {
        enqueued.push(event);
      },
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.transcribeStt({
      request_id: "stt-9",
      mode: "ROOM",
      wav: Buffer.from("dummy"),
    });
    expect(enqueued).toEqual([{ type: "STT_FAILED", request_id: "stt-9" }]);
  });

  it("enqueues STT_RESULT when provider resolves async", async () => {
    const providers = createStubProviders({
      sttTranscribe: async () => ({ text: "hello" }),
    });

    const enqueued: unknown[] = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => {
        enqueued.push(event);
      },
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.transcribeStt({
      request_id: "stt-2",
      mode: "ROOM",
      wav: Buffer.from("dummy"),
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(enqueued).toEqual([{ type: "STT_RESULT", request_id: "stt-2", text: "hello" }]);
  });

  it("enqueues STT_FAILED when provider rejects async", async () => {
    const providers = createStubProviders({
      sttTranscribe: async () => {
        throw new Error("boom");
      },
    });

    const enqueued: unknown[] = [];
    const executor = createEffectExecutor({
      providers,
      sendKioskCommand: () => {},
      enqueueEvent: (event) => {
        enqueued.push(event);
      },
      onSttRequested: () => {},
      storeWritePending: () => {},
    });

    executor.transcribeStt({
      request_id: "stt-3",
      mode: "ROOM",
      wav: Buffer.from("dummy"),
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(enqueued).toEqual([{ type: "STT_FAILED", request_id: "stt-3" }]);
  });
});
