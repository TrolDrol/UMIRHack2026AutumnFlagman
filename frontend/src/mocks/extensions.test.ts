import { beforeEach, expect, it } from "vitest";
import { demoRequest, resetDemoData, demoWarehouseA } from "./model";
import type {
  Batch,
  Dish,
  Envelope,
  Page,
  InventoryRow,
  Order,
  Movement,
} from "../shared/api/types";
import type {
  Quarantine,
  Combo,
  PublicCombo,
  StopForecast,
  RiskReport,
} from "@rims/demo-api/contracts";
const scope = `/warehouses/${demoWarehouseA}`;
function call<T>(path: string, method = "GET", body?: unknown, key?: string) {
  const scoped = path.startsWith("/auth/") ? path : scope + path;
  const url = new URL("http://localhost/api/v2" + scoped);
  return demoRequest(
    url.pathname.replace("/api/v2", ""),
    method,
    body,
    url,
    key ?? null,
  ) as { status: number; body: Envelope<T> };
}
function login(username = "operator") {
  expect(
    call("/auth/login", "POST", { username, password: "demo" }).status,
  ).toBe(200);
}
beforeEach(() => {
  resetDemoData();
  login();
});
it("partially holds/releases/writes off exactly once and protects warehouse decisions", () => {
  const b = call<Page<Batch>>("/batches").body.data.items.find(
    (b) =>
      Number(b.remainingQuantity) > 1 && Date.parse(b.expiresAt) > Date.now(),
  )!;
  const before = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (i) => i.ingredientId === b.ingredientId,
  )!;
  const opened = call<Quarantine>(
    "/quarantines",
    "POST",
    {
      batchId: b.id,
      expectedBatchVersion: b.version,
      quantity: "1.000",
      reason: "Check quality",
      note: null,
    },
    crypto.randomUUID(),
  );
  expect(opened.status).toBe(201);
  let q = opened.body.data;
  const after = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (i) => i.ingredientId === b.ingredientId,
  )!;
  expect(after.physicalQuantity).toBe(before.physicalQuantity);
  expect(Number(after.availableQuantity)).toBe(
    Number(before.availableQuantity) - 1,
  );
  expect(Number(after.heldQuantity)).toBe(1);
  login("warehouse");
  expect(
    call(
      `/quarantines/${q.id}/release`,
      "POST",
      { expectedVersion: q.version, quantity: "0.250", reason: "Checked" },
      crypto.randomUUID(),
    ).status,
  ).toBe(403);
  expect(call(`/quarantines/${q.id}/orders`).status).toBe(403);
  login();
  const release = call<Quarantine>(
    `/quarantines/${q.id}/release`,
    "POST",
    { expectedVersion: q.version, quantity: "0.250", reason: "Checked" },
    crypto.randomUUID(),
  );
  expect(release.status).toBe(200);
  q = release.body.data;
  expect(q.remainingHeldQuantity).toBe("0.750");
  const key = crypto.randomUUID(),
    body = {
      expectedVersion: q.version,
      quantity: "0.750",
      reason: "damaged",
      note: null,
    };
  const writeoff = call<{ quarantine: Quarantine }>(
    `/quarantines/${q.id}/write-off`,
    "POST",
    body,
    key,
  );
  expect(writeoff.status).toBe(200);
  expect(writeoff.body.data.quarantine.status).toBe("closed");
  expect(
    call(`/quarantines/${q.id}/write-off`, "POST", body, key).body,
  ).toEqual(writeoff.body);
  const movements = call<Page<Movement>>(`/movements?batchId=${b.id}`).body.data
    .items;
  const physical = movements.filter(
    (m) => m.quarantineId === q.id && m.type === "write_off",
  );
  expect(physical).toHaveLength(1);
  expect(physical[0].quantityDelta).toBe("-0.750");
  expect(physical[0].heldQuantityDelta).toBe("-0.750");
  expect(physical[0].riskSnapshot?.policyVersion).toBe("expiry-10pct-v1");
  expect(new Set(movements.map((m) => m.eventSequence)).size).toBe(
    movements.length,
  );
});
it("publishes a safe combo and commits mixed order once; immutable replay survives archive", () => {
  const stocked = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (i) => Number(i.availableQuantity) > 10,
  )!;
  for (const name of ["Test pair A", "Test pair B"])
    expect(
      call("/dishes", "POST", {
        name,
        active: true,
        recipe: [{ ingredientId: stocked.ingredientId, quantity: "1.000" }],
      }).status,
    ).toBe(201);
  const dishes = call<Page<Dish>>("/dishes").body.data.items;
  const available = call<Page<{ dishId: string; maxPortions: number }>>(
    "/menu/availability",
  ).body.data.items.filter(
    (d) =>
      d.maxPortions >= 3 &&
      dishes.find((x) => x.id === d.dishId)?.name.startsWith("Test pair"),
  );
  expect(available.length).toBeGreaterThanOrEqual(2);
  const components = available
    .slice(0, 2)
    .map((d) => ({ dishId: d.dishId, portions: 1 }));
  const draft = call<Combo>(
    "/combos",
    "POST",
    { title: "Lunch pair", components },
    crypto.randomUUID(),
  );
  expect(draft.status).toBe(201);
  const c = draft.body.data;
  expect(
    call(
      `/combos/${c.id}/publish`,
      "POST",
      { expectedVersion: c.version },
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  const publicPage = call<Page<PublicCombo>>("/service/combos");
  expect(publicPage.status).toBe(200);
  expect(publicPage.body.data.items[0].components[0].dishName).toBe(
    dishes.find((d) => d.id === components[0].dishId)!.name,
  );
  expect(JSON.stringify(publicPage.body)).not.toMatch(
    /recipeFingerprint|expiresAt|ingredientId|batchId/,
  );
  const key = crypto.randomUUID(),
    body = {
      lines: [{ dishId: components[0].dishId, portions: 1 }],
      combos: [{ comboId: c.id, version: c.version, quantity: 2 }],
    };
  const order = call<Order>("/orders", "POST", body, key);
  expect(order.status).toBe(201);
  expect(order.body.data.lines.map((l) => l.portions).sort()).toEqual([2, 3]);
  expect(order.body.data.composition).toHaveLength(2);
  const onlyCombo = call<{
    composition: unknown[];
    lines: { portions: number }[];
  }>(
    "/service/orders",
    "POST",
    { lines: [], combos: [{ comboId: c.id, version: c.version, quantity: 1 }] },
    crypto.randomUUID(),
  );
  expect(onlyCombo.status).toBe(201);
  expect(onlyCombo.body.data.lines.map((l) => l.portions)).toEqual([1, 1]);
  expect(onlyCombo.body.data.composition).toHaveLength(1);
  expect("allocations" in onlyCombo.body.data).toBe(false);
  expect(
    order.body.data.allocations.every(
      (a) => a.riskSnapshot?.evaluatedAt === order.body.data.createdAt,
    ),
  ).toBe(true);
  expect(
    call(
      `/combos/${c.id}/archive`,
      "POST",
      { expectedVersion: c.version },
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  expect(call("/orders", "POST", body, key).body).toEqual(order.body);
  expect(call("/orders", "POST", body, crypto.randomUUID()).status).toBe(409);
});

it("changing a recipe stops a published combo until a new version is published", () => {
  const stocked = call<Page<InventoryRow>>("/inventory").body.data.items.find(
    (i) => Number(i.availableQuantity) > 10,
  )!;
  const ids = ["Recipe A", "Recipe B"].map(
    (name) =>
      call<Dish>("/dishes", "POST", {
        name,
        active: true,
        recipe: [{ ingredientId: stocked.ingredientId, quantity: "1.000" }],
      }).body.data.id,
  );
  const c = call<Combo>(
    "/combos",
    "POST",
    {
      title: "Recipe pair",
      components: ids.map((dishId) => ({ dishId, portions: 1 })),
    },
    crypto.randomUUID(),
  ).body.data;
  expect(
    call(
      `/combos/${c.id}/publish`,
      "POST",
      { expectedVersion: 1 },
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  expect(
    call(`/dishes/${ids[0]}`, "PUT", {
      name: "Recipe A",
      active: true,
      recipe: [{ ingredientId: stocked.ingredientId, quantity: "2.000" }],
    }).status,
  ).toBe(200);
  expect(call<Combo>(`/combos/${c.id}`).body.data.needsReview).toBe(true);
  expect(
    call<Page<PublicCombo>>("/service/combos").body.data.items[0].status,
  ).toBe("stopped");
  const body = {
      lines: [],
      combos: [{ comboId: c.id, version: 1, quantity: 1 }],
    },
    failedKey = crypto.randomUUID();
  const refused = call("/orders", "POST", body, failedKey);
  expect(refused.status).toBe(409);
  const revised = call<Combo>(
    `/combos/${c.id}/versions`,
    "POST",
    { expectedVersion: 1, title: c.title, components: c.components },
    crypto.randomUUID(),
  );
  expect(revised.status).toBe(201);
  expect(revised.body.data.version).toBe(2);
  expect(
    call(
      `/combos/${c.id}/publish`,
      "POST",
      { expectedVersion: 2 },
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  expect(call("/orders", "POST", body, failedKey).body).toEqual(refused.body);
  expect(
    call(
      "/orders",
      "POST",
      { ...body, combos: [{ comboId: c.id, version: 2, quantity: 1 }] },
      crypto.randomUUID(),
    ).status,
  ).toBe(201);
});
it("reports insufficient history honestly and read-only calculations do not change storage", () => {
  const before = localStorage.getItem(
    `rims.demo.database.v2.${demoWarehouseA}`,
  );
  const prediction = call<StopForecast>("/stop-list/forecast");
  expect(prediction.status).toBe(200);
  expect(prediction.body.data.calculatedThrough).toBe(
    prediction.body.data.asOf,
  );
  expect(
    prediction.body.data.items.every((d) =>
      ["already_stopped", "insufficient_history"].includes(d.status),
    ),
  ).toBe(true);
  const now = Date.now();
  const report = call<RiskReport>(
    `/analytics/risk-inventory?from=${encodeURIComponent(new Date(now - 86400000).toISOString())}&to=${encodeURIComponent(new Date(now - 1000).toISOString())}`,
  );
  expect(report.status).toBe(200);
  expect(localStorage.getItem(`rims.demo.database.v2.${demoWarehouseA}`)).toBe(
    before,
  );
});

it("schema 3 migration preserves stock, users, and replay without fabricating historical risk", () => {
  const key = `rims.demo.database.v2.${demoWarehouseA}`;
  const raw = JSON.parse(localStorage.getItem(key)!);
  const stockBefore = raw.deliveries
    .flatMap((d: { batches: Batch[] }) => d.batches)
    .map((b: Batch) => b.remainingQuantity);
  const usersBefore = JSON.parse(
    localStorage.getItem("rims.demo.registry.v2")!,
  ).users;
  raw.schemaVersion = 3;
  delete raw.openingBalances;
  delete raw.analyticsTrackingStartedAt;
  delete raw.forecastObservationStartedAt;
  for (const d of raw.deliveries)
    for (const b of d.batches) {
      delete b.heldQuantity;
      delete b.version;
      delete b.receiptCommittedAt;
    }
  for (const m of raw.movements) {
    delete m.riskSnapshot;
    delete m.eventSequence;
  }
  raw.replays["historic-key"] = {
    hash: "historic-hash",
    response: {
      status: 409,
      body: {
        error: {
          code: "INSUFFICIENT_STOCK",
          message: "Historic refusal",
          details: {},
        },
        meta: { serverTime: "2026-10-01T00:00:00Z", requestId: "historic" },
      },
    },
  };
  localStorage.setItem(key, JSON.stringify(raw));
  expect(call("/inventory").status).toBe(200);
  const upgraded = JSON.parse(localStorage.getItem(key)!);
  expect(upgraded.schemaVersion).toBe(4);
  expect(
    upgraded.deliveries
      .flatMap((d: { batches: Batch[] }) => d.batches)
      .map((b: Batch) => b.remainingQuantity),
  ).toEqual(stockBefore);
  expect(upgraded.replays["historic-key"]).toEqual(raw.replays["historic-key"]);
  expect(
    upgraded.movements.every((m: Movement) => m.riskSnapshot === null),
  ).toBe(true);
  expect(upgraded.openingBalances).toHaveLength(stockBefore.length);
  expect(
    JSON.parse(localStorage.getItem("rims.demo.registry.v2")!).users,
  ).toEqual(usersBefore);
  const stable = localStorage.getItem(key);
  call("/inventory");
  expect(localStorage.getItem(key)).toBe(stable);
});
