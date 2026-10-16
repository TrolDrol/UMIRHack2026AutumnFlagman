import { ScopedLink as Link } from "../shared/lib/routing";
import { ActionLink, ActionButton } from "../shared/ui";
import { useState } from "react";
import { useParams } from "react-router-dom";
import type {
  Delivery,
  Order,
  Page,
  Movement,
  Ingredient,
  Batch,
} from "../shared/api/types";
import { useApi, useDirectory, useResource } from "../shared/api/queries";
import { WriteOffDialog } from "../features/writeOffs/WriteOffDialog";
import { DeliveryDecision } from "../features/deliveries/DeliveryDecision";
import { management, useWorkspace } from "../app/workspace";
import {
  Heading,
  ErrorNotice,
  QueryState,
  Table,
  Pager,
  Empty,
  Status,
  Allocations,
  Field,
  CopyUuid,
  ResetFilters,
  useFilters,
  s,
} from "../shared/ui";
import { dateTime } from "../shared/lib/time";
import { displayQuantity, units } from "../shared/lib/decimal";
export function Documents({ kind }: { kind: "orders" | "deliveries" }) {
  const context = useWorkspace();
  const { params, update } = useFilters(
    kind === "deliveries" ? ["status"] : [],
  );
  const query = useResource<Page<Order | Delivery>>(kind, params);
  return (
    <>
      <Heading
        title={kind === "orders" ? "История заказов" : "Входящие поставки"}
        action={
          <ActionLink showLabel to={`/${kind}/new`}>
            {kind === "orders" ? "Создать заказ" : "Создать входящую поставку"}
          </ActionLink>
        }
      />
      {kind === "deliveries" && management(context.role) && (
        <p>
          Здесь регистрируются входящие поставки и их приёмка. Чтобы заказать
          ингредиенты у поставщика,{" "}
          <Link to="/purchase-requests">
            создайте и отправьте заявку поставщику
          </Link>
          .
        </p>
      )}
      <div className={s.toolbar}>
        {kind === "deliveries" && (
          <Field label="Статус поставки">
            <select
              value={params.status || ""}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="pending">Ожидают приёмки</option>
              <option value="confirmed">Подтверждённые</option>
              <option value="rejected">Отклонённые</option>
            </select>
          </Field>
        )}
        <ResetFilters />
      </div>
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <Table
                headers={[
                  "Документ",
                  "Создан · Москва",
                  "Статус",
                  "Источник",
                  "Ожидание / приёмка · Москва",
                  "Действия",
                ]}
              >
                {page.items.map((x) => (
                  <tr key={x.id}>
                    <td>{x.number}</td>
                    <td data-sort-value={x.createdAt}>
                      {dateTime(x.createdAt)}
                    </td>
                    <td>
                      <Status value={x.status} />
                    </td>
                    <td>
                      {x.source === "integration"
                        ? "Интеграция"
                        : x.source === "manual"
                          ? "Ручная"
                          : x.source === "customer"
                            ? "Покупатель"
                            : x.source === "waiter"
                              ? "Официант"
                              : "Сотрудник"}
                    </td>
                    <td>
                      {"batches" in x ? (
                        <>
                          {dateTime(x.expectedAt)} / {dateTime(x.receivedAt)}
                        </>
                      ) : (
                        `${x.lines.length} блюд`
                      )}
                    </td>
                    <td>
                      <div className={s.actions}>
                        <ActionLink to={`/${kind}/${x.id}`}>
                          Открыть {x.number}
                        </ActionLink>
                        <ActionLink
                          icon="copy"
                          to={`/${kind}/new?copy=${x.id}`}
                          aria-label={`${kind === "orders" ? "Повторить заказ" : "Создать копию поставки"} ${x.number}`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>Документов по выбранному фильтру нет.</Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
export function DocumentDetail({ kind }: { kind: "orders" | "deliveries" }) {
  const { id } = useParams();
  const query = useResource<Order | Delivery>(`${kind}/${id}`);
  return (
    <>
      <Heading
        title={
          kind === "orders" ? "Подробности заказа" : "Подробности поставки"
        }
        action={<ActionLink to={`/${kind}`}>К истории</ActionLink>}
      />
      <QueryState query={query}>
        {(x) => (
          <>
            <section className={s.panel}>
              <div className={s.row}>
                <h2>{x.number}</h2>
                <ActionLink
                  icon="copy"
                  to={`/${kind}/new?copy=${x.id}`}
                  aria-label={`${kind === "orders" ? "Повторить заказ" : "Создать копию поставки"} ${x.number}`}
                />
              </div>
              <p className={s.muted}>
                Создан: {dateTime(x.createdAt)} · Москва · <code>{x.id}</code>
              </p>
              <Status value={x.status} />
              {"batches" in x ? (
                <>
                  <p>
                    Источник:{" "}
                    {x.source === "integration"
                      ? "Внешняя интеграция"
                      : "Ручной документ"}
                    {x.externalId && ` · ${x.externalId}`}
                  </p>
                  <p>
                    Ожидаемая доставка: {dateTime(x.expectedAt)} · Фактическая
                    приёмка: {dateTime(x.receivedAt)} · Москва
                  </p>
                  {x.note && <p>{x.note}</p>}
                  {x.status === "pending" && (
                    <p className={s.notice}>
                      Документ ожидает решения. Партии ещё не созданы, запасы не
                      увеличены.
                    </p>
                  )}
                  {x.rejectionReason && (
                    <p>
                      Причина отклонения: {x.rejectionReason} ·{" "}
                      {dateTime(x.rejectedAt)}
                    </p>
                  )}
                  <h3>Состав входящего документа</h3>
                  <Table
                    headers={[
                      "Ингредиент",
                      "Количество",
                      "Изготовлено · Москва",
                      "Срок хранения",
                      "Истекает · Москва",
                    ]}
                  >
                    {x.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.ingredientName}</td>
                        <td data-sort-value={line.quantity}>
                          {displayQuantity(line.quantity)} {units[line.unit]}
                        </td>
                        <td>{dateTime(line.manufacturedAt)}</td>
                        <td>{line.shelfLifeHours} ч</td>
                        <td>{dateTime(line.expiresAt)}</td>
                      </tr>
                    ))}
                  </Table>
                  {x.status === "confirmed" && (
                    <>
                      <h3>Принятые складские партии</h3>
                      <Table
                        headers={[
                          "Ингредиент / партия",
                          "Истекает · Москва",
                          "Начальное / остаток",
                          "Статус",
                        ]}
                      >
                        {x.batches.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <Link to={`/inventory/${b.ingredientId}`}>
                                {b.ingredientName}
                              </Link>
                              <br />
                              <Link to={`/movements?batchId=${b.id}`}>
                                <code>{b.id}</code>
                              </Link>
                            </td>
                            <td>{dateTime(b.expiresAt)}</td>
                            <td>
                              {displayQuantity(b.initialQuantity)} /{" "}
                              {displayQuantity(b.remainingQuantity)}{" "}
                              {units[b.unit]}
                            </td>
                            <td>
                              <Status value={b.status} />
                            </td>
                          </tr>
                        ))}
                      </Table>
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3>Зафиксированные блюда</h3>
                  <Table headers={["Блюдо", "Порции"]}>
                    {x.lines.map((line) => (
                      <tr key={line.dishId}>
                        <td>{line.dishName}</td>
                        <td>{line.portions}</td>
                      </tr>
                    ))}
                  </Table>
                  <h3>Фактическое списание FEFO</h3>
                  <section className={s.panel}>
                    <h3>Исходный состав заказа</h3>
                    {(
                      x.composition ??
                      x.lines.map((l) => ({ kind: "dish" as const, ...l }))
                    ).map((c, i) => (
                      <p key={i}>
                        {c.kind === "dish"
                          ? `${c.dishName} ? ${c.portions}`
                          : `${c.title} ? ${c.quantity} ? v${c.version}: ${c.components.map((p) => p.dishName).join(" + ")}`}
                      </p>
                    ))}
                  </section>
                  <Allocations items={x.allocations} />
                </>
              )}
            </section>
            {"batches" in x && <DeliveryDecision delivery={x} />}
          </>
        )}
      </QueryState>
    </>
  );
}
export function Movements() {
  const { context, readCollection } = useApi();
  const [repeat, setRepeat] = useState<{
    batch: Batch;
    quantity: string;
    id: string;
  } | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { params, update } = useFilters(["ingredientId", "batchId", "type"]);
  const query = useResource<Page<Movement>>("movements", params);
  const ingredients = useDirectory<Ingredient>("ingredients");
  return (
    <>
      <Heading title="Движения продуктов" />
      <div className={s.toolbar}>
        <Field label="Ингредиент">
          <select
            value={params.ingredientId || ""}
            onChange={(e) => update("ingredientId", e.target.value)}
          >
            <option value="">Все ингредиенты</option>
            {ingredients.data?.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Партия (UUID)">
          <input
            value={params.batchId || ""}
            onChange={(e) => update("batchId", e.target.value)}
          />
        </Field>
        <Field label="Тип движения">
          <select
            value={params.type || ""}
            onChange={(e) => update("type", e.target.value)}
          >
            <option value="">Все типы</option>
            <option value="receipt">Приход</option>
            <option value="order">Заказ</option>
            <option value="quarantine_open">Удержание</option>
            <option value="quarantine_release">Освобождение</option>
            <option value="write_off">Ручное списание</option>
          </select>
        </Field>
        <ResetFilters />
      </div>
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <Table
                headers={[
                  "Время · Москва",
                  "Ингредиент",
                  "Партия",
                  "Операция",
                  "Изменение",
                  "Остаток после",
                  "Документ",
                  "Повторить",
                ]}
              >
                {page.items.map((x) => (
                  <tr key={x.id}>
                    <td data-sort-value={x.createdAt || ""}>
                      {dateTime(x.createdAt)}
                    </td>
                    <td>
                      <Link to={`/inventory/${x.ingredientId}`}>
                        {x.ingredientName}
                      </Link>
                    </td>
                    <td data-sort-value={x.batchId}>
                      <CopyUuid value={x.batchId} />{" "}
                      <ActionButton
                        icon="filter"
                        aria-label={`Фильтровать по партии ${x.batchId}`}
                        onClick={() => update("batchId", x.batchId)}
                      >
                        <code>{x.batchId}</code>
                      </ActionButton>
                    </td>
                    <td>
                      <Status value={x.type} />
                    </td>
                    <td data-sort-value={x.quantityDelta}>
                      {x.quantityDelta.startsWith("-") ? "" : "+"}
                      {displayQuantity(x.quantityDelta)} {units[x.unit]}
                    </td>
                    <td data-sort-value={x.remainingAfter}>
                      {displayQuantity(x.remainingAfter)} {units[x.unit]}
                    </td>
                    <td>
                      {x.quarantineId ? (
                        <Link to={`/quarantines/${x.quarantineId}`}>
                          Карантин {x.quarantineId.slice(0, 8)}...
                        </Link>
                      ) : x.type === "order" && !management(context.role) ? (
                        <span>{x.referenceNumber || "Заказ"}</span>
                      ) : x.type === "write_off" ? (
                        <>
                          <span>Списание</span>
                          <br />
                          <code>{x.referenceId}</code>
                        </>
                      ) : (
                        <Link
                          to={`/${x.type === "order" ? "orders" : "deliveries"}/${x.referenceId}`}
                        >
                          {x.referenceNumber || x.referenceId}
                        </Link>
                      )}
                    </td>
                    <td>
                      <div className={s.actions}>
                        {management(context.role) &&
                          ["receipt", "order", "write_off"].includes(x.type) &&
                          (x.type === "write_off" ? (
                            <ActionButton
                              icon="copy"
                              disabled={copying}
                              aria-label={`Повторить списание ${x.referenceId}`}
                              onClick={async () => {
                                setCopying(true);
                                setError(null);
                                try {
                                  const all = await readCollection<Batch>(
                                    "batches",
                                    {
                                      ingredientId: x.ingredientId,
                                      includeEmpty: "true",
                                    },
                                  );
                                  const batch = all.data.find(
                                    (item) => item.id === x.batchId,
                                  );
                                  if (!batch)
                                    throw new Error(
                                      "Исходная партия не найдена",
                                    );
                                  setRepeat({
                                    batch,
                                    quantity: x.quantityDelta.replace(/^-/, ""),
                                    id: x.id,
                                  });
                                } catch (e) {
                                  setError(e);
                                } finally {
                                  setCopying(false);
                                }
                              }}
                            />
                          ) : (
                            <ActionLink
                              icon="copy"
                              to={`/${x.type === "order" ? "orders" : "deliveries"}/new?copy=${x.referenceId}`}
                              aria-label={`${x.type === "order" ? "Повторить заказ" : "Создать копию поставки"} ${x.referenceNumber || x.referenceId}`}
                            />
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>Движений по выбранным фильтрам нет.</Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <ErrorNotice error={error} />
      {repeat && (
        <WriteOffDialog
          key={repeat.id}
          batch={repeat.batch}
          initialQuantity={repeat.quantity}
          copyId={repeat.id}
          onClose={() => setRepeat(null)}
        />
      )}
    </>
  );
}
