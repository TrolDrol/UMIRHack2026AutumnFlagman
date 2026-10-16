import { AvailabilityStatus } from "../shared/api/availability";
import { useScopedNavigate as useNavigate } from "../shared/lib/routing";
import { useSearchParams } from "react-router-dom";
import type { DishAvailability, Page } from "../shared/api/types";
import { useLiveCollection } from "../shared/api/queries";
import { stopSupply } from "../shared/lib/stopSupply";
import {
  ActionButton,
  ActionLink,
  Empty,
  Field,
  Heading,
  Pager,
  QueryState,
  Requirements,
  Search,
  s,
  ResetFilters,
  useFilters,
} from "../shared/ui";

export function StopList() {
  const [search, setSearch] = useSearchParams();
  const columns = ["1", "2", "3", "4"].includes(search.get("columns") || "")
    ? search.get("columns")!
    : "2";
  const query = useLiveCollection<DishAvailability>("stop-list");
  const { params, update } = useFilters(["q", "ingredientId"]);
  const navigate = useNavigate();
  const all = query.data?.data || [];
  const ingredients = [
    ...new Map(
      all.flatMap((dish) =>
        dish.shortages.map((x) => [x.ingredientId, x.ingredientName] as const),
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const filtered = all.filter(
    (dish) =>
      dish.dishName
        .toLocaleLowerCase("ru")
        .includes((params.q || "").trim().toLocaleLowerCase("ru")) &&
      (!params.ingredientId ||
        dish.shortages.some((x) => x.ingredientId === params.ingredientId)),
  );
  const size = Number(params.pageSize || 50);
  const number = Math.min(
    Math.max(1, Number(params.page || 1)),
    Math.max(1, Math.ceil(filtered.length / size)),
  );
  const page: Page<DishAvailability> = {
    items: filtered.slice((number - 1) * size, number * size),
    total: filtered.length,
    page: number,
    pageSize: size,
  };
  const supply = stopSupply(all);
  return (
    <>
      <Heading
        title="Стоп-лист"
        action={
          <ActionButton
            showLabel
            icon="delivery"
            disabled={!query.data || query.isFetching || supply.length === 0}
            title="Заказать поставку: недостающие ингредиенты для 10 порций каждого активного блюда из всего стоп-листа. Общие ингредиенты суммируются."
            onClick={() =>
              navigate("/deliveries/new", {
                state: {
                  lines: supply,
                  draftKey: `delivery.stop.${crypto.randomUUID()}`,
                  note: "Недостающие ингредиенты для 10 порций каждого блюда из стоп-листа",
                },
              })
            }
          >
            Заказать недостающее
          </ActionButton>
        }
      />
      <AvailabilityStatus />
      <div className={s.toolbar}>
        <Field label="Колонки">
          <select
            value={columns}
            onChange={(event) => {
              const next = new URLSearchParams(search);
              next.set("columns", event.target.value);
              setSearch(next, { replace: true });
            }}
          >
            {[1, 2, 3, 4].map((number) => (
              <option value={number} key={number}>
                {number}
              </option>
            ))}
          </select>
        </Field>
        <Search value={params.q} onChange={(value) => update("q", value)} />
        <Field label="Недостающий ингредиент">
          <select
            value={params.ingredientId || ""}
            onChange={(event) => update("ingredientId", event.target.value)}
          >
            <option value="">Все ингредиенты</option>
            {ingredients.map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <ResetFilters />
      </div>

      <QueryState query={query}>
        {() => (
          <>
            {page.items.length ? (
              <div
                className={s.stopCards}
                style={
                  { "--stop-columns": columns } as import("react").CSSProperties
                }
              >
                {page.items.map((dish) => (
                  <article className={s.panel} key={dish.dishId}>
                    <h2>{dish.dishName}</h2>
                    <p>Не хватает на одну порцию</p>
                    <Requirements items={dish.shortages} />
                    <div className={s.row}>
                      <ActionLink
                        to={`/dishes/${dish.dishId}/edit`}
                        title={`Редактировать блюдо «${dish.dishName}»`}
                      >
                        Рецептура
                      </ActionLink>
                      <ActionLink
                        icon="copy"
                        to={`/dishes/new?copy=${dish.dishId}`}
                        aria-label={`Создать копию блюда «${dish.dishName}»`}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty>
                {all.length
                  ? "Блюда не найдены. Измените поиск или фильтр ингредиента."
                  : "Все активные блюда доступны. Стоп-лист пуст."}
              </Empty>
            )}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
