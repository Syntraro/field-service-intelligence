import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
      // 2026-05-07 Pricebook picker: tests/pricebook-picker.test.ts imports
      // pure helpers from `client/src/components/line-items/pricebookHelpers.ts`,
      // which uses the standard `@/` alias for the rest of the client tree.
      // tsconfig.json already maps `@/* → client/src/*`; this mirrors it for
      // vitest's runtime resolver. Existing source-pin tests are unaffected
      // (they readFileSync source files instead of importing them).
      "@": path.resolve(__dirname, "./client/src"),
    },
  },
});
