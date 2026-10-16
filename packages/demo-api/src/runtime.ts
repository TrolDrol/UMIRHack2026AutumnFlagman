export type RuntimeIdentity = {
  backendInstanceId: string;
  sourceKind: "server" | "mock";
  contractVersion: string;
};
export const runtimeMode =
  import.meta.env.VITE_DEMO_MODE === "true" ? "demo" : "live";
let identity: RuntimeIdentity | null = null;
let preparedMode = runtimeMode;
export class RuntimeChangedError extends Error {}
export class RuntimeHttpError extends Error {
  constructor(
    public status: number,
    public payload: {
      error: { code: string; message: string; details: Record<string, unknown> & { fields?: { path: string; message: string }[] } };
      meta: { serverTime: string; requestId: string };
    },
    public retryAt = 0,
  ) { super(payload.error.message); }
}
export async function assertRuntimeCurrent(signal?: AbortSignal) {
  // The entrypoint completes prepareRuntime before mounting any application.
  // Standalone transport unit tests may operate without mounting that entrypoint.
  if (preparedMode !== "live" || !identity) return;
  const response = await fetch("/api/v2/runtime", {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  const payload = await response.json();
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
    throw new RuntimeHttpError(response.status, {
      error: payload.error || { code: "LIVE_API_UNAVAILABLE", message: "Live API недоступен; сохранённая операция не отправлена.", details: {} },
      meta: payload.meta || { serverTime: new Date().toISOString(), requestId: crypto.randomUUID() },
    }, Number.isFinite(retryAt) ? retryAt : 0);
  }
  const current = payload.data as RuntimeIdentity;
  if (
    !payload.meta ||
    current?.sourceKind !== "server" ||
    current.contractVersion !== identity.contractVersion ||
    current.backendInstanceId !== identity.backendInstanceId
  )
    throw new RuntimeChangedError(
      "Источник API изменился. Операция сохранена в исходной среде; повтор заблокирован. Перезагрузите приложение и сверьте результат с администратором.",
    );
}
export function runtimeIdentity() {
  if (!identity) throw new Error("Источник API ещё не проверен");
  return identity;
}
export function runtimeNamespace() {
  return `${preparedMode}.${identity?.backendInstanceId || "unverified"}`;
}
export async function prepareRuntime(mode: "demo" | "live" = runtimeMode) {
  if (mode === "live" && navigator.serviceWorker) {
    const known = (worker: ServiceWorker | null) =>
      worker &&
      new URL(worker.scriptURL).origin === location.origin &&
      new URL(worker.scriptURL).pathname === "/mockServiceWorker.js";
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (
        registration.scope === location.origin + "/" &&
        [
          registration.active,
          registration.waiting,
          registration.installing,
        ].some(known)
      ) {
        registration.active?.postMessage("MOCK_DEACTIVATE");
        await registration.unregister();
      }
    }
    if (known(navigator.serviceWorker.controller)) {
      const marker = "rims.live.msw-cutover";
      if (sessionStorage.getItem(marker))
        throw new Error(
          "Demo Service Worker всё ещё контролирует вкладку. Закройте demo-вкладки и откройте live заново.",
        );
      sessionStorage.setItem(marker, "1");
      location.reload();
      await new Promise<never>(() => {});
    }
    sessionStorage.removeItem("rims.live.msw-cutover");
  }
  const response = await fetch("/api/v2/runtime", {
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json();
  const value = payload.data as RuntimeIdentity;
  if (
    !response.ok ||
    !payload.meta ||
    !value?.backendInstanceId ||
    value.contractVersion !== "2.1.0" ||
    value.sourceKind !== (mode === "live" ? "server" : "mock")
  )
    throw new Error(
      "Источник API или версия контракта не соответствует режиму приложения",
    );
  identity = value;
  preparedMode = mode;
  return value;
}
