import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files share one database and truncate it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
