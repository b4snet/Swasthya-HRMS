import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Unit tests only — integration tests (tests/integration/**) run in
    // their own config with a real Postgres (vitest.integration.config.ts).
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "**/node_modules/**"],
    reporters: ["default"],
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/modules/**/*.ts", "src/lib/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
