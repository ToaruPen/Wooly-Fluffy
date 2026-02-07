import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

let latestSseHandlers: {
  onMessage?: (message: { type: string; seq: number; data: unknown }) => void;
} | null = null;

let latestMotionProps: unknown = null;

vi.mock("./components/audio-player", () => ({
  AudioPlayer: () => null,
}));

vi.mock("./components/vrm-avatar", () => ({
  VrmAvatar: (props: unknown) => {
    const record = props as Record<string, unknown>;
    latestMotionProps = record.motion;
    return null;
  },
}));

vi.mock("./sse-client", async () => {
  const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
  return {
    ...actual,
    connectSse: (_url: string, handlers: unknown) => {
      latestSseHandlers = handlers as typeof latestSseHandlers;
      return { close: () => undefined };
    },
  };
});

describe("KioskPage play_motion", () => {
  it("passes allowlisted play_motion to VrmAvatar and de-dupes by motion_instance_id", async () => {
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

    await act(async () => {
      latestSseHandlers?.onMessage?.({
        type: "kiosk.command.play_motion",
        seq: 1,
        data: { motion_id: "idle", motion_instance_id: "m-1" },
      });
      await Promise.resolve();
    });
    expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-1" });

    // Same instance id -> ignore
    await act(async () => {
      latestSseHandlers?.onMessage?.({
        type: "kiosk.command.play_motion",
        seq: 2,
        data: { motion_id: "cheer", motion_instance_id: "m-1" },
      });
      await Promise.resolve();
    });
    expect(latestMotionProps).toEqual({ motionId: "idle", motionInstanceId: "m-1" });

    // Different instance id -> update
    await act(async () => {
      latestSseHandlers?.onMessage?.({
        type: "kiosk.command.play_motion",
        seq: 3,
        data: { motion_id: "cheer", motion_instance_id: "m-2" },
      });
      await Promise.resolve();
    });
    expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-2" });

    // Non-allowlisted -> ignore
    await act(async () => {
      latestSseHandlers?.onMessage?.({
        type: "kiosk.command.play_motion",
        seq: 4,
        data: { motion_id: "dance", motion_instance_id: "m-3" },
      });
      await Promise.resolve();
    });
    expect(latestMotionProps).toEqual({ motionId: "cheer", motionInstanceId: "m-2" });

    // Dev helper (if enabled): should ignore unknown and accept allowlisted.
    const w = window as unknown as { __wfPlayMotion?: (motionId: unknown) => void };
    await act(async () => {
      w.__wfPlayMotion?.("dance");
      w.__wfPlayMotion?.("idle");
      await Promise.resolve();
    });

    act(() => root.unmount());
    document.body.removeChild(container);
  });
});
