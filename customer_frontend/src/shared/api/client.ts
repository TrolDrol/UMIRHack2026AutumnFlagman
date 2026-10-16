import { ServerClock } from "@rims/demo-api/server-clock";
import { runtimeNamespace } from "@rims/demo-api/runtime";
const serverClock = new ServerClock();
export const serverNow = () =>
  serverClock.now(`${runtimeNamespace()}:${sessionEpoch}`);
import {
  assertRuntimeCurrent,
  RuntimeChangedError,
  RuntimeHttpError,
} from "@rims/demo-api/runtime";
export const mode = import.meta.env.VITE_DEMO_MODE === "true" ? "demo" : "live";
let sessionEpoch = 0;
let csrfToken: string | null = null;
let authenticatedUserId: string | null = null;
let csrfRequest: Promise<string> | null = null;
export const currentSessionEpoch = () => sessionEpoch;
export const invalidateSession = () => {
  sessionEpoch++;
  serverClock.reset();
  csrfToken = null;
  authenticatedUserId = null;
};
const sessionChannel =
  mode === "live" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("rims.customer.session")
    : null;
sessionChannel?.addEventListener("message", () => {
  invalidateSession();
  window.dispatchEvent(new Event("customer:session-changed"));
});
export const base = new URL(
  import.meta.env.VITE_CUSTOMER_API_BASE_URL || "/api/v2/customer",
  location.origin,
).href.replace(/\/$/, "");
if (new URL(base).origin !== location.origin || /[?#]/.test(base))
  throw new Error("API должен находиться на том же origin.");
export class ApiError extends Error {
  runtimeCheckFailed = false;
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: { path: string; message: string }[] = [],
    public details: Record<string, unknown> = {},
    public meta: Record<string, unknown> = {},
    public retryAt = 0,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  options: RequestInit & { expectedUserId?: string; csrfRetry?: boolean } = {},
): Promise<T> {
  if (
    new URL(path.startsWith("http") ? path : base + path).origin !==
    location.origin
  )
    throw new Error("Запрос в другую среду запрещён");
  if (
    options.method === "POST" &&
    /^\/auth\/(login|register|logout)$/.test(path)
  )
    sessionEpoch++;
  const epoch = sessionEpoch;
  const runtime = runtimeNamespace();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, abort.signal])
    : abort.signal;
  try {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
      options.method || "GET",
    );
    if (mode === "live" && unsafe && !/^\/auth\//.test(path))
      await assertRuntimeCurrent(signal);
    const expectedUser = options.expectedUserId || authenticatedUserId;
    if (mode === "live" && unsafe && !csrfToken) {
      csrfRequest ??= fetch(base + "/auth/csrf", {
        credentials: "include",
        cache: "no-store",
        signal,
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !payload.data?.requestToken)
            throw new Error("CSRF unavailable");
          return (csrfToken = payload.data.requestToken as string);
        })
        .finally(() => {
          csrfRequest = null;
        });
      await csrfRequest;
    }
    const response = await fetch(path.startsWith("http") ? path : base + path, {
      ...options,
      signal,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        ...(mode === "live" && unsafe && csrfToken
          ? { "X-CSRF-TOKEN": csrfToken }
          : {}),
        ...(mode === "live" && unsafe && !/^\/auth\//.test(path) && expectedUser
          ? { "X-Rims-Expected-User-Id": expectedUser }
          : {}),
      },
    });
    if (response.status === 204) {
      if (path === "/auth/logout") {
        authenticatedUserId = null;
        csrfToken = null;
        sessionChannel?.postMessage("changed");
      }
      return undefined as T;
    }
    const value = await response.json().catch(() => {
      throw new ApiError(
        response.status,
        "CONNECTION_ERROR",
        "API вернул некорректный ответ. Проверьте подключение сервера.",
      );
    });
    if (!response.ok) {
      if (value.error?.code === "CSRF_INVALID") {
        csrfToken = null;
        if (!options.csrfRetry)
          return request<T>(path, { ...options, csrfRetry: true });
      }
      if (value.error?.code === "SESSION_CONTEXT_CHANGED") {
        invalidateSession();
        window.dispatchEvent(new Event("customer:session-changed"));
      }
      if (response.status === 401 && epoch === sessionEpoch) {
        csrfToken = null;
        authenticatedUserId = null;
      }
      if (response.status === 401 && epoch === sessionEpoch)
        window.dispatchEvent(new Event("customer:unauthorized"));
      throw new ApiError(
        response.status,
        value.error?.code || "API_ERROR",
        value.error?.message || "Ошибка сервера",
        value.error?.details?.fields || [],
        value.error?.details || {},
        value.meta || {},
        response.headers.get("Retry-After")
          ? /^\d+$/.test(response.headers.get("Retry-After")!)
            ? Date.now() + Number(response.headers.get("Retry-After")) * 1000
            : Date.parse(response.headers.get("Retry-After")!)
          : 0,
      );
    }
    if (!value.meta || !("data" in value))
      throw new ApiError(
        502,
        "CONNECTION_ERROR",
        "Ответ API не соответствует контракту.",
      );
    if (
      epoch === sessionEpoch &&
      ["/auth/login", "/auth/register", "/auth/me"].includes(path)
    ) {
      if (authenticatedUserId !== value.data.id) csrfToken = null;
      authenticatedUserId = value.data.id;
      if (path !== "/auth/me") csrfToken = null;
      if (path !== "/auth/me") sessionChannel?.postMessage("changed");
    }
    if (epoch === sessionEpoch && runtime === runtimeNamespace())
      serverClock.observe(`${runtime}:${epoch}`, value.meta.serverTime);
    return value.data as T;
  } catch (error) {
    if (error instanceof RuntimeHttpError) {
      const failure = new ApiError(
        error.status,
        error.payload.error.code,
        error.message,
        error.payload.error.details.fields || [],
        error.payload.error.details,
        error.payload.meta,
        error.retryAt,
      );
      failure.runtimeCheckFailed = true;
      throw failure;
    }
    if (error instanceof ApiError) throw error;
    if (error instanceof RuntimeChangedError)
      throw new ApiError(0, "RUNTIME_CONTEXT_CHANGED", error.message);
    throw new ApiError(
      0,
      "CONNECTION_ERROR",
      "Соединение прервано. Результат отправленного заказа может быть неизвестен.",
    );
  } finally {
    clearTimeout(timer);
  }
}
export const warehouse = (id: string) =>
  "/warehouses/" + encodeURIComponent(id);
