import { describe, expect, it } from "vitest";

import { createAbortableNeverFetch } from "./fetch.js";

describe("createAbortableNeverFetch", () => {
  it("rejects when signal is missing", async () => {
    const fetchStub = createAbortableNeverFetch();
    await expect(fetchStub("http://example.com")).rejects.toThrow("missing_signal");
  });

  it("rejects immediately with AbortError when already aborted", async () => {
    const fetchStub = createAbortableNeverFetch();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchStub("http://example.com", { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
      message: "aborted",
    });
  });

  it("rejects with AbortError when aborted later", async () => {
    const fetchStub = createAbortableNeverFetch();
    const controller = new AbortController();

    const pending = fetchStub("http://example.com", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "aborted",
    });
  });
});
