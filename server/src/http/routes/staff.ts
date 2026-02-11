import type { IncomingMessage, ServerResponse } from "http";
import type { OrchestratorEvent } from "../../orchestrator.js";
import type { createStore } from "../../store.js";
import { createSessionCookie } from "../staff-session.js";

type Store = ReturnType<typeof createStore>;

type PendingRow = {
  id: string;
  personal_name: string;
  kind: string;
  value: string;
  source_quote: string | null;
  status: string;
  created_at_ms: number;
  expires_at_ms: number;
};

type HandleStaffRoutesInput = {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  now_ms: () => number;
  store: Store;
  staff_session_ttl_ms: number;
  ok_body: string;
  not_found_body: string;
  readJson: (req: IncomingMessage, maxBytes: number) => Promise<unknown>;
  mapPendingToDto: (item: PendingRow) => object;
  sendJson: (res: ServerResponse, statusCode: number, body: string) => void;
  sendError: (res: ServerResponse, statusCode: number, code: string, message: string) => void;
  safeSendError: (res: ServerResponse, statusCode: number, code: string, message: string) => void;
  isPasscodeMatch: (actual: string, expected: string) => boolean;
  getStaffSessionToken: (req: IncomingMessage) => string | null;
  createStaffSession: () => string;
  keepaliveStaffSession: (token: string) => boolean;
  requireStaffLan: () => boolean;
  requireStaffSession: () => string | null;
  openStaffStream: (token: string) => void;
  enqueueEvent: (event: OrchestratorEvent, now: number) => void;
  broadcastStaffSnapshotIfChanged: () => void;
};

const isStaffEventType = (
  value: unknown,
): value is
  | "STAFF_PTT_DOWN"
  | "STAFF_PTT_UP"
  | "STAFF_FORCE_ROOM"
  | "STAFF_EMERGENCY_STOP"
  | "STAFF_RESUME" =>
  value === "STAFF_PTT_DOWN" ||
  value === "STAFF_PTT_UP" ||
  value === "STAFF_FORCE_ROOM" ||
  value === "STAFF_EMERGENCY_STOP" ||
  value === "STAFF_RESUME";

export const handleStaffRoutes = (input: HandleStaffRoutesInput): boolean => {
  const {
    req,
    res,
    path,
    now_ms,
    store,
    staff_session_ttl_ms,
    ok_body,
    not_found_body,
    readJson,
    mapPendingToDto,
    sendJson,
    sendError,
    safeSendError,
    isPasscodeMatch,
    getStaffSessionToken,
    createStaffSession,
    keepaliveStaffSession,
    requireStaffLan,
    requireStaffSession,
    openStaffStream,
    enqueueEvent,
    broadcastStaffSnapshotIfChanged,
  } = input;

  if (path === "/api/v1/staff/auth/login") {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "POST") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }

    readJson(req, 128_000)
      .then((body) => {
        const parsed = body as { passcode?: unknown };
        if (typeof parsed.passcode !== "string") {
          sendError(res, 400, "invalid_request", "Invalid request");
          return;
        }
        const expected = process.env.STAFF_PASSCODE;
        if (typeof expected !== "string" || expected.length === 0) {
          sendError(res, 500, "misconfigured", "Server misconfigured");
          return;
        }
        if (!isPasscodeMatch(parsed.passcode, expected)) {
          sendError(res, 401, "unauthorized", "Unauthorized");
          return;
        }

        const token = createStaffSession();
        res.setHeader("set-cookie", createSessionCookie(token, staff_session_ttl_ms));
        sendJson(res, 200, ok_body);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "body_too_large") {
          safeSendError(res, 413, "payload_too_large", "Payload Too Large");
          return;
        }
        safeSendError(res, 400, "invalid_json", "Invalid JSON");
      });
    return true;
  }

  if (path === "/api/v1/staff/auth/keepalive") {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "POST") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }

    const token = getStaffSessionToken(req);
    if (!token || !keepaliveStaffSession(token)) {
      sendError(res, 401, "unauthorized", "Unauthorized");
      return true;
    }

    res.setHeader("set-cookie", createSessionCookie(token, staff_session_ttl_ms));
    sendJson(res, 200, ok_body);
    return true;
  }

  if (path === "/api/v1/staff/stream") {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "GET") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }
    const token = requireStaffSession();
    if (!token) {
      return true;
    }
    openStaffStream(token);
    return true;
  }

  if (path === "/api/v1/staff/event") {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "POST") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }
    if (!requireStaffSession()) {
      return true;
    }
    readJson(req, 128_000)
      .then((body) => {
        const parsed = body as { type?: unknown };
        if (!isStaffEventType(parsed.type)) {
          sendError(res, 400, "invalid_request", "Invalid request");
          return;
        }
        enqueueEvent({ type: parsed.type }, now_ms());
        sendJson(res, 200, ok_body);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "body_too_large") {
          safeSendError(res, 413, "payload_too_large", "Payload Too Large");
          return;
        }
        safeSendError(res, 400, "invalid_json", "Invalid JSON");
      });
    return true;
  }

  if (path === "/api/v1/staff/pending") {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "GET") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }
    if (!requireStaffSession()) {
      return true;
    }
    const items = store.listPending().map(mapPendingToDto);
    sendJson(res, 200, JSON.stringify({ items }));
    return true;
  }

  if (path.startsWith("/api/v1/staff/pending/") && path.endsWith("/confirm")) {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "POST") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }
    if (!requireStaffSession()) {
      return true;
    }
    const id = path.slice("/api/v1/staff/pending/".length, -"/confirm".length);
    const didConfirm = store.confirmById(id);
    if (!didConfirm) {
      sendJson(res, 404, not_found_body);
      return true;
    }
    broadcastStaffSnapshotIfChanged();
    sendJson(res, 200, ok_body);
    return true;
  }

  if (path.startsWith("/api/v1/staff/pending/") && path.endsWith("/deny")) {
    if (!requireStaffLan()) {
      return true;
    }
    if (req.method !== "POST") {
      sendError(res, 405, "method_not_allowed", "Method Not Allowed");
      return true;
    }
    if (!requireStaffSession()) {
      return true;
    }
    const id = path.slice("/api/v1/staff/pending/".length, -"/deny".length);
    const didDeny = store.denyById(id);
    if (!didDeny) {
      sendJson(res, 404, not_found_body);
      return true;
    }
    broadcastStaffSnapshotIfChanged();
    sendJson(res, 200, ok_body);
    return true;
  }

  return false;
};
