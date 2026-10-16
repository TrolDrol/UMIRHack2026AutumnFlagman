import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import type { Connect } from "vite";
const rootWorker: Connect.NextHandleFunction = (request, response, next) => {
  if (request.url?.split("?")[0] !== "/mockServiceWorker.js") return next();
  response.setHeader("Content-Type", "text/javascript");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Service-Worker-Allowed", "/");
  response.end(
    readFileSync(new URL("./public/mockServiceWorker.js", import.meta.url)),
  );
};
export default defineConfig({
  base: "/client/",
  publicDir: false,
  plugins: [
    react(),
    {
      name: "portal-root-worker",
      configureServer(server) {
        server.middlewares.use(rootWorker);
      },
      configurePreviewServer(server) {
        server.middlewares.use(rootWorker);
      },
    },
  ],
  server: {
    port: 5174,
    fs: { allow: [".."] },
    proxy: {
      "/api": {
        ws: true,
        target: process.env.API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
