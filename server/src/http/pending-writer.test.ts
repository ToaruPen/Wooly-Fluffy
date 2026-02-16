import { describe, expect, it } from "vitest";
import { createStore } from "../store.js";
import {
  createStoreWritePending,
  createStoreWriteSessionSummaryPending,
} from "./pending-writer.js";

describe("pending-writer", () => {
  it("writes pending and broadcasts snapshot", () => {
    const store = createStore({ db_path: ":memory:" });
    try {
      let broadcasts = 0;
      const writePending = createStoreWritePending({
        store,
        broadcastStaffSnapshotIfChanged: () => {
          broadcasts += 1;
        },
      });

      writePending({ personal_name: "taro", kind: "likes", value: "apples" });

      expect(store.listPending().length).toBe(1);
      expect(broadcasts).toBe(1);
    } finally {
      store.close();
    }
  });

  it("writes pending session summary and broadcasts snapshot", () => {
    const store = createStore({ db_path: ":memory:" });
    try {
      let broadcasts = 0;
      const writePending = createStoreWriteSessionSummaryPending({
        store,
        broadcastStaffSnapshotIfChanged: () => {
          broadcasts += 1;
        },
      });

      writePending({
        title: "要約",
        summary_json: { summary: "s", topics: [], staff_notes: [] },
      });

      expect(store.listPendingSessionSummaries().length).toBe(1);
      expect(broadcasts).toBe(1);
    } finally {
      store.close();
    }
  });
});
