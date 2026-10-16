import { useScopedNavigate as useNavigate } from "../../shared/lib/routing";
import { useApi } from "../../shared/api/queries";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import type { Dish, DishInput, Ingredient } from "../../shared/api/types";
import { HttpError } from "../../shared/api/client";
import { useDirectory, useResource } from "../../shared/api/queries";
import { copyDish, sameName } from "../../shared/lib/copy";
import { dishSchema } from "../../shared/lib/schemas";
import { quantity, units } from "../../shared/lib/decimal";
import {
  loadDraft,
  useDraft,
  clearDraft,
  fieldErrors,
  useUnsaved,
} from "../../shared/lib/hooks";
import { Heading, Field, QueryState, ErrorNotice, s } from "../../shared/ui";
export function DishEditor() {
  const { request, readCollection, queryPrefix } = useApi();
  const { id } = useParams();
  const [search] = useSearchParams();
  const copyId = !id ? search.get("copy") : null;
  const query = useResource<Dish>(`dishes/${id}`, {}, !!id);
  const copyQuery = useQuery({
    queryKey: [...queryPrefix, "dishes", "copy", copyId],
    enabled: !!copyId,
    queryFn: async ({ signal }) => {
      const [source, all] = await Promise.all([
        request<Dish>(`/dishes/${copyId}`, { signal }),
        readCollection<Dish>("dishes", {}, signal),
      ]);
      return {
        data: copyDish(
          source.data,
          all.data.map((item) => item.name),
        ),
        meta: source.meta,
      };
    },
  });
  if (copyId)
    return (
      <>
        <Heading title="Копия блюда" />
        <QueryState query={copyQuery}>
          {(initial) => (
            <DishForm
              key={`copy-${copyId}`}
              copyId={copyId}
              initial={initial}
            />
          )}
        </QueryState>
      </>
    );
  if (id)
    return (
      <>
        <Heading title="Редактировать рецептуру" />
        <QueryState query={query}>
          {(dish) => <DishForm key={dish.id} dish={dish} />}
        </QueryState>
      </>
    );
  return (
    <>
      <Heading title="Новая рецептура" />
      <DishForm />
    </>
  );
}
function DishForm({
  dish,
  initial,
  copyId,
}: {
  dish?: Dish;
  initial?: DishInput;
  copyId?: string;
}) {
  const { context, request, readCollection } = useApi();

  const name = copyId ? `dish.copy.${copyId}` : `dish.${dish?.id || "new"}`;
  const client = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<DishInput>({
    shouldFocusError: false,
    resolver: zodResolver(dishSchema),
    defaultValues: loadDraft(
      context,
      name,
      initial ||
        (dish
          ? { name: dish.name, active: dish.active, recipe: dish.recipe }
          : {
              name: "",
              active: true,
              recipe: [{ ingredientId: "", quantity: "" }],
            }),
    ),
  });
  const lines = useFieldArray({ control: form.control, name: "recipe" });
  const ingredients = useDirectory<Ingredient>("ingredients");
  const [error, setError] = useState<unknown>(null);
  const errorScrollRef = useErrorScroll(form, error);
  const [saved, setSaved] = useState(false);
  const storageError = useDraft(context, name, form);
  useUnsaved(form.formState.isDirty && !saved);
  useEffect(() => {
    if (saved) navigate("/dishes");
  }, [saved, navigate]);
  const values = form.watch();
  const errors = form.formState.errors;
  return (
    <form
      ref={errorScrollRef}
      className={s.panel}
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          const existing = await readCollection<Dish>("dishes");
          if (
            existing.data.some(
              (item) => item.id !== dish?.id && sameName(item.name, v.name),
            )
          ) {
            form.setError("name", {
              message: "Блюдо с таким названием уже существует",
            });
            return;
          }
          await request(dish ? `/dishes/${dish.id}` : "/dishes", {
            method: dish ? "PUT" : "POST",
            body: JSON.stringify({
              ...v,
              recipe: v.recipe.map((x) => ({
                ...x,
                quantity: quantity(x.quantity),
              })),
            }),
          });
          clearDraft(context, name);
          await client.invalidateQueries({
            queryKey: ["warehouse", context.userId, context.warehouseId],
          });
          setSaved(true);
        } catch (e) {
          if (e instanceof HttpError && e.code === "NAME_CONFLICT")
            form.setError("name", {
              message: "Блюдо с таким названием уже существует",
            });
          setError(e);
          fieldErrors(e, form);
        }
      })}
    >
      {storageError && (
        <p role="alert" className={s.notice}>
          Черновик не удалось сохранить. Введённые данные остаются в форме.
        </p>
      )}
      <div className={s.grid}>
        <Field label="Название блюда" error={errors.name?.message}>
          <input {...form.register("name")} />
        </Field>
        <Field label="Блюдо активно">
          <input type="checkbox" {...form.register("active")} />
        </Field>
      </div>
      <h2>Состав на одну порцию</h2>
      <p className={s.muted}>
        От 1 до 50 ингредиентов. Допускаются дробные штуки.
      </p>
      <QueryState query={ingredients}>
        {(items) => (
          <>
            {lines.fields.map((line, index) => (
              <div className={s.line} key={line.id}>
                <div className={s.grid}>
                  <Field
                    label={`Ингредиент ${index + 1}`}
                    error={errors.recipe?.[index]?.ingredientId?.message}
                  >
                    <select {...form.register(`recipe.${index}.ingredientId`)}>
                      <option value="">Выберите ингредиент</option>
                      {items.map((x) => (
                        <option
                          key={x.id}
                          value={x.id}
                          disabled={values.recipe.some(
                            (r, i) => i !== index && r.ingredientId === x.id,
                          )}
                        >
                          {x.name} · {units[x.unit]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={`Расход на порцию, ${units[items.find((x) => x.id === values.recipe[index]?.ingredientId)?.unit || "g"]}`}
                    error={errors.recipe?.[index]?.quantity?.message}
                  >
                    <input
                      inputMode="decimal"
                      {...form.register(`recipe.${index}.quantity`)}
                    />
                  </Field>
                </div>
                <ActionButton type="button" onClick={() => lines.remove(index)}>
                  Удалить строку {index + 1}
                </ActionButton>
              </div>
            ))}
            <ActionButton
              type="button"
              disabled={lines.fields.length >= 50}
              onClick={() => lines.append({ ingredientId: "", quantity: "" })}
            >
              Добавить ингредиент
            </ActionButton>
          </>
        )}
      </QueryState>
      <p data-form-error className={s.fieldError}>
        {errors.recipe?.message || errors.recipe?.root?.message}
      </p>
      <ErrorNotice error={error} />
      <ActionButton
        className={s.primary}
        disabled={form.formState.isSubmitting || !ingredients.data}
      >
        Сохранить рецептуру
      </ActionButton>
    </form>
  );
}
