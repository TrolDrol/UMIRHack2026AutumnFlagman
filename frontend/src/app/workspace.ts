import { runtimeNamespace } from "@rims/demo-api/runtime";
import { createContext, useContext } from "react";
import type { Membership, Role } from "../shared/api/types";
export type RequestContext = Membership & {
  userId: string;
  sessionVersion: number;
  runtimeScope?: string;
};
export const WorkspaceContext = createContext<RequestContext | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context)
    throw new Error("Выберите предприятие перед работой со складом");
  return context;
}
export const scopeKey = (context: RequestContext) =>
  [
    "warehouse",
    context.runtimeScope || runtimeNamespace(),
    "staff",
    context.userId,
    context.warehouseId,
    context.role,
  ] as const;
let active: RequestContext | null = null;
let epoch = 0;
export function renewSession() {
  active = null;
  return ++epoch;
}
export function sessionVersion() {
  return epoch;
}
export function activateContext(context: RequestContext | null) {
  active = context;
}
export function isCurrentContext(context: RequestContext) {
  return Boolean(
    active &&
    active.userId === context.userId &&
    active.warehouseId === context.warehouseId &&
    active.role === context.role &&
    context.sessionVersion === epoch,
  );
}
export function sameScope(
  a: Pick<RequestContext, "userId" | "warehouseId">,
  b: Pick<RequestContext, "userId" | "warehouseId">,
) {
  return (
    (a as RequestContext).runtimeScope === (b as RequestContext).runtimeScope &&
    a.userId === b.userId &&
    a.warehouseId === b.warehouseId
  );
}
export const management = (role: Role) =>
  role === "super_admin" || role === "owner" || role === "manager";
export const roleNames: Record<Role, string> = {
  super_admin: "Супер-админ",
  owner: "Владелец",
  manager: "Менеджер",
  warehouse: "Склад",
  waiter: "Официант",
};
export function homeFor(role: Role) {
  return role === "waiter"
    ? "/service/orders/new"
    : role === "warehouse"
      ? "/inventory"
      : "/";
}
export function mayVisit(role: Role, path: string) {
  if (path.startsWith("/service")) return role !== "warehouse";
  if (path.startsWith("/members") || path.startsWith("/integrations"))
    return role === "owner" || role === "super_admin";
  if (management(role)) return true;
  return (
    role === "warehouse" &&
    /^\/(inventory|batches|ingredients|deliveries|purchases|movements|quarantines|risk-inventory|stop-list)(\/|$)/.test(
      path,
    )
  );
}
export function maySend(role: Role, path: string) {
  if (path === "/deliveries" || path === "/quarantines")
    return role !== "waiter";
  if (path === "/service/orders") return role !== "warehouse";
  return management(role);
}
