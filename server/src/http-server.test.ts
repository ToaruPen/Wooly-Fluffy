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
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" });
  });
});
