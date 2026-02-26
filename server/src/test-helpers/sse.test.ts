import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { afterEach, describe, expect, it } from "vitest";

import { createSseTestHelpers } from "./sse.js";

const TEST_TIMEOUT_MS = 5_000;

const servers: Server[] = [];

const listen = async (
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
): Promise<{ server: Server; port: number }> => {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server_address_unavailable");
  }

  return { server, port: address.port };
};

const closeServer = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    let isDone = false;
    const timeout = setTimeout(() => {
      if (isDone) {
        return;
      }
      isDone = true;
      reject(new Error("server_close_timeout"));
    }, 2000);

    server.close((error) => {
      if (isDone) {
        return;
      }
      isDone = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe("createSseTestHelpers", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  it(
    "reads LF-delimited data messages and runs onFirstMessage",
    async () => {
      let isOnFirstCalled = false;
      const { server, port } = await listen((req, res) => {
        expect(req.headers["x-test"]).toBe("ok");
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"one","seq":1,"data":{"ok":true}}\n\n');
        res.write('data: {"type":"two","seq":2,"data":{"ok":true}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const messages = await helpers.readSseDataMessages(
        "/stream",
        2,
        async () => {
          isOnFirstCalled = true;
        },
        { headers: { "x-test": "ok" }, timeout_ms: 500 },
      );

      expect(messages.map((message) => message.type)).toEqual(["one", "two"]);
      expect(isOnFirstCalled).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "parses CRLF-delimited events",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"crlf","seq":1,"data":{}}\r\n\r\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const messages = await helpers.readSseUntil(
        "/stream",
        (message) => message.type === "crlf",
        undefined,
        { timeout_ms: 500 },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.type).toBe("crlf");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "handles mixed delimiter payload where LF appears first",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"lf_first","seq":1,"data":{}}\n\n\r\n\r\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const messages = await helpers.readSseUntil(
        "/stream",
        (message) => message.type === "lf_first",
        undefined,
        { timeout_ms: 500 },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.type).toBe("lf_first");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "handles mixed delimiter payload where CRLF appears first",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"crlf_first","seq":1,"data":{}}\r\n\r\n\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const messages = await helpers.readSseUntil(
        "/stream",
        (message) => message.type === "crlf_first",
        undefined,
        { timeout_ms: 500 },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.type).toBe("crlf_first");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects on invalid SSE json",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: {invalid}\n\n");
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readSseUntil("/stream", () => false, undefined, { timeout_ms: 500 }),
      ).rejects.toBeInstanceOf(Error);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects when predicate throws non-error",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"x","seq":1,"data":{}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readSseUntil(
          "/stream",
          () => {
            throw "boom";
          },
          undefined,
          { timeout_ms: 500 },
        ),
      ).rejects.toBeInstanceOf(Error);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects when onFirstMessage rejects non-error",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"x","seq":1,"data":{}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readSseUntil(
          "/stream",
          () => false,
          async () => Promise.reject("boom"),
          { timeout_ms: 500 },
        ),
      ).rejects.toBeInstanceOf(Error);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "ignores late onFirstMessage rejection after predicate has already resolved",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"done","seq":1,"data":{}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const messages = await helpers.readSseUntil(
        "/stream",
        (message) => message.type === "done",
        async () => Promise.reject(new Error("late_failure")),
        { timeout_ms: 500 },
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.type).toBe("done");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "times out when stream has no data frames",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keep-alive\n\n");
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readSseUntil("/stream", () => false, undefined, { timeout_ms: 25 }),
      ).rejects.toThrow("sse_timeout");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects on request error for readSseUntil",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.end("ok");
      });
      await closeServer(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readSseUntil("/stream", () => false, undefined, { timeout_ms: 100 }),
      ).rejects.toBeInstanceOf(Error);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "readFirstSseMessage ignores keepalive and resolves on first data event",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keep-alive\n\n");
        res.write('id: evt-1\ndata: {"type":"snapshot","seq":1,"data":{}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const result = await helpers.readFirstSseMessage("/stream", { timeout_ms: 500 });
      expect(result.status).toBe(200);
      expect(result.contentType).toContain("text/event-stream");
      expect(result.id).toBe("evt-1");
      expect(result.data).toContain("snapshot");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "readFirstSseMessage times out when only keepalive frames arrive",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keep-alive\n\n");
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(helpers.readFirstSseMessage("/stream", { timeout_ms: 25 })).rejects.toThrow(
        "sse_timeout",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "readFirstSseMessage defaults empty contentType and id when headers/fields are missing",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.write('data: {"type":"snapshot","seq":1,"data":{}}\n\n');
      });
      servers.push(server);

      const helpers = createSseTestHelpers(() => port);
      const result = await helpers.readFirstSseMessage("/stream", { timeout_ms: 500 });
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("");
      expect(result.id).toBe("");
      expect(result.data).toContain("snapshot");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "readFirstSseMessage rejects on request error",
    async () => {
      const { server, port } = await listen((_req, res) => {
        res.end("ok");
      });
      await closeServer(server);

      const helpers = createSseTestHelpers(() => port);
      await expect(
        helpers.readFirstSseMessage("/stream", { timeout_ms: 100 }),
      ).rejects.toBeInstanceOf(Error);
    },
    TEST_TIMEOUT_MS,
  );
});
