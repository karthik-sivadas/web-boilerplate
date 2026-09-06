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
      "apps/api/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/.nitro/**",
    ],
    coverage: {
      provider: "v8",
      include: [
        "apps/web/src/features/workspace/legacy-import/reader.ts",
        "apps/web/src/features/workspace/api/client.ts",
        "packages/workspace-core/src/{domain,application}/workspace.ts",
        "apps/web/src/lib/auth/server.ts",
        "apps/web/src/features/auth/session-controller.ts",
        "apps/web/src/server/response-policy.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
        "packages/workspace-core/src/{domain,application}/workspace.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 85,
        },
      },
    },
  },
});
