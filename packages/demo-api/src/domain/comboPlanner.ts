import type { Batch, Dish, Ingredient, OrderInput } from "../shared/api/types";
import type {
  Combo,
  ComboComponent,
  ComboPlan,
  CompositionSnapshot,
  PublicCombo,
} from "../shared/api/extensions";
import { thousandths } from "../shared/lib/decimal";
import {
  available,
  decimal,
  inventory,
  riskStartsAt,
  stockPlan,
} from "./stock";

export function recipeFingerprint(
  components: ComboComponent[],
  dishes: Dish[],
): string {
  return JSON.stringify(
    [...components]
      .sort((a, b) => a.dishId.localeCompare(b.dishId))
      .map((c) => {
        const d = dishes.find((d) => d.id === c.dishId);
        return {
          dishId: c.dishId,
          portions: c.portions,
          active: d?.active ?? false,
          recipe: [...(d?.recipe ?? [])]
            .sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))
            .map((r) => ({ ...r, quantity: decimal(thousandths(r.quantity)) })),
        };
      }),
  );
}
export function expandOrder(
  input: OrderInput,
  dishes: Dish[],
  combos: Combo[],
) {
  const totals = new Map<string, number>();
  const composition: CompositionSnapshot[] = [];
  const add = (id: string, n: number) =>
    totals.set(id, (totals.get(id) ?? 0) + n);
  for (const l of input.lines) {
    const d = dishes.find((d) => d.id === l.dishId);
    if (!d) throw new Error("DISH_NOT_FOUND");
    add(l.dishId, l.portions);
    composition.push({ kind: "dish", ...l, dishName: d.name });
  }
  for (const l of input.combos ?? []) {
    const c = combos.find((c) => c.id === l.comboId);
    if (!c || c.version !== l.version) throw new Error("COMBO_VERSION_CHANGED");
    if (c.status !== "published") throw new Error("COMBO_UNAVAILABLE");
    if (c.recipeFingerprint !== recipeFingerprint(c.components, dishes))
      throw new Error("COMBO_RECIPE_CHANGED");
    if (
      c.components.some((c) => !dishes.find((d) => d.id === c.dishId)?.active)
    )
      throw new Error("COMBO_UNAVAILABLE");
    for (const component of c.components) add(component.dishId, l.quantity);
    composition.push({
      kind: "combo",
      comboId: c.id,
      version: c.version,
      title: c.title,
      quantity: l.quantity,
      pricingMode: "unpriced",
      components: c.components.map((c) => ({
        ...c,
        dishName: dishes.find((d) => d.id === c.dishId)!.name,
      })),
    });
  }
  if (totals.size > 100 || [...totals.values()].some((n) => n > 1000))
    throw new Error("ORDER_LIMIT_EXCEEDED");
  return {
    input: {
      lines: [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dishId, portions]) => ({ dishId, portions })),
    },
    composition,
  };
}
export function publicCombo(
  combo: Combo,
  dishes: Dish[],
  ingredients: Ingredient[],
  batches: Batch[],
  asOf: number,
): PublicCombo {
  const changed =
    combo.recipeFingerprint !== recipeFingerprint(combo.components, dishes);
  const needs = new Map<string, bigint>();
  const active = combo.components.every(
    (c) => dishes.find((d) => d.id === c.dishId)?.active,
  );
  for (const c of combo.components)
    for (const r of dishes.find((d) => d.id === c.dishId)?.recipe ?? [])
      needs.set(
        r.ingredientId,
        (needs.get(r.ingredientId) ?? 0n) + thousandths(r.quantity),
      );
  const stock = inventory(ingredients, batches, asOf);
  const maxUnits =
    changed || !active || combo.status !== "published"
      ? 0
      : Math.min(
          1000,
          ...[...needs].map(([id, n]) =>
            Number(
              thousandths(
                stock.find((i) => i.ingredientId === id)!.availableQuantity,
              ) / n,
            ),
          ),
        );
  return {
    id: combo.id,
    version: combo.version,
    title: combo.title,
    components: combo.components.map((c) => ({
      ...c,
      dishName: dishes.find((d) => d.id === c.dishId)?.name ?? "Блюдо",
    })),
    status: maxUnits > 0 ? "available" : "stopped",
    maxUnits,
    unavailableReason: maxUnits > 0 ? null : "Комплект временно недоступен",
    pricingMode: "unpriced",
  };
}
export function jointPlan(
  ingredients: Ingredient[],
  dishes: Dish[],
  batches: Batch[],
  candidateIds: string[],
  asOf: number,
  revision: number,
): ComboPlan {
  const result: ComboPlan = {
    asOf: new Date(asOf).toISOString(),
    stateRevision: revision,
    method: "joint_fefo_greedy_v1",
    proposals: [],
    allocations: [],
    emptyReason: null,
    isReservation: false,
  };
  const risk = new Map(
    inventory(ingredients, batches, asOf).map((i) => [
      i.ingredientId,
      thousandths(i.expiringQuantity),
    ]),
  );
  if (![...risk.values()].some((n) => n > 0n))
    return { ...result, emptyReason: "no_risk_stock" };
  const ids = [...candidateIds].sort(),
    virtual = structuredClone(batches);
  const pairs = ids.flatMap((id, i) =>
    ids.slice(i + 1).map((other) => ({
      key: id + ":" + other,
      components: [
        { dishId: id, portions: 1 as const },
        { dishId: other, portions: 1 as const },
      ],
      count: 0,
      individualMaxUnits: 0,
    })),
  );
  const input = (components: ComboComponent[], n = 1): OrderInput => ({
    lines: components.map((c) => ({ dishId: c.dishId, portions: n })),
  });
  for (const pair of pairs) {
    let lo = 0,
      hi = 1000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (
        stockPlan(
          ingredients,
          dishes,
          batches,
          input(pair.components, mid),
          asOf,
        ).canCreate
      )
        lo = mid;
      else hi = mid - 1;
    }
    pair.individualMaxUnits = lo;
  }
  for (let n = 0; n < 60; n++) {
    const selected = pairs.filter((p) => p.count > 0);
    const candidates = pairs
      .filter((p) => p.count < 20 && (selected.length < 3 || p.count > 0))
      .map((p) => {
        const preview = stockPlan(
          ingredients,
          dishes,
          virtual,
          input(p.components),
          asOf,
        );
        let score = 0,
          earliest = Infinity;
        for (const a of preview.allocations) {
          const b = virtual.find((b) => b.id === a.batchId)!;
          if (asOf < riskStartsAt(b) || available(b, asOf) <= 0n) continue;
          const r = risk.get(a.ingredientId) ?? 0n;
          if (r === 0n) continue;
          const urgency = Math.max(
            0,
            Math.min(
              1,
              1 -
                (Date.parse(b.expiresAt) - asOf) / (b.shelfLifeHours * 360000),
            ),
          );
          score +=
            (Number(thousandths(a.quantity)) / Number(r)) * (1 + urgency);
          earliest = Math.min(earliest, Date.parse(b.expiresAt));
        }
        return { p, preview, score, earliest };
      })
      .filter((c) => c.preview.canCreate && c.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.earliest - b.earliest ||
          a.p.key.localeCompare(b.p.key),
      );
    const best = candidates[0];
    if (!best) break;
    best.p.count++;
    for (const a of best.preview.allocations) {
      const b = virtual.find((b) => b.id === a.batchId)!;
      b.remainingQuantity = decimal(
        thousandths(b.remainingQuantity) - thousandths(a.quantity),
      );
    }
  }
  const selected = pairs.filter((p) => p.count > 0);
  if (!selected.length) return { ...result, emptyReason: "no_feasible_pairs" };
  const totals = new Map<string, number>();
  for (const p of selected)
    for (const c of p.components)
      totals.set(c.dishId, (totals.get(c.dishId) ?? 0) + p.count);
  const preview = stockPlan(
    ingredients,
    dishes,
    batches,
    { lines: [...totals].map(([dishId, portions]) => ({ dishId, portions })) },
    asOf,
  );
  if (!preview.canCreate) throw new Error("JOINT_PLAN_INVARIANT");
  result.proposals = selected.map((p) => ({
    titleSuggestion: p.components
      .map((c) => dishes.find((d) => d.id === c.dishId)!.name)
      .join(" + "),
    components: p.components,
    suggestedUnits: p.count,
    individualMaxUnits: p.individualMaxUnits,
    explanation:
      "Совместный подбор по фактическому FEFO расходу истекающих партий. Это рекомендация, а не резерв.",
  }));
  result.allocations = preview.allocations.map((a) => {
    const b = batches.find((b) => b.id === a.batchId)!;
    return {
      batchId: a.batchId,
      ingredientId: a.ingredientId,
      unit: b.unit,
      quantity: a.quantity,
      expiringQuantity: asOf >= riskStartsAt(b) ? a.quantity : "0.000",
    };
  });
  return result;
}
