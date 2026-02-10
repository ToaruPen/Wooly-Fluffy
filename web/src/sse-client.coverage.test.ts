import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./sse-client");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

describe("sse-client coverage", () => {
  it("close is idempotent", async () => {
    vi.resetModules();

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      closed = false;
      url: string;

      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
      }

      close() {
        this.closed = true;
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

    const { connectSse } = await import("./sse-client");

    const client = connectSse("/api/v1/kiosk/stream", { onSnapshot: () => {} });
    const source = FakeEventSource.instances[0];

    client.close();
    client.close();

    expect(source.closed).toBe(true);
  });

  it("ignores errors after close()", async () => {
    vi.resetModules();

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      closed = false;
      url: string;

      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
      }

      close() {
        this.closed = true;
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);

    const { connectSse } = await import("./sse-client");
    const client = connectSse("/api/v1/kiosk/stream", { onSnapshot: () => {} });
    const source = FakeEventSource.instances[0];

    client.close();
    source.onerror?.(new Event("error"));

    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it("does not reconnect if a queued reconnect callback runs after close()", async () => {
    vi.resetModules();

    const originalEnabled = import.meta.env.VITE_SSE_RECONNECT_ENABLED;
    const originalBaseDelay = import.meta.env.VITE_SSE_RECONNECT_BASE_DELAY_MS;
    const originalMaxDelay = import.meta.env.VITE_SSE_RECONNECT_MAX_DELAY_MS;
    import.meta.env.VITE_SSE_RECONNECT_ENABLED = "true";
    import.meta.env.VITE_SSE_RECONNECT_BASE_DELAY_MS = "100";
    import.meta.env.VITE_SSE_RECONNECT_MAX_DELAY_MS = "100";

    try {
      class FakeEventSource {
        static instances: FakeEventSource[] = [];
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        closed = false;
        url: string;

        constructor(url: string) {
          this.url = url;
          FakeEventSource.instances.push(this);
        }

        close() {
          this.closed = true;
        }
      }

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
      import.meta.env.VITE_SSE_RECONNECT_ENABLED = originalEnabled;
      import.meta.env.VITE_SSE_RECONNECT_BASE_DELAY_MS = originalBaseDelay;
      import.meta.env.VITE_SSE_RECONNECT_MAX_DELAY_MS = originalMaxDelay;
    }
  });
});
