import { prepareRuntime } from "@rims/demo-api/runtime";
import ReactDOM from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import foundation from "./styles/foundation.module.css";
import { HttpError } from "./shared/api/client";
const root = document.getElementById("root")!;
// Keep an actual module export in use so production retains the global rules.
root.classList.add(foundation.appRoot);
const client = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: {
      retryOnMount: false,
      refetchOnMount: (query) =>
        !(
          query.state.error instanceof HttpError &&
          [403, 404].includes(query.state.error.status)
        ),
    },
  },
});
focusManager.setEventListener((notify) => {
  const update = () => notify(document.visibilityState === "visible");
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", update);
  };
});
async function start() {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const { startBrowserDemo } = await import("@rims/demo-api");
    await startBrowserDemo();
  }
  await prepareRuntime();
  ReactDOM.createRoot(root).render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
void start().catch((error) => {
  root.textContent = `Не удалось запустить приложение: ${error instanceof Error ? error.message : "ошибка"}. Для demo требуется service worker на localhost или HTTPS.`;
});
