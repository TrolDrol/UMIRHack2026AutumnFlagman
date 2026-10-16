import {
  type Context,
  type Connection,
  HttpError,
  request,
  prefix,
} from "./client";
export type Operation = {
  schema: 1;
  context: Context;
  method: "POST";
  path: string;
  body: string;
  key: string;
  createdAt: string;
  requestId: string;
  notBefore?: number;
};
export function scope(context: Context) {
  return `rims.supplier.v1.${encodeURIComponent(context.origin)}.${context.mode}.${context.backendInstanceId || "legacy"}.${context.warehouseId}.${context.clientId}`;
}
export function sameContext(a: Context, b: Context) {
  return (
    a.mode === b.mode &&
    a.backendInstanceId === b.backendInstanceId &&
    a.origin === b.origin &&
    a.warehouseId === b.warehouseId &&
    a.clientId === b.clientId
  );
}
export function foreignPending(context: Context) {
  const oldPrefix = `rims.supplier.v1.${encodeURIComponent(context.origin)}.${context.mode}.`;
  return Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i),
  )
    .filter(
      (key): key is string =>
        !!key &&
        key.startsWith(oldPrefix) &&
        key.includes(".pending.") &&
        !key.startsWith(scope(context) + ".pending."),
    )
    .map((key) => {
      const saved = localStorage.getItem(key);
      try {
        const original = JSON.parse(saved || "null") as Operation | null;
        if (original?.context.clientId === context.clientId && original.context.warehouseId === context.warehouseId && original.context.origin === context.origin)
          return { key, saved };
      } catch { /* Preserve unreadable records without exposing another principal's intention. */ }
      return null;
    })
    .filter((item): item is { key: string; saved: string | null } => item !== null);
}
export function readPending(context: Context): Operation | null {
  const pendingPrefix = `${scope(context)}.pending.`;
  const keys = Array.from({ length: localStorage.length }, (_, i) =>
    localStorage.key(i)!,
  )
    .filter((key) => key?.startsWith(pendingPrefix))
    .sort();
  if (!keys.length) return null;
  const raw = localStorage.getItem(keys[0]);
  if (!raw) return null;
  const value = JSON.parse(raw) as Operation;
  if (
    value.schema !== 1 ||
    !sameContext(value.context, context) ||
    value.method !== "POST" ||
    typeof value.body !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(value.key) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !value.path.startsWith(`${prefix(context.warehouseId)}/`) ||
    !(
      /^\/purchase-requests\/[^/]+\/(approve|reject)$/.test(
        value.path.slice(prefix(context.warehouseId).length),
      ) || value.path === `${prefix(context.warehouseId)}/deliveries`
    )
  )
    throw new Error(
      "Сохранённая операция повреждена. Нужна сверка с администратором.",
    );
  return value;
}
export function savePending(operation: Operation) {
  const key = `${scope(operation.context)}.pending.${operation.key}`;
  const serialized = JSON.stringify(operation);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized)
    throw new Error("Не удалось сохранить операцию. Отправка запрещена.");
}
export function prepare(
  context: Context,
  path: string,
  body: unknown,
  requestId: string,
): Operation {
  if (readPending(context))
    throw new Error("Сначала разрешите результат предыдущей операции.");
  const { mode, origin, warehouseId, clientId, backendInstanceId } = context;
  const operation: Operation = {
    schema: 1,
    context: { mode, origin, warehouseId, clientId, backendInstanceId },
    method: "POST",
    path,
    body: JSON.stringify(body),
    key: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    requestId,
  };
  savePending(operation);
  return operation;
}
export function clearPending(context: Context, key?: string) {
  const operationKey = key || readPending(context)?.key;
  if (operationKey)
    localStorage.removeItem(`${scope(context)}.pending.${operationKey}`);
}
export function expired(operation: Operation) {
  return Date.now() - Date.parse(operation.createdAt) >= 24 * 60 * 60 * 1000;
}
export async function sendOperation<T>(
  connection: Connection,
  operation: Operation,
): Promise<T> {
  if (!sameContext(connection, operation.context))
    throw new Error("Подключение не совпадает с сохранённой операцией.");
  if (expired(operation))
    throw new Error(
      "Прошло 24 часа. Нужна сверка результата с администратором; повтор заблокирован.",
    );
  if (operation.notBefore && Date.now() < operation.notBefore)
    throw new Error(
      "Сервер ограничил частоту запросов. Дождитесь указанного времени.",
    );
  savePending(operation);
  try {
    const result = await request<T>(connection.key, operation.path, {
      body: operation.body,
      idempotencyKey: operation.key,
    });
    clearPending(connection, operation.key);
    return result;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 429) {
        operation.notBefore = Date.now() + (error.retryAfter ?? 30) * 1000;
        savePending(operation);
      } else if (
        !error.unknown &&
        ![401, 403, 404].includes(error.status) &&
        error.code !== "IDEMPOTENCY_KEY_REUSED"
      )
        clearPending(connection, operation.key);
    }
    throw error;
  }
}
