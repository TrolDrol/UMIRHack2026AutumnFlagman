import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  PurchaseRequest,
  PurchaseRequestInput,
} from "../../../packages/portal-contracts/src";
import type { Page, Ingredient } from "../shared/api/types";
import {
  useDirectory,
  useResource,
  useLiveCollection,
} from "../shared/api/queries";
import { useWorkspace, management, scopeKey } from "../app/workspace";
import { beginPending, pendingFor, sendPending } from "../shared/lib/pending";
import { useOnline, useUnsaved } from "../shared/lib/hooks";
import { quantity, units } from "../shared/lib/decimal";
import { dateTime, moscowToUtc, utcToMoscow } from "../shared/lib/time";
import {
  ActionButton,
  ActionLink,
  Empty,
  ErrorNotice,
  Field,
  Heading,
  QueryState,
  Pager,
  useFilters,
  s,
} from "../shared/ui";
import { DateTimePicker } from "../shared/ui/DateTimePicker";

const statuses: Record<PurchaseRequest["status"], string> = {
  draft: "Черновик",
  submitted: "Отправлена поставщику",
  approved: "Одобрена поставщиком",
  delivery_pending: "Поставка ожидает приёмки",
  received: "Получена",
  rejected: "Отклонена поставщиком",
  cancelled: "Отменена",
  delivery_rejected: "Приёмка отклонена",
};
export function PurchaseRequests() {
  const context = useWorkspace();
  const cache = useQueryClient();
  const online = useOnline();
  const { params, update } = useFilters([]);
  const query = useResource<Page<PurchaseRequest>>("purchase-requests", params);
  const suppliers = useLiveCollection<{ id: string; name: string }>(
    "purchase-suppliers",
  );
  const ingredients = useDirectory<Ingredient>("ingredients");
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ ingredientId: "", quantity: "" }]);
  const [editing, setEditing] = useState<PurchaseRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const dirty = Boolean(
    supplier || note || lines.some((l) => l.ingredientId || l.quantity),
  );
  useUnsaved(dirty);
  if (!management(context.role))
    return <p>Заявки доступны управляющим сотрудникам.</p>;
  const locked =
    busy ||
    !online ||
    pendingFor(context).some((p) => p.kind === "purchase-request");
  const refresh = () =>
    cache.invalidateQueries({ queryKey: scopeKey(context) });
  const reset = () => {
    setEditing(null);
    setSupplier("");
    setExpected("");
    setNote("");
    setLines([{ ingredientId: "", quantity: "" }]);
  };
  const decide = async (item: PurchaseRequest, action: "submit" | "cancel") => {
    setBusy(true);
    setError(null);
    try {
      await sendPending(
        beginPending(context, `/purchase-requests/${item.id}/${action}`, {
          version: item.version,
        }),
        context,
      );
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Heading
        title="Заявки поставщикам"
        action={<ActionLink to="/purchases">Предложения закупок</ActionLink>}
      >
        <p>
          Черновик виден ресторану. После отправки поставщик может одобрить
          заявку и оформить одну полную отгрузку; остатки появятся после
          приёмки.
        </p>
      </Heading>
      <section className={s.panel}>
        <h2>{editing ? `Изменить ${editing.number}` : "Новая заявка"}</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const sendNow =
              (event.nativeEvent as SubmitEvent).submitter instanceof
                HTMLButtonElement &&
              (
                (event.nativeEvent as SubmitEvent)
                  .submitter as HTMLButtonElement
              ).value === "send";
            setBusy(true);
            setError(null);
            setNotice("");
            try {
              if (
                !supplier ||
                lines.length < 1 ||
                lines.length > 100 ||
                lines.some((l) => !l.ingredientId) ||
                new Set(lines.map((l) => l.ingredientId)).size !== lines.length
              )
                throw new Error("Выберите поставщика и уникальные ингредиенты");
              const input: PurchaseRequestInput = {
                supplierClientId: supplier,
                expectedAt: expected ? moscowToUtc(expected) : null,
                note: note || null,
                lines: lines.map((l) => {
                  const q = quantity(l.quantity);
                  if (q === "0.000")
                    throw new Error("Количество должно быть положительным");
                  return { ...l, quantity: q };
                }),
              };
              const path = editing
                ? `/purchase-requests/${editing.id}`
                : "/purchase-requests";
              const saved = await sendPending<PurchaseRequest>(
                beginPending(
                  context,
                  path,
                  editing ? { ...input, version: editing.version } : input,
                  undefined,
                  editing ? "PUT" : "POST",
                ),
                context,
              );
              setEditing(saved.data);
              setNotice(
                `Черновик ${saved.data.number} сохранён. Поставщик увидит его после отправки.`,
              );
              await refresh();
              if (sendNow) {
                const sent = await sendPending<PurchaseRequest>(
                  beginPending(
                    context,
                    `/purchase-requests/${saved.data.id}/submit`,
                    { version: saved.data.version },
                  ),
                  context,
                );
                setNotice(
                  `Заявка ${sent.data.number} отправлена поставщику «${sent.data.supplierName}». Она появится в его кабинете в разделе «Ожидает решения».`,
                );
              }
              reset();
              await refresh();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Поставщик">
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              required
              disabled={locked}
            >
              <option value="">Выберите поставщика</option>
              {suppliers.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorNotice error={suppliers.error || ingredients.error} />
          {!suppliers.isPending && !suppliers.data?.data.length && (
            <p>
              Владелец должен создать supplier-клиента в разделе интеграций.
              Секретный ключ здесь не требуется.
            </p>
          )}
          <DateTimePicker
            label="Ожидаемая доставка · Москва (необязательно)"
            value={expected}
            onChange={setExpected}
          />
          <Field label="Примечание">
            <textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              disabled={locked}
            />
          </Field>
          {lines.map((line, index) => (
            <div className={s.row} key={index}>
              <Field label={`Ингредиент ${index + 1}`}>
                <select
                  value={line.ingredientId}
                  disabled={locked}
                  required
                  onChange={(e) =>
                    setLines(
                      lines.map((l, n) =>
                        n === index
                          ? { ...l, ingredientId: e.target.value }
                          : l,
                      ),
                    )
                  }
                >
                  <option value="">Выберите</option>
                  {ingredients.data?.data.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {units[i.unit]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Количество в базовой единице">
                <input
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={locked}
                  required
                  onChange={(e) =>
                    setLines(
                      lines.map((l, n) =>
                        n === index ? { ...l, quantity: e.target.value } : l,
                      ),
                    )
                  }
                />
              </Field>
              <ActionButton
                type="button"
                disabled={locked || lines.length === 1}
                onClick={() => setLines(lines.filter((_, n) => n !== index))}
              >
                Убрать
              </ActionButton>
            </div>
          ))}
          <div className={s.row}>
            <ActionButton
              type="button"
              disabled={locked || lines.length >= 100}
              onClick={() =>
                setLines([...lines, { ingredientId: "", quantity: "" }])
              }
            >
              Добавить ингредиент
            </ActionButton>
            <ActionButton showLabel icon="save" disabled={locked}>
              Сохранить черновик
            </ActionButton>
            <ActionButton
              showLabel
              type="submit"
              name="action"
              value="send"
              disabled={locked}
            >
              Сохранить и отправить поставщику
            </ActionButton>
            {editing && (
              <ActionButton type="button" onClick={reset} disabled={locked}>
                Закрыть редактор
              </ActionButton>
            )}
          </div>
        </form>
      </section>
      <ErrorNotice error={error} />
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      <QueryState query={query}>
        {() =>
          query.data?.data.items.length ? (
            <div className={s.cards}>
              {query.data.data.items.map((item) => (
                <article className={s.panel} key={item.id}>
                  <h2>
                    {item.number} · {statuses[item.status]}
                  </h2>
                  <p>
                    {item.supplierName} · {dateTime(item.createdAt)} · Москва
                  </p>
                  <ul>
                    {item.lines.map((l) => (
                      <li key={l.ingredientId}>
                        {l.ingredientName}: {l.quantity} {units[l.unit]}
                      </li>
                    ))}
                  </ul>
                  {item.note && <p>{item.note}</p>}
                  {item.rejectionReason && <p>{item.rejectionReason}</p>}
                  {item.deliveryId && (
                    <ActionLink to={`/deliveries/${item.deliveryId}`}>
                      Открыть поставку
                    </ActionLink>
                  )}
                  <div className={s.row}>
                    {item.status === "draft" && (
                      <>
                        <ActionButton
                          disabled={locked}
                          onClick={() => {
                            setEditing(item);
                            setSupplier(item.supplierClientId);
                            setExpected(
                              item.expectedAt
                                ? utcToMoscow(item.expectedAt)
                                : "",
                            );
                            setNote(item.note || "");
                            setLines(
                              item.lines.map((l) => ({
                                ingredientId: l.ingredientId,
                                quantity: l.quantity,
                              })),
                            );
                          }}
                        >
                          Редактировать
                        </ActionButton>
                        <ActionButton
                          disabled={locked}
                          onClick={() => void decide(item, "submit")}
                        >
                          Отправить поставщику
                        </ActionButton>
                      </>
                    )}
                    {["draft", "submitted", "approved"].includes(item.status) &&
                      !item.deliveryId && (
                        <ActionButton
                          disabled={locked}
                          onClick={() => void decide(item, "cancel")}
                        >
                          Отменить заявку
                        </ActionButton>
                      )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty>Заявок пока нет.</Empty>
          )
        }
      </QueryState>
      {query.data && <Pager page={query.data.data} onChange={update} />}
    </>
  );
}
