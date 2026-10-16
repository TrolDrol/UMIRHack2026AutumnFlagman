import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  demoRequest,
  resetDemoData,
  demoWarehouseA as A,
  demoWarehouseB as B,
} from "../../../packages/demo-api/src/model";
import { transaction } from "../../../packages/demo-api/src/storage";
import { savePending, pendingFor, scope, expired } from "../shared/lib/storage";
import type { MenuItem, Page, Receipt, Preview } from "../shared/api/types";
function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key: string | null = null,
) {
  return transaction(() =>
    demoRequest(
      path,
      method,
      body,
      new URL("http://localhost/api/v2" + path),
      key,
    ),
  ) as unknown as {
    status: number;
    body: { data: T; error: { code: string } };
  };
}
const root = `/customer/warehouses/${A}`;
function register(name = "buyer_a") {
  return call<{ id: string }>("/customer/auth/register", "POST", {
    username: name,
    password: "long_password_123",
    displayName: name,
  });
}
function available() {
  return call<Page<MenuItem>>(root + "/menu").body.data.items.find(
    (x) => x.status === "available",
  )!;
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDemoData();
});
describe("customer shared API", () => {
  it("does not assign a customer as employee or owner", () => {
    register();
    call("/auth/login", "POST", { username: "superadmin", password: "demo" });
    const enterprise = "aaaaaaaa-0000-4000-8000-000000000011";
    expect(
      call(`/enterprises/${enterprise}/members`, "POST", {
        username: "buyer_a",
        role: "manager",
      }).status,
    ).toBe(422);
    expect(
      call(`/enterprises/${enterprise}/owner`, "POST", {
        ownerUsername: "buyer_a",
      }).status,
    ).toBe(422);
    expect(
      call("/enterprises", "POST", { name: "Test", ownerUsername: "buyer_a" })
        .status,
    ).toBe(422);
  });
  it("recovers a partial commit including replay after quota failure", () => {
    register();
    const dish = available();
    const body = { lines: [{ dishId: dish.dishId, portions: 1 }] };
    const key = crypto.randomUUID();
    const original = Storage.prototype.setItem;
    let failOnce = true;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, k: string, v: string) {
        if (failOnce && k === "rims.demo.database.v2." + A) {
          failOnce = false;
          throw new Error("quota");
        }
        original.call(this, k, v);
      });
    expect(() => call(root + "/orders", "POST", body, key)).toThrow("quota");
    spy.mockRestore();
    expect(localStorage.getItem("rims.demo.journal.v1")).not.toBeNull();
    expect(call(root + "/orders", "POST", body, key).status).toBe(201);
    expect(call<Page<Receipt>>(root + "/orders").body.data.total).toBe(1);
    expect(localStorage.getItem("rims.demo.journal.v1")).toBeNull();
  });
  it("registers only a customer without enterprise or staff login", () => {
    const before = JSON.parse(localStorage.getItem("rims.demo.registry.v2")!);
    expect(register().status).toBe(201);
    const after = JSON.parse(localStorage.getItem("rims.demo.registry.v2")!);
    expect(after.enterprises).toEqual(before.enterprises);
    expect(after.members).toEqual(before.members);
    expect(
      call("/auth/login", "POST", {
        username: "buyer_a",
        password: "long_password_123",
      }).status,
    ).toBe(401);
  });
  it("rejects privileged registration fields", () => {
    expect(
      call("/customer/auth/register", "POST", {
        username: "buyer_a",
        password: "long_password_123",
        displayName: "Имя",
        role: "owner",
      }).status,
    ).toBe(422);
  });
  it("does not inherit or destroy staff session", () => {
    call("/auth/login", "POST", { username: "manager", password: "demo" });
    expect(call(root + "/menu").status).toBe(401);
    const session = sessionStorage.getItem("flagman.demo.signedIn");
    register();
    call("/customer/auth/logout", "POST");
    expect(sessionStorage.getItem("flagman.demo.signedIn")).toBe(session);
  });
  it("returns safe DTOs and debits manager's shared warehouse", () => {
    register();
    const dish = available();
    expect(Object.keys(dish).sort()).toEqual(
      [
        "dishId",
        "dishName",
        "maxPortions",
        "status",
        "unavailableReason",
      ].sort(),
    );
    const receipt = call<Receipt>(
      root + "/orders",
      "POST",
      { lines: [{ dishId: dish.dishId, portions: 1 }] },
      crypto.randomUUID(),
    );
    expect(receipt.status).toBe(201);
    const db = JSON.parse(localStorage.getItem("rims.demo.database.v2." + A)!);
    expect(db.orders.at(-1).source).toBe("customer");
    expect(db.orders.at(-1).customerId).toBe(
      JSON.parse(localStorage.getItem("rims.demo.registry.v2")!).users.find(
        (u: { username: string }) => u.username === "buyer_a",
      ).id,
    );
    expect(
      call<Page<MenuItem>>(root + "/menu").body.data.items.find(
        (d) => d.dishId === dish.dishId,
      )!.maxPortions,
    ).toBeLessThan(dish.maxPortions);
  });
  it("filters ownership before total and denies foreign ID, warehouse and replay", () => {
    register();
    const dish = available();
    const key = crypto.randomUUID();
    const input = { lines: [{ dishId: dish.dishId, portions: 1 }] };
    const own = call<Receipt>(root + "/orders", "POST", input, key).body.data;
    register("buyer_b");
    expect(call<Page<Receipt>>(root + "/orders").body.data.total).toBe(0);
    expect(call(root + "/orders/" + own.id).status).toBe(404);
    expect(call(`/customer/warehouses/${B}/orders/${own.id}`).status).toBe(404);
    const another = call<Receipt>(root + "/orders", "POST", input, key);
    expect(another.body.data.id).not.toBe(own.id);
  });
  it("replays exactly once and new intent has new ID", () => {
    register();
    const dish = available();
    const input = { lines: [{ dishId: dish.dishId, portions: 1 }] };
    const key = crypto.randomUUID();
    const first = call<Receipt>(root + "/orders", "POST", input, key);
    expect(call(root + "/orders", "POST", input, key)).toEqual(first);
    expect(
      call(
        root + "/orders",
        "POST",
        { lines: [{ dishId: dish.dishId, portions: 2 }] },
        key,
      ).status,
    ).toBe(409);
    expect(call<Page<Receipt>>(root + "/orders").body.data.total).toBe(1);
    expect(
      call<Receipt>(root + "/orders", "POST", input, crypto.randomUUID()).body
        .data.id,
    ).not.toBe(first.body.data.id);
  });
  it("unpublication denies catalog and new orders but permits history and replay", () => {
    register();
    const dish = available();
    const input = { lines: [{ dishId: dish.dishId, portions: 1 }] };
    const key = crypto.randomUUID();
    const first = call<Receipt>(root + "/orders", "POST", input, key);
    const registry = JSON.parse(localStorage.getItem("rims.demo.registry.v2")!);
    registry.publication[A] = false;
    localStorage.setItem("rims.demo.registry.v2", JSON.stringify(registry));
    expect(call(root + "/menu").status).toBe(404);
    expect(
      call(root + "/orders", "POST", input, crypto.randomUUID()).status,
    ).toBe(404);
    expect(call(root + "/orders/" + first.body.data.id).status).toBe(200);
    expect(call(root + "/orders", "POST", input, key)).toEqual(first);
  });
  it("validates shared ingredients for entire basket without reserving preview", () => {
    register();
    const menu = call<Page<MenuItem>>(root + "/menu").body.data.items.filter(
      (x) => x.status === "available",
    );
    const input = {
      lines: menu.map((x) => ({ dishId: x.dishId, portions: x.maxPortions })),
    };
    const before = localStorage.getItem("rims.demo.database.v2." + A);
    expect(
      call<Preview>(root + "/orders/preview", "POST", input).body.data
        .canCreate,
    ).toBe(false);
    const after = JSON.parse(
      localStorage.getItem("rims.demo.database.v2." + A)!,
    );
    expect(after.orders).toEqual(JSON.parse(before!).orders);
    expect(
      call(root + "/orders", "POST", input, crypto.randomUUID()).status,
    ).toBe(409);
  });
  it("rejects user-selected customerId and duplicate dishes", () => {
    register();
    const dish = available();
    expect(
      call(
        root + "/orders",
        "POST",
        {
          customerId: crypto.randomUUID(),
          lines: [{ dishId: dish.dishId, portions: 1 }],
        },
        crypto.randomUUID(),
      ).status,
    ).toBe(422);
    expect(
      call(root + "/orders/preview", "POST", {
        lines: [
          { dishId: dish.dishId, portions: 1 },
          { dishId: dish.dishId, portions: 1 },
        ],
      }).status,
    ).toBe(422);
  });
  it("rolls forward unfinished journal before reading", () => {
    const key = "rims.demo.test";
    localStorage.setItem(
      "rims.demo.journal.v1",
      JSON.stringify({ after: [[key, "committed"]] }),
    );
    transaction(() => expect(localStorage.getItem(key)).toBe("committed"));
    expect(localStorage.getItem("rims.demo.journal.v1")).toBeNull();
  });
});
describe("immutable pending", () => {
  it("preserves malformed pending and blocks a fresh operation", () => {
    const key = scope("a", A) + ".pending";
    sessionStorage.setItem(key, "{broken");
    expect(() => pendingFor("a", A)).toThrow();
    expect(sessionStorage.getItem(key)).toBe("{broken");
  });
  it("scopes by actor, warehouse and mode and preserves body", () => {
    const body = { lines: [{ dishId: crypto.randomUUID(), portions: 1 }] };
    const p = savePending("a", A, body);
    body.lines[0].portions = 3;
    expect(pendingFor("a", A)?.body.lines[0].portions).toBe(1);
    expect(pendingFor("b", A)).toBeNull();
    expect(pendingFor("a", B)).toBeNull();
    expect(p.path).toContain("/api/v2/customer/warehouses/");
    expect(scope("a", A)).not.toBe(scope("b", A));
  });
  it("does not allow submission if storage is unavailable", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => savePending("a", A, { lines: [] })).toThrow();
    spy.mockRestore();
  });
  it("blocks automatic replay after 24 hours", () => {
    const p = savePending("a", A, {
      lines: [{ dishId: crypto.randomUUID(), portions: 1 }],
    });
    p.createdAt = new Date(Date.now() - 86400001).toISOString();
    expect(expired(p)).toBe(true);
  });
  it("does not reveal tampered context", () => {
    const p = savePending("a", A, {
      lines: [{ dishId: crypto.randomUUID(), portions: 1 }],
    });
    p.mode = "demo";
    sessionStorage.setItem(scope("a", A) + ".pending", JSON.stringify(p));
    expect(pendingFor("a", A)).toBeNull();
  });
});
