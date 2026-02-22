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

const bootStaffPage = async (
  fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  connectSseMock: ReturnType<typeof vi.fn<[string, ConnectHandlers], { close: () => void }>>,
) => {
  vi.stubGlobal("fetch", vi.fn(fetchMock));

  vi.doMock("./sse-client", async () => {
    const actual = await vi.importActual<typeof import("./sse-client")>("./sse-client");
    return { ...actual, connectSse: connectSseMock };
  });

  window.history.pushState({}, "", "/staff");
  document.body.innerHTML = '<div id="root"></div>';

  let appRoot: Root;
  await act(async () => {
    const mainModule = await import("./main");
    appRoot = mainModule.appRoot;
  });

  const input = document.querySelector("input") as HTMLInputElement | null;
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

  await act(async () => {});

  if (connectSseMock.mock.calls.length === 0) {
    throw new Error("Expected connectSse to be called during staff boot");
  }
  const handlers = connectSseMock.mock.calls[0]?.[1];
  if (!handlers) {
    throw new Error("Missing connectSse handlers from first connectSse call");
  }

  return {
    appRoot: appRoot!,
    fetchMock: globalThis.fetch as ReturnType<typeof vi.fn>,
    handlers,
  };
};

describe("staff session summaries flows", () => {
  it(
    "covers list/confirm/deny/SSE and staff control interactions",
    async () => {
      vi.resetModules();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));

      const closeSpy = vi.fn();
      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: closeSpy,
      }));

      const { appRoot, handlers, fetchMock } = await bootStaffPage(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? "GET";

          if (url === "/api/v1/staff/auth/login" && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
            return jsonResponse(200, {
              items: [
                {
                  id: "p1",
                  title: "Morning chat",
                  summary_json: { note: "Talked about plants" },
                  status: "pending",
                  created_at_ms: 0,
                  expires_at_ms: 1,
                },
              ],
            });
          }
          if (url === "/api/v1/staff/event" && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          if (url === "/api/v1/staff/auth/keepalive" && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          if (url.startsWith("/api/v1/staff/session-summaries/") && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          return jsonResponse(500, { error: { code: "unhandled", message: url } });
        },
        connectSseMock,
      );

      expect(document.body.textContent ?? "").toContain("Pending");
      expect(document.body.textContent ?? "").toContain("Morning chat");
      expect(document.body.textContent ?? "").toContain('{"note":"Talked about plants"}');
      expect(document.body.textContent ?? "").toContain("Created:");
      expect(document.body.textContent ?? "").toContain("Deadline:");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "PERSONAL", personal_name: null, phase: "idle" },
          pending: { count: 0, session_summary_count: 1 },
        });
        handlers?.onError?.(new Error("boom"));
        handlers?.onMessage?.({ type: "staff.snapshot", seq: 1, data: {} });
        handlers?.onMessage?.({
          type: "staff.session_summaries_pending_list",
          seq: 2,
          data: null,
        });
        handlers?.onMessage?.({
          type: "staff.session_summaries_pending_list",
          seq: 3,
          data: { items: "nope" },
        });
      });
      expect(document.body.textContent ?? "").toContain("boom");
      expect(document.body.textContent ?? "").toContain("Pending: 1");

      const ptt = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Push to talk"),
      );
      expect(ptt).toBeTruthy();
      await act(async () => {
        ptt?.dispatchEvent(new Event("pointerup", { bubbles: true }));
        ptt?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
        ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        ptt?.dispatchEvent(new Event("pointercancel", { bubbles: true }));
      });

      const staffEvCount = () =>
        (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
          (c) => String(c[0]) === "/api/v1/staff/event",
        ).length;

      const beforeSpace = staffEvCount();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
      });
      expect(staffEvCount()).toBeGreaterThan(beforeSpace);

      const beforeBtn = staffEvCount();
      await act(async () => {
        ptt?.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBe(beforeBtn);

      const roleBtn = document.createElement("div");
      roleBtn.setAttribute("role", "button");
      roleBtn.tabIndex = 0;
      document.body.appendChild(roleBtn);
      const beforeRole = staffEvCount();
      await act(async () => {
        roleBtn.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBe(beforeRole);
      document.body.removeChild(roleBtn);

      const editDiv = document.createElement("div");
      editDiv.setAttribute("contenteditable", "true");
      document.body.appendChild(editDiv);
      const beforeEdit = staffEvCount();
      await act(async () => {
        editDiv.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBe(beforeEdit);
      document.body.removeChild(editDiv);

      const nonEditDiv = document.createElement("div");
      nonEditDiv.setAttribute("contenteditable", "false");
      nonEditDiv.tabIndex = 0;
      document.body.appendChild(nonEditDiv);
      const beforeNonEdit = staffEvCount();
      await act(async () => {
        nonEditDiv.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBeGreaterThan(beforeNonEdit);
      document.body.removeChild(nonEditDiv);

      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      const beforeTa = staffEvCount();
      await act(async () => {
        textarea.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBe(beforeTa);
      document.body.removeChild(textarea);

      const selectEl = document.createElement("select");
      document.body.appendChild(selectEl);
      const beforeSel = staffEvCount();
      await act(async () => {
        selectEl.focus();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        (document.body as HTMLElement).focus();
      });
      expect(staffEvCount()).toBe(beforeSel);
      document.body.removeChild(selectEl);

      const originalActiveElementDescriptor = Object.getOwnPropertyDescriptor(
        document,
        "activeElement",
      );
      Object.defineProperty(document, "activeElement", { value: null, configurable: true });
      const beforeNull = staffEvCount();
      try {
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
        });
        expect(staffEvCount()).toBeGreaterThan(beforeNull);
      } finally {
        if (originalActiveElementDescriptor) {
          Object.defineProperty(document, "activeElement", originalActiveElementDescriptor);
        } else {
          delete (document as unknown as Record<string, unknown>).activeElement;
        }
      }

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      });
      const beforeHeldRepeat = staffEvCount();
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", bubbles: true, repeat: true }),
        );
      });
      expect(staffEvCount()).toBe(beforeHeldRepeat);
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
      });

      const beforeRepeat = staffEvCount();
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", bubbles: true, repeat: true }),
        );
      });
      expect(staffEvCount()).toBe(beforeRepeat);

      const beforeNonSpace = staffEvCount();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
      });
      expect(staffEvCount()).toBe(beforeNonSpace);

      await act(async () => {
        window.dispatchEvent(new Event("blur"));
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "listening" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });
      expect(document.body.textContent ?? "").toContain("Phase: Listening");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "waiting_stt" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });
      expect(document.body.textContent ?? "").toContain("Phase: Waiting (STT)");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "waiting_chat" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });
      expect(document.body.textContent ?? "").toContain("Phase: Waiting (Chat)");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "asking_consent" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });
      expect(document.body.textContent ?? "").toContain("Phase: Asking Consent");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "waiting_inner_task" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });
      expect(document.body.textContent ?? "").toContain("Phase: Waiting (Task)");

      await act(async () => {
        handlers?.onSnapshot({
          state: { mode: "ROOM", personal_name: null, phase: "idle" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });

      const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Confirm"),
      );
      const deny = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Deny"),
      );
      expect(confirm).toBeTruthy();
      expect(deny).toBeTruthy();

      await act(async () => {
        confirm?.click();
        deny?.click();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/staff/session-summaries/p1/confirm",
        expect.objectContaining({ method: "POST" }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/staff/session-summaries/p1/deny",
        expect.objectContaining({ method: "POST" }),
      );

      await act(async () => {
        ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        ptt?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/staff/event",
        expect.objectContaining({ method: "POST" }),
      );

      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      const keepaliveCalls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[0]) === "/api/v1/staff/auth/keepalive",
      );
      expect(keepaliveCalls).toHaveLength(1);

      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        vi.advanceTimersByTime(30_000);
      });
      const keepaliveCalls2 = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => String(c[0]) === "/api/v1/staff/auth/keepalive",
      );
      expect(keepaliveCalls2.length).toBeGreaterThan(1);

      const refresh = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Refresh"),
      );
      const forceRoom = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Force ROOM"),
      );
      const emergencyStop = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Emergency stop"),
      );
      const resume = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Resume"),
      );
      expect(refresh).toBeTruthy();
      expect(forceRoom).toBeTruthy();
      expect(emergencyStop).toBeTruthy();
      expect(resume).toBeTruthy();
      await act(async () => {
        refresh?.click();
        forceRoom?.click();
        emergencyStop?.click();
        resume?.click();
      });

      await act(async () => {
        handlers?.onMessage?.({
          type: "staff.session_summaries_pending_list",
          seq: 9,
          data: {
            items: [
              {
                id: "p2",
                title: "After lunch",
                summary_json: { note: "Played cards" },
                status: "pending",
                created_at_ms: 0,
                expires_at_ms: 1,
              },
            ],
          },
        });
      });
      expect(document.body.textContent ?? "").toContain("After lunch");
      expect(document.body.textContent ?? "").toContain('{"note":"Played cards"}');

      await act(async () => {
        handlers?.onMessage?.({
          type: "staff.session_summaries_pending_list",
          seq: 10,
          data: { items: [] },
        });
      });
      expect(document.body.textContent ?? "").toContain("No pending items.");

      await act(async () => {
        ptt?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      await act(async () => {
        vi.advanceTimersByTime(180_000);
      });
      expect(document.body.textContent ?? "").toContain("STAFF (Locked)");
      expect(closeSpy).toHaveBeenCalled();

      await act(async () => {
        appRoot.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "covers pending mutation errors (HTTP/network/401)",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));

      let mutateCall = 0;
      const { appRoot } = await bootStaffPage(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? "GET";

          if (url === "/api/v1/staff/auth/login" && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
            return jsonResponse(200, {
              items: [
                {
                  id: "p1",
                  title: "Morning chat",
                  summary_json: { note: "Talked about plants" },
                  status: "pending",
                  created_at_ms: 0,
                  expires_at_ms: 1,
                },
              ],
            });
          }
          if (url.startsWith("/api/v1/staff/session-summaries/") && method === "POST") {
            mutateCall += 1;
            if (mutateCall === 1) {
              return jsonResponse(404, { error: { code: "not_found", message: "x" } });
            }
            if (mutateCall === 2) {
              throw new Error("offline");
            }
            return jsonResponse(401, { error: { code: "unauthorized", message: "x" } });
          }
          return jsonResponse(200, { ok: true });
        },
        connectSseMock,
      );

      const confirm = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Confirm"),
      );
      const deny = Array.from(document.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Deny"),
      );
      expect(confirm).toBeTruthy();
      expect(deny).toBeTruthy();

      await act(async () => {
        confirm?.click();
      });
      expect(document.body.textContent ?? "").toContain("HTTP 404");

      await act(async () => {
        deny?.click();
      });
      expect(document.body.textContent ?? "").toContain("Network error");

      await act(async () => {
        confirm?.click();
      });
      expect(document.body.textContent ?? "").toContain("STAFF (Locked)");

      await act(async () => {
        appRoot.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );

  it(
    "does not render Mode card and surfaces timestamp validation errors",
    async () => {
      vi.resetModules();

      const connectSseMock = vi.fn<[string, ConnectHandlers], { close: () => void }>(() => ({
        close: vi.fn(),
      }));

      const { appRoot, handlers } = await bootStaffPage(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method ?? "GET";

          if (url === "/api/v1/staff/auth/login" && method === "POST") {
            return jsonResponse(200, { ok: true });
          }
          if (url === "/api/v1/staff/session-summaries/pending" && method === "GET") {
            return jsonResponse(200, {
              items: [
                {
                  id: "p-non-finite-ts",
                  title: "Non finite",
                  summary_json: { note: "non-finite timestamp" },
                  status: "pending",
                  created_at_ms: Number.POSITIVE_INFINITY,
                  expires_at_ms: Number.NEGATIVE_INFINITY,
                },
                {
                  id: "p-null-summary",
                  title: "Missing summary",
                  summary_json: "already formatted",
                  status: "pending",
                  created_at_ms: 0,
                  expires_at_ms: null,
                },
                {
                  id: "p-undefined-summary",
                  title: "Undefined summary",
                  summary_json: undefined,
                  status: "pending",
                  created_at_ms: 0,
                  expires_at_ms: null,
                },
                {
                  id: "p-invalid-ts",
                  title: "Out of range",
                  summary_json: { note: "invalid timestamp" },
                  status: "pending",
                  created_at_ms: 9_000_000_000_000_000,
                  expires_at_ms: -9_000_000_000_000_000,
                },
              ],
            });
          }
          return jsonResponse(200, { ok: true });
        },
        connectSseMock,
      );

      expect(typeof handlers?.onSnapshot).toBe("function");
      const onSnapshot = handlers?.onSnapshot;
      if (!onSnapshot) {
        throw new Error("Missing staff snapshot handler");
      }

      await act(async () => {
        onSnapshot({
          state: { mode: "PERSONAL", personal_name: "taro", phase: "idle" },
          pending: { count: 0, session_summary_count: 0 },
        });
      });

      expect(document.body.textContent ?? "").not.toContain("Mode:");
      expect(document.body.textContent ?? "").toContain("Non finite");
      expect(document.body.textContent ?? "").toContain("Missing summary");
      expect(document.body.textContent ?? "").toContain("Undefined summary");
      expect(document.body.textContent ?? "").toContain("already formatted");
      expect(document.body.textContent ?? "").not.toContain('"already formatted"');
      expect(document.body.textContent ?? "").toContain("null");
      expect(document.body.textContent ?? "").toContain("Invalid timestamp value: Infinity");
      expect(document.body.textContent ?? "").toContain("Invalid timestamp value: -Infinity");
      expect(document.body.textContent ?? "").toContain("Out of range");
      expect(document.body.textContent ?? "").toContain(
        "Invalid timestamp value: 9000000000000000",
      );
      expect(document.body.textContent ?? "").toContain(
        "Invalid timestamp value: -9000000000000000",
      );
      expect(document.body.textContent ?? "").toContain("Created: 1970-01-01T00:00:00.000Z");
      expect(document.body.textContent ?? "").toContain("Deadline: -");

      await act(async () => {
        appRoot.unmount();
      });
    },
    STAFF_TEST_TIMEOUT_MS,
  );
});
