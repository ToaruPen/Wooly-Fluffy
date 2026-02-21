import type { OrchestratorEffect } from "../orchestrator.js";
import type { createStore } from "../store.js";

type Store = ReturnType<typeof createStore>;

type StoreWriteSessionSummaryPendingInput = Extract<
  OrchestratorEffect,
  { type: "STORE_WRITE_SESSION_SUMMARY_PENDING" }
>["input"];

export const createStoreWriteSessionSummaryPending = (deps: {
  store: Store;
  broadcastStaffSnapshotIfChanged: () => void;
  broadcastStaffSessionSummariesPendingList: () => void;
}) => {
  return (input: StoreWriteSessionSummaryPendingInput) => {
    deps.store.createPendingSessionSummary(input);
    deps.broadcastStaffSnapshotIfChanged();
    deps.broadcastStaffSessionSummariesPendingList();
  };
};
