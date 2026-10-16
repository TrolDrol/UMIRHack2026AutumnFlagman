import { describe, expect, it } from "vitest";
import { thousandths, quantity, displayQuantity } from "./decimal";
describe("точные количества", () => {
  it("сохраняет максимум и тысячные без float", () => {
    expect(thousandths("999999999.999")).toBe(999999999999n);
    expect(thousandths("0.1") + thousandths("0.2")).toBe(300n);
    expect(quantity("0.5")).toBe("0.500");
    expect(displayQuantity("-100.010")).toBe("-100.01");
  });
  it.each(["-1", "1,5", "1e3", "1.0001", "1000000000", "01", " 1", "1."])(
    "отклоняет %s",
    (v) => expect(() => thousandths(v)).toThrow(),
  );
});
