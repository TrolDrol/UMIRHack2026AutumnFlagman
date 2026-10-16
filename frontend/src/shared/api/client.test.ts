import { testContext, activateTestContext } from "../../test/context";
import { beforeEach } from "vitest";
beforeEach(() => activateTestContext());
const request: typeof globalRequest = (path, options) =>
  path.startsWith("/auth/")
    ? globalRequest(path, options)
    : warehouseRequest(testContext, path, options);
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { request as globalRequest, warehouseRequest } from "./client";
const server = setupServer(
  http.get("/api/v2/auth/csrf", () =>
    HttpResponse.json({ data: { requestToken: "test-csrf" }, meta: {} }),
  ),
);
const meta = { serverTime: new Date().toISOString(), requestId: "req" };
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("сохраняет meta, отправляет credentials и корректно обрабатывает 204", async () => {
  let credentials = "";
  server.use(
    http.get(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/config",
      ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ data: { restaurantName: "Тест" }, meta });
      },
    ),
    http.post(
      "/api/v2/auth/logout",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  expect(await request("/config")).toEqual({
    data: { restaurantName: "Тест" },
    meta,
  });
  expect(credentials).toBe("include");
  await expect(
    request("/auth/logout", { method: "POST" }),
  ).resolves.toBeUndefined();
});
it("общий клиент соблюдает Retry-After до повторного обращения к серверу", async () => {
  let calls = 0;
  server.use(
    http.post("/api/v2/auth/login", () => {
      calls++;
      return HttpResponse.json(
        {
          error: { code: "RATE_LIMITED", message: "Подождите", details: {} },
          meta,
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }),
  );
  const now = Date.now();
  await expect(
    request("/auth/login", { method: "POST", body: "{}" }),
  ).rejects.toThrow("Подождите");
  await expect(
    request("/auth/login", { method: "POST", body: "{}" }),
  ).rejects.toThrow("Подождите");
  expect(calls).toBe(1);
  vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  server.use(
    http.post("/api/v2/auth/login", () => {
      calls++;
      return HttpResponse.json({ data: { id: "operator" }, meta });
    }),
  );
  await request("/auth/login", { method: "POST", body: "{}" });
  expect(calls).toBe(2);
});
it("таймаут прекращает запрос и выводит русское сообщение", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    (_url: unknown, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const pending = request("/dashboard");
  const assertion = expect(pending).rejects.toThrow(
    "Сервер не ответил вовремя",
  );
  await vi.advanceTimersByTimeAsync(30000);
  await assertion;
});
