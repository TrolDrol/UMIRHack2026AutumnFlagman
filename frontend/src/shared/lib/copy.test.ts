import { expect, it } from "vitest";
import {
  copyName,
  copyDish,
  copyIngredient,
  copyOrder,
  copyDelivery,
  sameName,
} from "./copy";
import type { Delivery, Dish, Ingredient, Order } from "../api/types";
it("generates free names without case-sensitive duplicates and respects limits", () => {
  expect(
    copyName("Томаты", ["Томаты", " ТОМАТЫ (КОПИЯ) ", "Томаты (копия 2)"]),
  ).toBe("Томаты (копия 3)");
  expect(copyName("X".repeat(120), [], 120)).toHaveLength(120);
  expect(copyName("A".repeat(64), [], 64, true)).toHaveLength(64);
  expect(sameName(" Сыр ", "сыр")).toBe(true);
  expect(sameName("SUP-1", "sup-1", true)).toBe(false);
});
it("copies catalog inputs and quantities without identifiers or source changes", () => {
  const ingredient: Ingredient = {
    id: "ingredient",
    name: "Сыр",
    unit: "g",
    defaultShelfLifeHours: 72,
    reorderPoint: "9007199254740993.001",
    targetStock: "9007199254740993.002",
  };
  const copied = copyIngredient(ingredient, [ingredient.name]);
  expect(copied).not.toHaveProperty("id");
  expect(copied.reorderPoint).toBe(ingredient.reorderPoint);
  const dish: Dish = {
    id: "dish",
    name: "Салат",
    active: false,
    recipe: [{ ingredientId: ingredient.id, quantity: "0.001" }],
    createdAt: "old",
    updatedAt: "old",
  };
  const result = copyDish(dish, [dish.name]);
  expect(result.active).toBe(false);
  expect(result).not.toHaveProperty("id");
  result.recipe[0].quantity = "1.000";
  expect(dish.recipe[0].quantity).toBe("0.001");
});
it("repeats only order inputs and never reuses stock allocations or document identifiers", () => {
  const source: Order = {
    id: "order",
    number: "ORD-1",
    createdAt: "old",
    status: "completed",
    source: "staff",
    externalId: null,
    lines: [{ dishId: "dish", dishName: "Блюдо", portions: 3 }],
    allocations: [],
    composition: [],
  };
  expect(copyOrder(source)).toEqual({
    lines: [{ dishId: "dish", portions: 3 }],
  });
});
it("copies delivery inputs without approval, stock balances or automatic expiry extension", () => {
  const source: Delivery = {
    id: "delivery",
    number: "SUP-1",
    createdAt: "2026-10-01T08:00:00Z",
    expectedAt: null,
    receivedAt: "2026-10-01T08:00:00Z",
    status: "confirmed",
    source: "manual",
    externalId: null,
    note: "Note",
    confirmedByUserId: "user",
    rejectedAt: null,
    rejectionReason: null,
    batches: [],
    lines: [
      {
        id: "item1",
        ingredientId: "ingredient",
        ingredientName: "Cheese",
        unit: "g",
        quantity: "100.001",
        manufacturedAt: null,
        shelfLifeHours: 72,
        expiresAt: "2026-10-02T08:00:00Z",
      },
      {
        id: "item2",
        ingredientId: "ingredient",
        ingredientName: "Cheese",
        unit: "g",
        quantity: "50.001",
        manufacturedAt: "2026-10-01T06:00:00Z",
        shelfLifeHours: 48,
        expiresAt: "2026-10-03T06:00:00Z",
      },
    ],
  };
  const result = copyDelivery(source, ["SUP-1", "SUP-1 (копия)"]);
  expect(result.number).toBe("SUP-1 (копия 2)");
  expect(result.expectedAt).toBeNull();
  expect(result).not.toHaveProperty("status");
  expect(result).not.toHaveProperty("receivedAt");
  expect(result.lines).toEqual([
    {
      ingredientId: "ingredient",
      quantity: "100.001",
      expiresAt: "2026-10-02T08:00:00Z",
    },
    {
      ingredientId: "ingredient",
      quantity: "50.001",
      manufacturedAt: "2026-10-01T06:00:00Z",
      shelfLifeHours: 48,
    },
  ]);
  expect(copyDelivery(source, [], [source.lines[0]]).lines).toHaveLength(1);
});
