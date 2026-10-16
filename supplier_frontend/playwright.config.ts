import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: { baseURL: "http://localhost:5175", headless: true },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5175 --configLoader runner",
    url: "http://localhost:5175/supplier/",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
