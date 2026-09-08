import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The reconciliation sweep runs a few hundred synthetic cells; comfortably under this on
    // CI, but a laptop running the whole workspace in parallel needs the headroom (S10).
    testTimeout: 60_000,
  },
});
