import { useState } from "react";
import type { RiskReport, StopForecast } from "@rims/demo-api/contracts";
import type { Ingredient } from "../shared/api/types";
import { useDirectory, useResource } from "../shared/api/queries";
import { ScopedLink as Link } from "../shared/lib/routing";
import { dateTime } from "../shared/lib/time";
import { displayQuantity, units } from "../shared/lib/decimal";
import {
  Heading,
  QueryState,
  Field,
  Table,
  Pager,
  Empty,
  useFilters,
  ResetFilters,
  s,
} from "../shared/ui";

const forecastStatus: Record<StopForecast["items"][number]["status"], string> =
  {
    already_stopped: "Уже в стоп-листе",
    predicted: "Ожидается остановка",
    not_reached_within_horizon: "В пределах горизонта не достигнут",
    insufficient_history: "Недостаточно истории",
    calculation_limited: "Достигнут предел расчёта",
  };
const confidence = {
  insufficient: "Недостаточно данных",
  low: "Низкая",
  medium: "Средняя",
};
const limitations: Record<string, string> = {
  insufficient_observation: "Мало наблюдений",
  unknown_competing_demand: "Неизвестен спрос на блюда с общими ингредиентами",
  recipe_changed_in_window: "Рецепт менялся в окне истории",
  event_cap: "Достигнут предел событий",
};
export function StopForecastPanel() {
  const [historyDays, setHistoryDays] = useState("14"),
    [horizonHours, setHorizonHours] = useState("48");
  const query = useResource<StopForecast>("stop-list/forecast", {
    historyDays,
    horizonHours,
  });
  return (
    <section className={s.panel}>
      <h2>Прогноз стоп-листа</h2>
      <div className={s.toolbar}>
        <Field label="История">
          <select
            value={historyDays}
            onChange={(e) => setHistoryDays(e.target.value)}
          >
            {[7, 14, 28].map((n) => (
              <option key={n} value={n}>
                {n} дней
              </option>
            ))}
          </select>
        </Field>
        <Field label="Горизонт">
          <select
            value={horizonHours}
            onChange={(e) => setHorizonHours(e.target.value)}
          >
            {[6, 12, 24, 48].map((n) => (
              <option key={n} value={n}>
                {n} часов
              </option>
            ))}
          </select>
        </Field>
      </div>
      <QueryState query={query}>
        {(data) => (
          <>
            <p>
              Снимок: {dateTime(data.asOf)}. Рассчитано до:{" "}
              {dateTime(data.calculatedThrough)}.
            </p>
            <p>
              {data.datasetKind === "demo_seeded"
                ? "Синтетический демонстрационный набор"
                : "Наблюдаемые заказы этого склада"}
              . Заказов: {data.history.completedOrders}; полных дней наблюдения:{" "}
              {data.history.observedFullDays}.
            </p>
            {data.items.length ? (
              <Table
                headers={[
                  "Блюдо",
                  "Результат",
                  "Окно · Москва",
                  "Продано / темп в час",
                  "Оценка истории",
                  "Ограничения",
                ]}
              >
                {data.items.map((d) => (
                  <tr key={d.dishId}>
                    <td>{d.dishName}</td>
                    <td>{forecastStatus[d.status]}</td>
                    <td>
                      {d.estimatedWindow
                        ? `${dateTime(d.estimatedWindow.from)} — ${dateTime(d.estimatedWindow.to)}`
                        : "—"}
                    </td>
                    <td>
                      {d.observedPortions} /{" "}
                      {d.portionsPerCalendarHour?.toFixed(2) ?? "—"}
                    </td>
                    <td>{confidence[d.confidence]}</td>
                    <td>
                      {d.limitations.map((l) => limitations[l] ?? l).join("; ")}
                      {d.limitingIngredients.length > 0 && (
                        <p>
                          {d.limitingIngredients
                            .map((i) => i.ingredientName)
                            .join(", ")}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>Активных блюд нет.</Empty>
            )}
            <details>
              <summary>Как рассчитан прогноз</summary>
              <ul>
                {data.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <p>
                Средний спрос и текущий склад дают оценку, а не гарантию
                наличия. Текущий стоп-лист определяется фактическим остатком.
              </p>
            </details>
          </>
        )}
      </QueryState>
    </section>
  );
}
const localDate = (n: number) => {
  const d = new Date(n);
  return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function RiskInventory() {
  const [initial] = useState(() => ({
    from: localDate(Date.now() - 7 * 86400000),
    to: localDate(Date.now() - 60000),
  }));
  const { params, update } = useFilters([
    "view",
    "cohortEntry",
    "from",
    "to",
    "ingredientId",
    "batchId",
  ]);
  const view = params.view || "period",
    from = params.from || initial.from,
    to = params.to || initial.to;
  const datesValid =
    Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to));
  const query = useResource<RiskReport>(
    "analytics/risk-inventory",
    {
      ...params,
      view,
      from: datesValid ? new Date(from).toISOString() : "",
      to: datesValid ? new Date(to).toISOString() : "",
      cohortEntry: view === "cohort" ? params.cohortEntry || "dated" : "",
    },
    datesValid,
  );
  const ingredients = useDirectory<Ingredient>("ingredients");
  return (
    <>
      <Heading title="Рискованные партии" />
      <div className={s.toolbar}>
        <Field label="Режим">
          <select value={view} onChange={(e) => update("view", e.target.value)}>
            <option value="period">Движения за период</option>
            <option value="cohort">Судьба когорты</option>
          </select>
        </Field>
        {view === "cohort" && (
          <Field label="Дата входа">
            <select
              value={params.cohortEntry || "dated"}
              onChange={(e) => update("cohortEntry", e.target.value)}
            >
              <option value="dated">Известна</option>
              <option value="unknown">Неизвестна</option>
            </select>
          </Field>
        )}
        <Field label="С">
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => update("from", e.target.value)}
          />
        </Field>
        <Field label="До (не включительно)">
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => update("to", e.target.value)}
          />
        </Field>
        <Field label="Ингредиент">
          <select
            value={params.ingredientId || ""}
            onChange={(e) => update("ingredientId", e.target.value)}
          >
            <option value="">Все</option>
            {ingredients.data?.data.map((i) => (
              <option value={i.id} key={i.id}>
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
        {(data) => (
          <>
            <section className={s.panel}>
              <p>
                Риск — последние 10% сохранённого срока годности партии. Учёт
                начат {dateTime(data.trackingStartedAt)}.
              </p>
              <p>
                Сейчас: {dateTime(data.asOf)}.{" "}
                {data.completeness === "complete"
                  ? "Полная история"
                  : "Неполная история: неизвестные значения показаны прочерком"}
                .
              </p>
              {view === "cohort" && (
                <>
                  <p>
                    Период выбирает дату входа в риск. Судьба партии показана до
                    текущего снимка, включая физический остаток после истечения.
                  </p>
                  <Link to={`/risk-inventory?view=cohort&cohortEntry=unknown`}>
                    Дата входа неизвестна: {data.unknownEntryBatchCount} партий
                  </Link>
                </>
              )}
              {data.cohortEntry === "unknown" && (
                <p className={s.notice}>
                  Период не отбирает эти партии. Известные движения показаны с
                  начала надёжного журнала до текущего снимка.
                </p>
              )}
            </section>
            {data.items.length ? (
              <Table
                headers={[
                  "Партия / поставка",
                  "Вход в риск",
                  "Использовано при истекающем сроке",
                  "Прочий / неизвестный расход",
                  "Списано: просрочено / повреждено",
                  "Сейчас: физически / карантин / просрочено",
                  ...(view === "cohort"
                    ? [
                        "Входной объём / использовано / списано",
                        "Доля использования",
                      ]
                    : []),
                  "История",
                ]}
              >
                {data.items.map((r) => (
                  <tr key={r.batchId}>
                    <td>
                      <Link to={`/movements?batchId=${r.batchId}`}>
                        {r.ingredientName} · {r.batchId}
                      </Link>
                      <p>
                        {r.deliveryNumber} · {units[r.unit]}
                      </p>
                    </td>
                    <td>{dateTime(r.cohortAt)}</td>
                    <td>{displayQuantity(r.usedExpiringQuantity)}</td>
                    <td>
                      {displayQuantity(r.usedFreshQuantity)} /{" "}
                      {displayQuantity(r.unknownRiskOrderQuantity)}
                    </td>
                    <td>
                      {displayQuantity(r.writtenOffExpiredQuantity)} /{" "}
                      {displayQuantity(r.writtenOffDamagedQuantity)}
                    </td>
                    <td>
                      {displayQuantity(r.remainingPhysicalAsOf)} /{" "}
                      {displayQuantity(r.heldAsOf)} /{" "}
                      {displayQuantity(r.expiredAsOf)}
                    </td>
                    {view === "cohort" && (
                      <>
                        <td>
                          {r.riskAtEntry === null
                            ? "—"
                            : displayQuantity(r.riskAtEntry)}{" "}
                          /{" "}
                          {r.usedInOrdersAfterEntry === null
                            ? "—"
                            : displayQuantity(r.usedInOrdersAfterEntry)}{" "}
                          /{" "}
                          {r.writtenOffAfterEntry === null
                            ? "—"
                            : displayQuantity(r.writtenOffAfterEntry)}
                        </td>
                        <td>
                          {r.usedFraction === null
                            ? "—"
                            : `${(r.usedFraction * 100).toFixed(1)}%`}
                        </td>
                      </>
                    )}
                    <td>
                      {r.completeness === "complete" ? "Полная" : "Неполная"}
                      <p>{r.limitations.join(" ")}</p>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>В выбранной выборке нет партий.</Empty>
            )}
            <Pager page={data} onChange={update} />
            <section className={s.panel}>
              <h2>Итоги всей выборки по ингредиентам</h2>
              <Table
                headers={[
                  "Ингредиент",
                  "Использовано при истекающем сроке",
                  "Прочий / неизвестный расход",
                  "Списано: просрочено / повреждено",
                ]}
              >
                {data.totalsByIngredient.map((t) => (
                  <tr key={t.ingredientId}>
                    <td>
                      {t.ingredientName} · {units[t.unit]}
                    </td>
                    <td>{displayQuantity(t.usedExpiringQuantity)}</td>
                    <td>
                      {displayQuantity(t.usedFreshQuantity)} /{" "}
                      {displayQuantity(t.unknownRiskOrderQuantity)}
                    </td>
                    <td>
                      {displayQuantity(t.writtenOffExpiredQuantity)} /{" "}
                      {displayQuantity(t.writtenOffDamagedQuantity)}
                    </td>
                  </tr>
                ))}
              </Table>
            </section>
          </>
        )}
      </QueryState>
    </>
  );
}
