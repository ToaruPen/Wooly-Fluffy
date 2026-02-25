import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

type MockServerMessage = { type: string; seq: number; data: unknown };
type ConnectHandlers = {
  onSnapshot: (data: unknown) => void;
  onMessage?: (message: MockServerMessage) => void;
  onError?: (error: Error) => void;
};

const DEBUG_PAGE_TEST_TIMEOUT_MS = 30_000;

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  vi.doUnmock("./sse-client");
  vi.doUnmock("./kiosk-tool-calls");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  resetDom();
});

describe("DevDebugLink", () => {
  it("renders when isDev=true", async () => {
    vi.resetModules();
    const { createRoot } = await import("react-dom/client");
    const { DevDebugLink } = await import("./dev-debug-link");

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(<DevDebugLink isDev={true} />);
    });

    expect(container.textContent ?? "").toContain("Open Debug");
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders nothing when isDev=false", async () => {
    vi.resetModules();
    const { createRoot } = await import("react-dom/client");
    const { DevDebugLink } = await import("./dev-debug-link");

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(<DevDebugLink isDev={false} />);
    });

    expect(container.textContent ?? "").not.toContain("Open Debug");
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});

describe("debug page", () => {
  it(
    "renders debug UI at /debug in DEV mode",
    async () => {
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
        vi.fn(async () => jsonResponse(200, { ok: true })),
      );

      window.history.pushState({}, "", "/debug");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        await import("./debug-page");
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await act(async () => {});

      const getDebugDlValue = (label: string): string => {
        const dts = Array.from(document.querySelectorAll("dt"));
        const dt = dts.find((el) => (el.textContent ?? "").trim() === label);
        if (!dt) {
          throw new Error(`Missing dt: ${label}`);
        }
        const dd = dt.nextElementSibling;
        if (!dd || dd.tagName.toLowerCase() !== "dd") {
          throw new Error(`Missing dd for: ${label}`);
        }
        return (dd.textContent ?? "").trim();
      };

      expect(document.body.textContent ?? "").toContain("Debug");
      expect(document.body.textContent ?? "").toContain("DEV-only diagnostics");
      expect(document.body.textContent ?? "").toContain("Connection");
      expect(document.body.textContent ?? "").toContain("Kiosk SSE");
      expect(document.body.textContent ?? "").toContain("disconnected");
      expect(document.body.textContent ?? "").toContain("State");
      expect(document.body.textContent ?? "").toContain("Errors");
      expect(document.body.textContent ?? "").toContain("Tool Calls");
      expect(document.body.textContent ?? "").toContain("Total calls");
      expect(document.body.textContent ?? "").toContain("Tool messages");
      expect(document.body.textContent ?? "").toContain("Messages");

      expect(document.body.textContent ?? "").not.toContain("passcode");
      expect(document.body.textContent ?? "").not.toContain("Passcode");

      expect(connectSseMock).toHaveBeenCalledWith("/api/v1/kiosk/stream", expect.any(Object));
      expect(connectSseMock).toHaveBeenCalledWith("/api/v1/staff/stream", expect.any(Object));

      const kioskHandlers = connectSseMock.mock.calls.find(
        (c) => c[0] === "/api/v1/kiosk/stream",
      )![1];
      const staffHandlers = connectSseMock.mock.calls.find(
        (c) => c[0] === "/api/v1/staff/stream",
      )![1];

      // Initial state: disconnected + no snapshot => show placeholder.
      expect(getDebugDlValue("Mode")).toBe("-");
      expect(getDebugDlValue("Phase")).toBe("-");

      // Cover the "unknown" branch when connected but snapshot is invalid.
      await act(async () => {
        kioskHandlers.onSnapshot({ state: { mode: "ROOM" } });
      });
      expect(getDebugDlValue("Mode")).toBe("unknown");
      expect(getDebugDlValue("Phase")).toBe("unknown");

      await act(async () => {
        kioskHandlers.onSnapshot({
          state: { mode: "ROOM", phase: "idle" },
        });
      });
      expect(document.body.textContent ?? "").toContain("connected");
      expect(document.body.textContent ?? "").toContain("ROOM");
      expect(document.body.textContent ?? "").toContain("idle");

      // Cover snapshot guards (do not crash on malformed payloads).
      await act(async () => {
        kioskHandlers.onSnapshot(null);
        kioskHandlers.onSnapshot({});
        kioskHandlers.onSnapshot({ state: null });
        kioskHandlers.onSnapshot({ state: { mode: "ROOM" } });
        kioskHandlers.onSnapshot({ state: { mode: "nope", phase: "idle" } });
      });

      await act(async () => {
        staffHandlers.onSnapshot({
          state: { mode: "ROOM", phase: "idle" },
        });
      });

      await act(async () => {
        kioskHandlers.onMessage?.({
          type: "kiosk.command.tool_calls",
          seq: 1,
          data: {
            tool_calls: [
              { id: "tc-1", function: { name: "get_weather" } },
              { id: "tc-2", function: { name: "search" } },
            ],
          },
        });
      });
      expect(document.body.textContent ?? "").toContain("2");
      expect(document.body.textContent ?? "").toContain("get_weather");
      expect(document.body.textContent ?? "").toContain("search");

      await act(async () => {
        kioskHandlers.onMessage?.({
          type: "kiosk.command.tool_calls",
          seq: 2,
          data: {
            tool_calls: [{ id: "tc-3", function: { name: "get_weather" } }],
          },
        });
      });
      expect(document.body.textContent ?? "").toContain("3");

      await act(async () => {
        kioskHandlers.onMessage?.({
          type: "kiosk.command.speak",
          seq: 2,
          data: { say_id: "s1", text: "hello" },
        });
      });

      await act(async () => {
        kioskHandlers.onMessage?.({
          type: "kiosk.error",
          seq: 3,
          data: {},
        });
      });
      expect(document.body.textContent ?? "").toContain("sse");

      await act(async () => {
        kioskHandlers.onError?.(new Error("connection lost"));
      });
      expect(document.body.textContent ?? "").toContain("sse");

      await act(async () => {
        staffHandlers.onError?.(new Error("connection lost"));
      });

      await act(async () => {
        staffHandlers.onMessage?.({
          type: "staff.session_summaries_pending_list",
          seq: 3,
          data: { items: [] },
        });
      });

      await act(async () => {
        staffHandlers.onMessage?.({
          type: "staff.error",
          seq: 4,
          data: {},
        });
      });

      await act(async () => {
        appRoot.unmount();
      });

      expect(closeSpy).toHaveBeenCalledTimes(2);
    },
    DEBUG_PAGE_TEST_TIMEOUT_MS,
  );

  it(
    "does not crash when tool_calls parsing throws",
    async () => {
      vi.resetModules();

      const closeSpy = vi.fn();
      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: closeSpy,
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });
      vi.doMock("./kiosk-tool-calls", () => ({
        parseKioskToolCallsData: () => {
          throw new Error("boom");
        },
      }));

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(200, { ok: true })),
      );

      window.history.pushState({}, "", "/debug");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        await import("./debug-page");
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      const kioskHandlers = connectSseMock.mock.calls.find(
        (c) => c[0] === "/api/v1/kiosk/stream",
      )![1];

      await act(async () => {
        kioskHandlers.onMessage?.({
          type: "kiosk.command.tool_calls",
          seq: 1,
          data: { tool_calls: [{ id: "tc-1", function: { name: "get_weather" } }] },
        });
      });

      expect(document.body.textContent ?? "").toContain("sse");

      await act(async () => {
        appRoot.unmount();
      });
      expect(closeSpy).toHaveBeenCalledTimes(2);
    },
    DEBUG_PAGE_TEST_TIMEOUT_MS,
  );
});
