import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Combo, ComboInput, ComboPlan } from "@rims/demo-api/contracts";
import type { Dish, Page } from "../shared/api/types";
import { useApi, useDirectory, useResource } from "../shared/api/queries";
import { beginPending, sendPending } from "../shared/lib/pending";
import {
  Heading,
  QueryState,
  Field,
  Search,
  Pager,
  Empty,
  ActionButton,
  Modal,
  ErrorNotice,
  useFilters,
  ResetFilters,
  s,
} from "../shared/ui";
import { displayQuantity, units } from "../shared/lib/decimal";

export function Combos() {
  const api = useApi(),
    client = useQueryClient(),
    { params, update } = useFilters(["q", "status"]);
  const query = useResource<Page<Combo>>("combos", params),
    dishes = useDirectory<Dish>("dishes");
  const [editing, setEditing] = useState<{
      combo: Combo | null;
      input: ComboInput;
    } | null>(null),
    [candidates, setCandidates] = useState<string[]>([]),
    [plan, setPlan] = useState<ComboPlan | null>(null);
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  async function command(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await sendPending(beginPending(api.context, path, body), api.context);
      await client.invalidateQueries({ queryKey: api.queryPrefix });
      return true;
    } catch (e) {
      setError(e);
      await client.invalidateQueries({ queryKey: api.queryPrefix });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const active = dishes.data?.data.filter((d) => d.active) ?? [];
  return (
    <>
      <Heading
        title="Комбо"
        action={
          <ActionButton
            showLabel
            icon="add"
            onClick={() =>
              setEditing({ combo: null, input: { title: "", components: [] } })
            }
          >
            Создать комбо
          </ActionButton>
        }
      />
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <Field label="Состояние">
          <select
            value={params.status || ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Все</option>
            <option value="draft">Черновики</option>
            <option value="published">Опубликованы</option>
            <option value="archived">Архив</option>
          </select>
        </Field>
        <ResetFilters />
      </div>
      {!!error && <ErrorNotice error={error} />}
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <div className={s.menuCards}>
                {page.items.map((c) => (
                  <article key={c.id} className={s.panel}>
                    <h2>{c.title}</h2>
                    <p>
                      Версия {c.version} ·{" "}
                      {c.status === "draft"
                        ? "Черновик"
                        : c.status === "published"
                          ? "Опубликовано"
                          : "Архив"}
                    </p>
                    <ul>
                      {c.components.map((part) => (
                        <li key={part.dishId}>
                          {dishes.data?.data.find((d) => d.id === part.dishId)
                            ?.name ?? part.dishId}{" "}
                          · 1 порция
                        </li>
                      ))}
                    </ul>
                    {c.needsReview && (
                      <p className={s.notice}>
                        Рецепт изменился. Создайте и опубликуйте новую версию.
                      </p>
                    )}
                    <div className={s.actions}>
                      <ActionButton
                        icon="edit"
                        title="Создать новую версию комбо"
                        disabled={busy}
                        onClick={() =>
                          setEditing({
                            combo: c,
                            input: { title: c.title, components: c.components },
                          })
                        }
                      />
                      {c.status === "draft" && (
                        <ActionButton
                          icon="check"
                          title="Опубликовать комбо"
                          disabled={busy || c.needsReview}
                          onClick={() =>
                            void command(`/combos/${c.id}/publish`, {
                              expectedVersion: c.version,
                            })
                          }
                        />
                      )}
                      {c.status !== "archived" && (
                        <ActionButton
                          icon="disable"
                          title="Архивировать комбо"
                          disabled={busy}
                          onClick={() =>
                            void command(`/combos/${c.id}/archive`, {
                              expectedVersion: c.version,
                            })
                          }
                        />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                Комбо пока нет. Создайте пару блюд или сохраните рекомендацию.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <section className={s.panel}>
        <h2>Подобрать совместный план</h2>
        <p>
          Выберите 2–12 активных блюд. Алгоритм подбирает до трёх пар с общим
          выполнимым расходом истекающих партий. Это рекомендация, а не резерв
          продуктов.
        </p>
        <div className={s.menuCards}>
          {active.map((d) => (
            <label key={d.id}>
              <input
                type="checkbox"
                checked={candidates.includes(d.id)}
                disabled={!candidates.includes(d.id) && candidates.length >= 12}
                onChange={(e) =>
                  setCandidates(
                    e.target.checked
                      ? [...candidates, d.id]
                      : candidates.filter((id) => id !== d.id),
                  )
                }
              />
              {d.name}
            </label>
          ))}
        </div>
        <ActionButton
          showLabel
          icon="hot"
          disabled={busy || candidates.length < 2}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setPlan(
                (
                  await api.request<ComboPlan>("/combo-plans/preview", {
                    method: "POST",
                    body: JSON.stringify({ candidateDishIds: candidates }),
                  })
                ).data,
              );
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Подобрать план
        </ActionButton>
        {plan && (
          <>
            <p>
              Снимок {new Date(plan.asOf).toLocaleString("ru-RU")}. Метод:{" "}
              {plan.method}.
            </p>
            {plan.emptyReason && (
              <Empty>
                {plan.emptyReason === "no_risk_stock"
                  ? "Нет свободного истекающего запаса."
                  : "Нет выполнимых пар с расходом истекающего запаса."}
              </Empty>
            )}
            {plan.proposals.map((p) => (
              <article
                className={s.panel}
                key={p.components.map((c) => c.dishId).join(":")}
              >
                <h3>{p.titleSuggestion}</h3>
                <p>
                  В совместном плане: {p.suggestedUnits} комплектов. Отдельно по
                  текущему запасу: до {p.individualMaxUnits}.
                </p>
                <p>{p.explanation}</p>
                <ActionButton
                  icon="save"
                  title="Сохранить рекомендацию как черновик"
                  onClick={() =>
                    setEditing({
                      combo: null,
                      input: {
                        title: p.titleSuggestion,
                        components: p.components,
                      },
                    })
                  }
                />
              </article>
            ))}
            <details>
              <summary>Совместный расход партий</summary>
              <ul>
                {plan.allocations.map((a) => (
                  <li key={a.batchId}>
                    Партия {a.batchId}: {displayQuantity(a.quantity)}{" "}
                    {units[a.unit]}, из них истекающих{" "}
                    {displayQuantity(a.expiringQuantity)}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
      {editing && (
        <Modal
          title={editing.combo ? "Новая версия комбо" : "Черновик комбо"}
          onClose={() => setEditing(null)}
          dirty
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await command(
                editing.combo
                  ? `/combos/${editing.combo.id}/versions`
                  : "/combos",
                {
                  ...editing.input,
                  ...(editing.combo
                    ? { expectedVersion: editing.combo.version }
                    : {}),
                },
              );
              if (ok) setEditing(null);
            }}
          >
            <Field label="Название">
              <input
                required
                maxLength={120}
                value={editing.input.title}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    input: { ...editing.input, title: e.target.value },
                  })
                }
              />
            </Field>
            {[0, 1].map((index) => (
              <Field key={index} label={`Блюдо ${index + 1} · одна порция`}>
                <select
                  required
                  value={editing.input.components[index]?.dishId ?? ""}
                  onChange={(e) => {
                    const components = [...editing.input.components];
                    components[index] = { dishId: e.target.value, portions: 1 };
                    setEditing({
                      ...editing,
                      input: { ...editing.input, components },
                    });
                  }}
                >
                  <option value="">Выберите блюдо</option>
                  {active.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <p>
              Перед публикацией проверьте название и сочетание блюд. Цены и
              скидки пока не задаются.
            </p>
            {!!error && <ErrorNotice error={error} />}
            <ActionButton showLabel icon="save" type="submit" disabled={busy}>
              Сохранить черновик
            </ActionButton>
          </form>
        </Modal>
      )}
    </>
  );
}
