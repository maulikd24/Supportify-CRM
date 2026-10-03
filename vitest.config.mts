import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // One real Postgres per run (see tests/setup/global-setup.ts), shared by
    // every file — run files one at a time so fixtures can't interfere.
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/test-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
