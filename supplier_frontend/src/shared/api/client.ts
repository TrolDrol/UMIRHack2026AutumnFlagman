import {
  runtimeIdentity,
  assertRuntimeCurrent,
  RuntimeChangedError,
  RuntimeHttpError,
} from "@rims/demo-api/runtime";
import type {
  Envelope,
  ApiError,
  IntegrationIdentity,
} from "@rims/portal-contracts";
export type Mode = "demo" | "live";
export type Context = {
  mode: Mode;
  origin: string;
  backendInstanceId?: string;
  warehouseId: string;
  clientId: string;
};
export type Connection = Context & {
  key: string;
  identity: IntegrationIdentity;
};
const configuredBase =
  import.meta.env.VITE_INTEGRATIONS_BASE_URL || "/integrations/v1";
if (
  !configuredBase.startsWith("/") ||
  configuredBase.startsWith("//") ||
  /[?#]/.test(configuredBase)
)
  throw new Error(
    "API должен находиться на том же origin и иметь абсолютный путь.",
  );
export const base = configuredBase.replace(/\/$/, "");
export const prefix = (warehouseId: string) =>
  `${base}/warehouses/${encodeURIComponent(warehouseId)}`;
export class HttpError extends Error {
  runtimeCheckFailed = false;
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: { path: string; message: string }[] = [],
    public retryAfter: number | null = null,
    public details: Record<string, unknown> = {},
    public meta: ApiError["meta"] | null = null,
  ) {
    super(message);
  }
  get unknown() {
    return this.runtimeCheckFailed || this.status === 0 || this.status >= 500;
  }
}
export async function request<T>(
  key: string,
  path: string,
  options: {
    body?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 20000);
  try {
    if (options.body !== undefined)
      await assertRuntimeCurrent(controller.signal);
    const response = await fetch(path, {
      method: options.body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "Idempotency-Key": options.idempotencyKey!,
            }),
      },
      body: options.body,
    });
    let payload: Envelope<T> | ApiError;
    try {
      payload = await response.json();
    } catch {
      throw new HttpError(
        response.ok ? 0 : response.status,
        "CONNECTION_ERROR",
        "API вернул некорректный ответ. Проверьте адрес и доступность сервера.",
      );
    }
    if (!response.ok) {
      const failure = "error" in payload ? payload.error : null;
      const retry = response.headers.get("Retry-After");
      const seconds = retry
        ? /^\d+$/.test(retry)
          ? Number(retry)
          : Math.max(0, (Date.parse(retry) - Date.now()) / 1000)
        : null;
      throw new HttpError(
        response.status,
        failure?.code || "HTTP_ERROR",
        response.status === 403
          ? "Недостаточно разрешений для этой операции."
          : failure?.message || "Ошибка API",
        failure?.details?.fields || [],
        Number.isFinite(seconds) ? seconds : null,
        failure?.details || {},
        payload.meta,
      );
    }
    if (!payload || !("data" in payload) || !("meta" in payload))
      throw new HttpError(
        0,
        "CONNECTION_ERROR",
        "Ответ API не соответствует контракту.",
      );
    return payload.data;
  } catch (error) {
    if (error instanceof RuntimeHttpError) {
      const failure = new HttpError(error.status, error.payload.error.code, error.message, error.payload.error.details.fields || [], error.retryAt ? Math.max(0, (error.retryAt - Date.now()) / 1000) : null, error.payload.error.details, error.payload.meta);
      failure.runtimeCheckFailed = true;
      throw failure;
    }
    if (error instanceof HttpError) throw error;
    if (error instanceof RuntimeChangedError)
      throw new HttpError(0, "RUNTIME_CONTEXT_CHANGED", error.message);
    throw new HttpError(
      0,
      "CONNECTION_ERROR",
      "Не удалось получить ответ. Проверьте соединение.",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
export async function identify(
  mode: Mode,
  warehouseId: string,
  key: string,
): Promise<Connection> {
  const identity = await request<IntegrationIdentity>(
    key,
    `${prefix(warehouseId)}/identity`,
  );
  if (
    identity.warehouseId !== warehouseId ||
    identity.kind !== "supplier" ||
    !identity.clientId
  )
    throw new HttpError(
      403,
      "IDENTITY_MISMATCH",
      "Ключ должен принадлежать поставщику выбранного склада.",
    );
  return {
    mode,
    origin: location.origin,
    backendInstanceId: runtimeIdentity().backendInstanceId,
    warehouseId,
    clientId: identity.clientId,
    key,
    identity,
  };
}
