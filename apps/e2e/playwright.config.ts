import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the built app (server + web in one process), the
 * same shape people self-host. Needs E2E_DATABASE_URL pointing at an empty
 * PostgreSQL database; migrations run on start.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const db = process.env.E2E_DATABASE_URL;
if (!db) throw new Error("E2E_DATABASE_URL is required");

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node ../server/dist/main.js",
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: db,
      AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123",
      BASE_URL: BASE,
      PORT: String(PORT),
      WEB_DIST: "../web/dist",
      MIGRATIONS_DIR: "../../packages/db/migrations",
      DATA_DIR: "./.e2e-data",
      // Every test signs up fresh people from one address.
      AUTH_ATTEMPTS_PER_5_MIN: "0",
    },
  },
});
