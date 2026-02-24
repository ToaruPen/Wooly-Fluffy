import { afterEach, describe, expect, it, vi } from "vitest";

type EventHandler = (...args: unknown[]) => void;

const createRequestStub = () => {
  return (_options: unknown, callback: (res: unknown) => void) => {
    const responseHandlers = new Map<string, EventHandler>();
    callback({
      statusCode: undefined,
      headers: {},
      setEncoding: () => undefined,
      on: (event: string, handler: EventHandler) => {
        responseHandlers.set(event, handler);
      },
    });

    return {
      on: () => undefined,
      setHeader: () => undefined,
      write: () => undefined,
      end: () => {
        responseHandlers.get("end")?.();
      },
    };
  };
};

describe("createHttpTestHelpers branch coverage", () => {
  afterEach(() => {
    vi.doUnmock("http");
    vi.resetModules();
  });

  it("falls back to status 0 when response statusCode is undefined", async () => {
    vi.doMock("http", () => ({
      request: createRequestStub(),
    }));

    const { createHttpTestHelpers } = await import("./http.js");
    const helpers = createHttpTestHelpers(() => 0);

    const text = await helpers.sendRequest("GET", "/");
    expect(text.status).toBe(0);

    const binary = await helpers.sendRequestBuffer("GET", "/");
    expect(binary.status).toBe(0);
    expect(binary.body.length).toBe(0);
  });
});
