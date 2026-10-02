import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 4318);
const apiPort = Number(process.env.API_PORT ?? 4317);
const appUrl = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx ../server/test-support/run-mcp-http.ts",
      port: 4320,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node ../../scripts/start-mcp-test-host.mjs",
      url: "http://localhost:8080",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `API_PORT=${apiPort} pnpm exec tsx e2e/start-api.ts`,
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `API_PORT=${apiPort} pnpm dev --host 127.0.0.1 --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
