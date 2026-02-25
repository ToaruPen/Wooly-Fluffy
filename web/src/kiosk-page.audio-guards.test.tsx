import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createAudioPlayerCaptureMock,
  createNullVrmAvatarMock,
  createSseClientMockFactory,
} from "./test-helpers/kiosk-page-mocks";

let latestAudioPlayerProps: {
  onLevel?: (playId: number, level: number) => void;
  onEnded?: (playId: number) => void;
  onError?: (playId: number, message: string) => void;
} | null = null;

vi.mock("./components/audio-player", () =>
  createAudioPlayerCaptureMock((props: unknown) => {
    latestAudioPlayerProps = props as typeof latestAudioPlayerProps;
  })(),
);

vi.mock("./components/vrm-avatar", () => createNullVrmAvatarMock());

vi.mock("./sse-client", () => createSseClientMockFactory()());

describe("KioskPage audio callback guards", () => {
  it("ignores stale AudioPlayer callbacks", async () => {
    vi.resetModules();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    expect(latestAudioPlayerProps).toBeTruthy();

    await act(async () => {
      latestAudioPlayerProps?.onLevel?.(999, 0.5);
      latestAudioPlayerProps?.onEnded?.(999);
      latestAudioPlayerProps?.onError?.(999, "boom");
      await Promise.resolve();
    });

    expect(container.textContent ?? "").not.toContain("おとがでないみたい");

    act(() => root.unmount());
    document.body.removeChild(container);
  });
});
