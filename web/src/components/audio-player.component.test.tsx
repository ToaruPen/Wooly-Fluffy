import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_ERROR_PLAY_BLOCKED, AUDIO_ERROR_UNSUPPORTED, AudioPlayer } from "./audio-player";

type FakeAudioInstance = {
  src: string;
  onended: (() => void) | null;
  play: () => Promise<void>;
  pause: () => void;
};

describe("AudioPlayer (component)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls onError when Audio/URL are not available", async () => {
    vi.stubGlobal("Audio", undefined as unknown as typeof Audio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    const onError = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayer wav={new ArrayBuffer(1)} playId={1} onError={onError} onLevel={vi.fn()} />,
      );
    });

    expect(onError).toHaveBeenCalledWith(1, AUDIO_ERROR_UNSUPPORTED);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("plays audio, reports level, and calls onEnded", async () => {
    const createObjectURL = vi.fn(() => "blob:tts");
    const revokeObjectURL = vi.fn(() => undefined);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL } as unknown as typeof URL);

    const instances: FakeAudioInstance[] = [];
    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    let rafCalls = 0;
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      if (rafCalls === 0) {
        rafCalls += 1;
        cb(0);
      }
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", rafSpy as unknown as typeof requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn() as unknown as typeof cancelAnimationFrame);

    class FakeAnalyser {
      fftSize = 0;
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => undefined);
      getByteTimeDomainData = (buffer: Uint8Array) => {
        buffer.fill(128);
      };
    }

    class FakeSource {
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => undefined);
    }

    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createMediaElementSource = vi.fn(
        () => new FakeSource() as unknown as MediaElementAudioSourceNode,
      );
      createAnalyser = () => new FakeAnalyser() as unknown as AnalyserNode;
      resume = vi.fn(async () => {
        this.state = "running";
      });
      close = vi.fn(async () => undefined);
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const onLevel = vi.fn();
    const onEnded = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayer wav={new ArrayBuffer(1)} playId={7} onLevel={onLevel} onEnded={onEnded} />,
      );
      await Promise.resolve();
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(instances.length).toBe(1);
    expect(instances[0]!.src).toBe("blob:tts");
    expect(instances[0]!.play).toHaveBeenCalled();
    expect(onLevel).toHaveBeenCalledWith(7, expect.any(Number));

    expect(
      (window as unknown as { AudioContext?: { prototype?: unknown } }).AudioContext,
    ).toBeTruthy();

    instances[0]!.onended?.();
    expect(onEnded).toHaveBeenCalledWith(7);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tts");

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("calls onError when audio.play rejects and still cleans up", async () => {
    const createObjectURL = vi.fn(() => "blob:tts");
    const revokeObjectURL = vi.fn(() => undefined);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL } as unknown as typeof URL);

    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => {
        const err = new Error("blocked");
        (err as unknown as { name: string }).name = "NotAllowedError";
        throw err;
      });
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const onError = vi.fn();
    const onLevel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AudioPlayer wav={new ArrayBuffer(1)} playId={2} onError={onError} onLevel={onLevel} />,
      );
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(2, AUDIO_ERROR_PLAY_BLOCKED);
    expect(onLevel).toHaveBeenCalledWith(2, 0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:tts");

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("ignores callbacks from an old runtime after replay", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    const instances: FakeAudioInstance[] = [];
    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const onEnded = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} onEnded={onEnded} />);
    });
    expect(instances.length).toBe(1);
    const oldOnEnded = instances[0]!.onended;

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(2)} playId={2} onEnded={onEnded} />);
    });
    expect(instances.length).toBe(2);

    oldOnEnded?.();
    expect(onEnded).not.toHaveBeenCalledWith(1);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("keeps playing even if WebAudio setup throws", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    class ThrowingAudioContext {
      constructor() {
        throw new Error("boom");
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = ThrowingAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
    });

    expect(FakeAudio.instances.length).toBe(1);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("falls back to direct playback when audioContext.resume rejects", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => {
        throw new Error("no-gesture");
      });
      close = vi.fn(async () => {
        throw new Error("close");
      });
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
    });

    expect(FakeAudio.instances.length).toBe(1);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();
    // If resume fails, do not route the media element through AudioContext.
    expect(ctxInstances.length).toBe(1);
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("closes audioContext cleanly when resume rejects", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => {
        throw new Error("no-gesture");
      });
      close = vi.fn(async () => undefined);
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeAudio.instances.length).toBe(1);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();
    expect(ctxInstances.length).toBe(1);
    expect(ctxInstances[0]!.close).toHaveBeenCalled();
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("avoids routing audio when audioContext does not become running", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => {
        throw new Error("close");
      });
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeAudio.instances.length).toBe(1);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();
    expect(ctxInstances.length).toBe(1);
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("closes audioContext cleanly when it does not become running", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      static instances: FakeAudio[] = [];
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
        FakeAudio.instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeAudio.instances.length).toBe(1);
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalled();
    expect(ctxInstances.length).toBe(1);
    expect(ctxInstances[0]!.close).toHaveBeenCalled();
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("closes audioContext when runtime changes before resume completes", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    let resumeResolve!: () => void;
    const resumePromise = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => {
        await resumePromise;
        this.state = "running";
      });
      close = vi.fn(async () => {
        throw new Error("close");
      });
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(2)} playId={2} />);
      await Promise.resolve();
    });

    resumeResolve();
    await Promise.resolve();

    expect(ctxInstances.length).toBe(2);
    expect(ctxInstances[0]!.close).toHaveBeenCalled();
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("closes audioContext cleanly when runtime changes before resume completes", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    let resumeResolve!: () => void;
    const resumePromise = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    const ctxInstances: FakeAudioContext[] = [];
    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = vi.fn(() => ({
        fftSize: 0,
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
        getByteTimeDomainData: vi.fn(() => undefined),
      })) as unknown as () => AnalyserNode;
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(() => undefined),
        disconnect: vi.fn(() => undefined),
      })) as unknown as () => MediaElementAudioSourceNode;
      constructor() {
        ctxInstances.push(this);
      }
      resume = vi.fn(async () => {
        await resumePromise;
        this.state = "running";
      });
      close = vi.fn(async () => undefined);
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} />);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(2)} playId={2} />);
      await Promise.resolve();
    });

    resumeResolve();
    await Promise.resolve();

    expect(ctxInstances.length).toBe(2);
    expect(ctxInstances[0]!.close).toHaveBeenCalled();
    expect(ctxInstances[0]!.createMediaElementSource).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("returns early in tick when runtime changes", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    const tickHolder: { cb: (() => void) | null } = { cb: null };
    vi.stubGlobal("requestAnimationFrame", ((cb: () => void) => {
      tickHolder.cb = cb;
      return 1;
    }) as unknown as typeof requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn() as unknown as typeof cancelAnimationFrame);

    class FakeAnalyser {
      fftSize = 2048;
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => undefined);
      getByteTimeDomainData = (_buffer: Uint8Array) => undefined;
    }

    class FakeSource {
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => undefined);
    }

    class FakeAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = () => new FakeAnalyser() as unknown as AnalyserNode;
      createMediaElementSource = () => new FakeSource() as unknown as MediaElementAudioSourceNode;
      resume = vi.fn(async () => {
        this.state = "running";
      });
      close = vi.fn(async () => undefined);
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;

    const onLevel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} onLevel={onLevel} />);
      await Promise.resolve();
    });

    const oldTick = tickHolder.cb;
    expect(oldTick).toBeTruthy();

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(2)} playId={2} onLevel={onLevel} />);
      await Promise.resolve();
    });

    const beforeCalls = onLevel.mock.calls.length;
    (oldTick as () => void)();
    expect(onLevel.mock.calls.length).toBe(beforeCalls);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("swallows disconnect/close errors during cleanup", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:tts"),
      revokeObjectURL: vi.fn(() => undefined),
    } as unknown as typeof URL);

    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
      constructor(src: string) {
        this.src = src;
      }
    }
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);

    class ThrowingSource {
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => {
        throw new Error("disconnect");
      });
    }

    class ThrowingAnalyser {
      fftSize = 2048;
      connect = vi.fn(() => undefined);
      disconnect = vi.fn(() => {
        throw new Error("disconnect");
      });
      getByteTimeDomainData = (_buffer: Uint8Array) => undefined;
    }

    class ThrowingAudioContext {
      state: AudioContextState = "suspended";
      destination = {} as AudioDestinationNode;
      createAnalyser = () => new ThrowingAnalyser() as unknown as AnalyserNode;
      createMediaElementSource = () =>
        new ThrowingSource() as unknown as MediaElementAudioSourceNode;
      resume = vi.fn(async () => {
        this.state = "running";
      });
      close = vi.fn(async () => {
        throw new Error("close");
      });
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = ThrowingAudioContext;

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1) as unknown as typeof requestAnimationFrame,
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn() as unknown as typeof cancelAnimationFrame);

    const onLevel = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<AudioPlayer wav={new ArrayBuffer(1)} playId={1} onLevel={onLevel} />);
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    document.body.removeChild(container);
  });
});
