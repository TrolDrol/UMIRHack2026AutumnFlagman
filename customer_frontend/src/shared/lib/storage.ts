import { runtimeNamespace } from "@rims/demo-api/runtime";
import { orderSchema } from "@rims/demo-api/schemas";
import { base, mode } from "../api/client";
import type { OrderInput } from "../api/types";
import { z } from "zod";
const pendingSchema = z
  .object({
    app: z.literal("customer"),
    mode: z.enum(["demo", "live"]),
    runtimeScope: z.string(),
    customerId: z.string(),
    warehouseId: z.string(),
    method: z.literal("POST"),
    path: z.string().url(),
    key: z.string().uuid(),
    createdAt: z.string().datetime(),
    body: orderSchema,
  })
  .strict();
export const scope = (user: string, warehouse: string) =>
  `flagman.customer.${runtimeNamespace()}.${user}.${warehouse}`;
export function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function write(key: string, value: unknown) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
export type Pending = {
  app: "customer";
  mode: string;
  runtimeScope: string;
  customerId: string;
  warehouseId: string;
  method: "POST";
  path: string;
  key: string;
  body: OrderInput;
  createdAt: string;
};
export function savePending(
  user: string,
  id: string,
  body: OrderInput,
): Pending {
  const value: Pending = {
    app: "customer",
    mode,
    runtimeScope: runtimeNamespace(),
    customerId: user,
    warehouseId: id,
    method: "POST",
    path: base + "/warehouses/" + encodeURIComponent(id) + "/orders",
    key: crypto.randomUUID(),
    body: structuredClone(body),
    createdAt: new Date().toISOString(),
  };
  const key = scope(user, id) + ".pending";
  write(key, value);
  if (sessionStorage.getItem(key) !== JSON.stringify(value))
    throw new Error("Не удалось сохранить запрос. Заказ не отправлен.");
  return value;
}
export function pendingFor(user: string, id: string): Pending | null {
  const raw = sessionStorage.getItem(scope(user, id) + ".pending");
  if (!raw) return null;
  let p: Pending;
  try {
    p = pendingSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Сохранённый запрос повреждён. Новый заказ заблокирован до сверки результата с администратором.",
    );
  }
  return p &&
    p.app === "customer" &&
    p.mode === mode &&
    p.runtimeScope === runtimeNamespace() &&
    p.customerId === user &&
    p.warehouseId === id &&
    p.path === base + "/warehouses/" + encodeURIComponent(id) + "/orders" &&
    p.method === "POST"
    ? p
    : null;
}
export const expired = (p: Pending) =>
  Date.now() - Date.parse(p.createdAt) >= 86400000;
export function foreignPending(user: string, warehouse: string): unknown[] {
  return Array.from({ length: sessionStorage.length }, (_, i) =>
    sessionStorage.key(i),
  )
    .filter(
      (key): key is string =>
        !!key &&
        key.startsWith("flagman.customer.") &&
        key.endsWith(`.${user}.${warehouse}.pending`) &&
        key !== scope(user, warehouse) + ".pending",
    )
    .map((key) => ({ key, saved: read<unknown>(key, null) }));
}
