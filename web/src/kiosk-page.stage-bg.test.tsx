import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createNullAudioPlayerMock,
  createNullVrmAvatarMock,
  createSseClientMockFactory,
} from "./test-helpers/kiosk-page-mocks";

vi.mock("./components/audio-player", () => createNullAudioPlayerMock());

vi.mock("./components/vrm-avatar", () => createNullVrmAvatarMock());

vi.mock("./sse-client", () => createSseClientMockFactory()());

const getStage = (container: HTMLElement) => {
  const stage = container.querySelector('section[aria-label="Mascot stage"]');
  expect(stage).toBeTruthy();
  return stage as HTMLElement;
};

describe("KioskPage stage background", () => {
  it("disables the image layer when VITE_KIOSK_STAGE_BG_URL is empty", async () => {
    vi.resetModules();

    const original = import.meta.env.VITE_KIOSK_STAGE_BG_URL;
    import.meta.env.VITE_KIOSK_STAGE_BG_URL = "";
    try {
      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const stage = getStage(container);
      expect(stage.style.getPropertyValue("--wf-kiosk-stage-bg")).toBe("none");

      act(() => root.unmount());
      document.body.removeChild(container);
    } finally {
      import.meta.env.VITE_KIOSK_STAGE_BG_URL = original;
    }
  });

  it("falls back to the bundled background when VITE_KIOSK_STAGE_BG_URL is http(s)", async () => {
    vi.resetModules();

    const original = import.meta.env.VITE_KIOSK_STAGE_BG_URL;
    import.meta.env.VITE_KIOSK_STAGE_BG_URL = "https://example.com/bg.png";
    try {
      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const stage = getStage(container);
      expect(stage.style.getPropertyValue("--wf-kiosk-stage-bg")).toBe(
        'url("/assets/stage-bg/kenney-uncolored-hills.png")',
      );

      act(() => root.unmount());
      document.body.removeChild(container);
    } finally {
      import.meta.env.VITE_KIOSK_STAGE_BG_URL = original;
    }
  });

  it("falls back to the bundled background when VITE_KIOSK_STAGE_BG_URL is protocol-relative", async () => {
    vi.resetModules();

    const original = import.meta.env.VITE_KIOSK_STAGE_BG_URL;
    import.meta.env.VITE_KIOSK_STAGE_BG_URL = "//cdn.example.com/bg.png";
    try {
      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const stage = getStage(container);
      expect(stage.style.getPropertyValue("--wf-kiosk-stage-bg")).toBe(
        'url("/assets/stage-bg/kenney-uncolored-hills.png")',
      );

      act(() => root.unmount());
      document.body.removeChild(container);
    } finally {
      import.meta.env.VITE_KIOSK_STAGE_BG_URL = original;
    }
  });

  it("uses a configured local path when VITE_KIOSK_STAGE_BG_URL is a relative/absolute path", async () => {
    vi.resetModules();

    const original = import.meta.env.VITE_KIOSK_STAGE_BG_URL;
    import.meta.env.VITE_KIOSK_STAGE_BG_URL = "/assets/stage-bg/custom.png";
    try {
      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const stage = getStage(container);
      expect(stage.style.getPropertyValue("--wf-kiosk-stage-bg")).toBe(
        'url("/assets/stage-bg/custom.png")',
      );

      act(() => root.unmount());
      document.body.removeChild(container);
    } finally {
      import.meta.env.VITE_KIOSK_STAGE_BG_URL = original;
    }
  });
});
