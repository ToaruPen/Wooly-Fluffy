import { createServer } from "http";
import type { ServerResponse } from "http";

const healthBody = JSON.stringify({ status: "ok" });
const notFoundBody = JSON.stringify({ error: "not_found" });

const sendJson = (res: ServerResponse, statusCode: number, body: string) => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
};

export const createHttpServer = () => {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, healthBody);
      return;
    }

    sendJson(res, 404, notFoundBody);
  });
};
