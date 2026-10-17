import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real custom server (Next + Socket.IO). In CI the job builds first and Playwright
 * boots `node dist/server.mjs`; locally an already-running `npm run dev` on :3000 is reused.
 * Graph interactions target `/demo` (deterministic fixtures — no GitHub needed).
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node dist/server.mjs",
        // `/` needs no database, so local runs without Postgres still boot; CI has a real DB.
        url: `${baseURL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        env: { PORT: String(PORT), DEMO_ENABLED: "true" },
      },
});
