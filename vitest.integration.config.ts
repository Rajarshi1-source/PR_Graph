import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/** Integration tests need live services (Postgres/Redis) — run separately from unit tests. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
});
