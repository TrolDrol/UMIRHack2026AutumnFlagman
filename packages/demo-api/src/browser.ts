import { setupWorker } from "msw/browser";
import { http, HttpResponse } from "msw";
import { transaction } from "./storage";
let activeWorker: ReturnType<typeof setupWorker> | null = null;
export async function ensureDemoInitialized() {
  if (!navigator.locks) throw new Error("Демонстрации нужен Web Locks.");
  return navigator.locks.request("rims.demo.api.v2", async () => {
    const model = await import("./model");
    transaction(() => model.initializeDemoData());
    return model;
  });
}
export async function resetDemo({ confirmed }: { confirmed: true }) {
  if (confirmed !== true)
    throw new Error("Требуется явное подтверждение сброса.");
  const model = await ensureDemoInitialized();
  await navigator.locks.request("rims.demo.api.v2", () =>
    transaction(() => {
      model.resetDemoData();
      localStorage.setItem("rims.demo.instance.v1", crypto.randomUUID());
    }),
  );
}
export async function startBrowserDemo({
  workerUrl = "/mockServiceWorker.js",
  scope = "/",
} = {}) {
  if (activeWorker) return activeWorker;
  if (!navigator.locks || !navigator.serviceWorker)
    throw new Error(
      "Демонстрации нужны Web Locks и Service Worker: используйте localhost или HTTPS.",
    );
  const model = await ensureDemoInitialized();
  const handle = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/v2/runtime") {
      const storageKey = "rims.demo.instance.v1";
      const backendInstanceId =
        localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, backendInstanceId);
      return HttpResponse.json({
        data: {
          backendInstanceId,
          sourceKind: "mock",
          contractVersion: "2.1.0",
        },
        meta: {
          serverTime: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        },
      });
    }
    let body: unknown;
    try {
      const raw = request.method === "GET" ? "" : await request.text();
      if (raw) body = JSON.parse(raw);
    } catch {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "Некорректный JSON",
            details: {},
          },
          meta: {
            serverTime: new Date().toISOString(),
            requestId: crypto.randomUUID(),
          },
        },
        { status: 400 },
      );
    }
    try {
      const result = await navigator.locks.request("rims.demo.api.v2", () =>
        transaction(() =>
          model.demoRequest(
            url.pathname.replace(/^\/api\/v2/, ""),
            request.method,
            body,
            url,
            request.headers.get("Idempotency-Key"),
            request.headers.get("Authorization")?.replace(/^Bearer /, ""),
          ),
        ),
      );
      return result.status === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(result.body, {
            status: result.status,
            headers: { "Cache-Control": "no-store" },
          });
    } catch {
      return HttpResponse.json(
        {
          error: {
            code: "DEMO_STORAGE_ERROR",
            message:
              "Не удалось сохранить демонстрационные данные. Освободите хранилище и повторите ту же операцию.",
            details: {},
          },
          meta: {
            serverTime: new Date().toISOString(),
            requestId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      );
    }
  };
  const worker = setupWorker(
    http.all("/api/v2/*", handle),
    http.all("/integrations/v1/*", handle),
  );
  await worker.start({
    serviceWorker: { url: workerUrl, options: { scope } },
    onUnhandledRequest: "bypass",
    quiet: true,
  });
  activeWorker = worker;
  return worker;
}
export async function listDemoSuppliers() {
  const model = await ensureDemoInitialized();
  return navigator.locks.request("rims.demo.api.v2", () =>
    transaction(() => model.listDemoSuppliers()),
  );
}
export async function connectDemoSupplier(input: {
  warehouseId: string;
  clientId: string;
}) {
  const model = await ensureDemoInitialized();
  return navigator.locks.request("rims.demo.api.v2", () =>
    transaction(() => model.connectDemoSupplier(input)),
  );
}
