import type { Envelope, Page, Ingredient, Delivery } from "../shared/api/types";
import type { PurchaseRequest } from "../../../packages/portal-contracts/src";
import { beforeEach, expect, it } from "vitest";
import {
  demoRequest,
  resetDemoData,
  initializeDemoData,
  listDemoSuppliers,
  connectDemoSupplier,
  demoWarehouseA,
} from "@rims/demo-api/model";
function call<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  key = crypto.randomUUID(),
  token?: string,
) {
  const url = new URL(
    `http://localhost${path.startsWith("/integrations/") ? path : "/api/v2" + path}`,
  );
  return demoRequest(path, method, body, url, key, token) as {
    status: number;
    body: Envelope<T>;
  };
}
beforeEach(() => {
  resetDemoData();
  initializeDemoData();
});
it("demo supplier uses the same restaurant-created request and only creates stock after acceptance", () => {
  const supplier = listDemoSuppliers()[0];
  const { token } = connectDemoSupplier(supplier);
  const integration = `/integrations/v1/warehouses/${demoWarehouseA}`;
  const warehouse = `/warehouses/${demoWarehouseA}`;
  expect(
    call(integration + "/identity", "GET", undefined, undefined, token).status,
  ).toBe(200);
  call("/auth/login", "POST", { username: "operator", password: "demo" });
  const catalog = call<Page<Ingredient>>(warehouse + "/ingredients");
  const ingredientId = catalog.body.data.items[0].id;
  const draft = call<PurchaseRequest>(
    warehouse + "/purchase-requests",
    "POST",
    {
      supplierClientId: supplier.clientId,
      expectedAt: null,
      note: null,
      lines: [{ ingredientId, quantity: "1.000" }],
    },
  );
  expect(draft.status).toBe(201);
  const id = draft.body.data.id;
  expect(
    call(
      integration + `/purchase-requests/${id}`,
      "GET",
      undefined,
      undefined,
      token,
    ).status,
  ).toBe(404);
  const submitted = call<PurchaseRequest>(
    warehouse + `/purchase-requests/${id}/submit`,
    "POST",
    { version: 1 },
  );
  expect(submitted.body.data.status).toBe("submitted");
  const key = crypto.randomUUID();
  const approved = call<PurchaseRequest>(
    integration + `/purchase-requests/${id}/approve`,
    "POST",
    { version: 2 },
    key,
    token,
  );
  expect(approved.body.data.status).toBe("approved");
  expect(
    call(
      integration + `/purchase-requests/${id}/approve`,
      "POST",
      { version: 2 },
      key,
      token,
    ),
  ).toEqual(approved);
  const shipment = call<Delivery & { purchaseRequestId: string }>(
    integration + "/deliveries",
    "POST",
    {
      externalId: crypto.randomUUID(),
      purchaseRequestId: id,
      number: crypto.randomUUID(),
      expectedAt: null,
      note: null,
      lines: [
        {
          ingredientId,
          quantity: "1.000",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    },
    undefined,
    token,
  );
  expect(shipment.status).toBe(201);
  expect(shipment.body.data.status).toBe("pending");
  expect(shipment.body.data.purchaseRequestId).toBe(id);
  call(warehouse + `/deliveries/${shipment.body.data.id}/confirm`, "POST", {
    receivedAt: new Date().toISOString(),
  });
  const received = call<PurchaseRequest>(
    integration + `/purchase-requests/${id}`,
    "GET",
    undefined,
    undefined,
    token,
  );
  expect(received.body.data.status).toBe("received");
});
