import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectAvailability,
  type StreamState,
} from "@rims/demo-api/availability-stream";
import { apiBase } from "./client";
import { useWorkspace, scopeKey, isCurrentContext } from "../../app/workspace";

const resources = new Set([
  "stop-list",
  "service/stop-list",
  "menu/availability",
  "service/menu",
  "service/combos",
  "combos",
  "dishes",
  "ingredients",
  "offers",
  "service/offers",
  "recommendations",
  "service/recommendations",
]);
export const streamsResource = (resource: string) => resources.has(resource);
type Snapshot = { state: StreamState; epoch: number };
const initial: Snapshot = { state: "connecting", epoch: 0 };
const stores = new Map<
  string,
  { snapshot: Snapshot; listeners: Set<() => void>; stop?: () => void }
>();
export function useAvailability(enabled = true) {
  const context = useWorkspace(),
    cache = useQueryClient();
  const key = JSON.stringify([...scopeKey(context), context.sessionVersion]);
  const live =
    enabled &&
    import.meta.env.VITE_DEMO_MODE !== "true" &&
    typeof WebSocket !== "undefined";
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!live) return () => {};
      let store = stores.get(key);
      if (!store) {
        store = { snapshot: initial, listeners: new Set() };
        stores.set(key, store);
      }
      store.listeners.add(listener);
      if (!store.stop) {
        const current = store;
        const update = (snapshot: Snapshot) => {
          current.snapshot = snapshot;
          current.listeners.forEach((notify) => notify());
        };
        const url = new URL(
          `${apiBase}/warehouses/${context.warehouseId}/availability/ws`,
          location.origin,
        );
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("userId", context.userId);
        current.stop = connectAvailability({
          url: url.href,
          warehouseId: context.warehouseId,
          state: (state) => {
            if (current.snapshot.state !== state)
              update({ ...current.snapshot, state });
          },
          changed: () => {
            if (!isCurrentContext(context)) return;
            update({ ...current.snapshot, epoch: current.snapshot.epoch + 1 });
            void cache.invalidateQueries({
              queryKey: scopeKey(context),
              predicate: (query) =>
                query.queryKey.some(
                  (part) => typeof part === "string" && resources.has(part),
                ),
            });
          },
        });
      }
      const current = store;
      return () => {
        current.listeners.delete(listener);
        if (!current.listeners.size) {
          current.stop?.();
          stores.delete(key);
        }
      };
    },
    [live, key, cache, context],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => stores.get(key)?.snapshot ?? initial,
    () => initial,
  );
  return {
    ...snapshot,
    connected: live && snapshot.state === "connected",
    demo: import.meta.env.VITE_DEMO_MODE === "true",
  };
}
export function AvailabilityStatus() {
  const stream = useAvailability();
  if (stream.demo) return null;
  return (
    <p role="status" data-availability-state={stream.state}>
      {stream.connected
        ? "Доступность обновляется в реальном времени"
        : "Соединение восстанавливается · резервное обновление каждые 15 секунд"}
    </p>
  );
}
