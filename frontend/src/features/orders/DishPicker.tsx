import { ActionButton } from "../../shared/ui";
import { useRef, useState, type ReactNode } from "react";
import type {
  DishAvailability,
  OfferCard,
  ServiceMenuItem,
  PublicOfferCard,
} from "../../shared/api/types";
import { useLiveCollection } from "../../shared/api/queries";
import { ErrorNotice, QueryState, Search, s } from "../../shared/ui";
import styles from "./orders.module.css";

const pageSize = 10;
export function DishSection({
  title,
  items,
  initialOpen = true,
}: {
  title: string;
  items: { id: string; content: ReactNode }[];
  initialOpen?: boolean;
}) {
  const [page, setPage] = useState(1);
  const list = useRef<HTMLDivElement>(null);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const changePage = (next: number) => {
    setPage(next);
    if (list.current) list.current.scrollTop = 0;
  };
  return (
    <details className={styles.section} open={initialOpen}>
      <summary>
        <span>{title}</span>
        <span className={styles.count}>{items.length}</span>
        <span className={styles.chevron} aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className={styles.sectionBody}>
        <div
          ref={list}
          className={styles.dishList}
          role="region"
          aria-label={`${title}: блюда`}
          tabIndex={0}
        >
          {items.length ? (
            items
              .slice((currentPage - 1) * pageSize, currentPage * pageSize)
              .map((item) => (
                <div className={styles.dishCard} key={item.id}>
                  {item.content}
                </div>
              ))
          ) : (
            <p className={s.muted}>Блюд в этом разделе нет.</p>
          )}
        </div>
        <nav className={styles.pagination} aria-label={`${title}: страницы`}>
          <span aria-live="polite">
            Страница {currentPage} из {pageCount} · по {pageSize} блюд
          </span>
          <div>
            <ActionButton
              type="button"
              aria-label={`${title}: предыдущая страница`}
              disabled={currentPage === 1}
              onClick={() => changePage(currentPage - 1)}
            >
              ←
            </ActionButton>
            <ActionButton
              type="button"
              aria-label={`${title}: следующая страница`}
              disabled={currentPage === pageCount}
              onClick={() => changePage(currentPage + 1)}
            >
              →
            </ActionButton>
          </div>
        </nav>
      </div>
    </details>
  );
}

export function DishPicker({
  onAdd,
  disabled,
  service = false,
}: {
  onAdd: (dishId: string, portions?: number, dishName?: string) => void;
  disabled: boolean;
  service?: boolean;
}) {
  const menu = useLiveCollection<DishAvailability | ServiceMenuItem>(
    service ? "service/menu" : "menu/availability",
  );
  const offers = useLiveCollection<OfferCard | PublicOfferCard>(
    service ? "service/offers" : "offers",
  );
  const [search, setSearch] = useState("");
  const matches = (name: string) =>
    name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"));
  const availability = new Map(
    menu.data?.data.map((dish) => [dish.dishId, dish]),
  );
  const hot = (offers.data?.data || []).filter(
    (offer) => availability.get(offer.dishId)?.status === "available",
  );
  const hotIds = new Set(hot.map((offer) => offer.dishId));
  const regular = (menu.data?.data || []).filter(
    (dish) => dish.status === "available" && !hotIds.has(dish.dishId),
  );
  const stopped = (menu.data?.data || []).filter(
    (dish) => dish.status === "stopped",
  );
  return (
    <section className={s.panel}>
      <h2>Добавить из меню</h2>
      <div className={s.toolbar}>
        <Search value={search} onChange={setSearch} />
      </div>
      <QueryState query={menu}>
        {() => (
          <>
            {!offers.data && !offers.isError ? (
              <div
                className={s.skeleton}
                role="status"
                aria-label="Загрузка горячих предложений"
              />
            ) : (
              <>
                <ErrorNotice error={offers.error} />
                {offers.isError && (
                  <ActionButton
                    type="button"
                    onClick={() => void offers.refetch()}
                  >
                    Обновить горячие предложения
                  </ActionButton>
                )}
                <DishSection
                  key={`hot-${search}`}
                  title="Горячие предложения"
                  items={hot
                    .filter((dish) => matches(dish.dishName))
                    .map((offer) => ({
                      id: offer.dishId,
                      content: (
                        <>
                          <strong>{offer.dishName}</strong>
                          {"automatic" in offer && offer.automatic && (
                            <span className={styles.hotBadge}>
                              Приоритет {offer.automatic!.score} из 100
                            </span>
                          )}
                          {"automatic" in offer && offer.automatic && (
                            <p className={s.muted}>
                              {offer.automatic!.explanation}
                            </p>
                          )}
                          {("manual" in offer
                            ? offer.manual
                            : offer.promotion) && (
                            <p>
                              {
                                ("manual" in offer
                                  ? offer.manual
                                  : offer.promotion)!.title
                              }{" "}
                              ·{" "}
                              {
                                ("manual" in offer
                                  ? offer.manual
                                  : offer.promotion)!.publicText
                              }
                            </p>
                          )}
                          <p className={s.muted}>
                            Предлагаем {offer.suggestedPortions} порций ·
                            доступно до{" "}
                            {availability.get(offer.dishId)?.maxPortions}
                          </p>
                          <ActionButton
                            type="button"
                            className={s.primary}
                            disabled={disabled}
                            onClick={() =>
                              onAdd(
                                offer.dishId,
                                Math.min(1000, offer.suggestedPortions),
                                offer.dishName,
                              )
                            }
                          >
                            Добавить в заказ
                          </ActionButton>
                        </>
                      ),
                    }))}
                />
                <DishSection
                  key={`regular-${search}`}
                  title="Обычные блюда"
                  items={regular
                    .filter((dish) => matches(dish.dishName))
                    .map((dish) => ({
                      id: dish.dishId,
                      content: (
                        <>
                          <strong>{dish.dishName}</strong>
                          <p className={s.muted}>
                            Доступно до {dish.maxPortions} порций
                          </p>
                          <ActionButton
                            type="button"
                            disabled={disabled}
                            onClick={() => onAdd(dish.dishId, 1, dish.dishName)}
                          >
                            Добавить в заказ
                          </ActionButton>
                        </>
                      ),
                    }))}
                />
                <DishSection
                  key={`stopped-${search}`}
                  title="Блюда в стоп-листе"
                  initialOpen={false}
                  items={stopped
                    .filter((dish) => matches(dish.dishName))
                    .map((dish) => ({
                      id: dish.dishId,
                      content: (
                        <>
                          <strong>{dish.dishName}</strong>
                          <p className={s.muted}>
                            Недостаточно ингредиентов для одной порции
                          </p>
                          <ActionButton type="button" disabled>
                            Добавить в заказ
                          </ActionButton>
                        </>
                      ),
                    }))}
                />
              </>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
