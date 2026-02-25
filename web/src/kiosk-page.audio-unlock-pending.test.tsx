import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "./sse-client";
import {
  createNullAudioPlayerMock,
  createNullVrmAvatarMock,
  createSseClientMockFactory,
} from "./test-helpers/kiosk-page-mocks";

let connectHandlers: {
  onSnapshot?: (data: unknown) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (error: Error) => void;
} | null = null;

const postJson = vi.fn(async (_path: string, _body: unknown) => {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(1),
  };
});

vi.mock("./api", () => ({
  postJson,
  postJsonWithTimeout: postJson,
  postFormData: vi.fn(async () => ({ ok: true, status: 202 })),
}));

vi.mock("./components/audio-player", () => createNullAudioPlayerMock());

vi.mock("./components/vrm-avatar", () => createNullVrmAvatarMock());

vi.mock("./sse-client", () =>
  createSseClientMockFactory((handlers: unknown) => {
    connectHandlers = handlers as typeof connectHandlers;
  })(),
);

const AUDIO_UNLOCK_PENDING_TEST_TIMEOUT_MS = 10_000;

describe("KioskPage pending TTS after audio unlock", () => {
  it(
    "queues speak while locked and plays after user gesture unlock",
    async () => {
      vi.resetModules();
      postJson.mockClear();

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      expect(connectHandlers).toBeTruthy();

      await act(async () => {
        connectHandlers?.onMessage?.({
          type: "kiosk.command.speak",
          seq: 1,
          data: { say_id: "s-1", text: "hello" },
        });
        // Same say_id while still locked should be ignored (dedupe guard).
        connectHandlers?.onMessage?.({
          type: "kiosk.command.speak",
          seq: 2,
          data: { say_id: "s-1", text: "hello" },
        });
        await Promise.resolve();
      });

      // Locked: should show the unlock hint and not attempt TTS yet.
      expect(container.textContent ?? "").toContain("おとをだすには 1かい タップしてね");
      expect(postJson).not.toHaveBeenCalledWith("/api/v1/kiosk/tts", expect.anything());

      await act(async () => {
        // Dispatch twice to cover the "already unlocked" early-return guard.
        window.dispatchEvent(new Event("pointerdown"));
        window.dispatchEvent(new Event("pointerdown"));
        await Promise.resolve();
      });

      // Unlocked: should now fetch TTS for the queued text.
      expect(postJson).toHaveBeenCalledWith("/api/v1/kiosk/tts", { text: "hello" });

      act(() => root.unmount());
      document.body.removeChild(container);
    },
    AUDIO_UNLOCK_PENDING_TEST_TIMEOUT_MS,
  );
});
