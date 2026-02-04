import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

let latestSseHandlers: {
  onMessage?: (message: { type: string; seq: number; data: unknown }) => void;
} | null = null;

vi.mock("./components/audio-player", () => ({
  AudioPlayer: () => null,
}));

vi.mock("./components/vrm-avatar", () => ({
  VrmAvatar: () => null,
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

describe("KioskPage tool_calls", () => {
  it("tracks kiosk.command.tool_calls count without rendering details", async () => {
    vi.resetModules();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    expect(latestSseHandlers).toBeTruthy();

    await act(async () => {
      latestSseHandlers?.onMessage?.({
        type: "kiosk.command.tool_calls",
        seq: 1,
        data: {
          tool_calls: [
            {
              id: "call-1",
              function: { name: "get_weather", arguments: "{}" },
            },
          ],
        },
      });
      await Promise.resolve();
    });

    const rootDiv = container.querySelector("[data-wf-tool-calls-count]");
    expect(rootDiv?.getAttribute("data-wf-tool-calls-count")).toBe("1");

    act(() => root.unmount());
    document.body.removeChild(container);
  });
});
