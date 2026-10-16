import { management } from "../app/workspace";
import { ScopedLink as Link } from "../shared/lib/routing";
import { useApi } from "../shared/api/queries";
import { ActionButton, ActionLink } from "../shared/ui";
import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import type {
  Dish,
  Ingredient,
  IngredientInput,
  Page,
} from "../shared/api/types";
import { useResource } from "../shared/api/queries";
import { copyIngredient } from "../shared/lib/copy";
import {
  Heading,
  QueryState,
  Table,
  Search,
  Pager,
  Empty,
  Field,
  ErrorNotice,
  ResetFilters,
  useFilters,
  s,
} from "../shared/ui";
import { displayQuantity, units } from "../shared/lib/decimal";
import { IngredientEditor } from "../features/ingredients/IngredientEditor";
export function Ingredients() {
  const { context, readCollection } = useApi();
  const [copy, setCopy] = useState<{
    id: string;
    initial: IngredientInput;
  } | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { params, update } = useFilters(["q"]);
  const query = useResource<Page<Ingredient>>("ingredients", params);
  const [editing, setEditing] = useState<Ingredient | null | undefined>(
    undefined,
  );
  return (
    <>
      <Heading
        title="Ингредиенты"
        action={
          management(context.role) && (
            <ActionButton onClick={() => setEditing(null)}>
              Добавить ингредиент
            </ActionButton>
          )
        }
      />
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <ResetFilters />
      </div>
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <Table
                headers={[
                  "Название",
                  "Единица",
                  "Срок по умолчанию",
                  "Порог",
                  "Целевой запас",
                  "Действия",
                ]}
              >
                {page.items.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <Link to={`/inventory/${x.id}`}>{x.name}</Link>
                    </td>
                    <td>{units[x.unit]}</td>
                    <td data-sort-value={x.defaultShelfLifeHours}>
                      {x.defaultShelfLifeHours} ч
                    </td>
                    <td data-sort-value={x.reorderPoint}>
                      {displayQuantity(x.reorderPoint)} {units[x.unit]}
                    </td>
                    <td data-sort-value={x.targetStock}>
                      {displayQuantity(x.targetStock)} {units[x.unit]}
                    </td>
                    <td>
                      <div className={s.actions}>
                        {management(context.role) && (
                          <>
                            <ActionButton onClick={() => setEditing(x)}>
                              Редактировать {x.name}
                            </ActionButton>
                            <ActionButton
                              disabled={copying}
                              aria-label={`Создать копию ингредиента «${x.name}»`}
                              onClick={async () => {
                                setCopying(true);
                                setError(null);
                                try {
                                  const all =
                                    await readCollection<Ingredient>(
                                      "ingredients",
                                    );
                                  setCopy({
                                    id: x.id,
                                    initial: copyIngredient(
                                      x,
                                      all.data.map((item) => item.name),
                                    ),
                                  });
                                } catch (e) {
                                  setError(e);
                                } finally {
                                  setCopying(false);
                                }
                              }}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>
                Ингредиентов пока нет. Добавьте ингредиент для приёмки и
                рецептур.
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
      <ErrorNotice error={error} />
      {copy && (
        <IngredientEditor
          key={`copy-${copy.id}`}
          initial={copy.initial}
          copyId={copy.id}
          onClose={() => setCopy(null)}
        />
      )}
      {editing !== undefined && (
        <IngredientEditor
          ingredient={editing || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
export function Dishes() {
  const { context, request } = useApi();
  const { params, update } = useFilters(["q", "active"]);
  const query = useResource<Page<Dish>>("dishes", params);
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  return (
    <>
      <Heading
        title="Блюда"
        action={
          <ActionLink className={s.action} to="/dishes/new">
            Добавить блюдо
          </ActionLink>
        }
      />
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <Field label="Активность">
          <select
            value={params.active || ""}
            onChange={(e) => update("active", e.target.value)}
          >
            <option value="">Все блюда</option>
            <option value="true">Активные</option>
            <option value="false">Неактивные</option>
          </select>
        </Field>
        <ResetFilters />
      </div>
      <ErrorNotice error={error} />
      <QueryState query={query}>
        {(page) => (
          <>
            {page.items.length ? (
              <Table headers={["Блюдо", "Состав", "Активность", "Действия"]}>
                {page.items.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td data-sort-value={x.recipe.length}>
                      {x.recipe.length} ингредиентов
                    </td>
                    <td>{x.active ? "Активно" : "Неактивно"}</td>
                    <td>
                      <div className={s.actions}>
                        <ActionLink
                          title={`Редактировать блюдо «${x.name}»`}
                          to={`/dishes/${x.id}/edit`}
                        >
                          Редактировать
                        </ActionLink>

                        <ActionLink
                          icon="copy"
                          to={`/dishes/new?copy=${x.id}`}
                          aria-label={`Создать копию блюда «${x.name}»`}
                        />
                        <ActionButton
                          disabled={!!busy}
                          onClick={async () => {
                            setBusy(x.id);
                            setError(null);
                            try {
                              await request(`/dishes/${x.id}`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  name: x.name,
                                  active: !x.active,
                                  recipe: x.recipe,
                                }),
                              });
                              await client.invalidateQueries({
                                queryKey: [
                                  "warehouse",
                                  context.userId,
                                  context.warehouseId,
                                ],
                              });
                            } catch (e) {
                              setError(e);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          {x.active ? "Отключить" : "Включить"} {x.name}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty>Блюд пока нет. Создайте блюдо и укажите состав.</Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
