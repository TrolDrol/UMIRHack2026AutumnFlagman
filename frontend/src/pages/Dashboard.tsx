import { ScopedLink as Link } from "../shared/lib/routing";
import { CustomerPublicationStatus } from "./CustomerPublication";
import { ActionLink } from "../shared/ui";

import type { Dashboard as Data } from "../shared/api/types";
import { useResource } from "../shared/api/queries";
import { Heading, QueryState, s } from "../shared/ui";
const metrics: [keyof Data, string, string][] = [
  [
    "pendingDeliveryCount",
    "Поставок ожидают приёмки",
    "/deliveries?status=pending",
  ],
  ["ingredientCount", "Ингредиентов", "/ingredients"],
  ["activeDishCount", "Активных блюд", "/dishes?active=true"],
  ["stoppedDishCount", "Блюд в стоп-листе", "/stop-list"],
  [
    "lowStockIngredientCount",
    "Ингредиентов в дефиците",
    "/inventory?lowStock=true",
  ],
  ["expiringBatchCount", "Партий скоро истечёт", "/batches?status=expiring"],
  ["expiredBatchCount", "Просроченных партий", "/batches?status=expired"],
  ["todayOrderCount", "Заказов сегодня", "/orders"],
  ["hotOfferCount", "Горячих предложений", "/recommendations"],
];
export function Dashboard() {
  const query = useResource<Data>("dashboard");
  return (
    <>
      <Heading title="Обзор ресторана">
        <p className={s.muted}>Запасы, доступность и ближайшие действия</p>
      </Heading>
      <CustomerPublicationStatus />
      <QueryState query={query}>
        {(data) => (
          <div className={s.cards}>
            {metrics.map(([key, title, path]) => (
              <Link to={path} className={s.metric} key={key}>
                <span>{title} ↗</span>
                <strong>{data[key]}</strong>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
      <section className={s.panel}>
        <h2>Быстрые действия</h2>
        <p className={s.muted}>
          Принимайте продукты партиями, проверяйте заказ целиком и используйте
          истекающие запасы вовремя.
        </p>
        <div className={s.row}>
          <ActionLink showLabel to="/deliveries/new">
            Создать входящую поставку
          </ActionLink>
          <ActionLink showLabel to="/recommendations">
            Использовать запасы
          </ActionLink>
          <ActionLink showLabel to="/purchases">
            Запланировать закупки
          </ActionLink>
        </div>
      </section>
    </>
  );
}
