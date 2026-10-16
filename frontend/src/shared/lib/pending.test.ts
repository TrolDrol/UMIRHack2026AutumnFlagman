import { testContext, activateTestContext } from "../../test/context";
import { beforeEach } from "vitest";
beforeEach(() => activateTestContext());
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import {
  beginPending,
  readPending,
  sendPending,
  reconcilePending,
} from "./pending";
const server = setupServer(
  http.get("/api/v2/auth/csrf", () =>
    HttpResponse.json({ data: { requestToken: "test-csrf" }, meta: {} }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const meta = { serverTime: "2026-10-09T09:00:00Z", requestId: "request" };
it.each([
  ["/manual-offers", "POST", null],
  ["/manual-offers/record", "PUT", "record"],
  ["/manual-offers/record/publish", "POST", "record"],
  ["/manual-offers/record/unpublish", "POST", "record"],
  ["/manual-offers/record/archive", "POST", "record"],
] as const)(
  "manual pending %s retains exact method/body/key through retry",
  async (path, method, id) => {
    const calls: { method: string; body: string; key: string | null }[] = [];
    server.use(
      http.all(
        "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001" + path,
        async ({ request }) => {
          calls.push({
            method: request.method,
            body: await request.text(),
            key: request.headers.get("Idempotency-Key"),
          });
          return calls.length === 1
            ? new HttpResponse(null, { status: 503 })
            : HttpResponse.json({ data: { id: "record" }, meta });
        },
      ),
    );
    const item = beginPending(
      testContext,
      path,
      { expectedVersion: 7, startsAt: null },
      undefined,
      method,
    );
    expect(item.resource).toBe("manual-offers");
    expect(item.resourceId).toBe(id);
    await expect(sendPending(item, testContext)).rejects.toThrow();
    await sendPending(readPending()[0], testContext);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0].method).toBe(method);
    expect(readPending()).toEqual([]);
  },
);
it.each([
  { receivedAtMode: "server" },
  { receivedAt: "2026-10-09T09:00:00.123456Z" },
])(
  "receipt pending does not rewrite server intention or legacy timestamp",
  (body) => {
    const item = beginPending(
      testContext,
      "/deliveries/document/confirm",
      body,
    );
    expect(JSON.parse(item.body)).toEqual(body);
    expect(readPending()[0].body).toBe(item.body);
  },
);
it("повтор неизвестного результата отправляет исходное body и ключ", async () => {
  const calls: { body: string; key: string | null }[] = [];
  let first = true;
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      async ({ request }) => {
        calls.push({
          body: await request.text(),
          key: request.headers.get("Idempotency-Key"),
        });
        if (first) {
          first = false;
          return new HttpResponse(null, { status: 503 });
        }
        return HttpResponse.json({ data: { id: "order" }, meta });
      },
    ),
  );
  const body = { lines: [{ dishId: "dish", portions: 2 }] };
  const pending = beginPending(
    testContext,
    "/orders",
    body,
    "order.copy.source",
  );
  body.lines[0].portions = 100;
  await expect(sendPending(pending, testContext)).rejects.toThrow();
  expect(readPending()).toHaveLength(1);
  expect(readPending()[0].draftName).toBe("order.copy.source");
  expect(() => beginPending(testContext, "/orders", body)).toThrow();
  await sendPending(readPending()[0], testContext);
  expect(calls[0]).toEqual(calls[1]);
  expect(JSON.parse(calls[1].body).lines[0].portions).toBe(2);
  expect(JSON.parse(calls[1].body)).not.toHaveProperty("draftName");
  expect(readPending()).toHaveLength(0);
});
it("401 сохраняет операцию, восстановление разрешено тому же оператору", async () => {
  const unauthorized = vi.fn();
  window.addEventListener("flagman:unauthorized", unauthorized);
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/deliveries",
      () =>
        HttpResponse.json(
          {
            error: { code: "UNAUTHENTICATED", message: "Войдите", details: {} },
            meta,
          },
          { status: 401 },
        ),
    ),
  );
  const pending = beginPending(testContext, "/deliveries", { number: "D1" });
  await expect(sendPending(pending, testContext)).rejects.toThrow("Войдите");
  expect(unauthorized).toHaveBeenCalled();
  expect(readPending()[0].key).toBe(pending.key);
  await expect(
    sendPending(pending, { ...testContext, userId: "other" }),
  ).rejects.toThrow("оператором");
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/deliveries",
      () => HttpResponse.json({ data: { id: "delivery" }, meta }),
    ),
  );
  await sendPending(readPending()[0], testContext);
  expect(readPending()).toEqual([]);
  window.removeEventListener("flagman:unauthorized", unauthorized);
});
it("409 завершает намерение, новое намерение получает новый ключ", async () => {
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      () =>
        HttpResponse.json(
          {
            error: {
              code: "INSUFFICIENT_STOCK",
              message: "Не хватает",
              details: {},
            },
            meta,
          },
          { status: 409 },
        ),
    ),
  );
  const pending = beginPending(testContext, "/orders", { lines: [] });
  await expect(sendPending(pending, testContext)).rejects.toThrow("Не хватает");
  expect(readPending()).toEqual([]);
  expect(beginPending(testContext, "/orders", { lines: [] }).key).not.toBe(
    pending.key,
  );
});
it("ошибка sessionStorage не позволяет начать отправку", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => beginPending(testContext, "/orders", {})).toThrow(
    "запрос не отправлен",
  );
});
it("429 сохраняет Retry-After и прежний снимок", async () => {
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/write-offs",
      () =>
        HttpResponse.json(
          {
            error: { code: "RATE_LIMITED", message: "Подождите", details: {} },
            meta,
          },
          { status: 429, headers: { "Retry-After": "60" } },
        ),
    ),
  );
  const pending = beginPending(testContext, "/write-offs", {
    quantity: "1.000",
  });
  await expect(sendPending(pending, testContext)).rejects.toThrow();
  expect(readPending()[0].retryAt).toBeGreaterThan(Date.now());
  await expect(sendPending(readPending()[0], testContext)).rejects.toThrow(
    "Дождитесь",
  );
});
it("два одновременных клика отправляют один запрос", async () => {
  let calls = 0;
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      async () => {
        calls++;
        await delay(30);
        return HttpResponse.json({ data: { id: "order" }, meta });
      },
    ),
  );
  const item = beginPending(testContext, "/orders", { lines: [] });
  const first = sendPending(item, testContext);
  await expect(sendPending(item, testContext)).rejects.toThrow(
    "уже отправляется",
  );
  await first;
  expect(calls).toBe(1);
});
it("повтор использует снимок из storage даже если объект вызывающего изменён", async () => {
  let received = "";
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      async ({ request }) => {
        received = await request.text();
        return HttpResponse.json({ data: { id: "order" }, meta });
      },
    ),
  );
  const item = beginPending(testContext, "/orders", {
    lines: [{ dishId: "dish", portions: 2 }],
  });
  item.body = JSON.stringify({ lines: [] });
  await sendPending(item, testContext);
  expect(JSON.parse(received).lines[0].portions).toBe(2);
});
it("неизвестные операции старше 24ч требуют явной сверки", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const item = beginPending(testContext, "/orders", { lines: [] });
  const stored = readPending();
  stored[0].createdAt = new Date(Date.now() - 25 * 3600000).toISOString();
  sessionStorage.setItem("rims.pending.v2", JSON.stringify(stored));
  await expect(sendPending(item, testContext)).rejects.toThrow("24 часа");
  expect(fetch).not.toHaveBeenCalled();
  reconcilePending(readPending()[0], testContext, "rejected");
  expect(readPending()).toEqual([]);
  expect(JSON.parse(sessionStorage.getItem("rims.reconciled.v2")!)[0].key).toBe(
    item.key,
  );
});
it("несоответствие ключа блокирует повтор и сохраняет снимок", async () => {
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      () =>
        HttpResponse.json(
          {
            error: {
              code: "IDEMPOTENCY_KEY_REUSED",
              message: "Несоответствие снимка",
              details: {},
            },
            meta,
          },
          { status: 409 },
        ),
    ),
  );
  const item = beginPending(testContext, "/orders", { lines: [] });
  await expect(sendPending(item, testContext)).rejects.toThrow(
    "Несоответствие",
  );
  expect(readPending()[0].state).toBe("conflict");
  await expect(sendPending(readPending()[0], testContext)).rejects.toThrow(
    "администратором",
  );
  expect(() => beginPending(testContext, "/orders", {})).toThrow();
});
