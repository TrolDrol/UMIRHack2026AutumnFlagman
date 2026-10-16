import { useQuery } from "@tanstack/react-query";
import { warehouseRequest, HttpError } from "./client";
import { streamsResource, useAvailability } from "./availability";
import {
  useWorkspace,
  scopeKey,
  type RequestContext,
} from "../../app/workspace";
import type { Ingredient, Page, Dish, Envelope } from "./types";
export async function readCollection<T>(
  context: RequestContext,
  resource: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Envelope<T[]>> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      ...params,
      page: String(page),
      pageSize: "100",
    });
    const result = await warehouseRequest<Page<T>>(
      context,
      `/${resource}?${query}`,
      { signal },
    );
    items.push(...result.data.items);
    if (items.length >= result.data.total || !result.data.items.length)
      return { data: items, meta: result.meta };
  }
}
export function useApi() {
  const context = useWorkspace();
  return {
    context,
    queryPrefix: scopeKey(context),
    request: <T>(
      path: string,
      options: Parameters<typeof warehouseRequest>[2] = {},
    ) => warehouseRequest<T>(context, path, options),
    readCollection: <T>(
      resource: string,
      params: Record<string, string> = {},
      signal?: AbortSignal,
    ) => readCollection<T>(context, resource, params, signal),
  };
}
const polling = () =>
  document.visibilityState === "visible" && navigator.onLine ? 15000 : false;
export const liveResources = [
  "dashboard",
  "quarantines",
  "combos",
  "service/combos",
  "stop-list/forecast",
  "analytics/risk-inventory",
  "inventory",
  "batches",
  "menu/availability",
  "stop-list",
  "recommendations",
  "offers",
  "manual-offers",
  "service/offers",
  "purchase-suggestions",
  "deliveries",
  "orders",
  "service/menu",
  "service/stop-list",
  "service/recommendations",
];
const retry = (count: number, error: Error) =>
  count < 1 && !(error instanceof HttpError && error.status < 500);
export function useResource<T>(
  resource: string,
  params: Record<string, string> = {},
  enabled = true,
) {
  const { request, queryPrefix } = useApi();
  const stream = useAvailability(enabled && streamsResource(resource));
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== ""),
  );
  return useQuery({
    queryKey: [...queryPrefix, resource, params],
    queryFn: ({ signal }) =>
      request<T>(`/${resource}${query.size ? `?${query}` : ""}`, { signal }),
    enabled,
    staleTime: 15000,
    refetchInterval: stream.connected ? false : polling,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry,
  });
}
export function useDirectory<T extends Ingredient | Dish>(
  resource: "ingredients" | "dishes",
  enabled = true,
) {
  const { readCollection, queryPrefix } = useApi();
  return useQuery({
    queryKey: [...queryPrefix, resource, "directory"],
    queryFn: ({ signal }) => readCollection<T>(resource, {}, signal),
    staleTime: 30000,
    enabled,
  });
}
export function useLiveCollection<T>(resource: string, enabled = true) {
  const { readCollection, queryPrefix } = useApi();
  const stream = useAvailability(enabled && streamsResource(resource));
  return useQuery({
    queryKey: [...queryPrefix, resource, "collection"],
    queryFn: ({ signal }) => readCollection<T>(resource, {}, signal),
    enabled,
    staleTime: 15000,
    refetchInterval: stream.connected ? false : polling,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry,
  });
}
