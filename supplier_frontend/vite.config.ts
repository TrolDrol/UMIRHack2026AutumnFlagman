import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/supplier/",
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/api/": {
        target: process.env.API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: false,
      },
      "/integrations/": {
        target: process.env.API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
