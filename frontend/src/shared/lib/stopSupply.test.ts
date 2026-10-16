import { describe, expect, it } from "vitest";
import type { DishAvailability } from "../api/types";
import { stopSupply } from "./stopSupply";

function dish(
  requiredQuantity: string,
  ingredientId = "milk",
  active = true,
): DishAvailability {
  return {
    dishId: crypto.randomUUID(),
    dishName: "Блюдо",
    active,
    status: "stopped",
    maxPortions: 0,
    shortages: [
      {
        ingredientId,
        ingredientName: "Молоко",
        unit: "ml",
        requiredQuantity,
        availableQuantity: "1.000",
        missingQuantity: "1.000",
      },
    ],
  };
}
describe("поставка из стоп-листа", () => {
  it("суммирует общие ингредиенты для десяти порций каждого блюда", () => {
    expect(stopSupply([dish("10.000"), dish("20.000")])).toEqual([
      { ingredientId: "milk", quantity: "300.000" },
    ]);
  });
  it("сохраняет точность дробей, разделяет ингредиенты и исключает неактивные блюда", () => {
    expect(
      stopSupply([
        dish("0.125"),
        dish("0.003"),
        dish("2.000", "flour"),
        dish("99.000", "milk", false),
      ]),
    ).toEqual([
      { ingredientId: "milk", quantity: "1.280" },
      { ingredientId: "flour", quantity: "20.000" },
    ]);
    expect(stopSupply([])).toEqual([]);
  });
});
