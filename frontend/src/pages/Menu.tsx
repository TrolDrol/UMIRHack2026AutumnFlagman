import { ManualOffers } from "./ManualOffers";
import { useState } from "react";
import { CustomerPublication } from "./CustomerPublication";
import { StopForecastPanel } from "./ExtensionAnalytics";
import { useWorkspace, management } from "../app/workspace";
import { useScopedNavigate as useNavigate } from "../shared/lib/routing";
import { ScopedLink as Link } from "../shared/lib/routing";
import { StopList } from "./StopList";
import { ActionLink, ActionButton } from "../shared/ui";

import type {
  DishAvailability,
  Page,
  OfferCard,
  PurchaseSuggestion,
  Dish,
} from "../shared/api/types";
import {
  useResource,
  useDirectory,
  useLiveCollection,
} from "../shared/api/queries";
import {
  Footnote,
  FootnoteMarker,
  Heading,
  QueryState,
  Search,
  Pager,
  Empty,
  ResetFilters,
  useFilters,
  s,
} from "../shared/ui";
import { dateTime } from "../shared/lib/time";
import { displayQuantity, units } from "../shared/lib/decimal";
export function Menu({ stop = false }: { stop?: boolean }) {
  const role = useWorkspace().role;
  const [tab, setTab] = useState(role === "warehouse" ? "forecast" : "current");
  return stop ? (
    <>
      <div className={s.toolbar} role="tablist">
        <button
          role="tab"
          aria-selected={tab === "current"}
          disabled={role === "warehouse"}
          onClick={() => setTab("current")}
        >
          Стоп-лист
        </button>
        <button
          role="tab"
          aria-selected={tab === "forecast"}
          onClick={() => setTab("forecast")}
        >
          Прогноз
        </button>
      </div>
      {tab === "forecast" ? <StopForecastPanel /> : <StopList />}
    </>
  ) : (
    <>
      <CustomerPublication />
      <MenuAvailability />
    </>
  );
}
function MenuAvailability() {
  const { params, update } = useFilters(["q"]);
  const query = useLiveCollection<DishAvailability>("menu/availability");
  const filtered = (query.data?.data || []).filter(
    (dish) =>
      dish.status === "available" &&
      dish.dishName
        .toLocaleLowerCase("ru")
        .includes((params.q || "").trim().toLocaleLowerCase("ru")),
  );
  const size = Number(params.pageSize || 50);
  const number = Math.min(
    Math.max(1, Number(params.page || 1)),
    Math.max(1, Math.ceil(filtered.length / size)),
  );
  const page: Page<DishAvailability> = {
    items: filtered.slice((number - 1) * size, number * size),
    total: filtered.length,
    page: number,
    pageSize: size,
  };
  return (
    <>
      <Heading
        title="Доступность меню"
        action={
          <ActionLink to="/orders/new" className={s.action}>
            Создать заказ
          </ActionLink>
        }
      >
        <Link className={s.sectionLink} to="/combos">
          Комбо →
        </Link>
        <Link className={s.sectionLink} to="/stop-list">
          Недоступные позиции →
        </Link>
      </Heading>
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <ResetFilters />
      </div>
      <QueryState query={query}>
        {() => (
          <>
            {page.items.length ? (
              <div className={s.menuCards}>
                {page.items.map((x) => (
                  <article
                    className={`${s.panel} ${s.menuCard}`}
                    key={x.dishId}
                  >
                    <h2>{x.dishName}</h2>
                    <p>До {x.maxPortions} порций</p>
                    <div className={s.menuActions}>
                      <ActionLink
                        className={s.action}
                        to="/orders/new"
                        state={{ dishId: x.dishId, portions: 1 }}
                      >
                        Добавить в заказ
                      </ActionLink>
                      <ActionLink
                        title={`Редактировать блюдо «${x.dishName}»`}
                        to={`/dishes/${x.dishId}/edit`}
                      >
                        Рецептура
                      </ActionLink>
                      <ActionLink
                        icon="copy"
                        to={`/dishes/new?copy=${x.dishId}`}
                        aria-label={`Создать копию блюда «${x.dishName}»`}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                Доступные блюда не найдены. Проверьте стоп-лист или измените
                поиск.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
export function Recommendations() {
  const { params, update } = useFilters(["q", "kind"]);
  const query = useResource<Page<OfferCard>>("offers", params);
  return (
    <>
      <Heading
        title="Горячие предложения"
        action={
          <ActionLink className={s.action} to="/orders/new">
            Открыть корзину
          </ActionLink>
        }
      />

      <ManualOffers />
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <select
          aria-label="Вид предложения"
          value={params.kind || "all"}
          onChange={(e) => update("kind", e.target.value)}
        >
          <option value="all">Все</option>
          <option value="automatic">Автоматические</option>
          <option value="manual">Ручные</option>
        </select>
      </div>
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <div className={s.cards}>
                {page.items.map((x) => (
                  <article className={s.panel} key={x.dishId}>
                    {x.automatic && (
                      <span className={s.badge}>
                        Приоритет {x.automatic.score} из 100
                        <FootnoteMarker id="offers-note" />
                      </span>
                    )}
                    {x.manual && (
                      <div>
                        <span className={s.badge}>Ручное предложение</span>
                        <h3>{x.manual.title}</h3>
                        <p>{x.manual.publicText}</p>
                        <p>
                          {dateTime(x.manual.startsAt)} —{" "}
                          {dateTime(x.manual.endsAt)} · Москва
                        </p>
                      </div>
                    )}
                    <h2>{x.dishName}</h2>
                    <p>
                      <strong>{x.suggestedPortions} порций</strong> · максимум{" "}
                      {x.maxPortions}
                    </p>
                    <p>{x.automatic?.explanation}</p>
                    {x.automatic && (
                      <p className={s.muted}>
                        Ближайший срок:{" "}
                        {dateTime(x.automatic.earliestExpiresAt)} · Москва
                      </p>
                    )}
                    {x.automatic && (
                      <details>
                        <summary>Почему это предложение</summary>
                        {x.automatic.reasons.map((r) => (
                          <div className={s.line} key={r.ingredientId}>
                            <Link to={`/inventory/${r.ingredientId}`}>
                              {r.ingredientName}
                            </Link>
                            <p>
                              Пригодный истекающий запас:{" "}
                              {displayQuantity(r.usableExpiringQuantity)}{" "}
                              {units[r.unit]}
                              <br />
                              План использования:{" "}
                              {displayQuantity(r.plannedUsage)} {units[r.unit]}
                              <br />
                              Срок: {dateTime(r.earliestExpiresAt)} · Москва
                            </p>
                            <p>Использованные партии:</p>
                            {r.batchIds.map((id) => (
                              <div key={id}>
                                <Link
                                  to={`/inventory/${r.ingredientId}?includeEmpty=true`}
                                >
                                  <code>{id}</code>
                                </Link>
                              </div>
                            ))}
                          </div>
                        ))}
                      </details>
                    )}
                    <ActionLink
                      className={s.action}
                      to="/orders/new"
                      state={{
                        dishId: x.dishId,
                        portions: x.suggestedPortions,
                      }}
                    >
                      Добавить {x.suggestedPortions} порций в заказ
                    </ActionLink>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                Нет действующих доступных предложений. Проверьте меню и склад.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <Footnote id="offers-note">
        Варианты используют общие ингредиенты. После заказа список
        пересчитается.
      </Footnote>
    </>
  );
}
export function Purchases() {
  const context = useWorkspace();
  const { params, update } = useFilters([]);
  const query = useLiveCollection<PurchaseSuggestion>("purchase-suggestions");
  const navigate = useNavigate();
  const all = query.data?.data || [];
  const size = Number(params.pageSize || 50);
  const number = Math.min(
    Math.max(1, Number(params.page || 1)),
    Math.max(1, Math.ceil(all.length / size)),
  );
  const page: Page<PurchaseSuggestion> = {
    items: all.slice((number - 1) * size, number * size),
    total: all.length,
    page: number,
    pageSize: size,
  };
  const receive = (items: PurchaseSuggestion[]) =>
    navigate("/deliveries/new", {
      state: {
        draftKey: `delivery.purchase.${crypto.randomUUID()}`,
        note: "Рекомендуемая закупка",
        lines: items.map((item) => ({
          ingredientId: item.ingredientId,
          quantity: item.suggestedQuantity,
        })),
      },
    });
  const dishes = useDirectory<Dish>("dishes", management(context.role));
  const reasons = {
    below_minimum: "Ниже минимума",
    expiring_stock: "Запас скоро истечёт",
    stopped_dish: "Ингредиента не хватает для блюда",
  };
  return (
    <>
      <Heading
        title="Предложения закупок"
        action={
          <ActionButton
            showLabel
            icon="delivery"
            disabled={!query.data || query.isFetching || !all.length}
            onClick={() => receive(all)}
          >
            Создать входящую поставку по рекомендациям
          </ActionButton>
        }
      />
      {management(context.role) && (
        <>
          <ActionLink to="/purchase-requests">Заказать у поставщика</ActionLink>
          <p className={s.muted}>
            Для отправки заказа используйте заявки поставщикам. Входящая
            поставка оформляет приёмку и сама поставщику не отправляется.
          </p>
        </>
      )}

      <QueryState query={query}>
        {() => (
          <>
            {page.items.length ? (
              <div className={s.cards}>
                {page.items.map((x) => (
                  <article className={s.panel} key={x.ingredientId}>
                    <h2>{x.ingredientName}</h2>
                    <p>
                      <strong>
                        Закупить {displayQuantity(x.suggestedQuantity)}{" "}
                        {units[x.unit]}
                        <FootnoteMarker id="purchases-note" />
                      </strong>
                    </p>
                    <p>
                      Доступно: {displayQuantity(x.availableQuantity)}{" "}
                      {units[x.unit]}
                      <br />
                      Истекает: {displayQuantity(x.expiringQuantity)}{" "}
                      {units[x.unit]}
                      <br />
                      Плановый остаток: {displayQuantity(
                        x.planningQuantity,
                      )}{" "}
                      {units[x.unit]}
                      <br />
                      Порог: {displayQuantity(x.reorderPoint)} {units[x.unit]}
                      <br />
                      Целевой запас: {displayQuantity(x.targetStock)}{" "}
                      {units[x.unit]}
                      <br />
                      Цель расчёта: {displayQuantity(x.targetQuantity)}{" "}
                      {units[x.unit]}
                    </p>
                    <ul>
                      {x.reasons.map((r) => (
                        <li key={r}>{reasons[r]}</li>
                      ))}
                    </ul>
                    {management(context.role) &&
                      x.affectedDishIds.length > 0 && (
                        <p>
                          Связанные блюда:{" "}
                          {x.affectedDishIds.map((id) => (
                            <Link key={id} to={`/dishes/${id}/edit`}>
                              {dishes.data?.data.find((d) => d.id === id)
                                ?.name || id}{" "}
                            </Link>
                          ))}
                        </p>
                      )}
                    <ActionButton
                      className={s.action}
                      onClick={() => receive([x])}
                    >
                      Перейти к приёмке
                    </ActionButton>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                Сейчас пополнение по серверному расчёту не требуется.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <Footnote id="purchases-note">
        Запас в последних 10% срока хранения исключён из планового остатка.
        Будущие продажи могут изменить расчёт. Это рекомендация количества в
        базовой единице.
      </Footnote>
    </>
  );
}
