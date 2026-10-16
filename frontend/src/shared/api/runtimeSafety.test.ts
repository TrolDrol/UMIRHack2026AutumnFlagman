import { afterEach, expect, it, vi } from "vitest";
import {
  prepareRuntime,
  runtimeNamespace,
  assertRuntimeCurrent,
  RuntimeHttpError,
} from "@rims/demo-api/runtime";
import { activateTestContext, testContext } from "../../test/context";
import { activateContext } from "../../app/workspace";
import { beginPending, pendingFor, readPending } from "../lib/pending";
afterEach(() => vi.unstubAllGlobals());
const runtime = (id: string, sourceKind = "server") =>
  Response.json({
    data: { backendInstanceId: id, sourceKind, contractVersion: "2.1.0" },
    meta: {},
  });
it("rejects a mock source in live and keeps unrelated Service Workers", async () => {
  const unregister = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: null,
      getRegistrations: async () => [
        {
          scope: location.origin + "/",
          active: { scriptURL: location.origin + "/offline-worker.js" },
          unregister,
        },
      ],
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => runtime("demo", "mock")),
  );
  await expect(prepareRuntime("live")).rejects.toThrow();
  expect(unregister).not.toHaveBeenCalled();
});
it("keeps runtime outage status, details, meta and Retry-After without calling it a replacement", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => runtime("db-original")));
  await prepareRuntime("live");
  const meta = { serverTime: new Date().toISOString(), requestId: crypto.randomUUID() };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "LIVE_API_UNAVAILABLE", message: "backend down", details: { dependency: "backend" } }, meta }, { status: 503, headers: { "Retry-After": "5" } })));
  const before = Date.now();
  const failure = await assertRuntimeCurrent().catch(error => error);
  expect(failure).toBeInstanceOf(RuntimeHttpError);
  expect(failure.status).toBe(503);
  expect(failure.payload).toEqual({ error: { code: "LIVE_API_UNAVAILABLE", message: "backend down", details: { dependency: "backend" } }, meta });
  expect(failure.retryAt).toBeGreaterThanOrEqual(before + 5000);
});
it("preserves pending intentions across backend replacement without permitting replay", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => runtime("db-original")),
  );
  await prepareRuntime("live");
  activateTestContext();
  const original = { ...testContext, runtimeScope: runtimeNamespace() };
  activateContext(original);
  const pending = beginPending(original, "/orders", {
    lines: [{ dishId: "A", portions: 1 }],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => runtime("db-replaced")),
  );
  await expect(assertRuntimeCurrent()).rejects.toThrow();
  await prepareRuntime("live");
  const replacement = { ...original, runtimeScope: runtimeNamespace() };
  activateContext(replacement);
  expect(pendingFor(replacement)).toEqual([]);
  expect(readPending()).toContainEqual(pending);
});
