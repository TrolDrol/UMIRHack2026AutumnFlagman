import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const configEnv = loadEnv(mode, process.cwd(), "API_PROXY_");
  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            forms: ["react-hook-form", "@hookform/resolvers", "zod"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          ws: true,
          target: configEnv.API_PROXY_TARGET || "http://localhost:8080",
          changeOrigin: false,
        },
        "/integrations/v1": {
          target: configEnv.API_PROXY_TARGET || "http://localhost:8080",
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
    },
  };
});
