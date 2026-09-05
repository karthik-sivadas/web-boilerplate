import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const externalServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure" },
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: "PORT=4173 HOST=127.0.0.1 pnpm start",
          port: 4173,
          reuseExistingServer: false,
        },
      }),
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium-emulation",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
