import { expect, it, vi } from "vitest";
import { transaction } from "./storage";
import { demoRegistryKey, demoStorage } from "./storage";

it("переносит старую модель вкладки в общую копию", () => {
  const legacy = JSON.stringify({ members: [{ username: "operator" }] });
  sessionStorage.setItem(demoRegistryKey, legacy);
  expect(demoStorage.getItem(demoRegistryKey)).toBe(legacy);
  expect(localStorage.getItem(demoRegistryKey)).toBe(legacy);
  expect(sessionStorage.getItem(demoRegistryKey)).toBeNull();
});

it("устаревшая копия вкладки не восстанавливает удалённое членство", () => {
  sessionStorage.setItem(
    demoRegistryKey,
    JSON.stringify({ members: [{ username: "operator" }] }),
  );
  demoStorage.setItem(demoRegistryKey, JSON.stringify({ members: [] }));
  expect(JSON.parse(demoStorage.getItem(demoRegistryKey)!).members).toEqual([]);
});

it("journal recovers every part of an interrupted command including its replay", () => {
  const original = Storage.prototype.setItem;
  const spy = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === "test.replay") throw new Error("Interrupted persistence");
      return original.call(this, key, value);
    });
  expect(() =>
    transaction(() => {
      demoStorage.setItem("test.stock", "7.000");
      demoStorage.setItem(
        "test.replay",
        JSON.stringify({ id: "order", composition: [] }),
      );
    }),
  ).toThrow();
  expect(localStorage.getItem("rims.demo.journal.v1")).not.toBeNull();
  spy.mockRestore();
  transaction(() => {
    expect(demoStorage.getItem("test.stock")).toBe("7.000");
    expect(JSON.parse(demoStorage.getItem("test.replay")!)).toEqual({
      id: "order",
      composition: [],
    });
  });
  expect(localStorage.getItem("rims.demo.journal.v1")).toBeNull();
});
