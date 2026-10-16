import { describe, it, expect } from "vitest";
import {
  buildShipment,
  newDraft,
  newLot,
  timestamp,
  FormError,
  distributed,
} from "./form";
import { purchaseRequest, ingredientId } from "../../test/fixtures";
describe("Точный состав отгрузки", () => {
  function valid() {
    const d = newDraft(purchaseRequest);
    d.number = "П-001";
    d.lots[0].date = "2026-10-13T12:00";
    return d;
  }
  it("суммирует 0.1 и 0.2 без float и отправляет даты UTC", () => {
    const d = valid();
    d.lots[0].quantity = "0.1";
    d.lots.push({ ...newLot(ingredientId, "0.2"), date: "2026-10-14T12:00" });
    expect(distributed(d, ingredientId)).toBe(300n);
    const body = buildShipment(purchaseRequest, d);
    expect(body.lines.map((l) => l.quantity)).toEqual(["0.100", "0.200"]);
    expect(body.lines[0]).toHaveProperty(
      "expiresAt",
      "2026-10-13T09:00:00.000Z",
    );
    expect(body.purchaseRequestId).toBe(purchaseRequest.id);
    expect(body).not.toHaveProperty("receivedAt");
  });
  it.each(["0.299", "0.301", "0", "1e-1", "0,3", "0.3001", "1000000000"])(
    "отклоняет количество %s",
    (amount) => {
      const d = valid();
      d.lots[0].quantity = amount;
      expect(() => buildShipment(purchaseRequest, d)).toThrow(FormError);
    },
  );
  it("не разрешает посторонний ингредиент и отгрузку до approve", () => {
    const d = valid();
    d.lots[0].ingredientId = "other";
    expect(() => buildShipment(purchaseRequest, d)).toThrow(FormError);
    expect(() =>
      buildShipment({ ...purchaseRequest, status: "submitted" }, valid()),
    ).toThrow(FormError);
  });
  it("сериализует один вариант срока и проверяет целые часы", () => {
    const d = valid();
    d.lots[0].mode = "manufactured";
    d.lots[0].hours = "24";
    const line = buildShipment(purchaseRequest, d).lines[0];
    expect(line).toHaveProperty("manufacturedAt");
    expect(line).not.toHaveProperty("expiresAt");
    d.lots[0].hours = "1.5";
    expect(() => buildShipment(purchaseRequest, d)).toThrow(FormError);
  });
  it("не принимает невозможные даты и более 100 строк", () => {
    expect(() => timestamp("2026-02-30T12:00")).toThrow();
    const d = valid();
    d.lots = Array.from({ length: 101 }, () => ({ ...d.lots[0] }));
    expect(() => buildShipment(purchaseRequest, d)).toThrow(FormError);
  });
});
