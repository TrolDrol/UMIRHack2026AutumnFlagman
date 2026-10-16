import { useParams } from "react-router-dom";
import type { PublicCombo } from "@rims/demo-api/contracts";
import { useCatalog } from "../../shared/api/queries";
import { useCart } from "../cart/CartProvider";
import { Feedback } from "../../shared/ui/Feedback";
import styles from "../../app/site.module.css";
export function ComboSection() {
  const id = useParams().warehouseId!,
    cart = useCart(),
    query = useCatalog<PublicCombo>(id, "combos");
  return (
    <section>
      <h2>Комбо</h2>
      <Feedback query={query} />
      <div className={styles.grid}>
        {query.data?.map((c) => {
          const existing = cart.combos.find(
            (l) => l.comboId === c.id && l.version === c.version,
          );
          return (
            <article className={styles.dish} key={c.id}>
              <h3>{c.title}</h3>
              <ul>
                {c.components.map((p) => (
                  <li key={p.dishId}>{p.dishName} · 1 порция</li>
                ))}
              </ul>
              <p>
                {c.status === "available"
                  ? "Два блюда в одном комплекте"
                  : "Временно недоступно"}
              </p>
              <button
                disabled={
                  cart.locked ||
                  c.status !== "available" ||
                  (existing?.quantity ?? 0) >= Math.min(c.maxUnits, 1000)
                }
                onClick={() =>
                  cart.setCombos(
                    existing
                      ? cart.combos.map((l) =>
                          l === existing
                            ? { ...l, quantity: l.quantity + 1 }
                            : l,
                        )
                      : [
                          ...cart.combos,
                          {
                            comboId: c.id,
                            version: c.version,
                            quantity: 1,
                            title: c.title,
                            components: c.components,
                          },
                        ],
                  )
                }
              >
                Добавить комплект
              </button>
            </article>
          );
        })}
      </div>
      {query.data && !query.data.length && (
        <p className={styles.muted}>Опубликованных комплектов пока нет.</p>
      )}
    </section>
  );
}
