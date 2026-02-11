import { describe, expect, it, vi } from "vitest";
import { getJson, postJsonWithTimeout, readJson } from "./api";

describe("api", () => {
  it("does not use AbortController when fetch timeout is disabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = undefined;

      const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
        expect(init?.signal).toBeUndefined();
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const res = await getJson("/api/v1/health");
      expect(res.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      vi.unstubAllGlobals();
    }
  });

  it("aborts fetch when fetch timeout is enabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = "1";
      vi.useFakeTimers();

      const fetchMock = vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const promise = getJson("/api/v1/health");
      const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("times out readJson when fetch timeout is enabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = "1";
      vi.useFakeTimers();

      const res = {
        json: async () =>
          await new Promise<unknown>(() => {
            // never resolves
          }),
      } as unknown as Response;

      const promise = readJson(res);
      const assertion = expect(promise).rejects.toMatchObject({ message: "fetch_timeout" });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      vi.useRealTimers();
    }
  });

  it("aborts fetch when postJsonWithTimeout is used even if env timeout is disabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = undefined;
      vi.useFakeTimers();

      const fetchMock = vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const promise = postJsonWithTimeout("/api/v1/kiosk/event", { type: "KIOSK_PTT_DOWN" }, 1);
      const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("does not use AbortController when postJsonWithTimeout timeout is disabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = "1";

      const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
        expect(init?.signal).toBeUndefined();
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

      const res = await postJsonWithTimeout("/api/v1/kiosk/event", { type: "KIOSK_PTT_UP" }, 0);
      expect(res.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      vi.unstubAllGlobals();
    }
  });

  it("returns from readJson before timeout when fetch timeout is enabled", async () => {
    const prev = (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS;
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = "50";

      const res = {
        json: async () => ({ ok: true }),
      } as unknown as Response;

      await expect(readJson<{ ok: boolean }>(res)).resolves.toEqual({ ok: true });
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      (import.meta.env as unknown as Record<string, unknown>).VITE_FETCH_TIMEOUT_MS = prev;
      clearSpy.mockRestore();
    }
  });
});
