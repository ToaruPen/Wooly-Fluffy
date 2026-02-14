import { describe, expect, it } from "vitest";
import type { OrchestratorEffect, OrchestratorEvent } from "./orchestrator.js";
import { createEffectExecutor } from "./effect-executor.js";
import type { Providers } from "./providers/types.js";

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
  });

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
        type: "kiosk.command.speak",
        data: { say_id: "say-1", text: "hello" },
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
