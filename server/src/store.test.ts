import { describe, expect, it } from "vitest";
import { createStore } from "./store.js";

describe("store", () => {
  it("creates a pending session summary and lists it", () => {
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => 1_000,
      id_factory: () => "sum-1",
    });

    try {
      const id = store.createPendingSessionSummary({
        title: "After school chat",
        summary_json: { topics: ["play"], staff_notes: ["check in tomorrow"] },
      });

      expect(id).toBe("sum-1");

      expect(store.listPendingSessionSummaries()).toEqual([
        {
          id: "sum-1",
          schema_version: 1,
          trigger: "idle",
          title: "After school chat",
          summary_json: { topics: ["play"], staff_notes: ["check in tomorrow"] },
          status: "pending",
          created_at_ms: 1_000,
          expires_at_ms: 1_000 + 86_400_000 * 7,
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("confirms pending session summary and keeps it from housekeeping", () => {
    let now = 1_000;
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => now,
      id_factory: () => "sum-1",
    });

    try {
      store.createPendingSessionSummary({
        title: "After school chat",
        summary_json: { topics: ["play"] },
      });

      now = 2_000;
      expect(store.confirmSessionSummary("sum-1")).toBe(true);
      expect(store.listPendingSessionSummaries()).toEqual([]);

      now = 1_000 + 86_400_000 * 8;
      expect(store.housekeepExpiredSessionSummaries()).toBe(0);

      expect(store.getSessionSummaryById("sum-1")).toEqual({
        id: "sum-1",
        schema_version: 1,
        trigger: "idle",
        title: "After school chat",
        summary_json: { topics: ["play"] },
        status: "confirmed",
        created_at_ms: 1_000,
        updated_at_ms: 2_000,
        expires_at_ms: null,
      });
    } finally {
      store.close();
    }
  });

  it("denies pending session summary and hard deletes it", () => {
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => 1_000,
      id_factory: () => "sum-1",
    });

    try {
      store.createPendingSessionSummary({
        title: "After school chat",
        summary_json: { topics: ["play"] },
      });

      expect(store.denySessionSummary("sum-1")).toBe(true);
      expect(store.listPendingSessionSummaries()).toEqual([]);
      expect(store.getSessionSummaryById("sum-1")).toBe(null);
    } finally {
      store.close();
    }
  });

  it("deletes expired pending session summaries on housekeeping", () => {
    let now = 1_000;
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => now,
      id_factory: () => "sum-1",
    });

    try {
      store.createPendingSessionSummary({
        title: "After school chat",
        summary_json: { topics: ["play"] },
      });

      now = 1_000 + 86_400_000 * 7;
      expect(store.housekeepExpiredSessionSummaries()).toBe(1);
      expect(store.listPendingSessionSummaries()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("does not create legacy memory_items table", () => {
    const store = createStore({ db_path: ":memory:" });

    try {
      expect("createPending" in store).toBe(false);
      expect("listPending" in store).toBe(false);
      expect("confirmById" in store).toBe(false);
      expect("denyById" in store).toBe(false);
      expect("housekeepExpired" in store).toBe(false);
    } finally {
      store.close();
    }
  });

  it("rejects non-JSON-serializable session summary_json", () => {
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => 1_000,
      id_factory: () => "sum-1",
    });

    try {
      expect(() =>
        store.createPendingSessionSummary({
          title: "After school chat",
          summary_json: undefined,
        }),
      ).toThrow(/summary_json must be JSON-serializable/);
    } finally {
      store.close();
    }
  });

  it("closes the database", () => {
    const store = createStore({ db_path: ":memory:" });
    expect(() => store.close()).not.toThrow();
  });
});
