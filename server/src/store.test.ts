import { describe, expect, it } from "vitest";
import { createStore } from "./store.js";

const isUuidV4Like = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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

  it("creates a pending item and lists it", () => {
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => 1_000,
      id_factory: () => "id-1",
    });

    const id = store.createPending({
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: "cats",
    });

    expect(id).toBe("id-1");

    expect(store.listPending()).toEqual([
      {
        id: "id-1",
        personal_name: "Alice",
        kind: "likes",
        value: "cats",
        source_quote: "cats",
        status: "pending",
        created_at_ms: 1_000,
        expires_at_ms: 1_000 + 86_400_000,
      },
    ]);
  });

  it("uses default now_ms and id_factory", () => {
    const store = createStore({ db_path: ":memory:" });

    const id = store.createPending({
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
    });

    expect(isUuidV4Like(id)).toBe(true);

    const pending = store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.source_quote).toBe(null);
    expect((pending[0]?.expires_at_ms ?? 0) - (pending[0]?.created_at_ms ?? 0)).toBe(86_400_000);
  });

  it("confirms pending and clears expires_at_ms and source_quote", () => {
    let now = 1_000;
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => now,
      id_factory: () => "id-1",
    });

    store.createPending({
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: "cats",
    });

    now = 2_000;
    expect(store.confirmById("id-1")).toBe(true);

    expect(store.listPending()).toEqual([]);

    expect(store.getById("id-1")).toEqual({
      id: "id-1",
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: null,
      status: "confirmed",
      created_at_ms: 1_000,
      updated_at_ms: 2_000,
      expires_at_ms: null,
    });
  });

  it("denies pending and clears source_quote", () => {
    let now = 1_000;
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => now,
      id_factory: () => "id-1",
    });

    store.createPending({
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: "cats",
    });

    now = 2_000;
    expect(store.denyById("id-1")).toBe(true);

    expect(store.listPending()).toEqual([]);

    expect(store.getById("id-1")).toEqual({
      id: "id-1",
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: null,
      status: "rejected",
      created_at_ms: 1_000,
      updated_at_ms: 2_000,
      expires_at_ms: 2_000 + 86_400_000,
    });
  });

  it("deletes expired rows on housekeeping", () => {
    let now = 1_000;
    const store = createStore({
      db_path: ":memory:",
      now_ms: () => now,
      id_factory: () => "id-1",
    });

    store.createPending({
      personal_name: "Alice",
      kind: "likes",
      value: "cats",
      source_quote: "cats",
    });

    now = 1_000 + 86_400_000;
    expect(store.housekeepExpired()).toBe(1);
    expect(store.getById("id-1")).toBe(null);
  });

  it("closes the database", () => {
    const store = createStore({ db_path: ":memory:" });
    expect(() => store.close()).not.toThrow();
  });
});
