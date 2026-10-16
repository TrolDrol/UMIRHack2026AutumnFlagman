import { beforeEach, expect, it } from "vitest";
import {
  demoRequest,
  resetDemoData,
  demoWarehouseA,
  demoWarehouseB,
} from "./model";
import type {
  Delivery,
  Envelope,
  InventoryRow,
  Page,
  IntegrationClient,
  IntegrationKey,
  OrderReceipt,
  ServiceMenuItem,
  Enterprise,
  Membership,
  Member,
} from "../shared/api/types";
type IntegrationKeyCreated = { key: IntegrationKey; token: string };

function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
  token?: string,
) {
  const url = new URL(`http://localhost/api/v2${path}`);
  return demoRequest(
    url.pathname.replace("/api/v2", ""),
    method,
    body,
    url,
    key || null,
    token,
  ) as { status: number; body: Envelope<T> };
}
const scope = `/warehouses/${demoWarehouseA}`;
const ingredientId = "22222222-2222-4222-8222-222222222222";
const document = () => ({
  number: crypto.randomUUID(),
  expectedAt: null,
  note: null,
  lines: [
    {
      ingredientId,
      quantity: "10.000",
      expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
    },
  ],
});
function login(username = "operator") {
  expect(
    call("/auth/login", "POST", { username, password: "demo" }).status,
  ).toBe(200);
}
beforeEach(() => {
  resetDemoData();
  login();
});
function stock() {
  return call<Page<InventoryRow>>(`${scope}/inventory`).body.data.items;
}

it("только глобальный супер-админ создаёт предприятия и назначает владельцев", () => {
  for (const username of ["operator", "manager", "warehouse", "waiter"]) {
    login(username);
    expect(
      call("/enterprises", "POST", {
        name: "Forbidden",
        ownerUsername: username,
      }).status,
    ).toBe(403);
    expect(
      call(`/enterprises/aaaaaaaa-0000-4000-8000-000000000011/owner`, "POST", {
        ownerUsername: username,
      }).status,
    ).toBe(403);
  }
  login("superadmin");
  expect(call<Membership[]>("/me/memberships").body.data).toHaveLength(3);
  expect(
    call("/enterprises", "POST", { name: "No owner", ownerUsername: "missing" })
      .status,
  ).toBe(404);
  expect(call<Membership[]>("/me/memberships").body.data).toHaveLength(3);
  const created = call<Enterprise>("/enterprises", "POST", {
    name: "New restaurant",
    ownerUsername: "manager",
  });
  expect(created.status).toBe(201);
  expect(
    call<Membership[]>("/me/memberships").body.data.every(
      (m) => m.role === "super_admin",
    ),
  ).toBe(true);
  const path = `/enterprises/${created.body.data.id}`;
  expect(
    call(`${path}/owner`, "POST", { ownerUsername: "waiter" }).status,
  ).toBe(200);
  const members = call<Page<Member>>(`${path}/members`).body.data.items;
  expect(members.find((m) => m.username === "manager")?.role).toBe("manager");
  expect(members.find((m) => m.username === "waiter")?.role).toBe("owner");
  login("waiter");
  expect(
    call(`${path}/members`, "POST", {
      username: "warehouse",
      role: "warehouse",
    }).status,
  ).toBe(201);
  expect(
    call(`${path}/members`, "POST", {
      username: "operator",
      role: "super_admin",
    }).status,
  ).toBe(422);
  expect(
    call("/enterprises", "POST", { name: "Forbidden", ownerUsername: "waiter" })
      .status,
  ).toBe(403);
});

it("ожидающая поставка не меняет склад; подтверждение создаёт приход ровно один раз", () => {
  const before = stock();
  const input = document();
  const key = crypto.randomUUID();
  const created = call<Delivery>(`${scope}/deliveries`, "POST", input, key);
  expect(created.status).toBe(201);
  expect(created.body.data.status).toBe("pending");
  expect(created.body.data.batches).toEqual([]);
  expect(stock()).toEqual(before);
  const id = created.body.data.id;
  const received = { receivedAt: new Date(Date.now() - 1000).toISOString() };
  const confirmed = call<Delivery>(
    `${scope}/deliveries/${id}/confirm`,
    "POST",
    received,
    crypto.randomUUID(),
  );
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.data.batches).toHaveLength(1);
  const after = stock();
  expect(after).not.toEqual(before);
  expect(
    call(
      `${scope}/deliveries/${id}/confirm`,
      "POST",
      received,
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  expect(stock()).toEqual(after);
  expect(
    call<Delivery>(`${scope}/deliveries`, "POST", input, key).body.data.status,
  ).toBe("pending");
  expect(call<Delivery>(`${scope}/deliveries/${id}`).body.data.status).toBe(
    "confirmed",
  );
  const movements = call<Page<{ referenceId: string }>>(
    `${scope}/movements?type=receipt&pageSize=100`,
  ).body.data.items;
  expect(movements.filter((item) => item.referenceId === id)).toHaveLength(1);
});

it("отклонение не создаёт партии и не меняет остатки", () => {
  const before = stock();
  const id = call<Delivery>(
    `${scope}/deliveries`,
    "POST",
    document(),
    crypto.randomUUID(),
  ).body.data.id;
  const path = `${scope}/deliveries/${id}/reject`;
  const body = { reason: "Повреждена упаковка" };
  const result = call<Delivery>(path, "POST", body, crypto.randomUUID());
  expect(result.status).toBe(200);
  expect(result.body.data.status).toBe("rejected");
  expect(result.body.data.batches).toEqual([]);
  expect(call(path, "POST", body, crypto.randomUUID()).status).toBe(200);
  expect(stock()).toEqual(before);
  expect(
    call(
      `${scope}/deliveries/${id}/confirm`,
      "POST",
      { receivedAt: new Date().toISOString() },
      crypto.randomUUID(),
    ).status,
  ).toBe(409);
});

it("снимки строк и партий сохраняются после изменения справочника", () => {
  const created = call<Delivery>(
    `${scope}/deliveries`,
    "POST",
    document(),
    crypto.randomUUID(),
  ).body.data;
  expect(
    call(`${scope}/ingredients/${ingredientId}`, "PATCH", {
      name: "Новый сыр",
      defaultShelfLifeHours: 500,
      reorderPoint: "0.000",
      targetStock: "100.000",
    }).status,
  ).toBe(200);
  const result = call<Delivery>(
    `${scope}/deliveries/${created.id}/confirm`,
    "POST",
    { receivedAt: new Date(Date.now() - 1000).toISOString() },
    crypto.randomUUID(),
  ).body.data;
  expect(result.lines[0].ingredientName).toBe(created.lines[0].ingredientName);
  expect(result.batches[0].ingredientName).toBe(
    created.lines[0].ingredientName,
  );
  expect(result.batches[0].shelfLifeHours).toBe(
    created.lines[0].shelfLifeHours,
  );
});

it("предприятия изолированы, официант получает только сервисные DTO", () => {
  expect(
    call<Page<InventoryRow>>(
      `/warehouses/${demoWarehouseB}/inventory`,
    ).body.data.items.every((item) => item.physicalQuantity === "0.000"),
  ).toBe(true);
  login("waiter");
  expect(call(`${scope}/inventory`).status).toBe(403);
  expect(call(`${scope}/orders`).status).toBe(403);
  expect(call(`${scope}/service/inventory`).status).toBe(404);
  expect(call(`${scope}/service/dishes`).status).toBe(404);
  expect(
    call(`${scope}/service/write-offs`, "POST", {}, crypto.randomUUID()).status,
  ).toBe(404);
  expect(call(`/warehouses/${demoWarehouseB}/service/menu`).status).toBe(404);
  const menu = call<Page<ServiceMenuItem>>(`${scope}/service/menu`).body.data;
  expect(menu.items.length).toBeGreaterThan(0);
  expect(Object.keys(menu.items[0]).sort()).toEqual(
    ["dishId", "dishName", "maxPortions", "status", "unavailableReason"].sort(),
  );
  expect(menu.total).toBe(menu.items.length);
  login("warehouse");
  expect(call(`${scope}/ingredients`).status).toBe(200);
  expect(call(`${scope}/dishes`).status).toBe(403);
  const created = call<Delivery>(
    `${scope}/deliveries`,
    "POST",
    document(),
    crypto.randomUUID(),
  );
  expect(created.status).toBe(201);
  expect(
    call(
      `${scope}/deliveries/${created.body.data.id}/confirm`,
      "POST",
      { receivedAt: new Date().toISOString() },
      crypto.randomUUID(),
    ).status,
  ).toBe(403);
});

function client(kind: "supplier" | "pos") {
  const created = call<IntegrationClient>(
    `${scope}/integration-clients`,
    "POST",
    { name: crypto.randomUUID(), kind },
  ).body.data;
  const key = call<IntegrationKeyCreated>(
    `${scope}/integration-clients/${created.id}/keys`,
    "POST",
    { label: "Test", expiresAt: null },
  ).body.data;
  return { created, key };
}
it("поставщик не подтверждает документ и не читает документы другого клиента; ротация сохраняет externalId", () => {
  const first = client("supplier");
  const other = client("supplier");
  const path = `/integrations/v1/warehouses/${demoWarehouseA}/deliveries`;
  const input = { ...document(), externalId: "external-1" };
  const result = call<Delivery>(
    path,
    "POST",
    input,
    crypto.randomUUID(),
    first.key.token,
  );
  expect(result.status).toBe(201);
  expect(result.body.data.status).toBe("pending");
  expect(
    call(
      `${path}/${result.body.data.id}`,
      "GET",
      undefined,
      undefined,
      other.key.token,
    ).status,
  ).toBe(404);
  expect(
    call(
      `${path}/${result.body.data.id}/confirm`,
      "POST",
      { receivedAt: new Date().toISOString() },
      crypto.randomUUID(),
      first.key.token,
    ).status,
  ).toBe(403);
  const rotated = call<IntegrationKeyCreated>(
    `${scope}/integration-clients/${first.created.id}/keys`,
    "POST",
    { label: "Rotated", expiresAt: null },
  ).body.data;
  const repeated = call<Delivery>(
    path,
    "POST",
    input,
    crypto.randomUUID(),
    rotated.token,
  );
  expect(repeated.body.data.id).toBe(result.body.data.id);
  expect(
    call(
      path,
      "POST",
      { ...input, number: "Other" },
      crypto.randomUUID(),
      rotated.token,
    ).status,
  ).toBe(409);
  const keys = call<Page<object>>(
    `${scope}/integration-clients/${first.created.id}/keys`,
  ).body.data;
  expect(JSON.stringify(keys)).not.toContain(first.key.token);
  expect(keys.items.every((key) => !("hash" in key) && !("token" in key))).toBe(
    true,
  );
});

it("касса получает краткий чек без складских распределений", () => {
  const pos = client("pos");
  const path = `/integrations/v1/warehouses/${demoWarehouseA}`;
  const menu = call<Page<ServiceMenuItem>>(
    `${path}/menu`,
    "GET",
    undefined,
    undefined,
    pos.key.token,
  ).body.data;
  const available = menu.items.find((item) => item.maxPortions > 0)!;
  const receipt = call<OrderReceipt>(
    `${path}/orders`,
    "POST",
    { externalId: "pos-1", lines: [{ dishId: available.dishId, portions: 1 }] },
    crypto.randomUUID(),
    pos.key.token,
  );
  expect(receipt.status).toBe(201);
  expect(Object.keys(receipt.body.data).sort()).toEqual(
    ["id", "number", "createdAt", "status", "lines", "composition"].sort(),
  );
  expect(
    call(
      `${path}/orders/preview`,
      "POST",
      { lines: [] },
      undefined,
      pos.key.token,
    ).status,
  ).toBe(403);
});

it("POS externalId cannot bypass key validation and remains part of the semantic hash", () => {
  const pos = client("pos"),
    path = `/integrations/v1/warehouses/${demoWarehouseA}/orders`;
  const menu = call<Page<ServiceMenuItem>>(
    `/integrations/v1/warehouses/${demoWarehouseA}/menu`,
    "GET",
    undefined,
    undefined,
    pos.key.token,
  ).body.data;
  const dish = menu.items.find((d) => d.maxPortions > 0)!;
  const key = crypto.randomUUID(),
    body = {
      externalId: "pos-hash-a",
      lines: [{ dishId: dish.dishId, portions: 1 }],
    };
  const first = call<OrderReceipt>(path, "POST", body, key, pos.key.token);
  expect(first.status).toBe(201);
  expect(
    call(
      path,
      "POST",
      { ...body, externalId: "pos-hash-b" },
      key,
      pos.key.token,
    ).status,
  ).toBe(409);
  expect(call(path, "POST", body, undefined, pos.key.token).status).toBe(400);
  expect(
    call<OrderReceipt>(path, "POST", body, crypto.randomUUID(), pos.key.token)
      .body.data.id,
  ).toBe(first.body.data.id);
  expect(
    call(
      path,
      "POST",
      { ...body, lines: [{ dishId: dish.dishId, portions: 2 }] },
      crypto.randomUUID(),
      pos.key.token,
    ).status,
  ).toBe(409);
});
