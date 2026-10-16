import { useEffect, useState } from "react";
import type { PurchaseRequest } from "@rims/portal-contracts";
import { thousandths } from "@rims/portal-contracts/decimal";
import type { Connection } from "../../shared/api/client";
import { scope } from "../../shared/api/operations";
import {
  buildShipment,
  distributed,
  FormError,
  newDraft,
  newLot,
  showAmount,
  type Draft,
} from "./form";
import s from "../../styles/Portal.module.css";
export function ShipmentEditor({
  request,
  connection,
  disabled,
  fields,
  onSend,
}: {
  request: PurchaseRequest;
  connection: Connection;
  disabled: boolean;
  fields: { path: string; message: string }[];
  onSend: (body: ReturnType<typeof buildShipment>) => void;
}) {
  const storageKey = `${scope(connection)}.draft.${request.id}`;
  const [storageError, setStorageError] = useState("");
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Draft;
        if (
          parsed.requestId === request.id &&
          ["number", "externalId", "expectedAt", "note"].every(
            (key) => typeof parsed[key as keyof Draft] === "string",
          ) &&
          Array.isArray(parsed.lots) &&
          parsed.lots.every(
            (lot) =>
              lot &&
              ["id", "ingredientId", "quantity", "date", "hours"].every(
                (key) => typeof lot[key as keyof typeof lot] === "string",
              ) &&
              (lot.mode === "expires" || lot.mode === "manufactured"),
          )
        )
          return parsed;
      }
    } catch {
      /* Storage failure is reported when saving. */
    }
    return newDraft(request);
  });
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setStorageError("");
    } catch {
      setStorageError(
        "Черновик не сохранён. Проверьте доступность хранилища перед отправкой.",
      );
    }
  }, [draft, storageKey]);
  const updateLot = (id: string, patch: Partial<Draft["lots"][number]>) =>
    setDraft((d) => ({
      ...d,
      lots: d.lots.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  const allErrors = [...errors, ...fields];
  const fieldError = (path: string) =>
    allErrors
      .filter((e) => e.path === path)
      .map((e) => (
        <span className={s.fieldError} key={e.message}>
          {e.message}
        </span>
      ));
  return (
    <section className={s.panel}>
      <h2>Оформить отгрузку</h2>
      <p>
        Весь согласованный состав, одна поставка. Даты и время указываются по
        Москве (UTC+03:00).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const body = buildShipment(request, draft);
            setErrors([]);
            onSend(body);
          } catch (error) {
            setErrors(
              error instanceof FormError
                ? error.fields
                : [{ path: "form", message: (error as Error).message }],
            );
          }
        }}
      >
        <fieldset disabled={disabled}>
          <div className={s.grid}>
            <label>
              Номер поставки
              <input
                value={draft.number}
                maxLength={64}
                onChange={(e) => setDraft({ ...draft, number: e.target.value })}
              />
              {fieldError("number")}
            </label>
            <label>
              Ожидаемая доставка (Москва)
              <input
                type="datetime-local"
                value={draft.expectedAt}
                onChange={(e) =>
                  setDraft({ ...draft, expectedAt: e.target.value })
                }
              />
              {fieldError("expectedAt")}
              <small>Можно оставить пустым.</small>
            </label>
          </div>
          <label>
            Примечание к поставке
            <textarea
              maxLength={500}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            {fieldError("note")}
          </label>
          {request.lines.map((line) => {
            const allocated = distributed(draft, line.ingredientId);
            return (
              <section className={s.lots} key={line.ingredientId}>
                <h3>{line.ingredientName}</h3>
                <p>
                  Требуется: {line.quantity} {line.unit} · Распределено:{" "}
                  {allocated === null
                    ? "Ошибка количества"
                    : showAmount(allocated)}{" "}
                  · Осталось:{" "}
                  {allocated === null
                    ? "—"
                    : showAmount(thousandths(line.quantity) - allocated)}
                </p>
                {fieldError(`ingredient.${line.ingredientId}`)}
                {draft.lots.map(
                  (lot, i) =>
                    lot.ingredientId === line.ingredientId && (
                      <div className={s.lot} key={lot.id}>
                        <label>
                          Количество ({line.unit})
                          <input
                            aria-label={`Количество партии ${i + 1}`}
                            inputMode="decimal"
                            value={lot.quantity}
                            onChange={(e) =>
                              updateLot(lot.id, { quantity: e.target.value })
                            }
                          />
                          {fieldError(`lines.${i}.quantity`)}
                        </label>
                        <label>
                          Срок годности
                          <select
                            value={lot.mode}
                            onChange={(e) =>
                              updateLot(lot.id, {
                                mode: e.target.value as
                                  "expires" | "manufactured",
                                date: "",
                                hours: "",
                              })
                            }
                          >
                            <option value="expires">Годен до</option>
                            <option value="manufactured">
                              Дата изготовления + часы
                            </option>
                          </select>
                        </label>
                        <label>
                          {lot.mode === "expires"
                            ? "Годен до (Москва)"
                            : "Изготовлено (Москва)"}
                          <input
                            type="datetime-local"
                            aria-label={`Дата партии ${i + 1}`}
                            value={lot.date}
                            onChange={(e) =>
                              updateLot(lot.id, { date: e.target.value })
                            }
                          />
                          {fieldError(
                            `lines.${i}.${lot.mode === "expires" ? "expiresAt" : "manufacturedAt"}`,
                          )}
                        </label>
                        {lot.mode === "manufactured" && (
                          <label>
                            Срок хранения, часов
                            <input
                              type="number"
                              min={1}
                              max={87600}
                              step={1}
                              value={lot.hours}
                              onChange={(e) =>
                                updateLot(lot.id, { hours: e.target.value })
                              }
                            />
                            {fieldError(`lines.${i}.shelfLifeHours`)}
                          </label>
                        )}
                        <button
                          type="button"
                          className={s.secondary}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              lots: draft.lots.filter((l) => l.id !== lot.id),
                            })
                          }
                        >
                          Удалить партию
                        </button>
                      </div>
                    ),
                )}
                <button
                  type="button"
                  className={s.secondary}
                  disabled={draft.lots.length >= 100}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      lots: [...draft.lots, newLot(line.ingredientId, "")],
                    })
                  }
                >
                  Добавить партию
                </button>
              </section>
            );
          })}
          {storageError && (
            <p role="alert" className={s.error}>
              {storageError}
            </p>
          )}
          {allErrors.length > 0 && (
            <ul role="alert" className={s.error}>
              {allErrors.map((e, i) => (
                <li key={i}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <p>
            Регистрация отгрузки не пополняет склад. Приёмку выполнит менеджер.
          </p>
          <button type="submit">Зарегистрировать поставку</button>
        </fieldset>
      </form>
    </section>
  );
}
