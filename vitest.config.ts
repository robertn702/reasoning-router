import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["@reasoning-router/source"],
  },
  ssr: {
    resolve: {
      conditions: ["@reasoning-router/source"],
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "eval/test/**/*.test.mjs"],
    // Lets tests force GC to check that cancellation survives weakly held abort links.
    execArgv: ["--expose-gc"],
  },
});
