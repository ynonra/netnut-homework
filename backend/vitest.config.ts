import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests share a temp DB; run serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
