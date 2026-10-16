import type {
  ExternalDeliveryInput,
  PurchaseRequest,
} from "@rims/portal-contracts";
import { thousandths, quantity } from "@rims/portal-contracts/decimal";
export type Lot = {
  id: string;
  ingredientId: string;
  quantity: string;
  mode: "expires" | "manufactured";
  date: string;
  hours: string;
};
export type Draft = {
  requestId: string;
  number: string;
  externalId: string;
  expectedAt: string;
  note: string;
  lots: Lot[];
};
export class FormError extends Error {
  constructor(public fields: { path: string; message: string }[]) {
    super("Исправьте поля отгрузки.");
  }
}
export function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)) + " (Москва, UTC+03:00)"
    : "Не указана";
}
export function moscowInput(value: string | null) {
  return value
    ? new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16)
    : "";
}
export function timestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Укажите дату и время по Москве.");
  const date = new Date(value + ":00+03:00");
  if (
    !Number.isFinite(date.getTime()) ||
    moscowInput(date.toISOString()) !== value
  )
    throw new Error("Некорректная дата.");
  return date.toISOString();
}
export const newLot = (ingredientId: string, amount: string): Lot => ({
  id: crypto.randomUUID(),
  ingredientId,
  quantity: amount,
  mode: "expires",
  date: "",
  hours: "",
});
export function newDraft(request: PurchaseRequest): Draft {
  return {
    requestId: request.id,
    number: "",
    externalId: crypto.randomUUID(),
    expectedAt: moscowInput(request.expectedAt),
    note: "",
    lots: request.lines.map((line) => newLot(line.ingredientId, line.quantity)),
  };
}
export function distributed(draft: Draft, ingredientId: string): bigint | null {
  try {
    return draft.lots
      .filter((l) => l.ingredientId === ingredientId)
      .reduce((sum, l) => sum + thousandths(l.quantity), 0n);
  } catch {
    return null;
  }
}
export function showAmount(n: bigint) {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return `${sign}${abs / 1000n}.${String(abs % 1000n).padStart(3, "0")}`;
}
export function buildShipment(
  request: PurchaseRequest,
  draft: Draft,
): ExternalDeliveryInput {
  const fields: { path: string; message: string }[] = [];
  const error = (path: string, message: string) =>
    fields.push({ path, message });
  if (draft.requestId !== request.id || request.status !== "approved")
    error("requestId", "Для отгрузки нужна принятая заявка.");
  if (!draft.number.trim() || draft.number.trim().length > 64)
    error("number", "Номер: от 1 до 64 символов.");
  if (!draft.externalId.trim() || draft.externalId.length > 128)
    error("externalId", "Некорректный внешний идентификатор.");
  if (draft.note.length > 500) error("note", "Не более 500 символов.");
  if (draft.lots.length < 1 || draft.lots.length > 100)
    error("lines", "Допускается от 1 до 100 партий.");
  let expectedAt: string | null = null;
  if (draft.expectedAt)
    try {
      expectedAt = timestamp(draft.expectedAt);
    } catch (e) {
      error("expectedAt", (e as Error).message);
    }
  const lines = draft.lots.map((lot, i) => {
    let amount = "0.000";
    try {
      if (thousandths(lot.quantity) <= 0n) throw new Error();
      amount = quantity(lot.quantity);
    } catch {
      error(
        `lines.${i}.quantity`,
        "Положительное количество, до 3 знаков после точки.",
      );
    }
    if (!request.lines.some((line) => line.ingredientId === lot.ingredientId))
      error(`lines.${i}.ingredientId`, "Ингредиент отсутствует в заявке.");
    let date = "";
    try {
      date = timestamp(lot.date);
    } catch (e) {
      error(
        `lines.${i}.${lot.mode === "expires" ? "expiresAt" : "manufacturedAt"}`,
        (e as Error).message,
      );
    }
    if (lot.mode === "expires")
      return {
        ingredientId: lot.ingredientId,
        quantity: amount,
        expiresAt: date,
      };
    const hours = Number(lot.hours);
    if (
      !/^\d+$/.test(lot.hours) ||
      !Number.isInteger(hours) ||
      hours < 1 ||
      hours > 87600
    )
      error(`lines.${i}.shelfLifeHours`, "От 1 до 87600 целых часов.");
    return {
      ingredientId: lot.ingredientId,
      quantity: amount,
      manufacturedAt: date,
      shelfLifeHours: hours,
    };
  });
  for (const line of request.lines)
    if (distributed(draft, line.ingredientId) !== thousandths(line.quantity))
      error(
        `ingredient.${line.ingredientId}`,
        "Сумма партий должна точно совпадать с заявкой.",
      );
  if (fields.length) throw new FormError(fields);
  return {
    number: draft.number.trim(),
    externalId: draft.externalId.trim(),
    purchaseRequestId: request.id,
    expectedAt,
    note: draft.note.trim() || null,
    lines,
  };
}
