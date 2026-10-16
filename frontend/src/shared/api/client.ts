import { ServerClock } from "@rims/demo-api/server-clock";
import { runtimeNamespace } from "@rims/demo-api/runtime";
const serverClock = new ServerClock();
export const serverNow = () =>
  serverClock.now(`${runtimeNamespace()}:${sessionVersion()}`);
import type { ApiError, Envelope } from "./types";
import {
  assertRuntimeCurrent,
  RuntimeChangedError,
  RuntimeHttpError,
} from "@rims/demo-api/runtime";
import {
  isCurrentContext,
  sessionVersion,
  type RequestContext,
} from "../../app/workspace";
export class HttpError extends Error {
  runtimeCheckFailed = false;
  constructor(
    public status: number,
    public payload: ApiError,
    public retryAt = 0,
  ) {
    super(payload.error.message);
  }
  get code() {
    return this.payload.error.code;
  }
}
export const apiBase = (import.meta.env.VITE_API_BASE_URL || "/api/v2").replace(
  /\/$/,
  "",
);
const rateLimits = new Map<string, HttpError>();
const live = import.meta.env.VITE_DEMO_MODE !== "true";
if (
  !apiBase.startsWith("/") ||
  apiBase.startsWith("//") ||
  /[?#]/.test(apiBase)
)
  throw new Error("API должен иметь путь на том же origin");
let csrfToken: string | null = null;
let authenticatedUserId: string | null = null;
let csrfRequest: Promise<string> | null = null;
async function csrf(signal?: AbortSignal): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfRequest ??= fetch(`${apiBase}/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
    signal,
  })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.data?.requestToken)
        throw new Error("Не удалось получить защитный токен сервера");
      return (csrfToken = payload.data.requestToken as string);
    })
    .finally(() => {
      csrfRequest = null;
    });
  return csrfRequest;
}
export function clearRateLimits() {
  rateLimits.clear();
}
export class ContextChangedError extends Error {
  constructor() {
    super(
      "Контекст изменился. Результат операции проверяйте в исходном предприятии.",
    );
  }
}
export function warehouseRequest<T>(
  context: RequestContext,
  path: string,
  options: Parameters<typeof request>[1] = {},
) {
  if (!isCurrentContext(context))
    return Promise.reject(new ContextChangedError());
  return request<T>(`/warehouses/${context.warehouseId}${path}`, {
    ...options,
    context,
  });
}
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: string;
    key?: string;
    signal?: AbortSignal;
    context?: RequestContext;
    csrfRetry?: boolean;
  } = {},
): Promise<Envelope<T>> {
  if (
    !/^\/(runtime$|auth\/|me\/|enterprises(?:\/|$)|staff(?:\/|\?|$)|warehouses\/)/.test(
      path,
    )
  )
    throw new Error("Бизнес-запросу требуется контекст склада");
  if (
    path.startsWith("/warehouses/") &&
    (!options.context ||
      !isCurrentContext(options.context) ||
      !path.startsWith(`/warehouses/${options.context.warehouseId}/`))
  )
    throw new ContextChangedError();
  const version = sessionVersion();
  const runtime = runtimeNamespace();
  const rateKey = `${options.context?.userId || version}:${options.method || "GET"}:${path.split("?")[0]}`;
  const limit = rateLimits.get(rateKey);
  if (limit && Date.now() < limit.retryAt) throw limit;
  rateLimits.delete(rateKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(
      options.method || "GET",
    );
    if (live && unsafe && !path.startsWith("/auth/"))
      await assertRuntimeCurrent(signal);
    const expectedUser = options.context?.userId || authenticatedUserId;
    const token = live && unsafe ? await csrf(signal) : null;
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
        ...(token ? { "X-CSRF-TOKEN": token } : {}),
        ...(live && unsafe && !path.startsWith("/auth/") && expectedUser
          ? { "X-Rims-Expected-User-Id": expectedUser }
          : {}),
      },
      body: options.body,
    });
    if (
      version !== sessionVersion() ||
      (options.context && !isCurrentContext(options.context))
    )
      throw new ContextChangedError();
    if (response.status === 204) {
      if (path === "/auth/logout") {
        csrfToken = null;
        authenticatedUserId = null;
        if (live && typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("rims.staff.session");
          channel.postMessage("changed");
          channel.close();
        }
      }
      return undefined as unknown as Envelope<T>;
    }
    const payload = await response.json();
    if (
      version !== sessionVersion() ||
      (options.context && !isCurrentContext(options.context))
    )
      throw new ContextChangedError();
    if (!response.ok) {
      if (payload?.error?.code === "CSRF_INVALID") {
        csrfToken = null;
        if (!options.csrfRetry)
          return request<T>(path, { ...options, csrfRetry: true });
      }
      if (payload?.error?.code === "SESSION_CONTEXT_CHANGED")
        window.dispatchEvent(new Event("rims:session-changed"));
      if (response.status === 401) {
        csrfToken = null;
        authenticatedUserId = null;
      }
      const retry = response.headers.get("Retry-After");
      const retryAt = retry
        ? /^\d+$/.test(retry)
          ? Date.now() + Number(retry) * 1000
          : Date.parse(retry)
        : 0;
      const error = new HttpError(
        response.status,
        payload?.error
          ? payload
          : {
              error: {
                code: "HTTP_ERROR",
                message: "Не удалось выполнить запрос",
                details: {},
              },
              meta: { serverTime: new Date().toISOString(), requestId: "" },
            },
        retryAt,
      );
      if (response.status === 401 && path !== "/auth/login")
        window.dispatchEvent(new Event("flagman:unauthorized"));
      if (response.status === 429 && retryAt > Date.now())
        rateLimits.set(rateKey, error);
      if ([403, 404].includes(response.status) && options.context)
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("rims:access-check", { detail: options.context }),
            ),
          0,
        );
      throw error;
    }
    if (["/auth/login", "/auth/register", "/auth/me"].includes(path)) {
      if (authenticatedUserId !== payload.data.id) csrfToken = null;
      authenticatedUserId = payload.data.id;
      if (path !== "/auth/me") csrfToken = null;
      if (
        live &&
        path !== "/auth/me" &&
        typeof BroadcastChannel !== "undefined"
      ) {
        const channel = new BroadcastChannel("rims.staff.session");
        channel.postMessage("changed");
        channel.close();
      }
    }
    if (runtime === runtimeNamespace())
      serverClock.observe(`${runtime}:${version}`, payload.meta.serverTime);
    return payload as Envelope<T>;
  } catch (error) {
    if (error instanceof RuntimeHttpError) {
      const failure = new HttpError(error.status, error.payload, error.retryAt);
      failure.runtimeCheckFailed = true;
      throw failure;
    }
    if (
      error instanceof HttpError ||
      error instanceof ContextChangedError ||
      error instanceof RuntimeChangedError ||
      options.signal?.aborted
    )
      throw error;
    if (controller.signal.aborted)
      throw new Error(
        "Сервер не ответил вовремя. Повторите проверку сохранённой операции.",
        { cause: error },
      );
    throw new Error(
      "Не удалось связаться с сервером. Проверьте соединение и повторите запрос.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Не удалось связаться с сервером";
}
