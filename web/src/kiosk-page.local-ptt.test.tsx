import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "./sse-client";

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

const postJsonWithTimeout = vi.fn(async (_path: string, _body: unknown, _timeoutMs: number) => {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(1),
  };
});

vi.mock("./api", () => ({
  postJson,
  postJsonWithTimeout,
  postFormData: vi.fn(async () => ({ ok: true, status: 202 })),
}));

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
      connectHandlers = handlers as typeof connectHandlers;
      return { close: () => undefined };
    },
  };
});

const KIOSK_LOCAL_PTT_TEST_TIMEOUT_MS = 10_000;

describe("KioskPage local PTT", () => {
  it("sends KIOSK_PTT_DOWN on Space keydown and KIOSK_PTT_UP on keyup", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

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
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_UP" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("disables local PTT controls while stream is reconnecting", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });

    const initialDownCalls = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(initialDownCalls.length).toBe(1);

    postJsonWithTimeout.mockClear();

    await act(async () => {
      connectHandlers?.onError?.(new Error("SSE connection error"));
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(true);
    expect(container.textContent ?? "").toContain("つながるまで ちょっとまってね");

    const upCalls = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
    );
    expect(upCalls.length).toBe(1);

    postJsonWithTimeout.mockClear();

    await act(async () => {
      button?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      button?.dispatchEvent(new Event("pointercancel", { bubbles: true }));
      button?.dispatchEvent(new Event("pointerleave", { bubbles: true }));
      button?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    const downCallsWhileDisconnected = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(downCallsWhileDisconnected.length).toBe(0);

    await act(async () => {
      connectHandlers?.onSnapshot?.({
        state: {
          phase: "idle",
          consent_ui_visible: false,
        },
      });
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);
    expect(container.textContent ?? "").not.toContain("つながるまで ちょっとまってね");

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("keeps local PTT enabled on non-transport SSE errors", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeTruthy();

    await act(async () => {
      connectHandlers?.onError?.(new Error("Invalid SSE message"));
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);
    expect(container.textContent ?? "").not.toContain("つながるまで ちょっとまってね");

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("ignores Space key repeats and prevents default while held", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const repeatBeforeHold = new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      repeat: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(repeatBeforeHold);
      await Promise.resolve();
    });
    expect(repeatBeforeHold.defaultPrevented).toBe(false);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true }),
      );
      await Promise.resolve();
    });

    const downCalls = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(downCalls.length).toBe(1);

    const repeatWhileHeld = new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      repeat: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(repeatWhileHeld);
      await Promise.resolve();
    });
    expect(repeatWhileHeld.defaultPrevented).toBe(true);

    const downCallsAfter = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(downCallsAfter.length).toBe(1);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("sends KIOSK_PTT_DOWN on on-screen button pointerdown and KIOSK_PTT_UP on pointerup", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerup", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_UP" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("releases local PTT on pointercancel", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointercancel", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_UP" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("releases local PTT on pointerleave", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      // React implements onPointerLeave via pointerout (since pointerleave does not bubble).
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_UP" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("releases local PTT on window blur", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_UP" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it(
    "ignores visibilitychange when local PTT is not held",
    async () => {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const beforeUpCalls = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
      ).length;

      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });

      const afterUpCalls = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
      ).length;
      expect(afterUpCalls).toBe(beforeUpCalls);

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
    KIOSK_LOCAL_PTT_TEST_TIMEOUT_MS,
  );

  it(
    "handles interactive focus and non-space keyup guards",
    async () => {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      const countDown = () =>
        postJsonWithTimeout.mock.calls.filter(
          ([path, body]) =>
            path === "/api/v1/kiosk/event" &&
            (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
        ).length;
      const countUp = () =>
        postJsonWithTimeout.mock.calls.filter(
          ([path, body]) =>
            path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
        ).length;

      const beforeNonSpaceKeyUp = postJsonWithTimeout.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA", key: "a" }));
        await Promise.resolve();
      });
      expect(postJsonWithTimeout.mock.calls.length).toBe(beforeNonSpaceKeyUp);

      const beforeSpaceKeyUpWhileIdle = postJsonWithTimeout.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });
      expect(postJsonWithTimeout.mock.calls.length).toBe(beforeSpaceKeyUpWhileIdle);

      const input = document.createElement("input");
      document.body.appendChild(input);
      const beforeInput = countDown();
      await act(async () => {
        input.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });
      expect(countDown()).toBe(beforeInput);
      document.body.removeChild(input);

      const roleButton = document.createElement("div");
      roleButton.setAttribute("role", "button");
      roleButton.tabIndex = 0;
      document.body.appendChild(roleButton);
      const beforeRole = countDown();
      await act(async () => {
        roleButton.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });
      expect(countDown()).toBe(beforeRole);
      document.body.removeChild(roleButton);

      const editDiv = document.createElement("div");
      editDiv.setAttribute("contenteditable", "true");
      editDiv.tabIndex = 0;
      document.body.appendChild(editDiv);
      const beforeEdit = countDown();
      await act(async () => {
        editDiv.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });
      expect(countDown()).toBe(beforeEdit);
      document.body.removeChild(editDiv);

      const beforeNullDown = countDown();
      const beforeNullUp = countUp();
      Object.defineProperty(document, "activeElement", { value: null, configurable: true });
      try {
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
          await Promise.resolve();
        });
      } finally {
        delete (document as unknown as Record<string, unknown>).activeElement;
      }
      expect(countDown()).toBe(beforeNullDown + 1);
      expect(countUp()).toBe(beforeNullUp + 1);

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
    KIOSK_LOCAL_PTT_TEST_TIMEOUT_MS,
  );

  it("does not send duplicate down when button is pressed while Space is held", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent ?? "").includes("おして"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    const downCalls = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(downCalls.length).toBe(1);

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await Promise.resolve();
    });

    const downCallsAfter = postJsonWithTimeout.mock.calls.filter(
      ([path, body]) =>
        path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
    );
    expect(downCallsAfter.length).toBe(1);

    await act(async () => {
      (button as HTMLButtonElement).dispatchEvent(new Event("pointerup", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("swallows kiosk event post failures", async () => {
    vi.resetModules();
    postJsonWithTimeout.mockClear();
    postJsonWithTimeout.mockRejectedValueOnce(new Error("boom"));

    const { KioskPage } = await import("./kiosk-page");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<KioskPage />);
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
      await Promise.resolve();
    });

    expect(postJsonWithTimeout).toHaveBeenCalledWith(
      "/api/v1/kiosk/event",
      { type: "KIOSK_PTT_DOWN" },
      3000,
    );

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("still sends KIOSK_PTT_UP on release after a failed KIOSK_PTT_DOWN response", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = (body as { type?: unknown } | null)?.type;
        if (type === "KIOSK_PTT_DOWN") {
          return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) };
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      expect(postJsonWithTimeout).toHaveBeenCalledWith(
        "/api/v1/kiosk/event",
        { type: "KIOSK_PTT_UP" },
        3000,
      );

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-sends KIOSK_PTT_DOWN after a failed KIOSK_PTT_UP response when pressed again", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      let upAttempt = 0;
      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = (body as { type?: unknown } | null)?.type;
        if (type === "KIOSK_PTT_UP") {
          upAttempt += 1;
          if (upAttempt === 1) {
            return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) };
          }
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      const downCalls = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
      );
      expect(downCalls.length).toBe(2);

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule a retry after unmount when a request resolves as failed", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      type ApiResponse = { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> };
      const pending: Array<{ type: string; resolve: (value: ApiResponse) => void }> = [];
      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = String((body as { type?: unknown } | null)?.type ?? "");
        return await new Promise<ApiResponse>((resolve) => {
          pending.push({ type, resolve });
        });
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      const down = pending.find((p) => p.type === "KIOSK_PTT_DOWN");
      expect(down).toBeTruthy();

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);

      await act(async () => {
        down?.resolve({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) });
        await Promise.resolve();
      });

      const up = pending.find((p) => p.type === "KIOSK_PTT_UP");
      if (up) {
        await act(async () => {
          up.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) });
          await Promise.resolve();
        });
      }

      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("sends final KIOSK_PTT_UP after an in-flight send resolves on unmount", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      type ApiResponse = { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> };
      const pending: Array<{ type: string; resolve: (value: ApiResponse) => void }> = [];
      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = String((body as { type?: unknown } | null)?.type ?? "");
        return await new Promise<ApiResponse>((resolve) => {
          pending.push({ type, resolve });
        });
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      expect(postJsonWithTimeout.mock.calls.length).toBe(1);
      expect(pending[0]?.type).toBe("KIOSK_PTT_DOWN");

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);

      // With in-flight send, cleanup should not fire UP immediately.
      expect(postJsonWithTimeout.mock.calls.length).toBe(1);

      await act(async () => {
        pending[0]?.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) });
        await Promise.resolve();
      });

      expect(postJsonWithTimeout).toHaveBeenCalledWith(
        "/api/v1/kiosk/event",
        { type: "KIOSK_PTT_UP" },
        3000,
      );

      const up = pending.find((p) => p.type === "KIOSK_PTT_UP");
      if (up) {
        await act(async () => {
          up.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) });
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends final KIOSK_PTT_UP on unmount even after quick release when DOWN is still in-flight", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      type ApiResponse = { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> };
      const pending: Array<{ type: string; resolve: (value: ApiResponse) => void }> = [];
      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = String((body as { type?: unknown } | null)?.type ?? "");
        return await new Promise<ApiResponse>((resolve) => {
          pending.push({ type, resolve });
        });
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      // DOWN is still in-flight; keyup cannot send UP yet.
      expect(postJsonWithTimeout.mock.calls.length).toBe(1);
      expect(pending[0]?.type).toBe("KIOSK_PTT_DOWN");

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);

      // Cleanup should not fire UP immediately while in-flight.
      expect(postJsonWithTimeout.mock.calls.length).toBe(1);

      await act(async () => {
        pending[0]?.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) });
        await Promise.resolve();
      });

      expect(postJsonWithTimeout).toHaveBeenCalledWith(
        "/api/v1/kiosk/event",
        { type: "KIOSK_PTT_UP" },
        3000,
      );

      const up = pending.find((p) => p.type === "KIOSK_PTT_UP");
      if (up) {
        await act(async () => {
          up.resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) });
          await Promise.resolve();
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries KIOSK_PTT_UP when the release post fails", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      let upAttempt = 0;

      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = (body as { type?: unknown } | null)?.type;

        if (type === "KIOSK_PTT_UP") {
          upAttempt += 1;
        }

        if (type === "KIOSK_PTT_UP" && upAttempt === 1) {
          return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) };
        }

        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      const upCallsInitial = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
      );
      expect(upCallsInitial.length).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      const upCallsAfterRetry = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_UP",
      );
      expect(upCallsAfterRetry.length).toBe(2);

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries KIOSK_PTT_DOWN when the press post fails", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      let downAttempt = 0;
      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = (body as { type?: unknown } | null)?.type;
        if (type === "KIOSK_PTT_DOWN") {
          downAttempt += 1;
          if (downAttempt === 1) {
            return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) };
          }
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      const downCallsInitial = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
      );
      expect(downCallsInitial.length).toBe(1);

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      const downCallsAfterRetry = postJsonWithTimeout.mock.calls.filter(
        ([path, body]) =>
          path === "/api/v1/kiosk/event" && (body as { type?: unknown }).type === "KIOSK_PTT_DOWN",
      );
      expect(downCallsAfterRetry.length).toBe(2);

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the pending release retry timeout on unmount", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    try {
      vi.resetModules();
      postJsonWithTimeout.mockClear();

      postJsonWithTimeout.mockImplementation(async (_path: string, body: unknown) => {
        const type = (body as { type?: unknown } | null)?.type;
        if (type === "KIOSK_PTT_UP") {
          return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(1) };
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
      });

      const { KioskPage } = await import("./kiosk-page");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(<KioskPage />);
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
        await Promise.resolve();
      });

      await act(async () => {
        root.unmount();
      });
      document.body.removeChild(container);

      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
