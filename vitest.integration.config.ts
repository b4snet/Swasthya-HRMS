/**
 * Vitest configuration for INTEGRATION tests (real PostgreSQL; queued
 * prompt 3). Run via `pnpm test:integration` with DATABASE_URL pointing at
 * a disposable database — CI provides a Postgres service; locally:
 *   docker compose up -d && pnpm db:migrate && pnpm test:integration
 *
 * Kept separate from vitest.config.ts so unit tests never require a DB.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    reporters: ["default"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites run sequentially: they share one database and
    // truncate tables between tests; parallel workers would interfere.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
