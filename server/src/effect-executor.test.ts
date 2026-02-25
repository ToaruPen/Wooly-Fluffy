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
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const STREAM_TEST_TIMEOUT_MS = 5_000;

const createStubProviders = (overrides?: {
  chatCall?: Providers["llm"]["chat"]["call"];
  chatStream?: NonNullable<Providers["llm"]["chat"]["stream"]>;
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
      stream: overrides?.chatStream,
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

  it(
    "streams speech segments from chat.stream before CHAT_RESULT",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "こんにちは。よろしくね。",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "こんにちは。" };
          yield { delta_text: "よろしくね。" };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const streamErrors: Array<{ request_id: string; emitted_segment_count: number }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onStreamError: (event) => {
          streamErrors.push({
            request_id: event.request_id,
            emitted_segment_count: event.emitted_segment_count,
          });
        },
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-1",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "chat-stream-1", chat_request_id: "chat-stream-1" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-1",
            chat_request_id: "chat-stream-1",
            segment_index: 0,
            text: "こんにちは。",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-1",
            chat_request_id: "chat-stream-1",
            segment_index: 1,
            text: "よろしくね。",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "chat-stream-1", chat_request_id: "chat-stream-1" },
        },
      ]);
      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-1",
          assistant_text: "こんにちは。よろしくね。",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);

      sent.length = 0;
      executor.executeEffects([
        { type: "SAY", text: "こんにちは。よろしくね。", chat_request_id: "chat-stream-1" },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speak",
          data: { say_id: "chat-stream-1", text: "こんにちは。よろしくね。" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "streams sentence segments when chat.stream uses ASCII punctuation",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "Hello. How are you?",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "Hello." };
          yield { delta_text: " How are you?" };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-ascii",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "chat-stream-ascii", chat_request_id: "chat-stream-ascii" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-ascii",
            chat_request_id: "chat-stream-ascii",
            segment_index: 0,
            text: "Hello.",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-ascii",
            chat_request_id: "chat-stream-ascii",
            segment_index: 1,
            text: "How are you?",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "chat-stream-ascii", chat_request_id: "chat-stream-ascii" },
        },
      ]);
      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-ascii",
          assistant_text: "Hello. How are you?",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not flush stream segment at abbreviation boundary",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
          return {
            assistant_text: "Dr. Smith arrived.",
            expression: "neutral",
            motion_id: null,
            tool_calls: [],
          };
        },
        chatStream: async function* () {
          yield { delta_text: "Dr." };
          yield { delta_text: " Smith arrived." };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-abbrev",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });

      const segments = sent.filter((item) => item.type === "kiosk.command.speech.segment");
      expect(segments).toEqual([
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-abbrev",
            chat_request_id: "chat-stream-abbrev",
            segment_index: 0,
            text: "Dr. Smith arrived.",
            is_last: false,
          },
        },
      ]);
      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-abbrev",
          assistant_text: "Dr. Smith arrived.",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not flush stream segment at decimal point",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
          return {
            assistant_text: "3.14 is pi.",
            expression: "neutral",
            motion_id: null,
            tool_calls: [],
          };
        },
        chatStream: async function* () {
          yield { delta_text: "3.14 is" };
          yield { delta_text: " pi." };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-decimal",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });

      const segments = sent.filter((item) => item.type === "kiosk.command.speech.segment");
      expect(segments).toEqual([
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-decimal",
            chat_request_id: "chat-stream-decimal",
            segment_index: 0,
            text: "3.14 is pi.",
            is_last: false,
          },
        },
      ]);
      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-decimal",
          assistant_text: "3.14 is pi.",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not split common dotted abbreviations like U.S.",
    async () => {
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

      executor.executeEffects([
        {
          type: "SAY",
          text: "I live in U.S. today.",
        },
      ]);

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
            text: "I live in U.S. today.",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "say-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "I live in U.S. today." },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not split dotted multi-part abbreviations like U.S.A.",
    async () => {
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

      executor.executeEffects([
        {
          type: "SAY",
          text: "I live in U.S.A. today.",
        },
      ]);

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
            text: "I live in U.S.A. today.",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "say-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "I live in U.S.A. today." },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not split decimal numbers at period between digits",
    async () => {
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

      executor.executeEffects([
        {
          type: "SAY",
          text: "3.14 is pi.",
        },
      ]);

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
            text: "3.14 is pi.",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "say-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "3.14 is pi." },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not split common title abbreviation Dr.",
    async () => {
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

      executor.executeEffects([
        {
          type: "SAY",
          text: "Dr. Smith arrived.",
        },
      ]);

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
            text: "Dr. Smith arrived.",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "say-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "Dr. Smith arrived." },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "splits when token before period is non-letter such as numeric list",
    async () => {
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

      executor.executeEffects([
        {
          type: "SAY",
          text: "123. next.",
        },
      ]);

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
            text: "123.next.",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "say-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "123. next." },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not suppress SAY when stream emits no segments",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "fallback-text",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "" };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-empty",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-empty",
          assistant_text: "fallback-text",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(sent).toEqual([]);

      sent.length = 0;
      executor.executeEffects([
        { type: "SAY", text: "fallback-text", chat_request_id: "chat-stream-empty" },
      ]);
      expect(sent[0]).toEqual({
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "chat-stream-empty" },
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "keeps conversation alive when stream fails and still emits CHAT_RESULT",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "fallback",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield* [];
          throw new Error("stream_failed");
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const streamErrors: Array<{ request_id: string; emitted_segment_count: number }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onStreamError: (event) => {
          streamErrors.push({
            request_id: event.request_id,
            emitted_segment_count: event.emitted_segment_count,
          });
        },
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-failed",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-failed",
          assistant_text: "fallback",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(streamErrors).toEqual([
        { request_id: "chat-stream-failed", emitted_segment_count: 0 },
      ]);
      expect(sent).toEqual([]);

      sent.length = 0;
      executor.executeEffects([
        { type: "SAY", text: "fallback", chat_request_id: "chat-stream-failed" },
      ]);
      expect(sent[0]).toEqual({
        type: "kiosk.command.speech.start",
        data: { utterance_id: "say-1", chat_request_id: "chat-stream-failed" },
      });
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "suppresses SAY when stream emitted segments before failing",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "partial then fallback",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "先に読む。" };
          throw new Error("stream_failed_after_partial");
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-partial-fail",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-partial-fail",
          assistant_text: "partial then fallback",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: {
            utterance_id: "chat-stream-partial-fail",
            chat_request_id: "chat-stream-partial-fail",
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-partial-fail",
            chat_request_id: "chat-stream-partial-fail",
            segment_index: 0,
            text: "先に読む。",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: {
            utterance_id: "chat-stream-partial-fail",
            chat_request_id: "chat-stream-partial-fail",
          },
        },
      ]);

      sent.length = 0;
      executor.executeEffects([
        {
          type: "SAY",
          text: "partial then fallback",
          chat_request_id: "chat-stream-partial-fail",
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speak",
          data: { say_id: "chat-stream-partial-fail", text: "partial then fallback" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not suppress SAY when chat result includes tool calls",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "tool final answer",
          expression: "neutral",
          motion_id: null,
          tool_calls: [
            { id: "tool-1", type: "function", function: { name: "lookup", arguments: "{}" } },
          ],
        }),
        chatStream: async function* () {
          yield { delta_text: "streamed draft." };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-with-tools",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-with-tools",
          assistant_text: "tool final answer",
          expression: "neutral",
          motion_id: null,
          tool_calls: [
            { id: "tool-1", type: "function", function: { name: "lookup", arguments: "{}" } },
          ],
        },
      ]);

      sent.length = 0;
      executor.executeEffects([
        {
          type: "SAY",
          text: "tool final answer",
          chat_request_id: "chat-stream-with-tools",
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-with-tools" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "say-1",
            chat_request_id: "chat-stream-with-tools",
            segment_index: 0,
            text: "tool final answer",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-with-tools" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "tool final answer" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not suppress SAY after CHAT_FAILED even when stream emitted segments",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
          });
          throw new Error("chat_failed");
        },
        chatStream: async function* () {
          yield { delta_text: "先に読む。" };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-call-failed",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([{ type: "CHAT_FAILED", request_id: "chat-stream-call-failed" }]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: {
            utterance_id: "chat-stream-call-failed",
            chat_request_id: "chat-stream-call-failed",
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-call-failed",
            chat_request_id: "chat-stream-call-failed",
            segment_index: 0,
            text: "先に読む。",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: {
            utterance_id: "chat-stream-call-failed",
            chat_request_id: "chat-stream-call-failed",
          },
        },
      ]);

      sent.length = 0;
      executor.executeEffects([
        {
          type: "SAY",
          text: "fallback text",
          chat_request_id: "chat-stream-call-failed",
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-call-failed" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "say-1",
            chat_request_id: "chat-stream-call-failed",
            segment_index: 0,
            text: "fallback text",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-call-failed" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "fallback text" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "ends streaming utterance when chat finishes but stream keeps hanging",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "done",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* (_input, options) {
          yield { delta_text: "先に読む。" };
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                resolve();
              },
              { once: true },
            );
          });
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-hang-after-start",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-hang-after-start",
          assistant_text: "done",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: {
            utterance_id: "chat-stream-hang-after-start",
            chat_request_id: "chat-stream-hang-after-start",
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-hang-after-start",
            chat_request_id: "chat-stream-hang-after-start",
            segment_index: 0,
            text: "先に読む。",
            is_last: false,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: {
            utterance_id: "chat-stream-hang-after-start",
            chat_request_id: "chat-stream-hang-after-start",
          },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "emits trailing segment and ttfa metric when stream ends without punctuation",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "末尾だけ",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "末尾だけ" };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const observed: object[] = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
        observeSpeechMetric: (metric) => {
          observed.push(metric);
        },
      });

      const events = executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-tail-only",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: {
            utterance_id: "chat-stream-tail-only",
            chat_request_id: "chat-stream-tail-only",
          },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "chat-stream-tail-only",
            chat_request_id: "chat-stream-tail-only",
            segment_index: 0,
            text: "末尾だけ",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: {
            utterance_id: "chat-stream-tail-only",
            chat_request_id: "chat-stream-tail-only",
          },
        },
      ]);
      expect(observed).toEqual([
        {
          type: "speech.ttfa.observation",
          emitted_at_ms: expect.any(Number),
          utterance_id: "chat-stream-tail-only",
          chat_request_id: "chat-stream-tail-only",
          segment_count: 1,
          first_segment_length: "末尾だけ".length,
        },
      ]);
      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-tail-only",
          assistant_text: "末尾だけ",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not block CHAT_RESULT when stream never completes",
    async () => {
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "result-while-stream-pending",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* (_input, options) {
          await new Promise<void>((resolve) => {
            const signal = options?.signal;
            if (!signal) {
              return;
            }
            if (signal.aborted) {
              resolve();
              return;
            }
            const onAbort = () => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            };
            signal.addEventListener("abort", onAbort, { once: true });
          });
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
          type: "CALL_CHAT",
          request_id: "chat-stream-hangs",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      expect(events).toEqual([]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-hangs",
          assistant_text: "result-while-stream-pending",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "evicts oldest streamed chat ids when max entries exceeded",
    async () => {
      let now = 0;
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "先に読む。" };
        },
      });

      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: () => {},
        onSttRequested: () => {},
        storeWritePending: () => {},
        now_ms: () => now,
        streamedChatRequestMaxEntries: 1,
      });

      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-evict-1",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });

      now += 1;
      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-evict-2",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });

      sent.length = 0;
      executor.executeEffects([
        {
          type: "SAY",
          text: "first fallback",
          chat_request_id: "chat-stream-evict-1",
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-evict-1" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "say-1",
            chat_request_id: "chat-stream-evict-1",
            segment_index: 0,
            text: "first fallback",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-evict-1" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "first fallback" },
        },
      ]);

      sent.length = 0;
      executor.executeEffects([
        {
          type: "SAY",
          text: "second fallback",
          chat_request_id: "chat-stream-evict-2",
        },
      ]);
      expect(sent).toEqual([
        {
          type: "kiosk.command.speak",
          data: { say_id: "chat-stream-evict-2", text: "second fallback" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "does not suppress SAY when streamed request marker expired by TTL",
    async () => {
      let now = 0;
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "先に読む。" };
        },
      });

      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: () => {},
        onSttRequested: () => {},
        storeWritePending: () => {},
        now_ms: () => now,
      });

      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-ttl",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();

      sent.length = 0;
      now = 5 * 60 * 1000 + 1;
      executor.executeEffects([
        {
          type: "SAY",
          text: "fallback text",
          chat_request_id: "chat-stream-ttl",
        },
      ]);

      expect(sent).toEqual([
        {
          type: "kiosk.command.speech.start",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-ttl" },
        },
        {
          type: "kiosk.command.speech.segment",
          data: {
            utterance_id: "say-1",
            chat_request_id: "chat-stream-ttl",
            segment_index: 0,
            text: "fallback text",
            is_last: true,
          },
        },
        {
          type: "kiosk.command.speech.end",
          data: { utterance_id: "say-1", chat_request_id: "chat-stream-ttl" },
        },
        {
          type: "kiosk.command.speak",
          data: { say_id: "say-1", text: "fallback text" },
        },
      ]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "drops late stream chunks when chat already finalized without emitted segments",
    async () => {
      let hasDeltaBeenAccessed = false;
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
          yield {
            get delta_text() {
              hasDeltaBeenAccessed = true;
              return "late";
            },
          };
        },
      });

      const sent: Array<{ type: string; data: object }> = [];
      const queued: OrchestratorEvent[] = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-late-chunk",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-late-chunk",
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(hasDeltaBeenAccessed).toBe(false);
      expect(sent).toEqual([]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "stops processing stream after call finalization when no segment was emitted",
    async () => {
      let hasSecondChunkBeenAccessed = false;
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          yield { delta_text: "a" };
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
          yield {
            get delta_text() {
              hasSecondChunkBeenAccessed = true;
              return "late text";
            },
          };
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-punctuation-only",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-punctuation-only",
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(hasSecondChunkBeenAccessed).toBe(false);
      expect(sent).toEqual([]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

  it(
    "closes stream iterator when first chunk arrives after chat finalized",
    async () => {
      let hasFirstChunkBeenConsumed = false;
      let isIteratorClosed = false;
      const providers = createStubProviders({
        chatCall: async () => ({
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        }),
        chatStream: async function* () {
          try {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 30);
            });
            yield {
              get delta_text() {
                hasFirstChunkBeenConsumed = true;
                return "late";
              },
            };
          } finally {
            isIteratorClosed = true;
          }
        },
      });

      const queued: OrchestratorEvent[] = [];
      const sent: Array<{ type: string; data: object }> = [];
      const executor = createEffectExecutor({
        providers,
        sendKioskCommand: (type, data) => {
          sent.push({ type, data });
        },
        enqueueEvent: (event) => queued.push(event),
        onSttRequested: () => {},
        storeWritePending: () => {},
      });

      executor.executeEffects([
        {
          type: "CALL_CHAT",
          request_id: "chat-stream-late-first-chunk",
          input: { mode: "ROOM", personal_name: null, text: "hi" },
        },
      ]);
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80);
      });

      expect(queued).toEqual([
        {
          type: "CHAT_RESULT",
          request_id: "chat-stream-late-first-chunk",
          assistant_text: "ok",
          expression: "neutral",
          motion_id: null,
          tool_calls: [],
        },
      ]);
      expect(hasFirstChunkBeenConsumed).toBe(false);
      expect(isIteratorClosed).toBe(true);
      expect(sent).toEqual([]);
    },
    STREAM_TEST_TIMEOUT_MS,
  );

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
