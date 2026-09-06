import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: [
    ...(externalServer
      ? []
      : [
          {
            command: "pnpm exec tsx tests/start-artifact.ts",
            port: 4173,
            reuseExistingServer: false,
          },
        ]),
    {
      command: "pnpm exec vite --config tests/rtl/vite.config.ts",
      port: 4174,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium-emulation",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
