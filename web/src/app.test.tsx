import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

type MockServerMessage = { type: string; seq: number; data: unknown };
type ConnectHandlers = {
  onSnapshot: (data: unknown) => void;
  onMessage?: (message: MockServerMessage) => void;
  onError?: (error: Error) => void;
};

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  resetDom();
});

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const wavResponse = (status: number, bytes: number[]): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  }) as unknown as Response;

const setNativeInputValue = (input: HTMLInputElement, value: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const setter = descriptor?.set;
  if (!setter) {
    throw new Error("Missing input value setter");
  }
  setter.call(input, value);
};

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
  });

  it("dispatches non-snapshot messages to onMessage", async () => {
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
    const onMessage = vi.fn();

    connectSse("/api/v1/staff/stream", { onSnapshot, onMessage });
    const source = FakeEventSource.instances[0];

    source.onmessage?.({
      data: JSON.stringify({
        type: "staff.pending_list",
        seq: 123,
        data: { items: [] },
      }),
    } as MessageEvent);

    expect(onSnapshot).toHaveBeenCalledTimes(0);
    expect(onMessage).toHaveBeenCalledWith({
      type: "staff.pending_list",
      seq: 123,
      data: { items: [] },
    });
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
        data: {},
      }),
    } as MessageEvent);

    source.onerror?.(new Event("error"));

    client.close();
    expect(source.closed).toBe(true);
  });
});

describe("app", () => {
  it("renders kiosk UI and handles commands/consent", async () => {
    vi.resetModules();

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const stopSpy = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    const startSpy = vi.fn(async () => ({ stop: stopSpy }));
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));

    const convertSpy = vi.fn(
      async () => new File([new Uint8Array([0])], "stt-1.wav", { type: "audio/wav" }),
    );
    vi.doMock("./kiosk-audio", () => ({ convertRecordingBlobToWavFile: convertSpy }));

    let kioskEventCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/v1/kiosk/stt-audio" && method === "POST") {
        return jsonResponse(202, { ok: true });
      }

      if (url === "/api/v1/kiosk/tts" && method === "POST") {
        return wavResponse(200, [1, 2, 3]);
      }

      if (url === "/api/v1/kiosk/event" && method === "POST") {
        kioskEventCalls += 1;
        if (kioskEventCalls === 1) {
          return jsonResponse(200, { ok: true });
        }
        if (kioskEventCalls === 2) {
          return jsonResponse(500, { error: { code: "boom", message: "boom" } });
        }
        throw new Error("offline");
      }

      return jsonResponse(404, { error: { code: "not_found", message: "Not Found" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    expect(connectSseMock).toHaveBeenCalledWith("/api/v1/kiosk/stream", expect.any(Object));

    const handlers = connectSseMock.mock.calls[0]![1];

    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
          consent_ui_visible: false,
        },
      });
    });

    expect(document.body.textContent ?? "").toContain("KIOSK");
    expect(document.body.textContent ?? "").toContain("Mascot Stage");
    expect(document.body.textContent ?? "").toContain("TTS: VOICEVOX / 四国めたん");
    expect(document.body.textContent ?? "").toContain("Mode: ROOM");
    expect(document.body.textContent ?? "").toContain("Phase: idle");

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.speak", seq: 1, data: null });
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 2,
        data: { say_id: 1, text: "nope" },
      });
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 3,
        data: { say_id: "say-1", text: "Hello" },
      });
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 4,
        data: { say_id: "say-1", text: "Hello" },
      });
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("Hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/kiosk/tts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 5, data: {} });
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 6,
        data: { say_id: "say-1", text: "Hello" },
      });
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 5, data: {} });
      await Promise.resolve();
    });
    expect(document.body.textContent ?? "").toContain("Recording");

    await act(async () => {
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 6,
        data: { stt_request_id: "stt-1" },
      });
      await Promise.resolve();
    });
    expect(document.body.textContent ?? "").not.toContain("Recording");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/kiosk/stt-audio",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );

    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "PERSONAL",
          personal_name: null,
          phase: "listening",
          consent_ui_visible: true,
        },
      });
    });

    expect(document.body.textContent ?? "").toContain("Mode: PERSONAL");
    expect(document.body.textContent ?? "").toContain("Recording");
    expect(document.body.textContent ?? "").toContain("覚えていい？");

    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "PERSONAL",
          personal_name: "taro",
          phase: "listening",
          consent_ui_visible: true,
        },
      });
    });
    expect(document.body.textContent ?? "").toContain("Mode: PERSONAL (taro)");

    const yesButton = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "はい",
    );
    expect(yesButton).toBeTruthy();
    await act(async () => {
      yesButton?.click();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      expect.objectContaining({ method: "POST" }),
    );

    const noButton = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "いいえ",
    );
    expect(noButton).toBeTruthy();
    await act(async () => {
      noButton?.click();
    });
    expect(document.body.textContent ?? "").toContain("Failed to send");

    await act(async () => {
      yesButton?.click();
    });
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 7, data: {} });
      handlers.onError?.(new Error("boom"));
    });

    expect(document.body.textContent ?? "").toContain("SSE error");

    await act(async () => {
      appRoot.unmount();
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("plays TTS audio on kiosk.command.speak when Audio/URL are available", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;

    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn(() => undefined);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      static latest: FakeAudio | null = null;
      src: string;
      onended: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        FakeAudio.latest = this;
        FakeAudio.instances.push(this);
      }
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/kiosk/tts" && method === "POST") {
        return wavResponse(200, [1, 2, 3]);
      }
      return jsonResponse(404, { error: { code: "not_found", message: url } });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/kiosk/tts",
        expect.objectContaining({ method: "POST" }),
      );
      expect(FakeAudio.instances.length).toBe(1);
      expect(FakeAudio.instances[0]!.src).toBe("blob:tts");
      expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();

      act(() => {
        FakeAudio.latest?.onended?.();
      });
      expect(FakeAudio.latest?.pause).toHaveBeenCalled();
      expect(
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL as unknown,
      ).toBeTruthy();

      await act(async () => {
        handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
        await Promise.resolve();
      });
      expect(FakeAudio.latest?.pause).toHaveBeenCalled();

      act(() => {
        FakeAudio.latest?.onended?.();
      });

      await act(async () => {
        appRoot.unmount();
      });
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });

  it("shows kiosk audio error when TTS fetch fails", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    vi.stubGlobal("Audio", function AudioCtor() {
      return { play: async () => undefined, pause: () => undefined };
    } as unknown as typeof Audio);

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v1/kiosk/tts") {
          throw new Error("offline");
        }
        return jsonResponse(404, { error: { code: "not_found", message: String(input) } });
      }),
    );

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      await act(async () => {
        await import("./main");
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      expect(document.body.textContent ?? "").toContain("Audio error: Network error");
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
    }
  });

  it("shows kiosk audio error when audio.play rejects (and cleanup is best-effort)", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;

    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn(() => {
      throw new Error("revoke boom");
    });

    class FakeAudio {
      static latest: FakeAudio | null = null;
      play = vi.fn(async () => {
        throw new Error("blocked");
      });
      pause = vi.fn(() => {
        throw new Error("pause boom");
      });
      constructor(_src: string) {
        void _src;
        FakeAudio.latest = this;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/kiosk/tts" && method === "POST") {
          return wavResponse(200, [1, 2, 3]);
        }
        return jsonResponse(404, { error: { code: "not_found", message: url } });
      }),
    );

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      expect(document.body.textContent ?? "").toContain("Audio error: Failed to play audio");

      await act(async () => {
        handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
        await Promise.resolve();
      });
      // stop_output should not throw even if pause/revoke fail
      expect(FakeAudio.latest).toBeTruthy();

      await act(async () => {
        appRoot.unmount();
      });
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });

  it("shows kiosk audio error when /api/v1/kiosk/tts returns non-2xx", async () => {
    vi.resetModules();

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/kiosk/tts" && method === "POST") {
          return { ok: false, status: 500 } as unknown as Response;
        }
        return jsonResponse(404, { error: { code: "not_found", message: url } });
      }),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    await act(async () => {
      const mainModule = await import("./main");
      void mainModule.appRoot;
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
          consent_ui_visible: false,
        },
      });
    });

    await act(async () => {
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 1,
        data: { say_id: "say-1", text: "Hello" },
      });
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("Audio error: HTTP 500");
  });

  it("ignores stale TTS responses after stop_output", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;

    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn(() => undefined);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    let resolveTts: ((res: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/kiosk/tts" && method === "POST") {
        return await new Promise<Response>((resolve) => {
          resolveTts = resolve;
        });
      }
      return jsonResponse(404, { error: { code: "not_found", message: url } });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      await act(async () => {
        handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
        await Promise.resolve();
      });

      await act(async () => {
        resolveTts?.(wavResponse(200, [1, 2, 3]));
        await Promise.resolve();
      });

      expect(FakeAudio.instances.length).toBe(0);

      await act(async () => {
        appRoot.unmount();
      });
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });

  it("ignores stale TTS wav when stop_output happens during arrayBuffer", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;

    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn(() => undefined);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      constructor(_src: string) {
        void _src;
        FakeAudio.instances.push(this);
      }
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    let resolveArrayBuffer: ((buf: ArrayBuffer) => void) | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/kiosk/tts" && method === "POST") {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () =>
              await new Promise<ArrayBuffer>((resolve) => {
                resolveArrayBuffer = resolve;
              }),
          } as unknown as Response;
        }
        return jsonResponse(404, { error: { code: "not_found", message: url } });
      }),
    );

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      await act(async () => {
        handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
        await Promise.resolve();
      });

      await act(async () => {
        resolveArrayBuffer?.(new Uint8Array([1, 2, 3]).buffer);
        await Promise.resolve();
      });

      expect(FakeAudio.instances.length).toBe(0);

      await act(async () => {
        appRoot.unmount();
      });
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });

  it("ignores stale TTS failure after stop_output", async () => {
    vi.resetModules();

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    let resolveTts: ((res: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/kiosk/tts" && method === "POST") {
          return await new Promise<Response>((resolve) => {
            resolveTts = resolve;
          });
        }
        return jsonResponse(404, { error: { code: "not_found", message: url } });
      }),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
          consent_ui_visible: false,
        },
      });
    });

    await act(async () => {
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 1,
        data: { say_id: "say-1", text: "Hello" },
      });
      await Promise.resolve();
    });

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
      await Promise.resolve();
    });

    await act(async () => {
      resolveTts?.({ ok: false, status: 500 } as unknown as Response);
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").not.toContain("Audio error:");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("ignores stale audio.play rejection after stop_output", async () => {
    vi.resetModules();

    const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;

    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = vi.fn(() => "blob:tts");
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn(() => undefined);

    let rejectPlay: (() => void) | null = null;
    class FakeAudio {
      play = vi.fn(
        async () =>
          await new Promise<void>((_resolve, reject) => {
            rejectPlay = () => reject(new Error("blocked"));
          }),
      );
      pause = vi.fn(() => undefined);
      constructor(_src: string) {
        void _src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/kiosk/tts" && method === "POST") {
          return wavResponse(200, [1, 2, 3]);
        }
        return jsonResponse(404, { error: { code: "not_found", message: url } });
      }),
    );

    try {
      window.history.pushState({}, "", "/kiosk");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const handlers = connectSseMock.mock.calls[0]![1];
      await act(async () => {
        handlers.onSnapshot({
          state: {
            mode: "ROOM",
            personal_name: null,
            phase: "idle",
            consent_ui_visible: false,
          },
        });
      });

      await act(async () => {
        handlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "say-1", text: "Hello" },
        });
        await Promise.resolve();
      });

      await act(async () => {
        handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
        await Promise.resolve();
      });

      await act(async () => {
        rejectPlay?.();
        await Promise.resolve();
      });

      expect(document.body.textContent ?? "").not.toContain("Audio error:");

      await act(async () => {
        appRoot.unmount();
      });
    } finally {
      if (originalCreateObjectURL === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL;
      }
      if (originalRevokeObjectURL === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });

  it("ignores stale TTS fetch exception after stop_output", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    let rejectFetch: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v1/kiosk/tts") {
          return await new Promise<Response>((_resolve, reject) => {
            rejectFetch = () => reject(new Error("offline"));
          });
        }
        return jsonResponse(404, { error: { code: "not_found", message: String(input) } });
      }),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onSnapshot({
        state: {
          mode: "ROOM",
          personal_name: null,
          phase: "idle",
          consent_ui_visible: false,
        },
      });
    });

    await act(async () => {
      handlers.onMessage?.({
        type: "kiosk.command.speak",
        seq: 1,
        data: { say_id: "say-1", text: "Hello" },
      });
      await Promise.resolve();
    });

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.stop_output", seq: 2, data: {} });
      await Promise.resolve();
    });

    await act(async () => {
      rejectFetch?.();
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").not.toContain("Audio error:");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("shows audio error when record_stop has invalid data", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_stop", seq: 1, data: {} });
    });

    expect(document.body.textContent ?? "").toContain("Audio error: Invalid record_stop message");
  });

  it("shows audio error when record_stop data is not an object", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_stop", seq: 1, data: null });
    });

    expect(document.body.textContent ?? "").toContain("Audio error: Invalid record_stop message");
  });

  it("ignores stale start errors after record_stop cancels a start", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const startPttSession = vi.fn(async () => {
      throw new Error("start failed");
    });
    vi.doMock("./kiosk-ptt", () => ({ startPttSession }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 2,
        data: { stt_request_id: "stt-1" },
      });
      await Promise.resolve();
    });

    expect(startPttSession).toHaveBeenCalledTimes(1);
    expect(document.body.textContent ?? "").toContain("Audio error: start failed");
  });

  it("stops recording on invalid record_stop and allows restart", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const stopSpy = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    const startSpy = vi.fn(async () => ({ stop: stopSpy }));
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      handlers.onMessage?.({ type: "kiosk.command.record_stop", seq: 2, data: {} });
      await Promise.resolve();
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(document.body.textContent ?? "").toContain("Audio error: Invalid record_stop message");

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 3, data: {} });
      await Promise.resolve();
    });

    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  it("stops recording on invalid record_stop when session is already established", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const stopSpy = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    const startSpy = vi.fn(async () => ({ stop: stopSpy }));
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_stop", seq: 2, data: {} });
      await Promise.resolve();
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("stops after invalid record_stop even if start is still pending", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const stopSpy = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    let resolveSession: ((s: { stop: () => Promise<Blob> }) => void) | null = null;
    const startSpy = vi.fn(
      async () =>
        await new Promise<{ stop: () => Promise<Blob> }>((resolve) => {
          resolveSession = resolve;
        }),
    );
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      handlers.onMessage?.({ type: "kiosk.command.record_stop", seq: 2, data: {} });
      await Promise.resolve();
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(resolveSession).toBeTruthy();

    await act(async () => {
      resolveSession?.({ stop: stopSpy });
      await Promise.resolve();
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("stops recording on unmount even if stop() rejects", async () => {
    vi.resetModules();

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const stopSpy = vi.fn(async () => {
      throw new Error("stop rejected");
    });
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: vi.fn(async () => ({ stop: stopSpy })) }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
    });

    await act(async () => {
      appRoot.unmount();
      await Promise.resolve();
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("shows audio error when record_stop arrives without an active session", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 1,
        data: { stt_request_id: "stt-1" },
      });
    });

    expect(document.body.textContent ?? "").toContain("Audio error: Not recording");
  });

  it("does not start PTT twice for duplicate record_start", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const startSpy = vi.fn(async () => ({ stop: vi.fn(async () => new Blob()) }));
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 2, data: {} });
      await Promise.resolve();
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("shows audio error on upload HTTP failure and on start failure", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const startSpy = vi
      .fn()
      .mockResolvedValueOnce({ stop: vi.fn(async () => new Blob([new Uint8Array([1])])) })
      .mockRejectedValueOnce(new Error("no mic"));
    vi.doMock("./kiosk-ptt", () => ({ startPttSession: startSpy }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/kiosk/stt-audio") {
        return jsonResponse(500, { error: { code: "boom", message: "boom" } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 2,
        data: { stt_request_id: "stt-1" },
      });
      await Promise.resolve();
    });
    expect(document.body.textContent ?? "").toContain("Audio error: HTTP 500");

    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 3, data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent ?? "").toContain("Audio error: no mic");
  });

  it("shows audio error when stopping recording fails", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.doMock("./kiosk-ptt", () => ({
      startPttSession: vi.fn(async () => ({
        stop: vi.fn(async () => {
          throw new Error("stop failed");
        }),
      })),
    }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 2,
        data: { stt_request_id: "stt-1" },
      });
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("Audio error: stop failed");
  });

  it("uses fallback message when startPttSession rejects with a non-Error", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.doMock("./kiosk-ptt", () => ({
      startPttSession: vi.fn(async () => {
        throw "boom";
      }),
    }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("Audio error: Failed to start recording");
  });

  it("uses fallback message when upload chain rejects with a non-Error", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: () => {},
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    vi.doMock("./kiosk-ptt", () => ({
      startPttSession: vi.fn(async () => ({
        stop: vi.fn(async () => {
          throw "boom";
        }),
      })),
    }));
    vi.doMock("./kiosk-audio", () => ({
      convertRecordingBlobToWavFile: vi.fn(
        async () => new File([], "x.wav", { type: "audio/wav" }),
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(202, { ok: true })),
    );

    window.history.pushState({}, "", "/kiosk");
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onMessage?.({ type: "kiosk.command.record_start", seq: 1, data: {} });
      await Promise.resolve();
      handlers.onMessage?.({
        type: "kiosk.command.record_stop",
        seq: 2,
        data: { stt_request_id: "stt-1" },
      });
      await Promise.resolve();
    });

    expect(document.body.textContent ?? "").toContain("Audio error: Failed to upload audio");
  });

  it("renders staff login, then control UI, then locks on inactivity", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "p1",
              personal_name: "taro",
              kind: "food",
              value: "curry",
              source_quote: "likes curry",
              status: "pending",
              created_at_ms: 0,
              expires_at_ms: 1,
            },
          ],
        });
      }
      if (url === "/api/v1/staff/event" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/auth/keepalive" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url.startsWith("/api/v1/staff/pending/") && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(500, { error: { code: "unhandled", message: url } });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    expect(document.body.textContent ?? "").toContain("STAFF");
    expect(document.body.textContent ?? "").toContain("Login");
    expect(document.body.textContent ?? "").toContain("TTS: VOICEVOX / 四国めたん");

    const input = document.querySelector("input") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {});

    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(signIn).toBeTruthy();
    expect((signIn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      signIn?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/staff/auth/login",
      expect.objectContaining({ method: "POST" }),
    );

    expect(connectSseMock).toHaveBeenCalledWith("/api/v1/staff/stream", expect.any(Object));
    expect(document.body.textContent ?? "").toContain("Pending");
    expect(document.body.textContent ?? "").toContain("taro / food / curry");
    expect(document.body.textContent ?? "").toContain("likes curry");

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onSnapshot({
        state: { mode: "PERSONAL", personal_name: null, phase: "idle" },
        pending: { count: 1 },
      });
      handlers.onError?.(new Error("boom"));
      handlers.onMessage?.({ type: "staff.snapshot", seq: 1, data: {} });
      handlers.onMessage?.({ type: "staff.pending_list", seq: 2, data: null });
      handlers.onMessage?.({ type: "staff.pending_list", seq: 3, data: { items: "nope" } });
      handlers.onMessage?.({ type: "staff.pending_list", seq: 3, data: { items: [] } });
      handlers.onSnapshot({
        state: { mode: "PERSONAL", personal_name: "taro", phase: "idle" },
        pending: { count: 0 },
      });
    });
    expect(document.body.textContent ?? "").toContain("boom");
    expect(document.body.textContent ?? "").toContain("Mode: PERSONAL (taro)");
    expect(document.body.textContent ?? "").toContain("Pending: 0");

    await act(async () => {
      handlers.onSnapshot({
        state: { mode: "ROOM", personal_name: null, phase: "idle" },
        pending: { count: 0 },
      });
    });
    expect(document.body.textContent ?? "").toContain("Mode: ROOM");

    const ptt = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Push to talk"),
    );
    expect(ptt).toBeTruthy();
    await act(async () => {
      ptt?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      ptt?.dispatchEvent(new Event("pointerout", { bubbles: true }));
      ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      ptt?.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    });
    const staffEventCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === "/api/v1/staff/event",
    );
    expect(staffEventCalls.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      ptt?.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/staff/event",
      expect.objectContaining({ method: "POST" }),
    );

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    const keepaliveCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === "/api/v1/staff/auth/keepalive",
    );
    expect(keepaliveCalls).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(30_000);
    });
    const keepaliveCalls2 = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === "/api/v1/staff/auth/keepalive",
    );
    expect(keepaliveCalls2.length).toBeGreaterThan(1);

    const refresh = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Refresh"),
    );
    expect(refresh).toBeTruthy();
    await act(async () => {
      refresh?.click();
    });

    const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Force ROOM"),
    );
    const emergencyStop = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Emergency stop"),
    );
    const resume = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Resume"),
    );
    expect(forceRoom).toBeTruthy();
    expect(emergencyStop).toBeTruthy();
    expect(resume).toBeTruthy();
    await act(async () => {
      forceRoom?.click();
      emergencyStop?.click();
      resume?.click();
    });

    const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Confirm"),
    );
    const deny = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Deny"),
    );
    expect(confirm).toBeTruthy();
    expect(deny).toBeTruthy();
    await act(async () => {
      confirm?.click();
      deny?.click();
    });

    await act(async () => {
      handlers.onMessage?.({
        type: "staff.pending_list",
        seq: 9,
        data: {
          items: [
            {
              id: "p2",
              personal_name: "taro",
              kind: "food",
              value: "curry",
              status: "pending",
              created_at_ms: 0,
              expires_at_ms: 1,
            },
          ],
        },
      });
    });
    expect(document.body.textContent ?? "").toContain("taro / food / curry");
    expect(document.body.textContent ?? "").not.toContain("likes curry");

    await act(async () => {
      handlers.onMessage?.({ type: "staff.pending_list", seq: 10, data: { items: [] } });
    });
    expect(document.body.textContent ?? "").toContain("No pending items.");

    await act(async () => {
      ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(document.body.textContent ?? "").toContain("STAFF (Locked)");
    expect(closeSpy).toHaveBeenCalled();

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("covers staff error paths (401/500/network) for login, pending, events, and keepalive", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const closeSpy = vi.fn();
    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: closeSpy,
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi
      .fn()
      // 1) login network error
      .mockRejectedValueOnce(new Error("offline"))
      // 2) login unauthorized
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthorized", message: "x" } }))
      // 3) login ok
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      // 4) pending 500
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
      // 5) staff event 500
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
      // 6) staff event network error
      .mockRejectedValueOnce(new Error("offline"))
      // 7) keepalive 500
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
      // 8) keepalive network error
      .mockRejectedValueOnce(new Error("offline"))
      // 9) keepalive 401
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthorized", message: "x" } }));
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();

    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });
    await act(async () => {});
    expect((signIn as HTMLButtonElement).disabled).toBe(false);
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      signIn?.click();
    });
    expect(document.body.textContent ?? "").toContain("Unauthorized");

    await act(async () => {
      signIn?.click();
    });
    expect(connectSseMock).toHaveBeenCalledWith("/api/v1/staff/stream", expect.any(Object));
    expect(document.body.textContent ?? "").toContain("HTTP 500");

    const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Force ROOM"),
    );
    expect(forceRoom).toBeTruthy();
    await act(async () => {
      forceRoom?.click();
    });
    expect(document.body.textContent ?? "").toContain("HTTP 500");

    await act(async () => {
      forceRoom?.click();
    });
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(30_000);
    });
    expect(document.body.textContent ?? "").toContain("HTTP 500");

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(30_000);
    });
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(30_000);
    });
    expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("locks on staff event 401", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        return jsonResponse(200, { items: [] });
      }
      if (url === "/api/v1/staff/event" && method === "POST") {
        return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();
    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {
      signIn?.click();
    });

    const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Force ROOM"),
    );
    expect(forceRoom).toBeTruthy();
    await act(async () => {
      forceRoom?.click();
    });
    expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("locks when pending GET returns 401", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();

    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });

    expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("shows pending network error when pending GET throws", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        throw new Error("offline");
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();
    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("covers pending mutation errors (HTTP/network/401)", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    let mutateCall = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "p1",
              personal_name: "taro",
              kind: "food",
              value: "curry",
              status: "pending",
              created_at_ms: 0,
              expires_at_ms: 1,
            },
          ],
        });
      }
      if (url.startsWith("/api/v1/staff/pending/") && method === "POST") {
        mutateCall += 1;
        if (mutateCall === 1) {
          return jsonResponse(404, { error: { code: "not_found", message: "x" } });
        }
        if (mutateCall === 2) {
          throw new Error("offline");
        }
        return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();
    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });

    const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Confirm"),
    );
    const deny = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Deny"),
    );
    expect(confirm).toBeTruthy();
    expect(deny).toBeTruthy();

    await act(async () => {
      confirm?.click();
    });
    expect(document.body.textContent ?? "").toContain("HTTP 404");

    await act(async () => {
      deny?.click();
    });
    expect(document.body.textContent ?? "").toContain("Network error");

    await act(async () => {
      confirm?.click();
    });
    expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("shows HTTP error on non-401 login failure", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(500, { error: { code: "boom", message: "boom" } });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();

    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });

    expect(document.body.textContent ?? "").toContain("HTTP 500");

    await act(async () => {
      appRoot.unmount();
    });
  });

  it("covers modeText PERSONAL name branch", async () => {
    vi.resetModules();

    const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
      close: vi.fn(),
    }));
    vi.doMock("./sse-client", async () => {
      const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
      return { ...actual, connectSse: connectSseMock };
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/v1/staff/auth/login" && method === "POST") {
        return jsonResponse(200, { ok: true });
      }
      if (url === "/api/v1/staff/pending" && method === "GET") {
        return jsonResponse(200, { items: [] });
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.pushState({}, "", "/staff");
    document.body.innerHTML = '<div id="root"></div>';

    let appRoot: Root;
    await act(async () => {
      const mainModule = await import("./main");
      appRoot = mainModule.appRoot;
    });

    const input = document.querySelector("input") as HTMLInputElement | null;
    const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sign in"),
    );
    expect(input).toBeTruthy();
    expect(signIn).toBeTruthy();
    await act(async () => {
      if (input) {
        setNativeInputValue(input, "pass");
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      signIn?.click();
    });

    const handlers = connectSseMock.mock.calls[0]![1];
    await act(async () => {
      handlers.onSnapshot({
        state: { mode: "PERSONAL", personal_name: null, phase: "idle" },
        pending: { count: 0 },
      });
    });
    expect(document.body.textContent ?? "").toContain("Mode: PERSONAL");
    expect(document.body.textContent ?? "").not.toContain("Mode: PERSONAL (");

    await act(async () => {
      handlers.onSnapshot({
        state: { mode: "PERSONAL", personal_name: "taro", phase: "idle" },
        pending: { count: 0 },
      });
    });
    expect(document.body.textContent ?? "").toContain("Mode: PERSONAL (taro)");

    await act(async () => {
      appRoot.unmount();
    });
  });
});
