import { describe, expect, it, vi } from "vitest";
import { performGestureAudioUnlock } from "./audio-unlock";

const flushMicrotasks = async (count = 10) => {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve();
  }
};

describe("performGestureAudioUnlock", () => {
  it("treats non-function global Audio as unavailable", async () => {
    const originalAudio = (globalThis as unknown as { Audio?: unknown }).Audio;
    try {
      (globalThis as unknown as { Audio?: unknown }).Audio = 123;
      performGestureAudioUnlock({ userAgent: "Chrome" });
      await flushMicrotasks();
    } finally {
      (globalThis as unknown as { Audio?: unknown }).Audio = originalAudio;
    }
  });
  it("does not create Audio instances in jsdom user agent", async () => {
    const created: unknown[] = [];
    class FakeAudio {
      constructor(_src: string) {
        created.push(_src);
      }
      volume = 0;
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => undefined);
    }

    performGestureAudioUnlock({
      userAgent: "jsdom",
      AudioCtor: FakeAudio as unknown as typeof Audio,
    });
    await flushMicrotasks();
    expect(created.length).toBe(0);
  });

  it("tries HTMLAudioElement unlock in non-jsdom and ignores pause errors", async () => {
    const created: FakeAudio[] = [];
    class FakeAudio {
      src: string;
      volume = 0;
      constructor(src: string) {
        this.src = src;
        created.push(this);
      }
      play = vi.fn(async () => undefined);
      pause = vi.fn(() => {
        throw new Error("pause boom");
      });
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: FakeAudio as unknown as typeof Audio,
    });
    await flushMicrotasks();
    expect(created.length).toBe(1);
    expect(created[0]!.play).toHaveBeenCalled();
    expect(created[0]!.pause).toHaveBeenCalled();
  });

  it("ignores HTMLAudioElement play() rejections", async () => {
    class FakeAudio {
      constructor(_src: string) {
        // noop
      }
      volume = 0;
      play = vi.fn(async () => {
        throw new Error("blocked");
      });
      pause = vi.fn(() => undefined);
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: FakeAudio as unknown as typeof Audio,
    });
    await flushMicrotasks();
  });

  it("ignores Audio constructor failures", async () => {
    class ThrowingAudio {
      constructor(_src: string) {
        throw new Error("ctor boom");
      }
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: ThrowingAudio as unknown as typeof Audio,
    });
    await flushMicrotasks();
  });

  it("does nothing when no AudioContext constructors are available", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const originalWebkit = (globalThis as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext;
    try {
      delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
      delete (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
      performGestureAudioUnlock({ userAgent: "Chrome", AudioCtor: null });
      await flushMicrotasks();
    } finally {
      (globalThis as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
      (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext =
        originalWebkit;
    }
  });

  it("resumes and closes AudioContext when resume resolves", async () => {
    class FakeAudioContext {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("catches close() errors on the resume-success path", async () => {
    class FakeAudioContext {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => {
        throw new Error("close boom");
      });
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("attempts to close AudioContext on resume rejection", async () => {
    class FakeAudioContext {
      resume = vi.fn(async () => {
        throw new Error("resume blocked");
      });
      close = vi.fn(async () => undefined);
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("catches close() errors on the resume-rejection path", async () => {
    class FakeAudioContext {
      resume = vi.fn(async () => {
        throw new Error("resume blocked");
      });
      close = vi.fn(async () => {
        throw new Error("close boom");
      });
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("catches errors when AudioContext constructor throws", async () => {
    class ThrowingAudioContext {
      constructor() {
        throw new Error("ctor boom");
      }
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: ThrowingAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("uses webkitAudioContextCtor when AudioContextCtor is not provided", async () => {
    class FakeAudioContext {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }

    performGestureAudioUnlock({
      userAgent: "Chrome",
      AudioCtor: null,
      AudioContextCtor: null,
      webkitAudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
    });
    await flushMicrotasks();
  });

  it("uses global webkitAudioContext when deps is not provided", async () => {
    const originalWebkit = (globalThis as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext;
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    try {
      delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;

      let constructed = 0;
      class FakeAudioContext {
        constructor() {
          constructed += 1;
        }
        resume = vi.fn(async () => undefined);
        close = vi.fn(async () => undefined);
      }

      (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext =
        FakeAudioContext as unknown as typeof AudioContext;

      performGestureAudioUnlock({ userAgent: "Chrome", AudioCtor: null });
      await flushMicrotasks();
      expect(constructed).toBe(1);
    } finally {
      (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext =
        originalWebkit;
      (globalThis as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    }
  });

  it("uses global AudioContext when available", async () => {
    const originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const originalWebkit = (globalThis as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext;
    try {
      let constructed = 0;
      class FakeAudioContext {
        constructor() {
          constructed += 1;
        }
        resume = vi.fn(async () => undefined);
        close = vi.fn(async () => undefined);
      }

      (globalThis as unknown as { AudioContext?: unknown }).AudioContext =
        FakeAudioContext as unknown as typeof AudioContext;
      delete (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

      performGestureAudioUnlock({ userAgent: "Chrome", AudioCtor: null });
      await flushMicrotasks();
      expect(constructed).toBe(1);
    } finally {
      (globalThis as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
      (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext =
        originalWebkit;
    }
  });
});
