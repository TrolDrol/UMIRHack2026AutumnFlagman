import { WorkspaceContext } from "../../app/workspace";
import { testContext, activateTestContext } from "../../test/context";
import { render, waitFor, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useResource, useDirectory } from "./queries";
import type { Ingredient } from "./types";
afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
it("polling работает только в видимой вкладке и возобновляется при фокусе", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: { value: 1 },
          meta: { serverTime: new Date().toISOString(), requestId: "req" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  activateTestContext();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const visible = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  focusManager.setFocused(true);
  function Probe() {
    const query = useResource("dashboard");
    return <div>{query.isSuccess ? "Готово" : "Ожидание"}</div>;
  }
  const view = render(
    <WorkspaceContext.Provider value={testContext}>
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    </WorkspaceContext.Provider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(view.getByText("Готово")).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  visible.mockReturnValue("hidden");
  focusManager.setFocused(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  visible.mockReturnValue("visible");
  await act(async () => {
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  view.unmount();
  client.clear();
  vi.unstubAllGlobals();
});
it("селекторы загружают все страницы справочника", async () => {
  const fetch = vi.fn().mockImplementation((url: string) => {
    const page = new URL(url, "http://localhost").searchParams.get("page");
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            items: [{ id: page, name: `Ингредиент ${page}`, unit: "g" }],
            page: Number(page),
            pageSize: 100,
            total: 2,
          },
          meta: { serverTime: new Date().toISOString(), requestId: "req" },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient();
  function Probe() {
    const q = useDirectory<Ingredient>("ingredients");
    return <div>{q.data?.data.map((x) => x.name).join(", ")}</div>;
  }
  const view = render(
    <WorkspaceContext.Provider value={testContext}>
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    </WorkspaceContext.Provider>,
  );
  await waitFor(() =>
    expect(view.getByText("Ингредиент 1, Ингредиент 2")).toBeVisible(),
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  view.unmount();
  client.clear();
  vi.unstubAllGlobals();
});
