import { useApi } from "../../shared/api/queries";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Ingredient,
  IngredientInput,
  IngredientPatch,
} from "../../shared/api/types";
import { HttpError } from "../../shared/api/client";

import { sameName } from "../../shared/lib/copy";
import { ingredientSchema } from "../../shared/lib/schemas";
import { quantity, units } from "../../shared/lib/decimal";
import {
  loadDraft,
  useDraft,
  clearDraft,
  fieldErrors,
  useUnsaved,
} from "../../shared/lib/hooks";
import { Modal, Field, ErrorNotice, s } from "../../shared/ui";
export function IngredientEditor({
  ingredient,
  initial,
  copyId,
  onClose,
}: {
  ingredient?: Ingredient;
  initial?: IngredientInput;
  copyId?: string;
  onClose: () => void;
}) {
  const { context, request, readCollection } = useApi();

  const name = copyId
    ? `ingredient.copy.${copyId}`
    : `ingredient.${ingredient?.id || "new"}`;
  const form = useForm<IngredientInput>({
    shouldFocusError: false,
    resolver: zodResolver(ingredientSchema),
    defaultValues: loadDraft(
      context,
      name,
      initial ||
        ingredient || {
          name: "",
          unit: "g",
          defaultShelfLifeHours: 48,
          reorderPoint: "0",
          targetStock: "0",
        },
    ),
  });
  const storageError = useDraft(context, name, form);
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const errorScrollRef = useErrorScroll(form, error);
  const { errors, isDirty, isSubmitting } = form.formState;
  useUnsaved(isDirty);
  return (
    <Modal
      title={
        ingredient
          ? "Редактировать ингредиент"
          : copyId
            ? "Копия ингредиента"
            : "Новый ингредиент"
      }
      onClose={onClose}
      dirty={isDirty}
    >
      <form
        ref={errorScrollRef}
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const existing = await readCollection<Ingredient>("ingredients");
            if (
              existing.data.some(
                (item) =>
                  item.id !== ingredient?.id && sameName(item.name, v.name),
              )
            ) {
              form.setError("name", {
                message: "Ингредиент с таким названием уже существует",
              });
              return;
            }
            const body = {
              ...v,
              name: v.name.trim(),
              reorderPoint: quantity(v.reorderPoint),
              targetStock: quantity(v.targetStock),
            };
            if (ingredient) {
              const patch: IngredientPatch = {};
              for (const key of [
                "name",
                "defaultShelfLifeHours",
                "reorderPoint",
                "targetStock",
              ] as const)
                if (body[key] !== ingredient[key])
                  Object.assign(patch, { [key]: body[key] });
              if (Object.keys(patch).length)
                await request(`/ingredients/${ingredient.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(patch),
                });
            } else
              await request("/ingredients", {
                method: "POST",
                body: JSON.stringify(body),
              });
            clearDraft(context, name);
            await client.invalidateQueries({
              queryKey: ["warehouse", context.userId, context.warehouseId],
            });
            onClose();
          } catch (e) {
            if (e instanceof HttpError && e.code === "NAME_CONFLICT")
              form.setError("name", {
                message: "Ингредиент с таким названием уже существует",
              });
            setError(e);
            fieldErrors(e, form);
          }
        })}
      >
        <div className={s.grid}>
          <Field label="Название" error={errors.name?.message}>
            <input {...form.register("name")} />
          </Field>
          <Field label="Единица измерения">
            <select disabled={!!ingredient} {...form.register("unit")}>
              <option value="g">Граммы (г)</option>
              <option value="ml">Миллилитры (мл)</option>
              <option value="pcs">Штуки (шт.)</option>
            </select>
          </Field>
          <Field
            label="Срок по умолчанию, часы"
            error={errors.defaultShelfLifeHours?.message}
          >
            <input
              type="number"
              {...form.register("defaultShelfLifeHours", {
                valueAsNumber: true,
              })}
            />
          </Field>
          <Field
            label="Порог пополнения"
            error={errors.reorderPoint?.message}
            hint={`Количество в ${units[form.watch("unit")]}`}
          >
            <input inputMode="decimal" {...form.register("reorderPoint")} />
          </Field>
          <Field
            label="Целевой запас"
            error={errors.targetStock?.message}
            hint={`Количество в ${units[form.watch("unit")]}`}
          >
            <input inputMode="decimal" {...form.register("targetStock")} />
          </Field>
        </div>
        <p className={s.muted}>
          Порог и запас указаны в выбранной единице. Изменение срока действует
          только для будущих приёмок. Срок существующих партий сохраняется.
        </p>
        {storageError && (
          <p role="alert">Черновик не удалось сохранить в этой вкладке.</p>
        )}
        <ErrorNotice error={error} />
        <ActionButton className={s.primary} disabled={isSubmitting}>
          Сохранить ингредиент
        </ActionButton>
      </form>
    </Modal>
  );
}
