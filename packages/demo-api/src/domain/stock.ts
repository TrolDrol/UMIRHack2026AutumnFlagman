import type {
  Batch,
  Dish,
  Ingredient,
  OrderInput,
  OrderPreview,
  InventoryRow,
} from "../shared/api/types";
import type { RiskSnapshot } from "../shared/api/extensions";
import { thousandths } from "../shared/lib/decimal";

export const decimal = (n: bigint): string =>
  `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 1000n}.${String((n < 0n ? -n : n) % 1000n).padStart(3, "0")}`;
export const held = (b: Batch) => thousandths(b.heldQuantity ?? "0.000");
export const free = (b: Batch) => thousandths(b.remainingQuantity) - held(b);
export const available = (b: Batch, asOf: number) =>
  Date.parse(b.expiresAt) > asOf ? free(b) : 0n;
export const riskStartsAt = (b: Pick<Batch, "expiresAt" | "shelfLifeHours">) =>
  Date.parse(b.expiresAt) - b.shelfLifeHours * 360000;
export function riskSnapshot(b: Batch, asOf: number): RiskSnapshot {
  return {
    policyVersion: "expiry-10pct-v1",
    evaluatedAt: new Date(asOf).toISOString(),
    expiresAt: b.expiresAt,
    shelfLifeHours: b.shelfLifeHours,
    riskStartsAt: new Date(riskStartsAt(b)).toISOString(),
    phase:
      asOf >= Date.parse(b.expiresAt)
        ? "expired"
        : asOf >= riskStartsAt(b)
          ? "expiring"
          : "fresh",
  };
}
export const fefo = (batches: Batch[]) =>
  [...batches].sort(
    (a, b) =>
      a.expiresAt.localeCompare(b.expiresAt) ||
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.id.localeCompare(b.id),
  );
export function inventory(
  ingredients: Ingredient[],
  batches: Batch[],
  asOf: number,
): InventoryRow[] {
  return ingredients.map((i) => {
    const own = batches.filter((b) => b.ingredientId === i.id);
    const sum = (value: (b: Batch) => bigint) =>
      decimal(own.reduce((s, b) => s + value(b), 0n));
    const a = sum((b) => available(b, asOf));
    return {
      ingredientId: i.id,
      ingredientName: i.name,
      unit: i.unit,
      physicalQuantity: sum((b) => thousandths(b.remainingQuantity)),
      availableQuantity: a,
      heldQuantity: sum(held),
      heldExpiredQuantity: sum((b) =>
        Date.parse(b.expiresAt) <= asOf ? held(b) : 0n,
      ),
      expiredQuantity: sum((b) =>
        Date.parse(b.expiresAt) <= asOf ? thousandths(b.remainingQuantity) : 0n,
      ),
      expiringQuantity: sum((b) =>
        asOf >= riskStartsAt(b) ? available(b, asOf) : 0n,
      ),
      nearestExpiresAt:
        fefo(own.filter((b) => available(b, asOf) > 0n))[0]?.expiresAt ?? null,
      reorderPoint: i.reorderPoint,
      targetStock: i.targetStock,
      isLowStock: thousandths(a) < thousandths(i.reorderPoint),
    };
  });
}
export function stockPlan(
  ingredients: Ingredient[],
  dishes: Dish[],
  batches: Batch[],
  input: OrderInput,
  asOf: number,
): OrderPreview {
  const needs = new Map<string, bigint>();
  for (const line of input.lines) {
    const dish = dishes.find((d) => d.id === line.dishId);
    if (!dish?.active) throw new Error("DISH_INACTIVE");
    for (const r of dish.recipe)
      needs.set(
        r.ingredientId,
        (needs.get(r.ingredientId) ?? 0n) +
          thousandths(r.quantity) * BigInt(line.portions),
      );
  }
  const stock = inventory(ingredients, batches, asOf);
  const requirements = [...needs]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, n]) => {
      if (n > 999999999999n) throw new Error("QUANTITY_LIMIT_EXCEEDED");
      const i = ingredients.find((i) => i.id === id)!;
      const a = thousandths(
        stock.find((i) => i.ingredientId === id)!.availableQuantity,
      );
      return {
        ingredientId: id,
        ingredientName: i.name,
        unit: i.unit,
        requiredQuantity: decimal(n),
        availableQuantity: decimal(a),
        missingQuantity: decimal(n > a ? n - a : 0n),
      };
    });
  const canCreate = requirements.every(
    (r) => thousandths(r.missingQuantity) === 0n,
  );
  const allocations: OrderPreview["allocations"] = [];
  if (canCreate)
    for (const [id, n] of needs) {
      let remaining = n;
      for (const b of fefo(
        batches.filter((b) => b.ingredientId === id && available(b, asOf) > 0n),
      )) {
        const a = available(b, asOf),
          q = a < remaining ? a : remaining;
        if (q > 0n)
          allocations.push({
            batchId: b.id,
            ingredientId: id,
            quantity: decimal(q),
            expiresAt: b.expiresAt,
            riskSnapshot: null,
          });
        remaining -= q;
        if (remaining === 0n) break;
      }
    }
  return { canCreate, requirements, allocations };
}
