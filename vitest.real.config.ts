import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/real/**/*.test.ts"],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 30000,
  },
});
