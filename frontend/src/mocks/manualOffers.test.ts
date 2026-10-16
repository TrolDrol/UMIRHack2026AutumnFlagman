// Explicit demo contract parity; live HTTP/PostgreSQL acceptance is separate.
import { beforeEach, expect, it } from "vitest";
import {
  demoRequest,
  resetDemoData,
  initializeDemoData,
} from "@rims/demo-api/model";
import type {
  Envelope,
  Page,
  DishAvailability,
  ManualOffer,
  OfferCard,
  Delivery,
} from "../shared/api/types";
const warehouse = "aaaaaaaa-0000-4000-8000-000000000001";
function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key: string | null = null,
) {
  return demoRequest(
    path.split("?")[0],
    method,
    body,
    new URL("http://localhost/api/v2" + path),
    key,
  ) as { status: number; body: Envelope<T> };
}
beforeEach(() => {
  resetDemoData();
  initializeDemoData();
  expect(
    call("/auth/login", "POST", { username: "operator", password: "demo" })
      .status,
  ).toBe(200);
});
it("DEMO manual draft/publish/merge/version/replay remains distinct from automatic score", () => {
  const w = `/warehouses/${warehouse}`;
  const dish = call<Page<DishAvailability>>(
    w + "/menu/availability?pageSize=100",
  ).body.data.items.find((d) => d.status === "available")!;
  const input = {
    dishId: dish.dishId,
    title: "Public promotion",
    publicText: null,
    startsAt: null,
    endsAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const key = crypto.randomUUID();
  const created = call<ManualOffer>(w + "/manual-offers", "POST", input, key);
  expect(created.status).toBe(201);
  expect(call<ManualOffer>(w + "/manual-offers", "POST", input, key)).toEqual(
    created,
  );
  const p = w + "/manual-offers/" + created.body.data.id;
  expect(
    call(p + "/publish", "POST", { expectedVersion: 1 }, crypto.randomUUID())
      .status,
  ).toBe(200);
  const cards = call<Page<OfferCard>>(w + "/offers?kind=manual");
  expect(cards.status).toBe(200);
  expect(cards.body.data.items).toHaveLength(1);
  expect(cards.body.data.items[0].manual?.title).toBe(input.title);
  expect(
    call(p + "/unpublish", "POST", { expectedVersion: 1 }, crypto.randomUUID())
      .status,
  ).toBe(409);
  expect(
    call(p + "/unpublish", "POST", { expectedVersion: 2 }, crypto.randomUUID())
      .status,
  ).toBe(200);
  expect(
    call(
      p,
      "PUT",
      { ...input, title: "Edited", expectedVersion: 3 },
      crypto.randomUUID(),
    ).status,
  ).toBe(200);
  expect(
    call(p + "/archive", "POST", { expectedVersion: 4 }, crypto.randomUUID())
      .status,
  ).toBe(200);
  expect(
    call(w + "/manual-offers", "POST", input, crypto.randomUUID()).status,
  ).toBe(201);
});
it("DEMO confirms server intention and replays unchanged time, strict union rejects both", () => {
  const w = `/warehouses/${warehouse}`;
  const ingredient = call<Page<{ id: string }>>(w + "/ingredients").body.data
    .items[0];
  const d = call<Delivery>(
    w + "/deliveries",
    "POST",
    {
      number: "SERVER",
      expectedAt: null,
      note: null,
      lines: [
        {
          ingredientId: ingredient.id,
          quantity: "1.000",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    },
    crypto.randomUUID(),
  );
  expect(d.status).toBe(201);
  const path = `${w}/deliveries/${d.body.data.id}/confirm`,
    key = crypto.randomUUID();
  const body = { receivedAtMode: "server" };
  const first = call<Delivery>(path, "POST", body, key);
  expect(first.status).toBe(200);
  expect(call(path, "POST", body, key)).toEqual(first);
  expect(
    call<Delivery>(path, "POST", body, crypto.randomUUID()).body.data
      .receivedAt,
  ).toBe(first.body.data.receivedAt);
  expect(
    call(
      path,
      "POST",
      { ...body, receivedAt: first.body.data.receivedAt },
      crypto.randomUUID(),
    ).status,
  ).toBe(422);
});
