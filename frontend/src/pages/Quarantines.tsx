import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type {
  Quarantine,
  QuarantineOrderUsage,
} from "@rims/demo-api/contracts";
import type { Batch, Page, Ingredient } from "../shared/api/types";
import { useApi, useResource, useDirectory } from "../shared/api/queries";
import { management } from "../app/workspace";
import { ScopedLink as Link } from "../shared/lib/routing";
import { beginPending, sendPending } from "../shared/lib/pending";
import { dateTime } from "../shared/lib/time";
import {
  displayQuantity,
  units,
  thousandths,
  quantity,
} from "../shared/lib/decimal";
import {
  Heading,
  Field,
  Table,
  QueryState,
  Pager,
  Empty,
  Modal,
  ErrorNotice,
  ActionButton,
  ResetFilters,
  useFilters,
  s,
} from "../shared/ui";

export function QuarantineOpenDialog({
  batch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const { context, queryPrefix } = useApi(),
    client = useQueryClient();
  const [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const free =
    thousandths(batch.remainingQuantity) -
    thousandths(batch.heldQuantity ?? "0.000");
  return (
    <Modal
      title="Удержать часть партии"
      onClose={onClose}
      dirty={!!amount || !!reason}
    >
      <p>
        {batch.ingredientName} · {batch.deliveryNumber}. Свободно:{" "}
        {displayQuantity(
          `${free / 1000n}.${String(free % 1000n).padStart(3, "0")}`,
        )}{" "}
        {units[batch.unit]}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const pending = beginPending(context, "/quarantines", {
              batchId: batch.id,
              expectedBatchVersion: batch.version ?? 1,
              quantity: quantity(amount),
              reason,
              note: note || null,
            });
            await sendPending(pending, context);
            await client.invalidateQueries({ queryKey: queryPrefix });
            onClose();
          } catch (e) {
            setError(e);
            await client.invalidateQueries({ queryKey: queryPrefix });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Количество">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Field label="Причина">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={500}
          />
        </Field>
        <Field label="Заметка">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        </Field>
        {!!error && <ErrorNotice error={error} />}
        <ActionButton showLabel icon="disable" type="submit" disabled={busy}>
          Удержать
        </ActionButton>
      </form>
    </Modal>
  );
}

export function Quarantines() {
  const { params, update } = useFilters(["status", "batchId", "ingredientId"]);
  const query = useResource<Page<Quarantine>>("quarantines", params);
  const ingredients = useDirectory<Ingredient>("ingredients");
  return (
    <>
      <Heading title="Карантин" />
      <p className={s.notice}>
        Карантин удерживает часть физического остатка. Она недоступна для
        заказов; освобождение просроченной партии не возвращает её в доступный
        запас.
      </p>
      <div className={s.toolbar}>
        <Field label="Состояние">
          <select
            value={params.status ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Все</option>
            <option value="open">Открытые</option>
            <option value="closed">Закрытые</option>
          </select>
        </Field>
        <Field label="Ингредиент">
          <select
            value={params.ingredientId || ""}
            onChange={(e) => update("ingredientId", e.target.value)}
          >
            <option value="">Все</option>
            {ingredients.data?.data.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="UUID партии">
          <input
            value={params.batchId || ""}
            onChange={(e) => update("batchId", e.target.value)}
          />
        </Field>
        <ResetFilters />
      </div>
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <Table
                headers={[
                  "Партия",
                  "Причина",
                  "Удержано / освобождено / списано",
                  "Состояние",
                  "Создан",
                ]}
              >
                {page.items.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link to={`/quarantines/${q.id}`}>{q.batchId}</Link>
                    </td>
                    <td>{q.reason}</td>
                    <td>
                      {displayQuantity(q.remainingHeldQuantity)} /{" "}
                      {displayQuantity(q.releasedQuantity)} /{" "}
                      {displayQuantity(q.writtenOffQuantity)}
                    </td>
                    <td>{q.status === "open" ? "Открыт" : "Закрыт"}</td>
                    <td>{dateTime(q.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>
                Карантинов нет. Удержать часть партии можно на странице
                «Партии».
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
export function QuarantineDetail() {
  const { id } = useParams(),
    api = useApi(),
    client = useQueryClient();
  const query = useResource<Quarantine>(`quarantines/${id}`);
  const [ordersPage, setOrdersPage] = useState("1"),
    [ordersSize, setOrdersSize] = useState("20");
  const orders = useResource<Page<QuarantineOrderUsage>>(
    `quarantines/${id}/orders`,
    { page: ordersPage, pageSize: ordersSize },
    management(api.context.role),
  );
  const [action, setAction] = useState<"release" | "write-off">("release"),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [writeReason, setWriteReason] = useState("damaged");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Heading title="Решения по карантину" />
      <Link to="/quarantines">Все карантины</Link>
      <QueryState query={query}>
        {(q) => (
          <>
            <section className={s.panel}>
              <h2>Партия {q.batchId}</h2>
              <p>{q.reason}</p>
              {q.note && <p>{q.note}</p>}
              <p>
                Удержано {displayQuantity(q.remainingHeldQuantity)} из{" "}
                {displayQuantity(q.openedQuantity)}. Освобождено{" "}
                {displayQuantity(q.releasedQuantity)}, списано{" "}
                {displayQuantity(q.writtenOffQuantity)}.
              </p>
              <p>
                Открыл {q.createdByUserId} · {dateTime(q.createdAt)}
              </p>
              <Link to={`/movements?batchId=${q.batchId}`}>Журнал партии</Link>
            </section>
            {management(api.context.role) && q.status === "open" && (
              <form
                className={s.panel}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError(null);
                  setBusy(true);
                  try {
                    const body =
                      action === "release"
                        ? {
                            expectedVersion: q.version,
                            quantity: quantity(amount),
                            reason,
                          }
                        : {
                            expectedVersion: q.version,
                            quantity: quantity(amount),
                            reason: writeReason,
                            note: reason || null,
                          };
                    await sendPending(
                      beginPending(
                        api.context,
                        `/quarantines/${q.id}/${action}`,
                        body,
                      ),
                      api.context,
                    );
                    setAmount("");
                    setReason("");
                  } catch (e) {
                    setError(e);
                  } finally {
                    await client.invalidateQueries({
                      queryKey: api.queryPrefix,
                    });
                    setBusy(false);
                  }
                }}
              >
                <h2>Принять решение по части удержанного</h2>
                <Field label="Действие">
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as typeof action)}
                  >
                    <option value="release">Освободить</option>
                    <option value="write-off">Списать</option>
                  </select>
                </Field>
                <Field label="Количество">
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
                {action === "write-off" && (
                  <Field label="Причина списания">
                    <select
                      value={writeReason}
                      onChange={(e) => setWriteReason(e.target.value)}
                    >
                      <option value="damaged">Повреждено</option>
                      <option value="expired">Просрочено</option>
                    </select>
                  </Field>
                )}
                <Field
                  label={
                    action === "release" ? "Причина освобождения" : "Заметка"
                  }
                >
                  <textarea
                    required={action === "release"}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </Field>
                {!!error && <ErrorNotice error={error} />}
                <ActionButton
                  showLabel
                  icon="check"
                  type="submit"
                  disabled={busy}
                >
                  {action === "release" ? "Освободить" : "Списать"}
                </ActionButton>
              </form>
            )}
            <section className={s.panel}>
              <h2>История решений</h2>
              {q.decisions.length ? (
                <Table
                  headers={[
                    "Дата",
                    "Решение",
                    "Количество",
                    "Причина",
                    "Автор",
                  ]}
                >
                  {q.decisions.map((d) => (
                    <tr key={d.id}>
                      <td>{dateTime(d.at)}</td>
                      <td>
                        {d.action === "release" ? "Освобождение" : "Списание"}
                      </td>
                      <td>{displayQuantity(d.quantity)}</td>
                      <td>{d.reason}</td>
                      <td>{d.actorUserId}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>Решений пока нет.</Empty>
              )}
            </section>
            {management(api.context.role) && (
              <section className={s.panel}>
                <h2>Заказы из этой партии</h2>
                <p>
                  Связь показывает расход партии. Она не означает, что проданные
                  порции были повреждены.
                </p>
                <QueryState query={orders}>
                  {(page) => (
                    <>
                      <Table headers={["Заказ", "Дата", "Расход"]}>
                        {page.items.map((o) => (
                          <tr key={o.orderId}>
                            <td>
                              <Link to={`/orders/${o.orderId}`}>
                                {o.number}
                              </Link>
                            </td>
                            <td>{dateTime(o.createdAt)}</td>
                            <td>
                              {displayQuantity(o.usedFromBatchQuantity)}{" "}
                              {units[o.unit]}
                            </td>
                          </tr>
                        ))}
                      </Table>
                      <Pager
                        page={page}
                        onChange={(key, value) => {
                          if (key === "page") setOrdersPage(value);
                          else if (key === "pageSize") {
                            setOrdersSize(value);
                            setOrdersPage("1");
                          }
                        }}
                      />
                    </>
                  )}
                </QueryState>
              </section>
            )}
          </>
        )}
      </QueryState>
    </>
  );
}
