import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateTestContext, testContext } from "../../test/context";
import { activateContext, renewSession } from "../../app/workspace";
import {
  warehouseRequest,
  request,
  ContextChangedError,
  clearRateLimits,
} from "./client";
import { beginPending, pendingFor, sendPending } from "../lib/pending";
import { loadDraft } from "../lib/hooks";
beforeEach(() => {
  activateTestContext();
  clearRateLimits();
});
afterEach(() => vi.unstubAllGlobals());

it("поздний ответ A не возвращается в контексте B", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const result = warehouseRequest(testContext, "/inventory");
  activateContext({
    ...testContext,
    warehouseId: "bbbbbbbb-0000-4000-8000-000000000002",
  });
  finish(Response.json({ data: { secret: "A" }, meta: {} }));
  await expect(result).rejects.toBeInstanceOf(ContextChangedError);
});
it("поздний 401 старой сессии не сбрасывает новый вход", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const handler = vi.fn();
  window.addEventListener("flagman:unauthorized", handler);
  const result = request("/auth/me");
  renewSession();
  activateTestContext();
  finish(
    Response.json(
      {
        error: { code: "UNAUTHENTICATED", message: "old", details: {} },
        meta: {},
      },
      { status: 401 },
    ),
  );
  await expect(result).rejects.toBeInstanceOf(ContextChangedError);
  expect(handler).not.toHaveBeenCalled();
  window.removeEventListener("flagman:unauthorized", handler);
});
it("лимит A не блокирует такой же запрос B", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: { code: "RATE_LIMITED", message: "wait", details: {} },
          meta: {},
        },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    )
    .mockResolvedValue(Response.json({ data: [], meta: {} }));
  vi.stubGlobal("fetch", fetch);
  await expect(warehouseRequest(testContext, "/inventory")).rejects.toThrow(
    "wait",
  );
  const b = {
    ...testContext,
    warehouseId: "bbbbbbbb-0000-4000-8000-000000000002",
  };
  activateContext(b);
  await expect(warehouseRequest(b, "/inventory")).resolves.toHaveProperty(
    "data",
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("pending и черновик не переносятся в другой склад или пользователя", async () => {
  const item = beginPending(testContext, "/orders", {
    lines: [{ dishId: "A", portions: 1 }],
  });
  sessionStorage.setItem(
    `rims.draft.v2.${testContext.userId}.${testContext.warehouseId}.order.new`,
    JSON.stringify({ secret: "A" }),
  );
  const b = {
    ...testContext,
    warehouseId: "bbbbbbbb-0000-4000-8000-000000000002",
  };
  activateContext(b);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(pendingFor(b)).toEqual([]);
  expect(loadDraft(b, "order.new", { secret: "empty" })).toEqual({
    secret: "empty",
  });
  await expect(sendPending(item, b)).rejects.toThrow("исходное предприятие");
  expect(fetch).not.toHaveBeenCalled();
  expect(pendingFor({ ...testContext, userId: "other" })).toEqual([]);
});
it("поздний успех операции A остаётся неизвестным и не публикует подтверждение в B", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/auth/csrf")
        ? Promise.resolve(
            Response.json({ data: { requestToken: "test" }, meta: {} }),
          )
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    ),
  );
  const confirmed = vi.fn();
  window.addEventListener("flagman:confirmed", confirmed);
  const item = beginPending(testContext, "/orders", {
    lines: [{ dishId: "A", portions: 1 }],
  });
  const result = sendPending(item, testContext);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const b = {
    ...testContext,
    warehouseId: "bbbbbbbb-0000-4000-8000-000000000002",
  };
  activateContext(b);
  finish(Response.json({ data: { id: "committed-in-A" }, meta: {} }));
  await expect(result).rejects.toBeInstanceOf(ContextChangedError);
  expect(confirmed).not.toHaveBeenCalled();
  expect(pendingFor(b)).toEqual([]);
  expect(pendingFor(testContext)[0]).toMatchObject({
    key: item.key,
    body: item.body,
    state: "unknown",
  });
  window.removeEventListener("flagman:confirmed", confirmed);
});
