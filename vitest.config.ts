import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "apps/web/src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: [
      "tests/e2e/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/.nitro/**",
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/web/src/features/workspace/{domain,persistence}.ts",
        "apps/web/src/lib/auth/{server,development-path}.ts",
        "apps/web/src/features/auth/session-controller.ts",
        "apps/web/src/server/{startup-gate,response-policy}.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
        "apps/web/src/features/workspace/{domain,persistence}.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 85,
        },
      },
    },
  },
});
