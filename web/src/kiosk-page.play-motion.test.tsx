import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNullAudioPlayerMock,
  createSseClientMockFactory,
  createVrmAvatarCaptureMock,
} from "./test-helpers/kiosk-page-mocks";

let latestSseHandlers: {
  onMessage?: (message: { type: string; seq: number; data: unknown }) => void;
} | null = null;

let latestMotionProps: unknown = null;

vi.mock("./components/audio-player", () => createNullAudioPlayerMock());

vi.mock("./components/vrm-avatar", () =>
  createVrmAvatarCaptureMock((props: unknown) => {
    const record = props as Record<string, unknown>;
    latestMotionProps = record.motion;
  })(),
);

vi.mock("./sse-client", () =>
  createSseClientMockFactory((handlers: unknown) => {
    latestSseHandlers = handlers as typeof latestSseHandlers;
  })(),
);

const KIOSK_PLAY_MOTION_TEST_TIMEOUT_MS = 10_000;

const getEnvRecord = (): Record<string, unknown> =>
  import.meta.env as unknown as Record<string, unknown>;

const setMotionDedupeEnv = (thinking: string | undefined, nonThinking: string | undefined) => {
  const env = getEnvRecord();
  env.VITE_KIOSK_MOTION_DEDUPE_THINKING = thinking;
  env.VITE_KIOSK_MOTION_DEDUPE_NON_THINKING = nonThinking;
};

const mountKioskPage = async () => {
  vi.resetModules();
  latestSseHandlers = null;
  latestMotionProps = null;
  const { KioskPage } = await import("./kiosk-page");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<KioskPage />);
    await Promise.resolve();
  });

  expect(latestSseHandlers).toBeTruthy();
  expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "boot-1" });

  return { root, container };
};

const emitPlayMotion = async (seq: number, motionId: string, motionInstanceId: string) => {
  await act(async () => {
    latestSseHandlers?.onMessage?.({
      type: "kiosk.command.play_motion",
      seq,
      data: { motion_id: motionId, motion_instance_id: motionInstanceId },
    });
    await Promise.resolve();
  });
};

describe("KioskPage play_motion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    "dedupes thinking by default while allowing repeated non-thinking motions",
    async () => {
      const env = getEnvRecord();
      const previousThinking = env.VITE_KIOSK_MOTION_DEDUPE_THINKING;
      const previousNonThinking = env.VITE_KIOSK_MOTION_DEDUPE_NON_THINKING;

      setMotionDedupeEnv(undefined, undefined);
      const { root, container } = await mountKioskPage();
      try {
        await emitPlayMotion(1, "thinking", "m-1");
        expect(latestMotionProps).toEqual({ motionId: "thinking", motionInstanceId: "m-1" });

        await emitPlayMotion(2, "thinking", "m-2");
        expect(latestMotionProps).toEqual({ motionId: "thinking", motionInstanceId: "m-1" });

        await emitPlayMotion(21, "dance", "m-invalid");
        expect(latestMotionProps).toEqual({ motionId: "thinking", motionInstanceId: "m-1" });

        await emitPlayMotion(3, "idle", "m-3");
        expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-3" });

        await emitPlayMotion(4, "idle", "m-4");
        expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-4" });

        await emitPlayMotion(22, "cheer", "m-dup");
        expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-dup" });

        await emitPlayMotion(23, "idle", "m-dup");
        expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-dup" });

        const w = window as unknown as { __wfPlayMotion?: (motionId: unknown) => void };
        await act(async () => {
          w.__wfPlayMotion?.("dance");
          await Promise.resolve();
        });
        expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-dup" });

        await act(async () => {
          w.__wfPlayMotion?.("idle");
          await Promise.resolve();
        });
        expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "dev-1" });
      } finally {
        act(() => root.unmount());
        container.remove();
        setMotionDedupeEnv(
          typeof previousThinking === "string" ? previousThinking : undefined,
          typeof previousNonThinking === "string" ? previousNonThinking : undefined,
        );
      }
    },
    KIOSK_PLAY_MOTION_TEST_TIMEOUT_MS,
  );

  it(
    "supports env toggles for thinking and non-thinking dedupe",
    async () => {
      const env = getEnvRecord();
      const previousThinking = env.VITE_KIOSK_MOTION_DEDUPE_THINKING;
      const previousNonThinking = env.VITE_KIOSK_MOTION_DEDUPE_NON_THINKING;

      setMotionDedupeEnv("false", "true");
      const { root, container } = await mountKioskPage();
      try {
        await emitPlayMotion(1, "thinking", "m-1");
        expect(latestMotionProps).toEqual({ motionId: "thinking", motionInstanceId: "m-1" });

        await emitPlayMotion(2, "thinking", "m-2");
        expect(latestMotionProps).toEqual({ motionId: "thinking", motionInstanceId: "m-2" });

        await emitPlayMotion(3, "cheer", "m-3");
        expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-3" });

        await emitPlayMotion(4, "cheer", "m-4");
        expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-3" });

        await emitPlayMotion(5, "idle", "m-5");
        expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-5" });

        await emitPlayMotion(6, "idle", "m-6");
        expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-5" });
      } finally {
        act(() => root.unmount());
        container.remove();
        setMotionDedupeEnv(
          typeof previousThinking === "string" ? previousThinking : undefined,
          typeof previousNonThinking === "string" ? previousNonThinking : undefined,
        );
      }
    },
    KIOSK_PLAY_MOTION_TEST_TIMEOUT_MS,
  );
});
