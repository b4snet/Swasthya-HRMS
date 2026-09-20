import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration (Phase 1, ADR-009 journeys).
 *
 * CI (e2e-check job): boots Postgres, migrates, seeds, starts the production
 * server and runs the full login→organization journey against seeded users.
 * The workflow exports E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD so credentials
 * never live in the repo.
 *
 * Locally without a database: `pnpm test:e2e` runs the org UI journeys in
 * FIXTURE MODE (mocked server actions), so UI regressions are catchable
 * without Postgres. Fixtures are test-only stubs, not app behavior.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command: "pnpm next start -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
