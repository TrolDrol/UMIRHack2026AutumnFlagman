import { QuarantineOpenDialog } from "./Quarantines";
import { useWorkspace, management } from "../app/workspace";
import { ScopedLink as Link } from "../shared/lib/routing";
import { ActionLink, ActionButton } from "../shared/ui";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  Batch,
  InventoryRow,
  Page,
  Ingredient,
} from "../shared/api/types";
import { useDirectory, useResource } from "../shared/api/queries";
import {
  Footnote,
  FootnoteMarker,
  Heading,
  QueryState,
  Table,
  Search,
  Pager,
  Empty,
  Status,
  Field,
  Modal,
  ResetFilters,
  useFilters,
  s,
} from "../shared/ui";
import { dateTime, remainingLabel } from "../shared/lib/time";
import { displayQuantity, thousandths, units } from "../shared/lib/decimal";
import { WriteOffDialog } from "../features/writeOffs/WriteOffDialog";
export function Inventory() {
  const { params, update } = useFilters(["q", "lowStock"]);
  const query = useResource<Page<InventoryRow>>("inventory", params);
  return (
    <>
      <Heading
        title="Остатки на складе"
        action={
          <ActionLink className={s.action} to="/deliveries/new">
            Принять поставку
          </ActionLink>
        }
      />

      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <Field label="Только дефицит">
          <input
            type="checkbox"
            checked={params.lowStock === "true"}
            onChange={(e) => update("lowStock", e.target.checked ? "true" : "")}
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
                  "Ингредиент",
                  "Физически",
                  "Доступно",
                  "На карантине",
                  "Истекает",
                  "Просрочено",
                  "Ближайший срок · Москва",
                  "Состояние",
                ]}
              >
                {page.items.map((x) => (
                  <tr key={x.ingredientId}>
                    <td>
                      <Link to={`/inventory/${x.ingredientId}`}>
                        {x.ingredientName}
                      </Link>
                      <br />
                      <small>{units[x.unit]}</small>
                    </td>
                    {[
                      x.physicalQuantity,
                      x.availableQuantity,
                      x.heldQuantity ?? "0.000",
                      x.expiringQuantity,
                      x.expiredQuantity,
                    ].map((n, i) => (
                      <td key={i} data-sort-value={n}>
                        {displayQuantity(n)} {units[x.unit]}
                      </td>
                    ))}
                    <td data-sort-value={x.nearestExpiresAt || ""}>
                      {dateTime(x.nearestExpiresAt)}
                    </td>
                    <td>
                      {x.isLowStock ? (
                        <span className={s.badge} data-tone="warning">
                          ⚠ Дефицит
                          <FootnoteMarker id="inventory-note" />
                        </span>
                      ) : (
                        "Достаточно"
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>
                Нет ингредиентов по выбранным фильтрам.{" "}
                <Link to="/ingredients">Открыть справочник</Link>
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <Footnote id="inventory-note">
        Карантин входит в физический остаток и недоступен для заказа.
        Просроченный карантин также входит в просроченный остаток: эти категории
        пересекаются, их нельзя складывать. Просроченные продукты физически
        остаются на складе до ручного списания, но недоступны для заказа.
        Дефицит означает, что доступный остаток ниже заданного порога.
      </Footnote>
    </>
  );
}
export function Batches() {
  const context = useWorkspace();
  const { ingredientId } = useParams();
  const { params, update } = useFilters(["status", "includeEmpty"]);
  const query = useResource<Page<Batch>>("batches", {
    ...params,
    ...(ingredientId ? { ingredientId } : {}),
  });
  const ingredients = useDirectory<Ingredient>("ingredients");
  const [holdBatch, setHoldBatch] = useState<Batch | null>(null);
  const [selected, setSelected] = useState<Batch | null>(null);
  const [detail, setDetail] = useState<Batch | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const boundaryRequested = useRef(0);
  useEffect(() => {
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [query.dataUpdatedAt]);
  useEffect(() => {
    if (
      boundaryRequested.current !== query.dataUpdatedAt &&
      document.visibilityState === "visible" &&
      navigator.onLine &&
      query.data?.data.items.some(
        (x) =>
          x.remainingSeconds > 0 &&
          x.remainingSeconds <= elapsed &&
          x.status !== "empty",
      )
    ) {
      boundaryRequested.current = query.dataUpdatedAt;
      void query.refetch();
    }
  }, [elapsed, query]);
  const updatedSelected = selected
    ? query.data?.data.items.find((x) => x.id === selected.id) || selected
    : null;
  return (
    <>
      <Heading
        title={
          ingredientId
            ? `Партии: ${ingredients.data?.data.find((x) => x.id === ingredientId)?.name || "ингредиент"}`
            : "Партии продуктов"
        }
        action={
          <ActionLink className={s.action} to="/deliveries/new">
            Принять поставку
          </ActionLink>
        }
      />
      {ingredientId && (
        <Link to={`/movements?ingredientId=${ingredientId}`}>
          История движений ингредиента
        </Link>
      )}
      <div className={s.toolbar}>
        <Field label="Статус партии">
          <select
            value={params.status || ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Все непустые</option>
            <option value="fresh">Свежие</option>
            <option value="expiring">Скоро истекают</option>
            <option value="expired">Просроченные</option>
            <option value="empty">Пустые</option>
          </select>
        </Field>
        <Field label="Включить пустые">
          <input
            type="checkbox"
            checked={
              params.includeEmpty === "true" || params.status === "empty"
            }
            disabled={params.status === "empty"}
            onChange={(e) =>
              update("includeEmpty", e.target.checked ? "true" : "")
            }
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
                  "Ингредиент / партия",
                  "Поставка",
                  "Приёмка / изготовление · Москва",
                  "Срок · Москва",
                  "Начальное / остаток",
                  "Доступно / карантин",
                  "Статус",
                  "Действия",
                ]}
              >
                {page.items.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link to={`/inventory/${x.ingredientId}`}>
                        {x.ingredientName}
                      </Link>
                      <br />
                      <code>{x.id}</code>{" "}
                      <ActionButton
                        title={`Открыть сведения о партии ${x.id}`}
                        onClick={() => setDetail(x)}
                      >
                        Партия {x.id}
                      </ActionButton>
                    </td>
                    <td>
                      <Link to={`/deliveries/${x.deliveryId}`}>
                        {x.deliveryNumber}
                      </Link>
                    </td>
                    <td data-sort-value={x.receivedAt || ""}>
                      {dateTime(x.receivedAt)}
                      <br />
                      <small>
                        Изготовлено: {dateTime(x.manufacturedAt)}
                        {x.shelfLifeHours !== null &&
                          ` · ${x.shelfLifeHours} ч`}
                      </small>
                    </td>
                    <td data-sort-value={x.expiresAt || ""}>
                      {dateTime(x.expiresAt)}
                      <br />
                      <small>
                        {x.status !== "empty" &&
                          remainingLabel(x.remainingSeconds - elapsed)}
                      </small>
                    </td>
                    <td data-sort-value={x.initialQuantity}>
                      {displayQuantity(x.initialQuantity)} /{" "}
                      {displayQuantity(x.remainingQuantity)} {units[x.unit]}
                    </td>
                    <td>
                      {displayQuantity(x.availableQuantity ?? "0.000")} /{" "}
                      {displayQuantity(x.heldQuantity ?? "0.000")}{" "}
                      {units[x.unit]}
                    </td>
                    <td>
                      <Status value={x.status} />
                    </td>
                    <td>
                      <div className={s.actions}>
                        <ActionLink to={`/movements?batchId=${x.id}`}>
                          Движения
                        </ActionLink>

                        <ActionLink
                          icon="copy"
                          to={`/deliveries/new?copy=${x.deliveryId}&batch=${x.id}`}
                          aria-label={`Создать копию партии ${x.id}`}
                        />
                        <ActionButton
                          icon="disable"
                          title="Удержать часть партии"
                          disabled={
                            thousandths(x.remainingQuantity) <=
                            thousandths(x.heldQuantity ?? "0.000")
                          }
                          onClick={() => setHoldBatch(x)}
                        />
                        {management(context.role) && (
                          <ActionButton
                            disabled={thousandths(x.remainingQuantity) === 0n}
                            onClick={() => setSelected(x)}
                          >
                            Списать
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>
                Партии не найдены. Измените фильтр или примите поставку.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      {holdBatch && (
        <QuarantineOpenDialog
          batch={
            query.data?.data.items.find((b) => b.id === holdBatch.id) ??
            holdBatch
          }
          onClose={() => setHoldBatch(null)}
        />
      )}
      {updatedSelected && (
        <WriteOffDialog
          batch={updatedSelected}
          onClose={() => setSelected(null)}
        />
      )}{" "}
      {detail && (
        <Modal title="Сведения о партии" onClose={() => setDetail(null)}>
          <p>
            <code>{detail.id}</code>
          </p>
          <p>
            {detail.ingredientName} · {units[detail.unit]}
          </p>
          <p>
            Поставка:{" "}
            <Link to={`/deliveries/${detail.deliveryId}`}>
              {detail.deliveryNumber}
            </Link>
          </p>
          <p>Приёмка: {dateTime(detail.receivedAt)} · Москва</p>
          <p>Изготовлено: {dateTime(detail.manufacturedAt)} · Москва</p>
          <p>Срок: {dateTime(detail.expiresAt)} · Москва</p>
          <p>
            Начальное количество: {displayQuantity(detail.initialQuantity)}{" "}
            {units[detail.unit]}
          </p>
          <p>
            Остаток: {displayQuantity(detail.remainingQuantity)}{" "}
            {units[detail.unit]}
          </p>
          <p>
            Доступно: {displayQuantity(detail.availableQuantity)} · На
            карантине: {displayQuantity(detail.heldQuantity)} · из них
            просрочено: {displayQuantity(detail.heldExpiredQuantity)}{" "}
            {units[detail.unit]}
          </p>
          <Link to={`/quarantines?batchId=${detail.id}`}>
            Карантины этой партии
          </Link>
          <Status value={detail.status} />
        </Modal>
      )}
    </>
  );
}
