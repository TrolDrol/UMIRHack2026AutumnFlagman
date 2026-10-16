import { useAvailability } from "./availability";
import { runtimeNamespace } from "@rims/demo-api/runtime";
import type { PublicCombo } from "@rims/demo-api/contracts";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/auth";
import { request, warehouse } from "./client";
import type { Page, Outlet, MenuItem, Offer } from "./types";
export function useOutlets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["customer", runtimeNamespace(), user?.id, "outlets"],
    queryFn: async ({ signal }) => {
      const items: Outlet[] = [];
      let page = 1,
        total = 1;
      while (items.length < total) {
        const result = await request<Page<Outlet>>(
          `/outlets?page=${page++}&pageSize=100`,
          { signal },
        );
        items.push(...result.items);
        total = result.total;
        if (!result.items.length) break;
      }
      return items;
    },
    enabled: !!user,
    refetchInterval: () =>
      document.visibilityState === "visible" && navigator.onLine
        ? 15000
        : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
export function useCatalog<T extends MenuItem | Offer | PublicCombo>(
  id: string,
  resource: string,
) {
  const { user } = useAuth();
  const stream = useAvailability(id);
  return useQuery({
    queryKey: ["customer", runtimeNamespace(), user?.id, id, resource],
    queryFn: async ({ signal }) => {
      const items: T[] = [];
      let page = 1,
        total = 1;
      while (items.length < total) {
        const result = await request<Page<T>>(
          warehouse(id) + `/${resource}?page=${page++}&pageSize=100`,
          { signal },
        );
        items.push(...result.items);
        total = result.total;
        if (!result.items.length) break;
      }
      return items;
    },
    enabled: !!user && !!id,
    refetchInterval: stream.connected
      ? false
      : () => (document.visibilityState === "visible" ? 15000 : false),
    refetchOnWindowFocus: true,
  });
}
