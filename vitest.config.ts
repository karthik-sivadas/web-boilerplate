import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".output/**"],
    coverage: {
      provider: "v8",
      include: ["src/features/workspace/{domain,persistence}.ts"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
