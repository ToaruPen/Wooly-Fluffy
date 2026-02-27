import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEventSourceClass } from "./test-helpers/fake-event-source";

const SSE_TEST_TIMEOUT_MS = 5_000;

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

afterEach(() => {
  vi.doUnmock("./sse-client");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  resetDom();
});

describe("sse-client", () => {
  it(
    "handles snapshots and errors",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const onSnapshot = vi.fn();
      const onError = vi.fn();

      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });
      const source = FakeEventSource.instances[0];

      source.onmessage?.({
        data: JSON.stringify({
          type: "kiosk.snapshot",
          seq: 1,
          data: { state: { mode: "ROOM" } },
        }),
      } as MessageEvent);

      expect(onSnapshot).toHaveBeenCalledWith({ state: { mode: "ROOM" } });

      source.onmessage?.({
        data: JSON.stringify({
          type: "kiosk.command.record_start",
          seq: 2,
          data: {},
        }),
      } as MessageEvent);

      expect(onSnapshot).toHaveBeenCalledTimes(1);

      source.onmessage?.({
        data: JSON.stringify({
          type: 123,
          seq: 3,
          data: {},
        }),
      } as MessageEvent);

      source.onmessage?.({ data: "not-json" } as MessageEvent);

      source.onerror?.(new Event("error"));

      expect(onError).toHaveBeenCalled();

      client.close();
      expect(source.closed).toBe(true);
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "dispatches non-snapshot messages to onMessage",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const onSnapshot = vi.fn();
      const onMessage = vi.fn();

      connectSse("/api/v1/staff/stream", { onSnapshot, onMessage });
      const source = FakeEventSource.instances[0];

      source.onmessage?.({
        data: JSON.stringify({
          type: "staff.session_summaries_pending_list",
          seq: 123,
          data: { items: [] },
        }),
      } as MessageEvent);

      expect(onSnapshot).toHaveBeenCalledTimes(0);
      expect(onMessage).toHaveBeenCalledWith({
        type: "staff.session_summaries_pending_list",
        seq: 123,
        data: { items: [] },
      });
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "does not throw when onError is not provided",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const onSnapshot = vi.fn();
      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot });
      const source = FakeEventSource.instances[0];

      const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
        throw "boom";
      });
      source.onmessage?.({ data: "not-json" } as MessageEvent);
      parseSpy.mockRestore();

      source.onmessage?.({
        data: JSON.stringify({
          type: 123,
          seq: 1,
          data: {},
        }),
      } as MessageEvent);

      source.onerror?.(new Event("error"));

      client.close();
      expect(source.closed).toBe(true);
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "does not reconnect when VITE_SSE_RECONNECT_ENABLED=false",
    async () => {
      vi.resetModules();

      vi.stubEnv("VITE_SSE_RECONNECT_ENABLED", "false");

      try {
        const FakeEventSource = createFakeEventSourceClass();

        vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

        const { connectSse } = await import("./sse-client");

        const onSnapshot = vi.fn();
        const onError = vi.fn();
        connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });

        const source = FakeEventSource.instances[0];
        source.onerror?.(new Event("error"));

        expect(onError).toHaveBeenCalled();
        expect(FakeEventSource.instances.length).toBe(1);
        expect(source.closed).toBe(true);
      } finally {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
      }
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "reconnects when VITE_SSE_RECONNECT_ENABLED=true",
    async () => {
      vi.resetModules();
      vi.useFakeTimers();

      vi.stubEnv("VITE_SSE_RECONNECT_ENABLED", "true");
      vi.stubEnv("VITE_SSE_RECONNECT_BASE_DELAY_MS", "100");
      vi.stubEnv("VITE_SSE_RECONNECT_MAX_DELAY_MS", "100");

      try {
        const FakeEventSource = createFakeEventSourceClass();

        vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

        const { connectSse } = await import("./sse-client");

        const onSnapshot = vi.fn();
        const onError = vi.fn();
        connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });

        const first = FakeEventSource.instances[0];
        first.onerror?.(new Event("error"));

        expect(onError).toHaveBeenCalled();
        expect(first.closed).toBe(true);
        expect(FakeEventSource.instances.length).toBe(1);

        await vi.advanceTimersByTimeAsync(100);

        expect(FakeEventSource.instances.length).toBe(2);
        const second = FakeEventSource.instances[1];

        second.onopen?.(new Event("open"));

        second.onmessage?.({
          data: JSON.stringify({
            type: "kiosk.snapshot",
            seq: 1,
            data: { state: { mode: "ROOM" } },
          }),
        } as MessageEvent);
        expect(onSnapshot).toHaveBeenCalledWith({ state: { mode: "ROOM" } });
      } finally {
        vi.unstubAllEnvs();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "does not reconnect after close()",
    async () => {
      vi.resetModules();
      vi.useFakeTimers();

      vi.stubEnv("VITE_SSE_RECONNECT_ENABLED", "true");
      vi.stubEnv("VITE_SSE_RECONNECT_BASE_DELAY_MS", "100");
      vi.stubEnv("VITE_SSE_RECONNECT_MAX_DELAY_MS", "100");

      try {
        const FakeEventSource = createFakeEventSourceClass();

        vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

        const { connectSse } = await import("./sse-client");

        const onSnapshot = vi.fn();
        const client = connectSse("/api/v1/kiosk/stream", { onSnapshot });
        const first = FakeEventSource.instances[0];
        first.onerror?.(new Event("error"));

        client.close();

        await vi.advanceTimersByTimeAsync(100);
        expect(FakeEventSource.instances.length).toBe(1);
        expect(first.closed).toBe(true);
      } finally {
        vi.unstubAllEnvs();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
    SSE_TEST_TIMEOUT_MS,
  );
});

describe("sse-client coverage", () => {
  it(
    "close is idempotent",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot: () => {} });
      const source = FakeEventSource.instances[0];

      client.close();
      client.close();

      expect(source.closed).toBe(true);
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "ignores errors after close()",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");
      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot: () => {} });
      const source = FakeEventSource.instances[0];

      client.close();
      source.onerror?.(new Event("error"));

      expect(source.closed).toBe(true);
      expect(FakeEventSource.instances.length).toBe(1);
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "does not reconnect if a queued reconnect callback runs after close()",
    async () => {
      vi.resetModules();

      vi.stubEnv("VITE_SSE_RECONNECT_ENABLED", "true");
      vi.stubEnv("VITE_SSE_RECONNECT_BASE_DELAY_MS", "100");
      vi.stubEnv("VITE_SSE_RECONNECT_MAX_DELAY_MS", "100");

      try {
        const FakeEventSource = createFakeEventSourceClass();

        const setTimeoutStub = vi.fn((fn: () => void) => {
          void fn;
          return 1 as unknown as ReturnType<typeof setTimeout>;
        });
        const clearTimeoutStub = vi.fn((_id: ReturnType<typeof setTimeout>) => {
          // Intentionally no-op to simulate a callback already queued.
        });

        vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
        vi.stubGlobal("setTimeout", setTimeoutStub as unknown as typeof setTimeout);
        vi.stubGlobal("clearTimeout", clearTimeoutStub as unknown as typeof clearTimeout);

        const { connectSse } = await import("./sse-client");
        const client = connectSse("/api/v1/kiosk/stream", { onSnapshot: () => {} });
        const first = FakeEventSource.instances[0];

        first.onerror?.(new Event("error"));
        first.onerror?.(new Event("error"));

        expect(setTimeoutStub).toHaveBeenCalledTimes(1);

        const queuedReconnect = setTimeoutStub.mock.calls[0]?.[0] as unknown as () => void;

        client.close();
        expect(first.closed).toBe(true);

        queuedReconnect();
        expect(FakeEventSource.instances.length).toBe(1);
      } finally {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
      }
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "reconnect() creates a new EventSource immediately",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const onSnapshot = vi.fn();
      const onError = vi.fn();
      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });
      const first = FakeEventSource.instances[0];

      client.reconnect();

      expect(first.closed).toBe(true);
      expect(FakeEventSource.instances.length).toBe(2);

      const second = FakeEventSource.instances[1];
      second.onopen?.(new Event("open"));
      second.onmessage?.({
        data: JSON.stringify({
          type: "kiosk.snapshot",
          seq: 1,
          data: { state: { mode: "ROOM" } },
        }),
      } as MessageEvent);

      expect(onSnapshot).toHaveBeenCalledWith({ state: { mode: "ROOM" } });
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "reconnect() cancels pending auto-reconnect timer",
    async () => {
      vi.resetModules();
      vi.useFakeTimers();

      vi.stubEnv("VITE_SSE_RECONNECT_ENABLED", "true");
      vi.stubEnv("VITE_SSE_RECONNECT_BASE_DELAY_MS", "5000");
      vi.stubEnv("VITE_SSE_RECONNECT_MAX_DELAY_MS", "5000");

      try {
        const FakeEventSource = createFakeEventSourceClass();

        vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

        const { connectSse } = await import("./sse-client");

        const onSnapshot = vi.fn();
        const onError = vi.fn();
        const client = connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });
        const first = FakeEventSource.instances[0];

        // Trigger auto-reconnect (schedules a 5s timer)
        first.onerror?.(new Event("error"));
        expect(first.closed).toBe(true);
        expect(FakeEventSource.instances.length).toBe(1);

        // Manual reconnect should cancel the timer and connect immediately
        client.reconnect();
        expect(FakeEventSource.instances.length).toBe(2);

        // Advance past the auto-reconnect delay — no extra EventSource should be created
        await vi.advanceTimersByTimeAsync(5000);
        expect(FakeEventSource.instances.length).toBe(2);
      } finally {
        vi.unstubAllEnvs();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
    SSE_TEST_TIMEOUT_MS,
  );

  it(
    "reconnect() works after close()",
    async () => {
      vi.resetModules();

      const FakeEventSource = createFakeEventSourceClass();

      vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

      const { connectSse } = await import("./sse-client");

      const onSnapshot = vi.fn();
      const client = connectSse("/api/v1/kiosk/stream", { onSnapshot });
      const first = FakeEventSource.instances[0];

      client.close();
      expect(first.closed).toBe(true);

      client.reconnect();
      expect(FakeEventSource.instances.length).toBe(2);

      const second = FakeEventSource.instances[1];
      second.onmessage?.({
        data: JSON.stringify({
          type: "kiosk.snapshot",
          seq: 1,
          data: { state: { mode: "ROOM" } },
        }),
      } as MessageEvent);

      expect(onSnapshot).toHaveBeenCalledWith({ state: { mode: "ROOM" } });
    },
    SSE_TEST_TIMEOUT_MS,
  );
});
