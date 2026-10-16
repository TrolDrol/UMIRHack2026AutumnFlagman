import { createRoot } from "react-dom/client";
import { prepareRuntime } from "@rims/demo-api/runtime";
import { App } from "./app/App";
async function start() {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const { startBrowserDemo } = await import("@rims/demo-api");
    await startBrowserDemo();
  }
  await prepareRuntime();
  createRoot(document.getElementById("root")!).render(<App />);
}
void start().catch((error) => {
  document.getElementById("root")!.textContent =
    `Не удалось запустить приложение: ${error instanceof Error ? error.message : "ошибка"}`;
});
