import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testIgnore:
    process.env.FLAGMAN_DEMO_TESTS === "1"
      ? ["**/contract.spec.ts", "**/live.spec.ts"]
      : ["**/demo.spec.ts", "**/v2-demo.spec.ts"],
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: process.env.FRONTEND_URL || "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.FRONTEND_URL
    ? undefined
    : {
        command:
          process.env.FLAGMAN_DEMO_TESTS === "1"
            ? "npm run dev:demo -- --host 127.0.0.1"
            : "npm run dev -- --host 127.0.0.1",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
      },
  reporter: "list",
});
