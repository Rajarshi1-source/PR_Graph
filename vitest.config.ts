import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.ts", "evals/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
});
