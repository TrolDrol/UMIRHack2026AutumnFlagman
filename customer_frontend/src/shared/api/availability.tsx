import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectAvailability,
  type StreamState,
} from "@rims/demo-api/availability-stream";
import { mode, currentSessionEpoch } from "./client";
import { runtimeNamespace } from "@rims/demo-api/runtime";
import { useAuth } from "../../app/auth";

type Snapshot = { state: StreamState; epoch: number };
const initial: Snapshot = { state: "connecting", epoch: 0 };
const stores = new Map<
  string,
  { snapshot: Snapshot; listeners: Set<() => void>; stop?: () => void }
>();
export function useAvailability(warehouseId: string) {
  const { user } = useAuth(),
    cache = useQueryClient();
  const epoch = currentSessionEpoch(),
    runtime = runtimeNamespace();
  const userId = user?.id;
  const prefix = ["customer", runtime, userId, warehouseId];
  const key = JSON.stringify([...prefix, epoch]);
  const live =
    !!userId &&
    !!warehouseId &&
    mode === "live" &&
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
          `/api/v2/customer/warehouses/${warehouseId}/availability/ws`,
          location.origin,
        );
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("userId", userId!);
        current.stop = connectAvailability({
          url: url.href,
          warehouseId: warehouseId,
          state: (state) => {
            if (current.snapshot.state !== state)
              update({ ...current.snapshot, state });
          },
          changed: () => {
            if (currentSessionEpoch() !== epoch) return;
            update({ ...current.snapshot, epoch: current.snapshot.epoch + 1 });
            void cache.invalidateQueries({
              queryKey: ["customer", runtime, userId, warehouseId],
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
    [live, key, cache, warehouseId, userId, epoch, runtime],
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
export function AvailabilityStatus({ warehouseId }: { warehouseId: string }) {
  const stream = useAvailability(warehouseId);
  if (stream.demo) return null;
  return (
    <p role="status" data-availability-state={stream.state}>
      {stream.connected
        ? "Доступность обновляется в реальном времени"
        : "Соединение восстанавливается · резервное обновление каждые 15 секунд"}
    </p>
  );
}
