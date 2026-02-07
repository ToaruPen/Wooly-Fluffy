import { afterEach, describe, expect, it, vi } from "vitest";
import { startPttSession } from "./kiosk-ptt";

describe("kiosk-ptt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("throws when getUserMedia is not available", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    await expect(startPttSession()).rejects.toThrow("getUserMedia is not available");
  });

  it("throws when MediaRecorder is not available", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
      configurable: true,
    });
    vi.stubGlobal("MediaRecorder", undefined as unknown as typeof MediaRecorder);
    await expect(startPttSession()).rejects.toThrow("MediaRecorder is not available");
  });

  it("records chunks and stops tracks", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      started = false;

      constructor(_stream: MediaStream) {}

      start() {
        this.started = true;
      }

      stop() {
        const blob = new Blob([new Uint8Array([1])], { type: "audio/webm" });
        this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
        this.onstop?.(new Event("stop"));
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    const session = await startPttSession();
    const blob = await session.stop();
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("defaults to audio/webm when MediaRecorder mimeType is empty", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        const blob = new Blob([new Uint8Array([1])]);
        this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
        this.onstop?.(new Event("stop"));
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    const session = await startPttSession();
    const blob = await session.stop();
    expect(blob.type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("ignores empty data chunks", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        const blob = new Blob([], { type: "audio/webm" });
        this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
        this.onstop?.(new Event("stop"));
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    const session = await startPttSession();
    const blob = await session.stop();
    expect(blob.size).toBe(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("rejects with the original error if Blob creation throws an Error", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        this.onstop?.(new Event("stop"));
      }
    }

    class ThrowingBlob {
      constructor(_parts?: unknown, _options?: unknown) {
        throw new Error("blob failed");
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
    vi.stubGlobal("Blob", ThrowingBlob as unknown as typeof Blob);

    const session = await startPttSession();
    await expect(session.stop()).rejects.toThrow("blob failed");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("rejects with a generic error if Blob creation throws a non-Error", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        this.onstop?.(new Event("stop"));
      }
    }

    class ThrowingBlob {
      constructor(_parts?: unknown, _options?: unknown) {
        throw "boom";
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
    vi.stubGlobal("Blob", ThrowingBlob as unknown as typeof Blob);

    const session = await startPttSession();
    await expect(session.stop()).rejects.toThrow("Failed to create Blob");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("rejects when MediaRecorder emits an error", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        this.onerror?.(new Event("error"));
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    const session = await startPttSession();
    await expect(session.stop()).rejects.toThrow("Recording error");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("stops tracks if MediaRecorder start throws", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {
        throw new Error("start failed");
      }

      stop() {}
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    await expect(startPttSession()).rejects.toThrow("start failed");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("stops tracks if MediaRecorder constructor throws", async () => {
    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      constructor(_stream: MediaStream) {
        throw new Error("ctor failed");
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    await expect(startPttSession()).rejects.toThrow("ctor failed");
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it("ignores errors when stopping tracks", async () => {
    const stopTrack = vi.fn(() => {
      throw new Error("stop failed");
    });
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });

    class FakeMediaRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((e: BlobEvent) => void) | null = null;
      onstop: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;

      constructor(_stream: MediaStream) {}

      start() {}

      stop() {
        const blob = new Blob([new Uint8Array([1])], { type: "audio/webm" });
        this.ondataavailable?.({ data: blob } as unknown as BlobEvent);
        this.onstop?.(new Event("stop"));
      }
    }

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);

    const session = await startPttSession();
    const blob = await session.stop();
    expect(blob.size).toBeGreaterThan(0);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
