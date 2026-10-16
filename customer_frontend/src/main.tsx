import { prepareRuntime } from "@rims/demo-api/runtime";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./app/auth";
import { App } from "./app/App";
import styles from "./app/foundation.module.css";
const root = document.getElementById("root")!;
root.className = styles.root;
async function start() {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const { startBrowserDemo } = await import("@rims/demo-api");
    await startBrowserDemo();
  }
  await prepareRuntime();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10000 },
      mutations: { retry: false },
    },
  });
  createRoot(root).render(
    <QueryClientProvider client={client}>
      <BrowserRouter basename="/client">
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}
void start().catch((error) => {
  root.textContent = `Не удалось запустить сайт: ${error instanceof Error ? error.message : "ошибка"}`;
});
