import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

type MockServerMessage = { type: string; seq: number; data: unknown };
type ConnectHandlers = {
  onSnapshot: (data: unknown) => void;
  onMessage?: (message: MockServerMessage) => void;
  onError?: (error: Error) => void;
};

const STAFF_TEST_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

const resetDom = () => {
  document.body.innerHTML = "";
  window.history.pushState({}, "", "/");
};

afterEach(() => {
  vi.doUnmock("./sse-client");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  resetDom();
});

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const setNativeInputValue = (input: HTMLInputElement, value: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const setter = descriptor?.set;
  if (!setter) {
    throw new Error("Missing input value setter");
  }
  setter.call(input, value);
};

const signInStaffPage = async () => {
  const input = document.querySelector("input");
  const signIn = Array.from(document.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Sign in"),
  );
  expect(input).toBeTruthy();
  expect(signIn).toBeTruthy();

  await act(async () => {
    if (input) {
      setNativeInputValue(input, "pass");
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    signIn?.click();
  });
};

describe("staff auth and error flows", () => {
  it(
    "covers login/pending/event/keepalive error paths",
    async () => {
      vi.resetModules();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: "unauthorized", message: "x" } }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
        .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
        .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(jsonResponse(500, { error: { code: "boom", message: "boom" } }))
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: "unauthorized", message: "x" } }),
        );
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/staff");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await signInStaffPage();
      await act(async () => {});
      expect(document.body.textContent ?? "").toContain("Network error");

      await signInStaffPage();
      await act(async () => {});
      expect(document.body.textContent ?? "").toContain("Unauthorized");

      await signInStaffPage();
      await act(async () => {});
      expect(connectSseMock).toHaveBeenCalledWith("/api/v1/staff/stream", expect.any(Object));
      expect(document.body.textContent ?? "").toContain("HTTP 500");

      const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Force ROOM"),
      );
      expect(forceRoom).toBeTruthy();

      await act(async () => {
        forceRoom?.click();
      });
      expect(document.body.textContent ?? "").toContain("HTTP 500");

      await act(async () => {
        forceRoom?.click();
      });
      expect(document.body.textContent ?? "").toContain("Network error");

      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      });
      expect(document.body.textContent ?? "").toContain("HTTP 500");

      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      });
      expect(document.body.textContent ?? "").toContain("Network error");

      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS);
      });
      expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

      await act(async () => {
        appRoot!.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "locks on staff event 401",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/staff/auth/login" && method === "POST") {
          return jsonResponse(200, { ok: true });
        }
        if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
          return jsonResponse(200, { items: [] });
        }
        if (url === "/api/v1/staff/event" && method === "POST") {
          return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
        }
        return jsonResponse(200, { ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/staff");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await signInStaffPage();

      const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Force ROOM"),
      );
      expect(forceRoom).toBeTruthy();
      await act(async () => {
        forceRoom?.click();
      });
      expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

      await act(async () => {
        appRoot!.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "locks when pending GET returns 401",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/staff/auth/login" && method === "POST") {
          return jsonResponse(200, { ok: true });
        }
        if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
          return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
        }
        return jsonResponse(200, { ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/staff");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await signInStaffPage();
      expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

      await act(async () => {
        appRoot!.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "shows pending network error when pending GET throws",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/staff/auth/login" && method === "POST") {
          return jsonResponse(200, { ok: true });
        }
        if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
          throw new Error("offline");
        }
        return jsonResponse(200, { ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/staff");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await signInStaffPage();
      expect(document.body.textContent ?? "").toContain("Network error");

      await act(async () => {
        appRoot!.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "shows HTTP error on non-401 login failure",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));
      vi.doMock("./sse-client", async () => {
        const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
        return { ...actual, connectSse: connectSseMock };
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/v1/staff/auth/login" && method === "POST") {
          return jsonResponse(500, { error: { code: "boom", message: "boom" } });
        }
        return jsonResponse(200, { ok: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/staff");
      document.body.innerHTML = '<div id="root"></div>';

      let appRoot: Root;
      await act(async () => {
        const mainModule = await import("./main");
        appRoot = mainModule.appRoot;
      });

      await signInStaffPage();
      expect(document.body.textContent ?? "").toContain("HTTP 500");

      await act(async () => {
        appRoot!.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );
});
