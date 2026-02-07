import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.WF_WEB_PORT ?? "5173");
const baseURL = process.env.WF_BASE_URL ?? `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: "node e2e/webserver.mjs",
    url: `${baseURL}/kiosk`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
