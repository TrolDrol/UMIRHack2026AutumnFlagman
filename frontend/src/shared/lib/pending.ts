import { HttpError, warehouseRequest } from "../api/client";
import type { Envelope } from "../api/types";
import {
  isCurrentContext,
  sameScope,
  maySend,
  type RequestContext,
} from "../../app/workspace";
export type Pending = {
  version: 2;
  context: RequestContext;
  method: "POST" | "PUT";
  path: string;
  scopedPath: string;
  resource:
    | "deliveries"
    | "orders"
    | "write-offs"
    | "quarantines"
    | "combos"
    | "purchase-requests"
    | "manual-offers";
  resourceId: string | null;
  kind:
    | "delivery-create"
    | "delivery-confirm"
    | "delivery-reject"
    | "order"
    | "service-order"
    | "write-off"
    | "quarantine"
    | "combo"
    | "purchase-request"
    | "manual-offer";
  // purchase commands retain their exact method/version/body on recovery
  key: string;
  body: string;
  createdAt: string;
  state: "unknown" | "sending" | "conflict";
  retryAt?: number;
  draftName?: string;
};
const storageKey = "rims.pending.v2";
function changed(context?: RequestContext) {
  window.dispatchEvent(new CustomEvent("flagman:pending", { detail: context }));
}
export function hasLegacyPending() {
  try {
    return (
      JSON.parse(sessionStorage.getItem("flagman.pending.v1") || "[]").length >
        0 || readPending().some((item) => !item.context.runtimeScope)
    );
  } catch {
    return false;
  }
}
export function readPending(): Pending[] {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || "[]").filter(
      (item: Pending) =>
        item.version === 2 && item.context?.userId && item.context?.warehouseId,
    );
  } catch {
    return [];
  }
}
export function pendingFor(context: RequestContext) {
  return readPending().filter((item) => sameScope(item.context, context));
}
function save(items: Pending[], context?: RequestContext) {
  sessionStorage.setItem(storageKey, JSON.stringify(items));
  changed(context);
}
export function completePending(key: string) {
  const item = readPending().find((x) => x.key === key);
  save(
    readPending().filter((x) => x.key !== key),
    item?.context,
  );
}
export function commandKind(path: string): Pending["kind"] {
  if (/^\/manual-offers(?:\/|$)/.test(path)) return "manual-offer";
  if (/^\/purchase-requests(?:\/|$)/.test(path)) return "purchase-request";
  if (/^\/quarantines(?:\/|$)/.test(path)) return "quarantine";
  if (/^\/combos(?:\/|$)/.test(path)) return "combo";
  if (/^\/deliveries\/[^/]+\/confirm$/.test(path)) return "delivery-confirm";
  if (/^\/deliveries\/[^/]+\/reject$/.test(path)) return "delivery-reject";
  if (path === "/deliveries") return "delivery-create";
  if (path === "/service/orders") return "service-order";
  if (path === "/orders") return "order";
  if (path === "/write-offs") return "write-off";
  throw new Error("Для этой команды восстановление не предусмотрено");
}
export function beginPending(
  context: RequestContext,
  path: string,
  body: unknown,
  draftName?: string,
  method: "POST" | "PUT" = "POST",
): Pending {
  if (!isCurrentContext(context) || !maySend(context.role, path))
    throw new Error("Операция недоступна в текущем предприятии");
  if (pendingFor(context).some((x) => x.path === path))
    throw new Error(
      "Сначала подтвердите результат предыдущей операции в восстановлении",
    );
  const item: Pending = {
    version: 2,
    context: { ...context },
    method,
    path,
    kind: commandKind(path),
    scopedPath: `/api/v2/warehouses/${context.warehouseId}${path}`,
    resource: path.startsWith("/manual-offers")
      ? "manual-offers"
      : path.startsWith("/purchase-requests")
        ? "purchase-requests"
        : path.startsWith("/quarantines")
          ? "quarantines"
          : path.startsWith("/combos")
            ? "combos"
            : path.includes("deliveries")
              ? "deliveries"
              : path.includes("orders")
                ? "orders"
                : "write-offs",
    resourceId:
      /^\/(?:deliveries|quarantines|combos|manual-offers)\/([^/]+)(?:\/|$)/.exec(
        path,
      )?.[1] || null,
    key: crypto.randomUUID(),
    body: JSON.stringify(body),
    createdAt: new Date().toISOString(),
    state: "sending",
    ...(draftName ? { draftName } : {}),
  };
  try {
    save([...readPending(), item], context);
  } catch {
    throw new Error(
      "Не удалось сохранить операцию; запрос не отправлен. Разрешите sessionStorage.",
    );
  }
  return item;
}
const inFlight = new Set<string>();
export const isSending = (key: string) => inFlight.has(key);
export const isExpiredPending = (item: Pending) =>
  Date.now() - Date.parse(item.createdAt) >= 24 * 3600000;
export async function sendPending<T>(
  snapshot: Pending,
  context: RequestContext,
): Promise<Envelope<T>> {
  const item = readPending().find((x) => x.key === snapshot.key);
  if (
    !item ||
    !sameScope(item.context, context) ||
    !isCurrentContext(context) ||
    !maySend(context.role, item.path)
  )
    throw new Error(
      "Восстановление недоступно: войдите под исходным оператором и выберите исходное предприятие с разрешённой ролью",
    );
  if (item.state === "conflict" || isExpiredPending(item))
    throw new Error(
      "Прошло 24 часа или ключ конфликтует. Требуется сверка истории и ключа с администратором API",
    );
  if (inFlight.has(item.key)) throw new Error("Операция уже отправляется");
  if (item.retryAt && Date.now() < item.retryAt)
    throw new Error("Дождитесь разрешённого времени повтора");
  inFlight.add(item.key);
  try {
    // Warehouse and serialized body are taken from the immutable saved intention.
    const result = await warehouseRequest<T>(
      {
        ...item.context,
        role: context.role,
        sessionVersion: context.sessionVersion,
      },
      item.path,
      { method: item.method, body: item.body, key: item.key },
    );
    completePending(item.key);
    window.dispatchEvent(
      new CustomEvent("flagman:confirmed", {
        detail: { path: item.path, kind: item.kind, context },
      }),
    );
    return result;
  } catch (error) {
    if (
      error instanceof HttpError &&
      !error.runtimeCheckFailed &&
      error.status < 500 &&
      ![401, 403, 404, 429].includes(error.status) &&
      error.code !== "IDEMPOTENCY_KEY_REUSED" &&
      error.code !== "SESSION_CONTEXT_CHANGED" &&
      error.code !== "CSRF_INVALID"
    )
      completePending(item.key);
    else
      save(
        readPending().map((x) =>
          x.key === item.key
            ? {
                ...x,
                state:
                  error instanceof HttpError &&
                  error.code === "IDEMPOTENCY_KEY_REUSED"
                    ? "conflict"
                    : "unknown",
                retryAt: error instanceof HttpError ? error.retryAt : 0,
              }
            : x,
        ),
        item.context,
      );
    throw error;
  } finally {
    inFlight.delete(item.key);
  }
}
export function reconcilePending(
  item: Pending,
  context: RequestContext,
  outcome: "created" | "rejected",
) {
  if (
    !sameScope(item.context, context) ||
    !isCurrentContext(context) ||
    !maySend(context.role, item.path)
  )
    throw new Error("Сверка недоступна");
  if (!isExpiredPending(item) && item.state !== "conflict")
    throw new Error("Проверьте операцию сохранённым запросом");
  const previous = JSON.parse(
    sessionStorage.getItem("rims.reconciled.v2") || "[]",
  );
  sessionStorage.setItem(
    "rims.reconciled.v2",
    JSON.stringify([
      ...previous,
      { ...item, outcome, reconciledAt: new Date().toISOString() },
    ]),
  );
  completePending(item.key);
}
