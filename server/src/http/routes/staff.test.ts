import type { IncomingMessage, ServerResponse } from "http";
import { describe, expect, it } from "vitest";
import { createStore } from "../../store.js";
import { handleStaffRoutes } from "./staff.js";

const createDenyRouteInput = (overrides?: {
  path?: string;
  requireStaffLan?: () => boolean;
  requireStaffSession?: () => string | null;
}) => {
  const store = createStore({ db_path: ":memory:" });
  const req = { method: "POST" } as IncomingMessage;
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const input = {
    req,
    res,
    path: overrides?.path ?? "/api/v1/staff/session-summaries/nope/deny",
    now_ms: () => 0,
    store,
    staff_session_ttl_ms: 60_000,
    ok_body: JSON.stringify({ ok: true }),
    not_found_body: JSON.stringify({ error: { code: "not_found", message: "Not Found" } }),
    readJson: async () => ({}),
    mapPendingToDto: (item: unknown) => item as object,
    mapSessionSummaryToDto: (item: unknown) => item as object,
    sendJson: () => undefined,
    sendError: () => undefined,
    safeSendError: () => undefined,
    isPasscodeMatch: () => true,
    getStaffSessionToken: () => "token",
    createStaffSession: () => "token",
    keepaliveStaffSession: () => true,
    requireStaffLan: overrides?.requireStaffLan ?? (() => true),
    requireStaffSession: overrides?.requireStaffSession ?? (() => "token"),
    openStaffStream: () => undefined,
    enqueueEvent: () => undefined,
    broadcastStaffSnapshotIfChanged: () => undefined,
    broadcastStaffSessionSummariesPendingList: () => undefined,
  };

  return {
    input,
    dispose: () => store.close(),
  };
};

describe("handleStaffRoutes deny guards", () => {
  it("returns early when LAN requirement fails", () => {
    const { input, dispose } = createDenyRouteInput({ requireStaffLan: () => false });
    try {
      expect(handleStaffRoutes(input)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("returns early when staff session is missing", () => {
    const { input, dispose } = createDenyRouteInput({ requireStaffSession: () => null });
    try {
      expect(handleStaffRoutes(input)).toBe(true);
    } finally {
      dispose();
    }
  });
});

describe("handleStaffRoutes confirm guards", () => {
  it("returns early when LAN requirement fails", () => {
    const { input, dispose } = createDenyRouteInput({
      path: "/api/v1/staff/session-summaries/nope/confirm",
      requireStaffLan: () => false,
    });
    try {
      expect(handleStaffRoutes(input)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("returns early when staff session is missing", () => {
    const { input, dispose } = createDenyRouteInput({
      path: "/api/v1/staff/session-summaries/nope/confirm",
      requireStaffSession: () => null,
    });
    try {
      expect(handleStaffRoutes(input)).toBe(true);
    } finally {
      dispose();
    }
  });
});

describe("handleStaffRoutes session summary list guards", () => {
  it("returns early when LAN requirement fails", () => {
    const { input, dispose } = createDenyRouteInput({
      path: "/api/v1/staff/session-summaries/pending",
      requireStaffLan: () => false,
    });
    input.req.method = "GET";
    try {
      expect(handleStaffRoutes(input)).toBe(true);
    } finally {
      dispose();
    }
  });
});
