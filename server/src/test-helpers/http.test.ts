import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";

import { createHttpTestHelpers } from "./http.js";

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

const close = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe("createHttpTestHelpers", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => close(server)));
    servers.length = 0;
  });

  it("sends requests with and without options", async () => {
    const { server, port } = await listen((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const payload = {
          method: req.method,
          customHeader: req.headers["x-custom"] ?? null,
          body,
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    const withOptions = await helpers.sendRequest("POST", "/echo", {
      headers: { "x-custom": "ok" },
      body: "hello",
    });
    expect(withOptions.status).toBe(200);
    expect(JSON.parse(withOptions.body)).toEqual({
      method: "POST",
      customHeader: "ok",
      body: "hello",
    });

    const withoutOptions = await helpers.sendRequest("GET", "/echo");
    expect(withoutOptions.status).toBe(200);
    expect(JSON.parse(withoutOptions.body)).toEqual({
      method: "GET",
      customHeader: null,
      body: "",
    });
  });

  it("sends buffer requests with and without options", async () => {
    const { server, port } = await listen((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const headerValue = String(req.headers["x-custom"] ?? "none");
        res.writeHead(200, { "x-echo-body": body });
        res.end(Buffer.from(`header:${headerValue}`));
      });
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    const withOptions = await helpers.sendRequestBuffer("POST", "/buffer", {
      headers: { "x-custom": "buf" },
      body: "payload",
    });
    expect(withOptions.status).toBe(200);
    expect(withOptions.body.toString("utf8")).toBe("header:buf");
    expect(withOptions.headers["x-echo-body"]).toBe("payload");

    const withoutOptions = await helpers.sendRequestBuffer("GET", "/buffer");
    expect(withoutOptions.status).toBe(200);
    expect(withoutOptions.body.toString("utf8")).toBe("header:none");
    expect(withoutOptions.headers["x-echo-body"]).toBe("");
  });

  it("parses cookie and throws for missing cookie", async () => {
    const helpers = createHttpTestHelpers(() => 0);
    expect(helpers.cookieFromSetCookie("session=abc; Path=/")).toBe("session=abc");
    expect(() => helpers.cookieFromSetCookie("")).toThrow("missing_set_cookie");
  });

  it("logs in staff and stores cookie from string set-cookie", async () => {
    const { server, port } = await listen((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/staff/auth/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "staff=string; Path=/",
        });
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("not_found");
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    await expect(helpers.loginStaff()).resolves.toBe("staff=string");
    expect(helpers.withStaffCookie()).toEqual({ cookie: "staff=string" });
    expect(helpers.withStaffCookie({ "x-mode": "test" })).toEqual({
      "x-mode": "test",
      cookie: "staff=string",
    });

    helpers.resetStaffCookie();
    expect(helpers.withStaffCookie()).toEqual({ cookie: "" });
  });

  it("logs in staff and accepts array set-cookie", async () => {
    const { server, port } = await listen((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/staff/auth/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": ["staff=array; Path=/", "ignored=1; Path=/"],
        });
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("not_found");
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    await expect(helpers.loginStaff()).resolves.toBe("staff=array");
  });

  it("throws when staff login fails", async () => {
    const { server, port } = await listen((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/staff/auth/login") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("not_found");
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    await expect(helpers.loginStaff()).rejects.toThrow("staff_login_failed:401");
  });

  it("throws when login response has no set-cookie", async () => {
    const { server, port } = await listen((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/staff/auth/login") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("not_found");
    });
    servers.push(server);

    const helpers = createHttpTestHelpers(() => port);
    await expect(helpers.loginStaff()).rejects.toThrow("missing_set_cookie");
  });
});
