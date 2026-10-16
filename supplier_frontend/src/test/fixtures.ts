import type { PurchaseRequest } from "@rims/portal-contracts";
import type { Connection } from "../shared/api/client";
export const warehouseId = "aaaaaaaa-0000-4000-8000-000000000001";
export const clientId = "bbbbbbbb-0000-4000-8000-000000000001";
export const requestId = "cccccccc-0000-4000-8000-000000000001";
export const ingredientId = "dddddddd-0000-4000-8000-000000000001";
export const connection: Connection = {
  mode: "live",
  origin: globalThis.location?.origin || "http://localhost:5175",
  warehouseId,
  clientId,
  key: "secret-test-credential",
  identity: { clientId, warehouseId, name: "Поставщик X", kind: "supplier" },
};
export const purchaseRequest: PurchaseRequest = {
  id: requestId,
  number: "ЗП-001",
  warehouseId,
  version: 2,
  supplierClientId: clientId,
  supplierName: "Поставщик X",
  status: "approved",
  createdAt: "2026-10-11T10:00:00Z",
  submittedAt: "2026-10-11T10:00:00Z",
  approvedAt: "2026-10-11T11:00:00Z",
  closedAt: null,
  expectedAt: null,
  note: "Привезите утром",
  rejectionReason: null,
  deliveryId: null,
  lines: [
    { ingredientId, ingredientName: "Молоко", unit: "ml", quantity: "0.300" },
  ],
};
