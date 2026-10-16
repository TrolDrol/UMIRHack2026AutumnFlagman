import { expect, it } from "vitest";
import { moscowToUtc, utcToMoscow, dateTime } from "./time";
it("интерпретирует Moscow datetime-local независимо от зоны машины", () => {
  expect(moscowToUtc("2026-10-09T18:00")).toBe("2026-10-09T15:00:00.000Z");
  expect(moscowToUtc("2026-01-01T01:00")).toBe("2025-12-31T22:00:00.000Z");
  expect(utcToMoscow("2026-10-09T15:00:00Z")).toBe("2026-10-09T18:00:00");
  expect(dateTime("2026-10-09T15:00:00Z")).toContain("18:00");
});
it("отклоняет несуществующую дату", () => {
  expect(() => moscowToUtc("2026-02-30T12:00")).toThrow();
});
it("не теряет секунды и микросекунды при копировании дат", () => {
  const utc = "2026-10-09T15:00:12.123456Z";
  expect(moscowToUtc(utcToMoscow(utc))).toBe(utc);
});
it("учитывает IANA offset исторической поставки", () => {
  expect(moscowToUtc("2013-10-09T18:00")).toBe("2013-10-09T14:00:00.000Z");
  expect(utcToMoscow("2013-10-09T14:00:00Z")).toBe("2013-10-09T18:00:00");
});
