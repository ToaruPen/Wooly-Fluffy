import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
// eslint-disable-next-line no-restricted-imports -- test-only fixture setup (same as stt-provider.test.ts)
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHttpServer } from "./http-server.js";
import { createStore } from "./store.js";
import { createHttpTestHelpers } from "./test-helpers/http.js";
import { createSseTestHelpers } from "./test-helpers/sse.js";

let webDistPath = "";

const savedEnv: Record<string, string | undefined> = {};

type TestServerContext = {
  server: Server;
  store: ReturnType<typeof createStore>;
  port: number;
};

const setupTestEnv = () => {
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

  savedEnv.STAFF_PASSCODE = process.env.STAFF_PASSCODE;
  savedEnv.TTS_SPEAKER_ID = process.env.TTS_SPEAKER_ID;
  process.env.STAFF_PASSCODE = "test-pass";
  process.env.TTS_SPEAKER_ID = "2";
};

const startTestServer = async (webDist?: string): Promise<TestServerContext> => {
  const store = createStore({ db_path: ":memory:" });
  const server = createHttpServer({ store, web_dist_path: webDist });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server address unavailable");
  }
  return { server, store, port: address.port };
};

const stopTestServer = async (ctx: TestServerContext) => {
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      ctx.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("server.close timed out")), 2_000),
    ),
  ]);
  ctx.store.close();
};

const teardownTestEnv = () => {
  if (savedEnv.STAFF_PASSCODE === undefined) {
    delete process.env.STAFF_PASSCODE;
  } else {
    process.env.STAFF_PASSCODE = savedEnv.STAFF_PASSCODE;
  }
  if (savedEnv.TTS_SPEAKER_ID === undefined) {
    delete process.env.TTS_SPEAKER_ID;
  } else {
    process.env.TTS_SPEAKER_ID = savedEnv.TTS_SPEAKER_ID;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
};

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

describe("http-server static web", () => {
  let ctx: TestServerContext;

  const helpers = createHttpTestHelpers(() => ctx.port);
  const { sendRequest } = helpers;
  const sseHelpers = createSseTestHelpers(() => ctx.port);
  const { readFirstSseMessage } = sseHelpers;

  beforeEach(async () => {
    setupTestEnv();
    ctx = await startTestServer(webDistPath);
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    teardownTestEnv();
  });

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
    const response = await readFirstSseMessage("/api/v1/kiosk/stream", { timeout_ms: 5_000 });

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

  it("returns 404 for GET /assets/%5C..%5Cpackage.json (backslash traversal)", async () => {
    const response = await sendRequest("GET", "/assets/%5C..%5Cpackage.json");

    expect(response.status).toBe(404);
  });
});

describe("http-server static web (no web_dist_path)", () => {
  let ctx: TestServerContext;

  const noDistHelpers = createHttpTestHelpers(() => ctx.port);

  beforeEach(async () => {
    setupTestEnv();
    ctx = await startTestServer(
      join(tmpdir(), `wf-nonexistent-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    );
  });

  afterEach(async () => {
    await stopTestServer(ctx);
    teardownTestEnv();
  });

  it("returns 404 for /kiosk when web_dist_path does not exist", async () => {
    const response = await noDistHelpers.sendRequest("GET", "/kiosk");

    expect(response.status).toBe(404);
  });

  it("returns 200 for /health even when web_dist_path does not exist", async () => {
    const response = await noDistHelpers.sendRequest("GET", "/health");

    expect(response.status).toBe(200);
  });
});
