import { beforeEach, expect, it, vi } from "vitest";
import { demoRequest, resetDemoData, demoWarehouseA } from "./model";
import type {
  ApiError,
  Dish,
  Envelope,
  InventoryRow,
  Order,
  OrderPreview,
  Page,
  Delivery,
  DishAvailability,
  HotOffer,
} from "../shared/api/types";
function call<T>(path: string, method = "GET", body?: unknown, key?: string) {
  const actual = path.startsWith("/auth/")
    ? path
    : `/warehouses/${demoWarehouseA}${path}`;
  const url = new URL(`http://localhost/api/v2${actual}`);
  return demoRequest(
    url.pathname.replace("/api/v2", ""),
    method,
    body,
    url,
    key || null,
  ) as { status: number; body: Envelope<T> };
}
const tomatoes = "11111111-1111-4111-8111-111111111111";
const cheese = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  resetDemoData();
  expect(
    call("/auth/login", "POST", { username: "operator", password: "demo" })
      .status,
  ).toBe(200);
});
function bruschetta() {
  return call<Page<Dish>>("/dishes?q=Брускетта").body.data.items[0];
}
function refill() {
  const result = call<Delivery>(
    "/deliveries",
    "POST",
    {
      number: crypto.randomUUID(),
      expectedAt: null,
      note: null,
      lines: [
        {
          ingredientId: cheese,
          quantity: "200.000",
          expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
        },
      ],
    },
    crypto.randomUUID(),
  );
  return call<Delivery>(
    `/deliveries/${result.body.data.id}/confirm`,
    "POST",
    { receivedAt: new Date(Date.now() - 10000).toISOString() },
    crypto.randomUUID(),
  );
}
it("порог истечения равен 10% срока ингредиента или срока конкретной партии", () => {
  vi.useFakeTimers();
  const now = Date.now();
  const milk = "44444444-4444-4444-8444-444444444444";
  const iso = (hours: number) => new Date(now + hours * 3600000).toISOString();
  try {
    const delivery = call<Delivery>(
      "/deliveries",
      "POST",
      {
        number: "EXPIRY-THRESHOLD",
        expectedAt: null,
        note: null,
        lines: [
          { ingredientId: milk, quantity: "1.000", expiresAt: iso(4.8) },
          { ingredientId: milk, quantity: "1.000", expiresAt: iso(4.8001) },
          { ingredientId: cheese, quantity: "1.000", expiresAt: iso(5) },
          { ingredientId: cheese, quantity: "1.000", expiresAt: iso(8) },
          {
            ingredientId: milk,
            quantity: "1.000",
            manufacturedAt: iso(-91),
            shelfLifeHours: 100,
          },
        ],
      },
      crypto.randomUUID(),
    );
    expect(delivery.status).toBe(201);
    const confirmed = call<Delivery>(
      `/deliveries/${delivery.body.data.id}/confirm`,
      "POST",
      { receivedAt: iso(-1) },
      crypto.randomUUID(),
    );
    expect(confirmed.body.data.batches.map((b) => b.status)).toEqual([
      "expiring",
      "fresh",
      "expiring",
      "fresh",
      "expiring",
    ]);
    const inventory = call<Page<InventoryRow>>(
      "/inventory",
    ).body.data.items.find((i) => i.ingredientId === milk)!;
    expect(inventory.expiringQuantity).toBe("2.000");
    vi.setSystemTime(now + 4.8 * 3600000);
    const batch = call<Page<Delivery["batches"][number]>>(
      "/batches?ingredientId=" + milk,
    ).body.data.items.find((b) => b.id === confirmed.body.data.batches[0].id)!;
    expect(batch.status).toBe("expired");
  } finally {
    vi.useRealTimers();
  }
});
it("demo воспроизводит полный сквозной пример C10 и идемпотентность", () => {
  const inventory = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (x) => x.ingredientId === tomatoes,
  )!;
  expect([
    inventory.physicalQuantity,
    inventory.availableQuantity,
    inventory.expiringQuantity,
    inventory.expiredQuantity,
  ]).toEqual(["1000.000", "800.000", "300.000", "200.000"]);
  const dish = bruschetta();
  const offers = call<Page<HotOffer>>("/recommendations").body.data.items.find(
    (x) => x.dishId === dish.id,
  )!;
  expect(offers.suggestedPortions).toBe(3);
  expect(offers.score).toBeCloseTo(16.67, 1);
  const body = { lines: [{ dishId: dish.id, portions: 2 }] };
  const key = crypto.randomUUID();
  const order = call<Order>("/orders", "POST", body, key);
  expect(order.status).toBe(201);
  expect(
    order.body.data.allocations.find((x) => x.ingredientId === tomatoes)
      ?.quantity,
  ).toBe("200.000");
  expect(call<Order>("/orders", "POST", body, key)).toEqual(order);
  const refusedKey = crypto.randomUUID();
  const refused = call<ApiError>("/orders", "POST", body, refusedKey);
  expect(refused.status).toBe(409);
  expect(
    (refused.body as unknown as ApiError).error.details.shortages?.[0]
      .missingQuantity,
  ).toBe("50.000");
  expect(
    call(
      "/orders",
      "POST",
      { lines: [{ dishId: dish.id, portions: 1 }] },
      crypto.randomUUID(),
    ).status,
  ).toBe(201);
  expect(
    call<Page<DishAvailability>>("/stop-list").body.data.items.some(
      (x) => x.dishId === dish.id,
    ),
  ).toBe(true);
  expect(refill().status).toBe(200);
  expect(
    call<Page<DishAvailability>>("/menu/availability?q=Брускетта").body.data
      .items[0].maxPortions,
  ).toBe(4);
  expect(call("/orders", "POST", body, refusedKey)).toEqual(refused);
});
it("общие ингредиенты проверяются целиком и отказ атомарен", () => {
  const dishes = call<Page<Dish>>("/dishes").body.data.items;
  const a = dishes.find((x) => x.name === "Брускетта")!,
    b = dishes.find((x) => x.name === "Салат с томатами и сыром")!;
  const before = call<Page<InventoryRow>>("/inventory").body.data;
  const input = {
    lines: [
      { dishId: a.id, portions: 2 },
      { dishId: b.id, portions: 1 },
    ],
  };
  const preview = call<OrderPreview>("/orders/preview", "POST", input).body
    .data;
  expect(preview.canCreate).toBe(false);
  expect(preview.allocations).toEqual([]);
  expect(
    preview.requirements.find((x) => x.ingredientId === cheese)
      ?.requiredQuantity,
  ).toBe("180.000");
  expect(call("/orders", "POST", input, crypto.randomUUID()).status).toBe(409);
  expect(call<Page<InventoryRow>>("/inventory").body.data).toEqual(before);
});
it("успешный replay не зависит от текущей активности рецепта", () => {
  const dish = bruschetta(),
    body = { lines: [{ dishId: dish.id, portions: 1 }] },
    key = crypto.randomUUID();
  const order = call<Order>("/orders", "POST", body, key);
  call(`/dishes/${dish.id}`, "PUT", {
    name: dish.name,
    active: false,
    recipe: dish.recipe,
  });
  expect(call<Order>("/orders", "POST", body, key)).toEqual(order);
  expect(call("/orders", "POST", body, crypto.randomUUID()).status).toBe(409);
});
it("другой body с прежним ключом запрещён", () => {
  const dish = bruschetta(),
    key = crypto.randomUUID();
  call("/orders", "POST", { lines: [{ dishId: dish.id, portions: 1 }] }, key);
  const response = call(
    "/orders",
    "POST",
    { lines: [{ dishId: dish.id, portions: 2 }] },
    key,
  );
  expect(response.status).toBe(409);
  expect((response.body as unknown as ApiError).error.code).toBe(
    "IDEMPOTENCY_KEY_REUSED",
  );
});
it("частичное списание просрочки уменьшает только физический запас", () => {
  const batches = call<Page<Delivery["batches"][number]>>(
    "/batches?status=expired",
  ).body.data.items;
  const before = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (x) => x.ingredientId === tomatoes,
  )!;
  expect(
    call(
      "/write-offs",
      "POST",
      {
        batchId: batches[0].id,
        quantity: "50.000",
        reason: "expired",
        note: null,
      },
      crypto.randomUUID(),
    ).status,
  ).toBe(201);
  const after = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (x) => x.ingredientId === tomatoes,
  )!;
  expect(after.physicalQuantity).toBe("950.000");
  expect(after.availableQuantity).toBe(before.availableQuantity);
  expect(after.expiredQuantity).toBe("150.000");
});
