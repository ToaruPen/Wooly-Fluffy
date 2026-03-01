import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
// eslint-disable-next-line no-restricted-imports
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { createHttpTestHelpers } from "./test-helpers/http.js";
import { createSseTestHelpers } from "./test-helpers/sse.js";

let server: Server;
let port = 0;
let store: ReturnType<typeof createStore>;
let webDistPath = "";

const helpers = createHttpTestHelpers(() => port);
const { sendRequest } = helpers;
const sseHelpers = createSseTestHelpers(() => port);
const { readFirstSseMessage } = sseHelpers;

beforeAll(() => {
  webDistPath = mkdtempSync(join(tmpdir(), "wf-static-web-"));
  mkdirSync(join(webDistPath, "assets"), { recursive: true });
  mkdirSync(join(webDistPath, "assets", "%2e%2e"), { recursive: true });
  writeFileSync(join(webDistPath, "index.html"), "<!doctype html><html><body>SPA</body></html>");
  writeFileSync(join(webDistPath, "package.json"), '{"name":"should-not-serve"}\n');
  writeFileSync(join(webDistPath, "assets", "app.js"), "console.log('app')");
  writeFileSync(join(webDistPath, "assets", "%2e%2e", "package.json"), '{"name":"encoded"}\n');
  writeFileSync(join(webDistPath, "assets", "style.css"), "body{}\n");
  writeFileSync(join(webDistPath, "assets", "data.bin"), Buffer.from([0x00, 0x01]));
});

afterAll(() => {
  rmSync(webDistPath, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.stubGlobal("fetch", (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/version")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: "test" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  }) as unknown as typeof fetch);

  process.env.STAFF_PASSCODE = "test-pass";
  process.env.TTS_SPEAKER_ID = "2";

  store = createStore({ db_path: ":memory:" });
  server = createHttpServer({ store, web_dist_path: webDistPath });
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

  store.close();
  delete process.env.STAFF_PASSCODE;
  delete process.env.TTS_SPEAKER_ID;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("http-server static web", () => {
  it("serves SPA index for GET /kiosk", async () => {
    const response = await sendRequest("GET", "/kiosk");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("text/html");
    expect(response.body).toContain("<!doctype html>");
  });

  it("serves SPA index for GET /staff", async () => {
    const response = await sendRequest("GET", "/staff");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("text/html");
    expect(response.body).toContain("<!doctype html>");
  });

  it("serves SPA index for nested kiosk/staff paths and root", async () => {
    const root = await sendRequest("GET", "/");
    const kioskNested = await sendRequest("GET", "/kiosk/settings");
    const staffNested = await sendRequest("GET", "/staff/reports");

    expect(root.status).toBe(200);
    expect(kioskNested.status).toBe(200);
    expect(staffNested.status).toBe(200);
    expect(root.body).toContain("<!doctype html>");
    expect(kioskNested.body).toContain("<!doctype html>");
    expect(staffNested.body).toContain("<!doctype html>");
  });

  it("serves static asset for GET /assets/app.js", async () => {
    const response = await sendRequest("GET", "/assets/app.js");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("application/javascript");
    expect(response.body).toContain("console.log('app')");
  });

  it("serves CSS asset with text/css content-type", async () => {
    const response = await sendRequest("GET", "/assets/style.css");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("text/css");
  });

  it("does not intercept GET /api/v1/kiosk/stream with static route", async () => {
    const response = await readFirstSseMessage("/api/v1/kiosk/stream");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");
  });

  it("returns 404 for GET /assets/../package.json", async () => {
    const response = await sendRequest("GET", "/assets/../package.json");

    expect(response.status).toBe(404);
  });

  it("returns 404 for GET /assets/%2e%2e/package.json", async () => {
    const response = await sendRequest("GET", "/assets/%2e%2e/package.json");

    expect(response.status).toBe(404);
  });

  it("returns 404 for GET /assets/nonexistent.js", async () => {
    const response = await sendRequest("GET", "/assets/nonexistent.js");

    expect(response.status).toBe(404);
  });

  it("returns 404 for malformed percent-encoding in asset path", async () => {
    const response = await sendRequest("GET", "/assets/%ZZ/file.js");

    expect(response.status).toBe(404);
  });

  it("serves unknown extension with application/octet-stream", async () => {
    const response = await sendRequest("GET", "/assets/data.bin");

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"] ?? "")).toContain("application/octet-stream");
  });
});
