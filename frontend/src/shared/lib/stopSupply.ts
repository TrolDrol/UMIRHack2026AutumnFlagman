import type { DishAvailability } from "../api/types";
import { thousandths } from "./decimal";

// Supply the full recipe amount of every missing ingredient for ten portions.
// Combine shared ingredients before creating delivery lines.
export function stopSupply(items: DishAvailability[]) {
  const totals = new Map<string, bigint>();
  for (const dish of items.filter((x) => x.active && x.status === "stopped")) {
    for (const shortage of dish.shortages) {
      totals.set(
        shortage.ingredientId,
        (totals.get(shortage.ingredientId) || 0n) +
          thousandths(shortage.requiredQuantity) * 10n,
      );
    }
  }
  return [...totals].map(([ingredientId, amount]) => ({
    ingredientId,
    quantity: `${amount / 1000n}.${String(amount % 1000n).padStart(3, "0")}`,
  }));
}
