import { createServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";

const healthBody = JSON.stringify({ status: "ok" });

const createErrorBody = (code: string, message: string) =>
  JSON.stringify({ error: { code, message } });

const notFoundBody = createErrorBody("not_found", "Not Found");

const sendJson = (res: ServerResponse, statusCode: number, body: string) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
};

const sendError = (
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string
) => {
  sendJson(res, statusCode, createErrorBody(code, message));
};

const kioskSnapshot = {
  state: {
    mode: "ROOM",
    personal_name: null,
    phase: "idle",
    consent_ui_visible: false
  }
};

const staffSnapshot = {
  state: {
    mode: "ROOM",
    personal_name: null,
    phase: "idle"
  },
  pending: {
    count: 0
  }
};

const writeSseHeaders = (res: ServerResponse) => {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
};

const openSse = (
  req: IncomingMessage,
  res: ServerResponse,
  snapshotType: string,
  snapshotData: object
) => {
  writeSseHeaders(res);

  let seq = 0;
  const send = (type: string, data: object) => {
    seq += 1;
    const payload = JSON.stringify({ type, seq, data });
    res.write(`id: ${seq}\n`);
    res.write(`data: ${payload}\n\n`);
  };

  send(snapshotType, snapshotData);

  const writeKeepAlive = () => {
    res.write(": keep-alive\n\n");
  };
  writeKeepAlive();
  const keepAlive = setInterval(writeKeepAlive, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    res.end();
  });
};

export const createHttpServer = () => {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, healthBody);
      return;
    }

    if (req.url === "/api/v1/kiosk/stream") {
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      openSse(req, res, "kiosk.snapshot", kioskSnapshot);
      return;
    }

    if (req.url === "/api/v1/staff/stream") {
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "Method Not Allowed");
        return;
      }
      openSse(req, res, "staff.snapshot", staffSnapshot);
      return;
    }

    sendJson(res, 404, notFoundBody);
  });
};
