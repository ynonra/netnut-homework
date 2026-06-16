import { defineConfig } from "vitest/config";

/**
 * Config for the cross-process race test (issue #7), which stands up the real
 * docker-compose stack. Kept separate from the default suite because it requires
 * Docker. Generous timeouts cover image build + stack startup.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/cross-process-race.test.ts"],
    fileParallelism: false,
    testTimeout: 360_000,
    hookTimeout: 600_000,
  },
});
