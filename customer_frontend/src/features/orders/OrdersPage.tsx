import { runtimeNamespace } from "@rims/demo-api/runtime";
import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/auth";
import { useCart } from "../cart/CartProvider";
import { useCatalog, useOutlets } from "../../shared/api/queries";
import { request, warehouse } from "../../shared/api/client";
import type { Page, Receipt, MenuItem } from "../../shared/api/types";
import { Feedback, moscow } from "../../shared/ui/Feedback";
import styles from "../../app/site.module.css";
export function OrdersPage() {
  const { warehouseId: id } = useParams();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["customer", runtimeNamespace(), user!.id, id, "orders", page],
    queryFn: ({ signal }) =>
      request<Page<Receipt>>(
        warehouse(id!) + `/orders?page=${page}&pageSize=10`,
        { signal },
      ),
  });
  return (
    <>
      <h1>Ваши заказы</h1>
      <Feedback query={query} />
      {query.data?.items.map((o) => (
        <Link
          className={styles.orderRow}
          key={o.id}
          to={`/outlets/${id}/orders/${o.id}`}
        >
          <div>
            <h2>{o.number}</h2>
            <p>{moscow(o.createdAt)}</p>
          </div>
          <span>{o.lines.reduce((s, x) => s + x.portions, 0)} порций →</span>
        </Link>
      ))}
      {query.data && !query.data.items.length && (
        <p>Вы ещё не оформляли заказы в этом заведении.</p>
      )}
      <div className={styles.filters}>
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </button>
        <span>Страница {page}</span>
        <button
          disabled={!query.data || page * 10 >= query.data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Далее
        </button>
      </div>
    </>
  );
}
export function OrderPage() {
  const { warehouseId: id, id: orderId } = useParams();
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const outlets = useOutlets();
  const published = outlets.data?.some((x) => x.warehouseId === id);
  const menu = useCatalog<MenuItem>(published ? id! : "", "menu");
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["customer", runtimeNamespace(), user!.id, id, "order", orderId],
    queryFn: ({ signal }) =>
      request<Receipt>(
        warehouse(id!) + "/orders/" + encodeURIComponent(orderId!),
        { signal },
      ),
  });
  const repeat = () => {
    const receipt = query.data!;
    if (cart.locked) return;
    const unavailable = receipt.lines.filter(
      (x) =>
        !menu.data?.some(
          (d) =>
            d.dishId === x.dishId &&
            d.status === "available" &&
            d.maxPortions >= x.portions,
        ),
    );
    if (unavailable.length) {
      setMessage(
        "Некоторые блюда недоступны или порций недостаточно. Состав сохранится целиком: скорректируйте его в корзине.",
      );
    }
    if (receipt.composition?.some((c) => c.kind === "combo")) {
      cart.setLines(
        receipt.composition.flatMap((c) =>
          c.kind === "dish" ? [{ dishId: c.dishId, portions: c.portions }] : [],
        ),
      );
      cart.setCombos(
        receipt.composition.flatMap((c) =>
          c.kind === "combo"
            ? [
                {
                  comboId: c.comboId,
                  version: c.version,
                  title: c.title,
                  components: c.components,
                  quantity: c.quantity,
                },
              ]
            : [],
        ),
      );
    } else {
      cart.setLines(
        receipt.lines.map(({ dishId, portions }) => ({ dishId, portions })),
      );
      cart.setCombos([]);
    }
    if (!unavailable.length) navigate(`/outlets/${id}/cart`);
  };
  return (
    <>
      <Feedback query={query} />
      {query.data && (
        <section className={styles.receipt}>
          <h1>Заказ зарегистрирован</h1>
          <h2>{query.data.number}</h2>
          <p>{moscow(query.data.createdAt)}</p>
          <ul>
            {(
              query.data.composition ??
              query.data.lines.map((l) => ({ kind: "dish" as const, ...l }))
            ).map((item, i) => (
              <li key={i}>
                <span>{item.kind === "dish" ? item.dishName : item.title}</span>
                <strong>
                  {item.kind === "dish" ? item.portions : item.quantity}{" "}
                  {item.kind === "dish" ? "порций" : "комплектов"}
                </strong>
                {item.kind === "combo" && (
                  <p>
                    {item.components
                      .map((c) => c.dishName + " ? 1")
                      .join(" + ")}{" "}
                    ? v{item.version}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className={styles.filters}>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(query.data!.number)
                  .then(() => setMessage("Номер скопирован"))
                  .catch(() => setMessage("Не удалось скопировать номер"))
              }
            >
              Копировать номер
            </button>
            <button onClick={() => window.print()}>Печать квитанции</button>
            <button
              disabled={!published || !menu.data || cart.locked}
              onClick={repeat}
            >
              Повторить в новую корзину
            </button>
          </div>
          {!published && outlets.isSuccess && (
            <p>
              Заведение снято с публикации. История остаётся доступной,
              повторить заказ нельзя.
            </p>
          )}
          <p role="status">{message || cart.error}</p>
          {message && <Link to={`/outlets/${id}/cart`}>Открыть корзину</Link>}
        </section>
      )}
    </>
  );
}
