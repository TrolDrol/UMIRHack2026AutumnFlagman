import { z } from "zod";
z.config(z.locales.ru());
import { thousandths } from "./decimal";
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Укажите название")
  .max(120, "Не более 120 символов");
export const decimalSchema = z.string().refine((v) => {
  try {
    thousandths(v);
    return true;
  } catch {
    return false;
  }
}, "До 999999999.999, точка и до трёх знаков");
export const positiveQuantity = decimalSchema.refine((v) => {
  try {
    return thousandths(v) > 0n;
  } catch {
    return false;
  }
}, "Количество должно быть больше нуля");
export const hoursSchema = z
  .number()
  .int("Целое число часов")
  .min(1)
  .max(87600);
export const ingredientSchema = z
  .object({
    name: nameSchema,
    unit: z.enum(["g", "ml", "pcs"]),
    defaultShelfLifeHours: hoursSchema,
    reorderPoint: decimalSchema,
    targetStock: decimalSchema,
  })
  .refine(
    (v) => {
      try {
        return thousandths(v.targetStock) >= thousandths(v.reorderPoint);
      } catch {
        return true;
      }
    },
    {
      path: ["targetStock"],
      message: "Целевой запас должен быть не ниже порога",
    },
  );
export const dishSchema = z
  .object({
    name: nameSchema,
    active: z.boolean(),
    recipe: z
      .array(
        z.object({
          ingredientId: z.string().uuid("Выберите ингредиент"),
          quantity: positiveQuantity,
        }),
      )
      .min(1, "Добавьте ингредиент")
      .max(50),
  })
  .refine(
    (v) =>
      new Set(v.recipe.map((x) => x.ingredientId)).size === v.recipe.length,
    { path: ["recipe"], message: "Ингредиенты не должны повторяться" },
  );
export const orderSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            dishId: z.string().uuid(),
            portions: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .max(100),
    combos: z
      .array(
        z
          .object({
            comboId: z.string().uuid(),
            version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            quantity: z.number().int().min(1).max(1000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.lines.length + (v.combos?.length ?? 0) < 1)
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Добавьте хотя бы одно блюдо или комбо",
      });
    if (v.lines.length + (v.combos?.length ?? 0) > 100)
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "В заказе может быть не более 100 позиций",
      });
    if (new Set(v.lines.map((l) => l.dishId)).size !== v.lines.length)
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Блюда не должны повторяться отдельными строками",
      });
    if (
      new Set((v.combos ?? []).map((l) => l.comboId + ":" + l.version)).size !==
      (v.combos?.length ?? 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["combos"],
        message: "Комбо одной версии не должно повторяться отдельными строками",
      });
  });
