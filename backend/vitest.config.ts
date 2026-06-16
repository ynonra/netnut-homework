import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The cross-process race test stands up the docker-compose stack and so needs
    // Docker; it is opt-in via `npm run test:cross-process`, not part of the
    // default (dependency-free) suite.
    exclude: ["test/cross-process-race.test.ts", "node_modules/**", "dist/**"],
    // Integration tests share a temp DB; run serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
