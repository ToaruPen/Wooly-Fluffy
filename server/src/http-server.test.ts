import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "http";
import type { Server } from "http";
import { createHttpServer } from "./http-server.js";

let server: Server;
let port: number;

const sendRequest = (method: string, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });

const readFirstSseMessage = (path: string) =>
  new Promise<{
    status: number;
    contentType: string;
    data: string;
    id: string;
  }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      const contentTypeHeader = res.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0] ?? ""
        : contentTypeHeader ?? "";

      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        const endIndex = buffer.indexOf("\n\n");
        if (endIndex === -1) {
          return;
        }
        const eventChunk = buffer.slice(0, endIndex);
        res.destroy();
        const lines = eventChunk.split("\n");
        const dataLine = lines.find((line) => line.startsWith("data: "));
        const idLine = lines.find((line) => line.startsWith("id: "));
        resolve({
          status: res.statusCode ?? 0,
          contentType,
          data: dataLine ? dataLine.slice("data: ".length) : "",
          id: idLine ? idLine.slice("id: ".length) : ""
        });
      });
    });

    req.on("error", reject);
    req.end();
  });

beforeEach(async () => {
  server = createHttpServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  port = address.port;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("http-server", () => {
  it("returns healthcheck status", async () => {
    const response = await sendRequest("GET", "/health");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await sendRequest("GET", "/unknown");

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "not_found", message: "Not Found" }
    });
  });

  it("streams kiosk snapshot on connect", async () => {
    const response = await readFirstSseMessage("/api/v1/kiosk/stream");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");

    const message = JSON.parse(response.data) as {
      type: string;
      seq: number;
      data: object;
    };

    expect(message.type).toBe("kiosk.snapshot");
    expect(message.seq).toBe(1);
    expect(message.data).toEqual({
      state: {
        mode: "ROOM",
        personal_name: null,
        phase: "idle",
        consent_ui_visible: false
      }
    });
  });

  it("returns 405 for kiosk stream with non-GET", async () => {
    const response = await sendRequest("POST", "/api/v1/kiosk/stream");

    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });

  it("streams staff snapshot on connect", async () => {
    const response = await readFirstSseMessage("/api/v1/staff/stream");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");

    const message = JSON.parse(response.data) as {
      type: string;
      seq: number;
      data: object;
    };

    expect(message.type).toBe("staff.snapshot");
    expect(message.seq).toBe(1);
    expect(message.data).toEqual({
      state: {
        mode: "ROOM",
        personal_name: null,
        phase: "idle"
      },
      pending: {
        count: 0
      }
    });
  });

  it("returns 405 for staff stream with non-GET", async () => {
    const response = await sendRequest("POST", "/api/v1/staff/stream");

    expect(response.status).toBe(405);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "method_not_allowed", message: "Method Not Allowed" }
    });
  });
});
