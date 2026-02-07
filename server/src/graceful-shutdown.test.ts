import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "http";
import type { IncomingMessage, Server } from "http";
import { createHttpServer } from "./http-server.js";
import { shutdownHttpServer, trackHttpServerConnections } from "./graceful-shutdown.js";
import { createStore } from "./store.js";

let server: Server;
let port: number;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  store = createStore({ db_path: ":memory:" });
  server = createHttpServer({ store });
  trackHttpServerConnections(server);
  trackHttpServerConnections(server);
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
  await shutdownHttpServer(server);
  store.close();
});

describe("graceful-shutdown", () => {
  it("shuts down even when an SSE client keeps the connection open", async () => {
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, method: "GET", path: "/api/v1/kiosk/stream" },
        resolve,
      );
      req.on("error", reject);
      req.end();
    });

    await new Promise<void>((resolve, reject) => {
      res.setEncoding("utf8");
      res.once("data", () => resolve());
      res.once("error", reject);
    });

    const closed = new Promise<void>((resolve) => {
      res.once("close", () => resolve());
    });

    await shutdownHttpServer(server);
    await closed;
  });

  it("is idempotent when called multiple times", async () => {
    await shutdownHttpServer(server);
    await shutdownHttpServer(server);
    expect(true).toBe(true);
  });

  it("rejects when server.close returns an unexpected error", async () => {
    const originalClose = server.close.bind(server);
    server.close = ((cb: (err?: Error) => void) => {
      cb(new Error("boom"));
      return server;
    }) as unknown as Server["close"];

    await expect(shutdownHttpServer(server)).rejects.toThrow("boom");

    server.close = originalClose;
  });
});
