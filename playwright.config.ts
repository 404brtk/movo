import { defineConfig, devices } from "@playwright/test";

const dataDirectory = process.env.MOVO_TEST_DATA_DIR;
if (!dataDirectory) {
  throw new Error("Run browser tests through bun run test:e2e to isolate their data");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4311", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run start",
    url: "http://127.0.0.1:4311/api/health",
    reuseExistingServer: false,
    env: { PORT: "4311", MOVO_DATA_DIR: dataDirectory },
    timeout: 30000,
  },
});
