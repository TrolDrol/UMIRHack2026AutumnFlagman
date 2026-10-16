import type {
  Delivery,
  DeliveryInput,
  Dish,
  DishInput,
  Ingredient,
  IngredientInput,
  Order,
  OrderInput,
} from "../api/types";
export function sameName(left: string, right: string, caseSensitive = false) {
  const normalize = (value: string) =>
    caseSensitive ? value.trim() : value.trim().toLocaleLowerCase("ru");
  return normalize(left) === normalize(right);
}
export function copyName(
  source: string,
  existing: string[],
  maxLength = 120,
  caseSensitive = false,
) {
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? " (копия)" : ` (копия ${index})`;
    const candidate =
      source
        .trim()
        .slice(0, maxLength - suffix.length)
        .trimEnd() + suffix;
    if (!existing.some((name) => sameName(name, candidate, caseSensitive)))
      return candidate;
  }
}
export function copyIngredient(
  source: Ingredient,
  existing: string[],
): IngredientInput {
  return {
    name: copyName(source.name, existing),
    unit: source.unit,
    defaultShelfLifeHours: source.defaultShelfLifeHours,
    reorderPoint: source.reorderPoint,
    targetStock: source.targetStock,
  };
}
export function copyDish(source: Dish, existing: string[]): DishInput {
  return {
    name: copyName(source.name, existing),
    active: source.active,
    recipe: source.recipe.map((line) => ({ ...line })),
  };
}
export function copyOrder(source: Order): OrderInput {
  if (source.composition?.some((c) => c.kind === "combo"))
    return {
      lines: source.composition.flatMap((c) =>
        c.kind === "dish" ? [{ dishId: c.dishId, portions: c.portions }] : [],
      ),
      combos: source.composition.flatMap((c) =>
        c.kind === "combo"
          ? [{ comboId: c.comboId, version: c.version, quantity: c.quantity }]
          : [],
      ),
    };
  return {
    lines: source.lines.map(({ dishId, portions }) => ({ dishId, portions })),
  };
}
export function copyDelivery(
  source: Delivery,
  existing: string[],
  items = source.lines,
): DeliveryInput {
  return {
    number: copyName(source.number, existing, 64, true),
    expectedAt: null,
    note: source.note,
    lines: items.map((item) =>
      item.manufacturedAt
        ? {
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            manufacturedAt: item.manufacturedAt,
            shelfLifeHours: item.shelfLifeHours,
          }
        : {
            ingredientId: item.ingredientId,
            quantity: item.quantity,
            expiresAt: item.expiresAt,
          },
    ),
  };
}
