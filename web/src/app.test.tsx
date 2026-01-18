import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    false;
});

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetDom();
});

describe("sse-client", () => {
  it("handles snapshots and errors", async () => {
    vi.resetModules();

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
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

    const onSnapshot = vi.fn();
    const onError = vi.fn();

    const client = connectSse("/api/v1/kiosk/stream", { onSnapshot, onError });
    const source = FakeEventSource.instances[0];

    source.onmessage?.({
      data: JSON.stringify({
        type: "kiosk.snapshot",
        seq: 1,
        data: { state: { mode: "ROOM" } }
      })
    } as MessageEvent);

    expect(onSnapshot).toHaveBeenCalledWith({ state: { mode: "ROOM" } });

    source.onmessage?.({
      data: JSON.stringify({
        type: "kiosk.command.record_start",
        seq: 2,
        data: {}
      })
    } as MessageEvent);

    expect(onSnapshot).toHaveBeenCalledTimes(1);

    source.onmessage?.({
      data: JSON.stringify({
        type: 123,
        seq: 3,
        data: {}
      })
    } as MessageEvent);

    source.onmessage?.({ data: "not-json" } as MessageEvent);

    source.onerror?.(new Event("error"));

    expect(onError).toHaveBeenCalled();

    client.close();
    expect(source.closed).toBe(true);
  });

  it("does not throw when onError is not provided", async () => {
    vi.resetModules();

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
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
        data: {}
      })
    } as MessageEvent);

    source.onerror?.(new Event("error"));

    client.close();
    expect(source.closed).toBe(true);
  });
});

describe("app", () => {
  it("renders kiosk and updates snapshot", async () => {
    vi.resetModules();

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<
      [string, { onSnapshot: (data: unknown) => void; onError?: (error: Error) => void }],
      { close: () => void }
    >(() => ({ close: closeSpy }));
    vi.doMock("./sse-client", () => ({ connectSse: connectSseMock }));

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    expect(connectSseMock).toHaveBeenCalledWith(
      "/api/v1/kiosk/stream",
      expect.any(Object)
    );

    const handlers = connectSseMock.mock.calls[0][1];

    await act(async () => {
      handlers.onSnapshot({ state: { mode: "ROOM" } });
    });

    const content = document.body.textContent ?? "";
    expect(content).toContain("KIOSK");
    expect(content).toContain("Latest snapshot");
    expect(content).toContain("ROOM");

    await act(async () => {
      appRoot.unmount();
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("renders staff and connects to staff stream", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<
      [string, { onSnapshot: (data: unknown) => void; onError?: (error: Error) => void }],
      { close: () => void }
    >(() => ({ close: vi.fn() }));
    vi.doMock("./sse-client", () => ({ connectSse: connectSseMock }));

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    expect(connectSseMock).toHaveBeenCalledWith(
      "/api/v1/staff/stream",
      expect.any(Object)
    );

    const content = document.body.textContent ?? "";
    expect(content).toContain("STAFF");

    await act(async () => {
      appRoot.unmount();
    });
  });
});
