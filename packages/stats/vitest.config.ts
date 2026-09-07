import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The seeded sweeps (property, sticky, shift) each resolve a few thousand synth cells.
    // Fine on CI, but a loaded laptop running the files in parallel can pass the 5 s default.
    testTimeout: 60_000,
  },
});
