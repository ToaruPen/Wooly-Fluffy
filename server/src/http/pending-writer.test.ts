import { describe, expect, it } from "vitest";
import { createStore } from "../store.js";
import { createStoreWriteSessionSummaryPending } from "./pending-writer.js";

describe("pending-writer", () => {
  it("writes pending session summary and broadcasts snapshot and list", () => {
    const store = createStore({ db_path: ":memory:" });
    try {
      let snapshotBroadcasts = 0;
      let listBroadcasts = 0;
      const writePending = createStoreWriteSessionSummaryPending({
        store,
        broadcastStaffSnapshotIfChanged: () => {
          snapshotBroadcasts += 1;
        },
        broadcastStaffSessionSummariesPendingList: () => {
          listBroadcasts += 1;
        },
      });

      writePending({
        title: "要約",
        summary_json: { summary: "s", topics: [], staff_notes: [] },
      });

      expect(store.listPendingSessionSummaries().length).toBe(1);
      expect(snapshotBroadcasts).toBe(1);
      expect(listBroadcasts).toBe(1);
    } finally {
      store.close();
    }
  });
});
