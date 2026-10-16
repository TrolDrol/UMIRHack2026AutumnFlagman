import { expect, test } from "vitest";
import { nextDeliveryNumber } from "../shared/lib/deliveryNumber";
test("номер поставки продолжает существующую серию и пропускает ручные номера", () => {
  expect(nextDeliveryNumber([])).toBe("SUP-0001");
  expect(
    nextDeliveryNumber([
      "SUP-0010",
      "SUP-2",
      "MANUAL",
      "SUP-DEMO-001",
      "SUP-0009",
    ]),
  ).toBe("SUP-0011");
  expect(nextDeliveryNumber(["SUP-9999"])).toBe("SUP-10000");
});
