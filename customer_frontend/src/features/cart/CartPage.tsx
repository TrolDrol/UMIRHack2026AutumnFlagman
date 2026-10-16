import { AvailabilityStatus } from "../../shared/api/availability";
import { runtimeNamespace } from "@rims/demo-api/runtime";
import { orderSchema } from "@rims/demo-api/schemas";
import type { PublicCombo } from "@rims/demo-api/contracts";
import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/auth";
import { useCart } from "./CartProvider";
import { useCatalog } from "../../shared/api/queries";
import { request, warehouse, ApiError } from "../../shared/api/client";
import { isTerminalOrderFailure } from "../../shared/api/recovery";
import {
  expired,
  pendingFor,
  savePending,
  scope,
  type Pending,
  foreignPending,
} from "../../shared/lib/storage";
import type { MenuItem, Preview, Receipt } from "../../shared/api/types";
import styles from "../../app/site.module.css";
export function CartPage() {
  const id = useParams().warehouseId!;
  const { user } = useAuth();
  const cart = useCart();
  const menu = useCatalog<MenuItem>(id, "menu");
  const combos = useCatalog<PublicCombo>(id, "combos");
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(() => pendingFor(user!.id, id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    setPreview(null);
  }, [menu.dataUpdatedAt]);
  const [online, setOnline] = useState(navigator.onLine);
  const [retryAt, setRetryAt] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const removePending = () => {
    sessionStorage.removeItem(scope(user!.id, id) + ".pending");
    setPending(null);
  };
  const send = async (p: Pending) => {
    try {
      const receipt = await request<Receipt>(p.path, {
        method: p.method,
        body: JSON.stringify(p.body),
        headers: { "Idempotency-Key": p.key },
        expectedUserId: p.customerId,
      });
      if (!active.current) return;
      removePending();
      cart.setLines([]);
      cart.setCombos([]);
      await cache.invalidateQueries({
        queryKey: ["customer", runtimeNamespace(), user!.id, id],
      });
      if (active.current) navigate(`/outlets/${id}/orders/${receipt.id}`);
    } catch (e) {
      if (!active.current) return;
      if (e instanceof ApiError && e.retryAt) setRetryAt(e.retryAt);
      if (isTerminalOrderFailure(e)) {
        removePending();
      }
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setBusy(false);
    }
  };
  const checkout = async () => {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const body = structuredClone({
        lines: cart.lines,
        ...(cart.combos.length
          ? {
              combos: cart.combos.map(({ comboId, version, quantity }) => ({
                comboId,
                version,
                quantity,
              })),
            }
          : {}),
      });
      orderSchema.parse(body);
      if (
        cart.lines.reduce((n, line) => n + line.portions, 0) +
          cart.combos.reduce(
            (n, combo) => n + combo.quantity * combo.components.length,
            0,
          ) >
        1000
      )
        throw new Error(
          "После раскрытия комбо допускается не более 1000 порций",
        );
      const result = await request<Preview>(warehouse(id) + "/orders/preview", {
        method: "POST",
        body: JSON.stringify(body),
        expectedUserId: user!.id,
      });
      if (!active.current) return;
      setPreview(result);
      if (!result.canCreate) {
        setBusy(false);
        return;
      }
      const p = savePending(user!.id, id, body);
      setPending(p);
      await send(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить заказ");
      setBusy(false);
    }
  };
  const update = (dishId: string, portions: number) => {
    cart.setLines(
      portions
        ? cart.lines.map((x) => (x.dishId === dishId ? { ...x, portions } : x))
        : cart.lines.filter((x) => x.dishId !== dishId),
    );
    setPreview(null);
  };
  return (
    <>
      <AvailabilityStatus warehouseId={id} />
      <h1>Ваш заказ</h1>
      {!online && (
        <p role="alert">
          Вы offline. Корзина сохранена, оформление временно недоступно.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {cart.error && <p role="alert">{cart.error}</p>}
      {foreignPending(user!.id, id).map((saved, index) => (
        <details key={index}>
          <summary>
            Сохранённый запрос из другой или прежней среды — повтор запрещён
          </summary>
          <p>
            Сверьте результат в исходной среде с администратором. Отсутствие
            заказа в текущей истории не доказывает отказ.
          </p>
          <pre>{JSON.stringify(saved, null, 2)}</pre>
        </details>
      ))}
      {pending && (
        <section className={styles.panel}>
          <h2>Восстановление заказа</h2>
          <p>
            Результат запроса неизвестен. Повторим прежний состав с тем же
            ключом.
          </p>
          <ul>
            {pending.body.lines.map((x) => (
              <li key={x.dishId}>
                {menu.data?.find((d) => d.dishId === x.dishId)?.dishName ||
                  x.dishId}{" "}
                · {x.portions} порций
              </li>
            ))}
          </ul>
          <ul>
            {pending.body.combos?.map((x) => (
              <li key={x.comboId + ":" + x.version}>
                Комбо {x.comboId} · версия {x.version} · {x.quantity} комплектов
              </li>
            ))}
          </ul>
          <p>Ключ: {pending.key}</p>
          {expired(pending) ? (
            <p role="alert">
              Прошло 24 часа. Повтор заблокирован: администратору нужно сверить
              журнал по покупателю {user!.id}, заведению {id}, адресу{" "}
              {pending.path} и ключу выше. Отсутствие заказа на странице истории
              не доказывает отказ.
            </p>
          ) : (
            <button
              disabled={busy || !online || Date.now() < retryAt}
              onClick={() => {
                setBusy(true);
                void send(pending);
              }}
            >
              Повторить прежний запрос
            </button>
          )}
          {retryAt > 0 && (
            <p>
              Повтор после {new Date(retryAt).toLocaleString("ru")}.{" "}
              <button
                onClick={() => setRetryAt(Date.now() < retryAt ? retryAt : 0)}
              >
                Проверить время
              </button>
            </p>
          )}
        </section>
      )}
      {cart.combos.map((line, i) => {
        const current = combos.data?.find((c) => c.id === line.comboId),
          changed = current?.version !== line.version;
        const updateCombo = (quantity: number) => {
          cart.setCombos(
            quantity
              ? cart.combos.map((l, index) =>
                  index === i ? { ...l, quantity } : l,
                )
              : cart.combos.filter((_, index) => index !== i),
          );
          setPreview(null);
        };
        return (
          <article
            className={styles.panel}
            key={line.comboId + ":" + line.version}
          >
            <h2>{line.title}</h2>
            <p>
              {line.components.map((c) => c.dishName + " · 1").join(" + ")} ?
              Версия {line.version}
            </p>
            {changed && (
              <p role="alert">
                Версия изменилась. Обновите позицию или удалите её.
              </p>
            )}
            <div className={styles.stepper}>
              <button
                disabled={busy || !!pending || line.quantity <= 1}
                aria-label="Уменьшить комплекты"
                onClick={() => updateCombo(line.quantity - 1)}
              >
                ?
              </button>
              <span>{line.quantity}</span>
              <button
                disabled={
                  busy ||
                  !!pending ||
                  changed ||
                  current?.status !== "available" ||
                  line.quantity >= Math.min(1000, current.maxUnits)
                }
                aria-label="Увеличить комплекты"
                onClick={() => updateCombo(line.quantity + 1)}
              >
                +
              </button>
              <button
                disabled={busy || !!pending}
                onClick={() => updateCombo(0)}
              >
                Удалить
              </button>
              {changed && current && (
                <button
                  disabled={busy || !!pending}
                  onClick={() =>
                    cart.setCombos(
                      cart.combos.map((l, index) =>
                        index === i
                          ? {
                              ...l,
                              version: current.version,
                              title: current.title,
                              components: current.components,
                            }
                          : l,
                      ),
                    )
                  }
                >
                  Обновить версию
                </button>
              )}
            </div>
          </article>
        );
      })}
      {cart.lines.map((line) => {
        const dish = menu.data?.find((x) => x.dishId === line.dishId);
        return (
          <div className={styles.cartRow} key={line.dishId}>
            <div>
              <h3>{dish?.dishName || "Блюдо отсутствует в актуальном меню"}</h3>
              <p>{dish?.status === "stopped" ? dish.unavailableReason : ""}</p>
            </div>
            <div className={styles.stepper}>
              <button
                disabled={busy || !!pending}
                aria-label="Уменьшить количество"
                onClick={() => update(line.dishId, line.portions - 1)}
              >
                −
              </button>
              <span>{line.portions}</span>
              <button
                disabled={
                  busy ||
                  !!pending ||
                  !dish ||
                  dish.status !== "available" ||
                  line.portions >= Math.min(1000, dish.maxPortions)
                }
                aria-label="Увеличить количество"
                onClick={() => update(line.dishId, line.portions + 1)}
              >
                +
              </button>
              <button
                disabled={busy || !!pending}
                onClick={() => update(line.dishId, 0)}
              >
                Удалить
              </button>
            </div>
          </div>
        );
      })}
      {!cart.lines.length && !cart.combos.length && (
        <p>Корзина пока пуста. Добавьте блюдо из меню.</p>
      )}
      {preview && !preview.canCreate && (
        <section role="alert">
          <h2>Нужно скорректировать заказ</h2>
          <ul>
            {preview.shortages.map((x, i) => (
              <li key={i}>
                {x.ingredientName}: не хватает {x.missingQuantity} {x.unit}
              </li>
            ))}
          </ul>
        </section>
      )}
      <button
        disabled={
          busy ||
          !!pending ||
          !online ||
          (!cart.lines.length && !cart.combos.length) ||
          menu.isError ||
          menu.isPending ||
          cart.lines.some(
            (x) =>
              !menu.data?.some(
                (d) => d.dishId === x.dishId && d.status === "available",
              ),
          )
        }
        onClick={() => void checkout()}
      >
        {busy ? "Проверяем и регистрируем…" : "Оформить заказ"}
      </button>
    </>
  );
}
