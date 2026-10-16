import { expect, it } from "vitest";
import { ingredientSchema, dishSchema, orderSchema } from "./schemas";
const id = "11111111-1111-4111-8111-111111111111";
it("пороги ингредиента сравниваются точно, срок целый и ограничен", () => {
  const input = {
    name: "Сыр",
    unit: "g",
    defaultShelfLifeHours: 48,
    reorderPoint: "999999999.998",
    targetStock: "999999999.999",
  };
  expect(ingredientSchema.safeParse(input).success).toBe(true);
  expect(
    ingredientSchema.safeParse({ ...input, targetStock: "999999999.997" })
      .success,
  ).toBe(false);
  for (const hours of [0, 87601, 1.5])
    expect(
      ingredientSchema.safeParse({ ...input, defaultShelfLifeHours: hours })
        .success,
    ).toBe(false);
});
it("пустой и повторяющийся рецепт запрещены, дробные штуки допустимы", () => {
  const input = {
    name: "Закуска",
    active: false,
    recipe: [{ ingredientId: id, quantity: "0.500" }],
  };
  expect(dishSchema.safeParse(input).success).toBe(true);
  expect(dishSchema.safeParse({ ...input, recipe: [] }).success).toBe(false);
  expect(
    dishSchema.safeParse({
      ...input,
      recipe: [...input.recipe, ...input.recipe],
    }).success,
  ).toBe(false);
  expect(
    dishSchema.safeParse({
      ...input,
      recipe: [{ ingredientId: id, quantity: "0" }],
    }).success,
  ).toBe(false);
});
it("заказ требует уникальных блюд и целых порций от 1 до 1000", () => {
  expect(
    orderSchema.safeParse({ lines: [{ dishId: id, portions: 1000 }] }).success,
  ).toBe(true);
  for (const portions of [0, 1.5, 1001])
    expect(
      orderSchema.safeParse({ lines: [{ dishId: id, portions }] }).success,
    ).toBe(false);
  expect(orderSchema.safeParse({ lines: [] }).success).toBe(false);
  expect(
    orderSchema.safeParse({
      lines: [
        { dishId: id, portions: 1 },
        { dishId: id, portions: 1 },
      ],
    }).success,
  ).toBe(false);
});
