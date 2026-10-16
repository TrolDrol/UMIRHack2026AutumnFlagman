import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", headless: true },
  webServer: [
    {
      command: "node scripts/serve-demo.mjs",
      url: "http://127.0.0.1:4174/client/",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node scripts/serve-demo.mjs",
      env: { PORT: "4175", CUSTOMER_DIST: "dist" },
      url: "http://127.0.0.1:4175/client/",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
