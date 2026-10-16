import { ComboSection } from "./ComboSection";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../app/auth";
import { useCatalog } from "../../shared/api/queries";
import { useCart } from "../cart/CartProvider";
import { scope } from "../../shared/lib/storage";
import { Feedback, moscow } from "../../shared/ui/Feedback";
import type { MenuItem, Offer } from "../../shared/api/types";
import { ApiError, serverNow } from "../../shared/api/client";
import styles from "../../app/site.module.css";
export function MenuPage({ offersOnly = false }: { offersOnly?: boolean }) {
  const id = useParams().warehouseId!;
  const { user } = useAuth();
  const menu = useCatalog<MenuItem>(id, "menu");
  const offers = useCatalog<Offer>(id, "offers");
  const cart = useCart();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Все");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [portions, setPortions] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const favoriteKey = scope(user!.id, id) + ".favorites";
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(favoriteKey) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  const [, clockTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => clockTick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const currentServerTime = serverNow();
  const visibleOffers = (offers.data || []).filter(
    (x) =>
      x.isAutomatic ||
      (x.promotion &&
        currentServerTime !== null &&
        Date.parse(x.promotion.startsAt) <= currentServerTime &&
        Date.parse(x.promotion.endsAt) > currentServerTime),
  );
  const hot = new Map(visibleOffers.map((x) => [x.dishId, x]));
  const promotionFor = (dishId: string) => {
    const p = hot.get(dishId)?.promotion;
    return p &&
      currentServerTime !== null &&
      Date.parse(p.startsAt) <= currentServerTime &&
      Date.parse(p.endsAt) > currentServerTime
      ? p
      : null;
  };
  const rows =
    (menu.error instanceof ApiError && [403, 404].includes(menu.error.status)
      ? []
      : menu.data
    )?.filter(
      (x) =>
        x.dishName.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (!offersOnly || hot.has(x.dishId)) &&
        (filter !== "Доступно" || x.status === "available") &&
        (filter !== "Горячие предложения" || hot.has(x.dishId)) &&
        (filter !== "Избранное" || favorites.includes(x.dishId)),
    ) || [];
  if (offersOnly || filter === "Горячие предложения")
    rows.sort(
      (a, b) =>
        visibleOffers.findIndex((x) => x.dishId === a.dishId) -
        visibleOffers.findIndex((x) => x.dishId === b.dishId),
    );
  const add = (dish: MenuItem, count = 1) => {
    const existing =
      cart.lines.find((x) => x.dishId === dish.dishId)?.portions || 0;
    if (
      cart.locked ||
      !Number.isInteger(count) ||
      count < 1 ||
      dish.status !== "available" ||
      existing + count > Math.min(dish.maxPortions, 1000) ||
      (!existing && cart.lines.length >= 100)
    ) {
      setNotice(
        "Добавление недоступно: проверьте количество или незавершённый заказ.",
      );
      return;
    }
    cart.setLines(
      existing
        ? cart.lines.map((x) =>
            x.dishId === dish.dishId
              ? { ...x, portions: x.portions + count }
              : x,
          )
        : [...cart.lines, { dishId: dish.dishId, portions: count }],
    );
    setNotice(`${dish.dishName} — добавлено порций: ${count}`);
  };
  const toggle = (dish: string) => {
    const next = favorites.includes(dish)
      ? favorites.filter((x) => x !== dish)
      : [...favorites, dish];
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
      setFavorites(next);
    } catch {
      setNotice("Не удалось сохранить избранное.");
    }
  };
  return (
    <>
      <h1>{offersOnly ? "Предложения" : "Меню"}</h1>
      <ComboSection />
      <label className={styles.search}>
        Найти блюдо
        <input
          type="search"
          placeholder="Введите название…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className={styles.filters}>
        {["Все", "Доступно", "Горячие предложения", "Избранное"].map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <Feedback query={menu} />
      <Feedback query={offers} />
      {offers.isError && offers.data && (
        <p role="alert">Предложения могли устареть. Не удалось обновить.</p>
      )}
      {currentServerTime === null && (
        <p>Актуальность периода предложения проверяется сервером.</p>
      )}
      <p className={styles.muted}>
        {menu.dataUpdatedAt
          ? `Обновлено ${moscow(new Date(menu.dataUpdatedAt).toISOString())}`
          : ""}
        {menu.isError && menu.data ? " · Данные могли устареть" : ""}
      </p>
      <div className={styles.menuLayout}>
        <div className={styles.grid}>
          {rows.map((dish) => {
            const count =
              cart.lines.find((x) => x.dishId === dish.dishId)?.portions || 0;
            return (
              <article
                key={dish.dishId}
                className={`${styles.dish} ${hot.has(dish.dishId) ? styles.hot : ""}`}
              >
                <div className={styles.art} aria-hidden="true">
                  ♧
                </div>
                <button
                  className={styles.favorite}
                  aria-label={`${favorites.includes(dish.dishId) ? "Убрать из" : "Добавить в"} избранное: ${dish.dishName}`}
                  aria-pressed={favorites.includes(dish.dishId)}
                  onClick={() => toggle(dish.dishId)}
                >
                  ♡
                </button>
                {hot.has(dish.dishId) && (
                  <span className={styles.tag}>Горячие предложения</span>
                )}
                {promotionFor(dish.dishId) && (
                  <div>
                    <h3>{promotionFor(dish.dishId)!.title}</h3>
                    <p>{promotionFor(dish.dishId)!.publicText}</p>
                    <p>
                      {moscow(promotionFor(dish.dishId)!.startsAt)} —{" "}
                      {moscow(promotionFor(dish.dishId)!.endsAt)}
                    </p>
                  </div>
                )}
                <button
                  className={styles.dishTitle}
                  onClick={() => {
                    setPortions(1);
                    setSelected(dish);
                  }}
                >
                  {dish.dishName}
                </button>
                <p>
                  {dish.status === "available"
                    ? "Доступно к заказу"
                    : dish.unavailableReason || "Недоступно"}
                </p>
                <button
                  disabled={
                    cart.locked ||
                    dish.status !== "available" ||
                    count >= Math.min(1000, dish.maxPortions)
                  }
                  onClick={() => add(dish)}
                >
                  {count ? `В корзине ${count} · ещё +1` : "Добавить +1"}
                </button>
              </article>
            );
          })}
        </div>
        <aside className={styles.cartAside}>
          <h2>Корзина</h2>
          <p>
            {cart.lines.length} позиций ·{" "}
            {cart.lines.reduce((s, x) => s + x.portions, 0)} порций
          </p>
          <Link className={styles.primaryLink} to={`/outlets/${id}/cart`}>
            К оформлению →
          </Link>
          {cart.locked && (
            <p>
              Есть запрос с неизвестным результатом. Откройте корзину для
              восстановления.
            </p>
          )}
        </aside>
      </div>
      {menu.isSuccess && !rows.length && <p>Блюд по этому запросу пока нет.</p>}
      <p role="status" aria-live="polite">
        {notice || cart.error}
      </p>
      <Link className={styles.mobileCart} to={`/outlets/${id}/cart`}>
        Корзина · {cart.lines.reduce((s, x) => s + x.portions, 0)} порций →
      </Link>
      <dialog
        ref={dialog}
        onClose={() => setSelected(null)}
        className={styles.dialog}
      >
        {selected && (
          <>
            <h2>{selected.dishName}</h2>
            <p>{selected.unavailableReason || "Выберите количество порций"}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add(selected, portions);
                dialog.current?.close();
              }}
            >
              <label>
                Порции
                <input
                  type="number"
                  min={1}
                  max={Math.max(
                    1,
                    Math.min(1000, selected.maxPortions) -
                      (cart.lines.find((x) => x.dishId === selected.dishId)
                        ?.portions || 0),
                  )}
                  value={portions}
                  onChange={(e) => setPortions(Number(e.target.value))}
                />
              </label>
              <button disabled={cart.locked || selected.status !== "available"}>
                Добавить в корзину
              </button>
              <button type="button" onClick={() => dialog.current?.close()}>
                Закрыть
              </button>
            </form>
          </>
        )}
      </dialog>
    </>
  );
}
