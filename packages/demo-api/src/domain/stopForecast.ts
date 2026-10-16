import type { Batch, Dish, Ingredient, Order } from "../shared/api/types";
import type { StopForecast } from "../shared/api/extensions";
import { stockPlan, decimal, free } from "./stock";
import { thousandths } from "../shared/lib/decimal";

export function forecast(
  snapshot: {
    ingredients: Ingredient[];
    dishes: Dish[];
    batches: Batch[];
    orders: Order[];
    observationStartedAt: string;
    datasetKind: "observed" | "demo_seeded";
    revision: number;
  },
  asOf: number,
  historyDays: number,
  horizonHours: number,
  eventCap = 50000,
): StopForecast {
  const end = asOf + horizonHours * 3600000,
    from = Math.max(
      asOf - historyDays * 86400000,
      Date.parse(snapshot.observationStartedAt),
    );
  const orders = snapshot.orders.filter(
    (o) =>
      o.status === "completed" &&
      Date.parse(o.createdAt) >= from &&
      Date.parse(o.createdAt) < asOf,
  );
  const globalEnough = asOf - from >= 86400000 && orders.length >= 10;
  const active = snapshot.dishes
    .filter((d) => d.active)
    .sort((a, b) => a.id.localeCompare(b.id));
  const virtual = structuredClone(snapshot.batches);
  const limiting = new Map<
    string,
    StopForecast["items"][number]["limitingIngredients"]
  >();
  const consumedIngredients = new Set<string>(),
    expiredIngredients = new Set<string>();
  const capture = (id: string, at: number, current = false) => {
    const plan = stockPlan(
      snapshot.ingredients,
      snapshot.dishes,
      virtual,
      { lines: [{ dishId: id, portions: 1 }] },
      at,
    );
    limiting.set(
      id,
      plan.requirements
        .filter((r) => thousandths(r.missingQuantity) > 0n)
        .map((r) => ({
          ingredientId: r.ingredientId,
          ingredientName: r.ingredientName,
          unit: r.unit,
          cause: current
            ? "current_shortage"
            : consumedIngredients.has(r.ingredientId) &&
                expiredIngredients.has(r.ingredientId)
              ? "combined"
              : expiredIngredients.has(r.ingredientId)
                ? "expiry"
                : "consumption",
        })),
    );
  };
  const data = active.map((d) => {
    const ownFrom = Math.max(from, Date.parse(d.createdAt)),
      exposure = asOf - ownFrom;
    const ownOrders = orders.filter(
      (o) =>
        Date.parse(o.createdAt) >= ownFrom &&
        o.lines.some((l) => l.dishId === d.id),
    );
    const portions = ownOrders.reduce(
      (n, o) =>
        n +
        o.lines
          .filter((l) => l.dishId === d.id)
          .reduce((s, l) => s + l.portions, 0),
      0,
    );
    const enough = globalEnough && exposure >= 86400000 && portions > 0;
    const stopped = !stockPlan(
      snapshot.ingredients,
      snapshot.dishes,
      virtual,
      { lines: [{ dishId: d.id, portions: 1 }] },
      asOf,
    ).canCreate;
    return {
      dish: d,
      ownFrom,
      exposure,
      portions,
      enough,
      ownOrders: ownOrders.length,
      stopped,
      firstStop: stopped ? asOf : (null as number | null),
      cause: stopped
        ? "current_shortage"
        : ("consumption" as
            "current_shortage" | "consumption" | "expiry" | "combined"),
      k: 1,
      next: enough
        ? asOf +
          Number((BigInt(exposure) + BigInt(portions) - 1n) / BigInt(portions))
        : Infinity,
    };
  });
  const expiries = [
    ...new Set(
      virtual
        .map((b) => Date.parse(b.expiresAt))
        .filter((t) => t > asOf && t <= end),
    ),
  ].sort((a, b) => a - b);
  for (const d of data) if (d.stopped) capture(d.dish.id, asOf, true);
  let expiryIndex = 0,
    attempts = 0,
    through = asOf,
    limited = false;
  const check = (at: number, cause: "expiry" | "consumption") => {
    for (const d of data)
      if (!d.stopped) {
        if (
          !stockPlan(
            snapshot.ingredients,
            snapshot.dishes,
            virtual,
            { lines: [{ dishId: d.dish.id, portions: 1 }] },
            at,
          ).canCreate
        ) {
          d.stopped = true;
          d.firstStop = at;
          d.cause = cause;
          capture(d.dish.id, at);
        }
      }
  };
  if (globalEnough)
    while (true) {
      const saleTime = Math.min(
        ...data.filter((d) => d.enough && !d.stopped).map((d) => d.next),
      );
      const expiryTime = expiries[expiryIndex] ?? Infinity;
      const at = Math.min(saleTime, expiryTime);
      if (at > end || !Number.isFinite(at)) {
        through = end;
        break;
      }
      const group = data.filter((d) => d.enough && !d.stopped && d.next === at);
      if (attempts + group.length > eventCap) {
        limited = true;
        break;
      }
      if (expiryTime === at) {
        for (const b of virtual)
          if (Date.parse(b.expiresAt) === at && free(b) > 0n)
            expiredIngredients.add(b.ingredientId);
        expiryIndex++;
        check(at, "expiry");
      }
      for (const d of group) {
        // The cap counts attempted sales, including a dish stopped by another event in this group.
        attempts++;
        if (d.stopped) continue;
        const plan = stockPlan(
          snapshot.ingredients,
          snapshot.dishes,
          virtual,
          { lines: [{ dishId: d.dish.id, portions: 1 }] },
          at,
        );
        if (plan.canCreate)
          for (const a of plan.allocations) {
            consumedIngredients.add(a.ingredientId);
            const b = virtual.find((b) => b.id === a.batchId)!;
            b.remainingQuantity = decimal(
              thousandths(b.remainingQuantity) - thousandths(a.quantity),
            );
          }
        check(at, "consumption");
        d.k++;
        d.next =
          asOf +
          Number(
            (BigInt(d.k) * BigInt(d.exposure) + BigInt(d.portions) - 1n) /
              BigInt(d.portions),
          );
      }
      through = at;
    }
  const items: StopForecast["items"] = data.map((d) => {
    const unknownCompetition = data.some(
      (other) =>
        other.dish.id !== d.dish.id &&
        !other.enough &&
        other.dish.recipe.some((r) =>
          d.dish.recipe.some((own) => own.ingredientId === r.ingredientId),
        ),
    );
    const changed = Date.parse(d.dish.updatedAt) > d.ownFrom;
    const status =
      d.firstStop === asOf
        ? "already_stopped"
        : !d.enough
          ? "insufficient_history"
          : d.firstStop !== null
            ? "predicted"
            : limited
              ? "calculation_limited"
              : "not_reached_within_horizon";
    const limitations: string[] = [];
    if (!d.enough) limitations.push("insufficient_observation");
    if (unknownCompetition) limitations.push("unknown_competing_demand");
    if (changed) limitations.push("recipe_changed_in_window");
    if (limited) limitations.push("event_cap");
    const at = d.firstStop;
    const estimate =
      status === "predicted" && at !== null
        ? {
            from: new Date(
              Math.max(asOf, Math.floor(at / 900000) * 900000),
            ).toISOString(),
            to: new Date(
              Math.min(end, Math.ceil(at / 900000) * 900000),
            ).toISOString(),
          }
        : null;
    return {
      dishId: d.dish.id,
      dishName: d.dish.name,
      status,
      estimatedWindow: estimate,
      observedFrom: new Date(d.ownFrom).toISOString(),
      exposureHours: d.exposure / 3600000,
      observedPortions: d.portions,
      portionsPerCalendarHour: d.enough
        ? d.portions / (d.exposure / 3600000)
        : null,
      confidence:
        status === "insufficient_history"
          ? "insufficient"
          : d.exposure >= 7 * 86400000 &&
              orders.length >= 50 &&
              d.ownOrders >= 5 &&
              !unknownCompetition &&
              !changed
            ? "medium"
            : "low",
      limitations,
      limitingIngredients:
        status === "already_stopped" || status === "predicted"
          ? (limiting.get(d.dish.id) ?? [])
          : [],
    };
  });
  return {
    asOf: new Date(asOf).toISOString(),
    stateRevision: snapshot.revision,
    method: "mean_demand_fefo_events_v1",
    horizonEndsAt: new Date(end).toISOString(),
    calculatedThrough: new Date(through).toISOString(),
    history: {
      from: new Date(from).toISOString(),
      to: new Date(asOf).toISOString(),
      exposureHours: (asOf - from) / 3600000,
      completedOrders: orders.length,
      observedFullDays: Math.floor((asOf - from) / 86400000),
    },
    datasetKind: snapshot.datasetKind,
    assumptions: [
      "Средний спрос по календарным часам, включая часы без продаж.",
      "Одна порция на событие; атомарные корзины не моделируются.",
      "При совпадении времени сначала истечение, затем продажи по стабильному ID блюда.",
      "Текущие рецепты; будущие поставки и снятие карантина не учитываются.",
      "Окно 15 минут — разрешение отображения, а не доверительный интервал.",
      "Прошлый стоп-лист и продвижение комбо могут изменить спрос.",
    ],
    items,
  };
}
