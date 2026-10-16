import type {
  Batch,
  Delivery,
  Dish,
  Ingredient,
  Movement,
  Order,
  WriteOff,
} from "../shared/api/types";
import type { Quarantine } from "../shared/api/extensions";
import { decimal, riskSnapshot, stockPlan } from "./stock";
import { thousandths } from "../shared/lib/decimal";
import { openQuarantine } from "./quarantine";

export const forecastWarehouseId = "dddddddd-0000-4000-8000-000000000003";
export const forecastEnterpriseId = "dddddddd-0000-4000-8000-000000000033";
const id = (n: number) =>
  `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Controlled-clock seed: every historical order is verified and allocated by the production demo stock kernel. */
export function createForecastFixture(asOf: number, actorId: string) {
  const iso = (n: number) => new Date(n).toISOString(),
    start = asOf - 14 * 86400000;
  const ingredients: Ingredient[] = [
    {
      id: id(101),
      name: "Молоко · демо",
      unit: "ml",
      defaultShelfLifeHours: 400,
      reorderPoint: "100.000",
      targetStock: "1000.000",
    },
    {
      id: id(102),
      name: "Хлеб · демо",
      unit: "g",
      defaultShelfLifeHours: 400,
      reorderPoint: "1.000",
      targetStock: "10.000",
    },
    {
      id: id(103),
      name: "Специи · без спроса",
      unit: "g",
      defaultShelfLifeHours: 400,
      reorderPoint: "1.000",
      targetStock: "10.000",
    },
  ];
  const dishes: Dish[] = [
    {
      id: id(201),
      name: "Кофе · общий ингредиент",
      active: true,
      recipe: [{ ingredientId: id(101), quantity: "10.000" }],
      createdAt: iso(start),
      updatedAt: iso(start),
    },
    {
      id: id(202),
      name: "Какао · общий ингредиент",
      active: true,
      recipe: [{ ingredientId: id(101), quantity: "20.000" }],
      createdAt: iso(start),
      updatedAt: iso(start),
    },
    {
      id: id(203),
      name: "Тост · истечение до расхода",
      active: true,
      recipe: [{ ingredientId: id(102), quantity: "0.100" }],
      createdAt: iso(start),
      updatedAt: iso(start),
    },
    {
      id: id(204),
      name: "Новинка · без истории",
      active: true,
      recipe: [{ ingredientId: id(103), quantity: "1.000" }],
      createdAt: iso(start),
      updatedAt: iso(start),
    },
  ];
  const batches: Batch[] = ingredients.map((i, index) => ({
    id: id(301 + index),
    deliveryId: id(401),
    deliveryNumber: "DEMO-HISTORY-14D",
    deliveryItemId: id(501 + index),
    ingredientId: i.id,
    ingredientName: i.name,
    unit: i.unit,
    receivedAt: iso(start),
    receiptCommittedAt: iso(start),
    manufacturedAt: iso(
      asOf - (400 - (index === 0 ? 36 : index === 1 ? 1 : 3)) * 3600000,
    ),
    shelfLifeHours: 400,
    expiresAt: iso(asOf + (index === 0 ? 36 : index === 1 ? 1 : 3) * 3600000),
    initialQuantity: index === 0 ? "2700.000" : "10.000",
    remainingQuantity: index === 0 ? "2700.000" : "10.000",
    heldQuantity: "0.000",
    availableQuantity: index === 0 ? "2700.000" : "10.000",
    heldExpiredQuantity: "0.000",
    version: 1,
    status: "fresh",
    remainingSeconds: 0,
  }));
  const movements: Movement[] = [],
    orders: Order[] = [],
    writeOffs: WriteOff[] = [],
    quarantines: Quarantine[] = [];
  let sequence = 0;
  const movement = (
    b: Batch,
    type: Movement["type"],
    delta: string,
    referenceId: string,
    at: number,
    heldDelta = "0.000",
    quarantineId: string | null = null,
  ) => {
    if (type !== "receipt") b.version = (b.version ?? 1) + 1;
    movements.push({
      id: id(1000 + ++sequence),
      createdAt: iso(at),
      ingredientId: b.ingredientId,
      ingredientName: b.ingredientName,
      unit: b.unit,
      batchId: b.id,
      type,
      quantityDelta: delta,
      remainingAfter: b.remainingQuantity,
      heldQuantityDelta: heldDelta,
      heldAfter: b.heldQuantity,
      quarantineId,
      actorUserId: actorId,
      integrationClientId: null,
      eventSequence: sequence,
      riskSnapshot:
        type === "order" || type === "write_off" ? riskSnapshot(b, at) : null,
      referenceId,
      referenceNumber: null,
    });
  };
  for (const b of batches)
    movement(b, "receipt", b.initialQuantity, b.deliveryId, start);
  for (let n = 0; n < 84; n++) {
    const at = start + (n + 1) * 4 * 3600000 - 60000;
    const input = {
      lines: dishes.slice(0, 3).map((d) => ({ dishId: d.id, portions: 1 })),
    };
    const preview = stockPlan(ingredients, dishes, batches, input, at);
    if (!preview.canCreate) throw new Error("FIXTURE_STOCK_INVARIANT");
    const order: Order = {
      id: id(2000 + n),
      number: `DEMO-ORDER-${n + 1}`,
      createdAt: iso(at),
      status: "completed",
      source: (["staff", "waiter", "customer", "integration"] as const)[n % 4],
      customerId: null,
      externalId: null,
      lines: input.lines.map((l) => ({
        ...l,
        dishName: dishes.find((d) => d.id === l.dishId)!.name,
      })),
      allocations: preview.allocations.map((a) => ({
        ...a,
        riskSnapshot: riskSnapshot(
          batches.find((b) => b.id === a.batchId)!,
          at,
        ),
      })),
      composition: input.lines.map((l) => ({
        kind: "dish",
        ...l,
        dishName: dishes.find((d) => d.id === l.dishId)!.name,
      })),
      recipeSnapshot: dishes
        .slice(0, 3)
        .map((d) => ({ dishId: d.id, recipe: structuredClone(d.recipe) })),
    };
    for (const a of preview.allocations) {
      const b = batches.find((b) => b.id === a.batchId)!;
      b.remainingQuantity = decimal(
        thousandths(b.remainingQuantity) - thousandths(a.quantity),
      );
      movement(b, "order", "-" + a.quantity, order.id, at);
    }
    orders.push(order);
  }
  const heldBatch = batches[0];
  const q = openQuarantine(
    heldBatch,
    {
      batchId: heldBatch.id,
      expectedBatchVersion: heldBatch.version!,
      quantity: "50.000",
      reason: "Демонстрационная проверка качества",
      note: null,
    },
    {
      id: id(4001),
      warehouseId: forecastWarehouseId,
      actorId,
      asOf: iso(asOf),
    },
  );
  Object.assign(heldBatch, q.batch);
  quarantines.push(q.quarantine);
  movement(
    heldBatch,
    "quarantine_open",
    "0.000",
    q.quarantine.id,
    asOf,
    "50.000",
    q.quarantine.id,
  );
  const deliveries: Delivery[] = [
    {
      id: id(401),
      number: "DEMO-HISTORY-14D",
      createdAt: iso(start),
      expectedAt: null,
      receivedAt: iso(start),
      status: "confirmed",
      source: "manual",
      externalId: null,
      note: "Синтетические данные за 14 дней; каждый заказ проведён через общее FEFO ядро.",
      lines: batches.map((b) => ({
        id: b.deliveryItemId,
        ingredientId: b.ingredientId,
        ingredientName: b.ingredientName,
        unit: b.unit,
        quantity: b.initialQuantity,
        manufacturedAt: b.manufacturedAt,
        shelfLifeHours: b.shelfLifeHours,
        expiresAt: b.expiresAt,
      })),
      batches,
      confirmedByUserId: actorId,
      rejectedAt: null,
      rejectionReason: null,
    },
  ];
  for (const b of batches) {
    const delta = movements
      .filter((m) => m.batchId === b.id)
      .reduce(
        (n, m) =>
          n +
          (m.quantityDelta.startsWith("-")
            ? -thousandths(m.quantityDelta.slice(1))
            : thousandths(m.quantityDelta)),
        0n,
      );
    if (delta !== thousandths(b.remainingQuantity))
      throw new Error("FIXTURE_LEDGER_INVARIANT");
  }
  return {
    schemaVersion: 4,
    ingredients,
    dishes,
    deliveries,
    orders,
    writeOffs,
    movements,
    quarantines,
    combos: [],
    comboVersions: [],
    replays: {},
    stateRevision: 1,
    eventSequence: sequence,
    analyticsTrackingStartedAt: iso(start),
    forecastObservationStartedAt: iso(start),
    datasetKind: "demo_seeded" as const,
    openingBalances: [],
  };
}
