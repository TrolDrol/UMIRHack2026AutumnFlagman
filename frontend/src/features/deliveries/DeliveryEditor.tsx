import { useScopedNavigate as useNavigate } from "../../shared/lib/routing";
import { useApi } from "../../shared/api/queries";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { useEffect, useState, useRef } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { DateTimePicker } from "../../shared/ui/DateTimePicker";
import { nextDeliveryNumber } from "../../shared/lib/deliveryNumber";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import type {
  Delivery,
  DeliveryInput,
  Ingredient,
} from "../../shared/api/types";
import { useDirectory } from "../../shared/api/queries";
import { HttpError } from "../../shared/api/client";
import { copyDelivery, sameName } from "../../shared/lib/copy";
import { positiveQuantity } from "../../shared/lib/schemas";
import { quantity, units } from "../../shared/lib/decimal";
import { moscowToUtc, utcToMoscow, dateTime } from "../../shared/lib/time";
import {
  loadDraft,
  useDraft,
  clearDraft,
  fieldErrors,
  useUnsaved,
  useOnline,
} from "../../shared/lib/hooks";
import {
  beginPending,
  readPending,
  sendPending,
} from "../../shared/lib/pending";
import { Heading, Field, QueryState, ErrorNotice, s } from "../../shared/ui";
const localDate = z.string().refine((v) => {
  try {
    moscowToUtc(v);
    return true;
  } catch {
    return false;
  }
}, "Укажите корректное московское время");
const schema = z.object({
  number: z.string().trim().min(1, "Укажите номер").max(64),
  expectedAt: z.union([z.literal(""), localDate]),
  note: z.string().max(500),
  lines: z
    .array(
      z.object({
        ingredientId: z.string().uuid("Выберите ингредиент"),
        quantity: positiveQuantity,
        mode: z.enum(["explicit", "manufactured"]),
        expiresAt: z.string(),
        manufacturedAt: z.string(),
        shelfLifeHours: z.string(),
      }),
    )
    .min(1, "Добавьте хотя бы одну позицию")
    .max(100),
});
type Values = z.infer<typeof schema>;
const emptyLine = {
  ingredientId: "",
  quantity: "",
  mode: "explicit" as const,
  expiresAt: "",
  manufacturedAt: "",
  shelfLifeHours: "",
};
export function DeliveryEditor() {
  const { request, readCollection, queryPrefix } = useApi();
  const location = useLocation();
  const [search] = useSearchParams();
  const copyId = search.get("copy");
  const batchId = search.get("batch");
  const query = useQuery({
    queryKey: [...queryPrefix, "deliveries", "copy", copyId, batchId],
    enabled: !!copyId,
    queryFn: async ({ signal }) => {
      const [source, all] = await Promise.all([
        request<Delivery>(`/deliveries/${copyId}`, { signal }),
        readCollection<Delivery>("deliveries", {}, signal),
      ]);
      const batches = batchId
        ? source.data.lines.filter((item) =>
            source.data.batches.some(
              (batch) =>
                batch.id === batchId && batch.deliveryItemId === item.id,
            ),
          )
        : source.data.lines;
      if (!batches.length)
        throw new Error("В исходной поставке нет выбранных партий");
      return {
        data: copyDelivery(
          source.data,
          all.data.map((item) => item.number),
          batches,
        ),
        meta: source.meta,
      };
    },
  });
  if (copyId)
    return (
      <>
        <Heading title="Копия поставки" />
        <QueryState query={query}>
          {(initial) => (
            <DeliveryForm
              key={`${copyId}.${batchId || "all"}`}
              initial={initial}
              copyId={`${copyId}.${batchId || "all"}`}
            />
          )}
        </QueryState>
      </>
    );
  return (
    <DeliveryForm
      key={
        (location.state as { draftKey?: string } | null)?.draftKey ||
        location.key
      }
    />
  );
}
function DeliveryForm({
  initial,
  copyId,
}: {
  initial?: DeliveryInput;
  copyId?: string;
}) {
  const { context, readCollection, queryPrefix } = useApi();

  const location = useLocation();
  const candidate = location.state as {
    warehouseId?: string;
    draftKey?: string;
    note?: string;
    lines?: { ingredientId: string; quantity: string }[];
  } | null;
  const prefill =
    candidate?.warehouseId && candidate.warehouseId !== context.warehouseId
      ? null
      : candidate;
  const draftName = copyId
    ? `delivery.copy.${copyId}`
    : prefill?.draftKey ||
      (prefill?.lines ? `delivery.prefill.${location.key}` : "delivery.new");
  const form = useForm<Values>({
    shouldUnregister: false,
    shouldFocusError: false,
    resolver: zodResolver(schema),
    defaultValues: loadDraft(
      context,
      draftName,
      initial
        ? {
            number: initial.number,
            expectedAt: initial.expectedAt
              ? utcToMoscow(initial.expectedAt)
              : "",
            note: initial.note || "",
            lines: initial.lines.map((line) =>
              "expiresAt" in line
                ? {
                    ...emptyLine,
                    ingredientId: line.ingredientId,
                    quantity: line.quantity,
                    expiresAt: utcToMoscow(line.expiresAt),
                  }
                : {
                    ...emptyLine,
                    ingredientId: line.ingredientId,
                    quantity: line.quantity,
                    mode: "manufactured",
                    manufacturedAt: utcToMoscow(line.manufacturedAt),
                    shelfLifeHours: String(line.shelfLifeHours || ""),
                  },
            ),
          }
        : {
            number: "",
            expectedAt: "",
            note: prefill?.note || "",
            lines: prefill?.lines?.map((x) => ({ ...emptyLine, ...x })) || [
              { ...emptyLine },
            ],
          },
    ),
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const ingredients = useDirectory<Ingredient>("ingredients");
  const values = form.watch();
  const numbered = useRef(Boolean(form.getValues("number")));
  const numbers = useQuery({
    queryKey: [...queryPrefix, "deliveries", "automatic-number", draftName],
    enabled: !copyId && !values.number,
    queryFn: ({ signal }) => readCollection<Delivery>("deliveries", {}, signal),
  });
  useEffect(() => {
    if (numbers.data && !numbered.current && !form.getValues("number")) {
      numbered.current = true;
      form.setValue(
        "number",
        nextDeliveryNumber(
          numbers.data.data.map((delivery) => delivery.number),
        ),
      );
    }
  }, [numbers.data, form]);
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const errorScrollRef = useErrorScroll(form, error || numbers.error);
  const [result, setResult] = useState("");
  const client = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const storageError = useDraft(context, draftName, form);
  useUnsaved(form.formState.isDirty && !result);
  useEffect(() => {
    if (result) navigate(`/deliveries/${result}`);
  }, [result, navigate]);
  return (
    <>
      {!copyId && <Heading title="Входящая поставка" />}
      {copyId && (
        <p className={s.muted}>
          Состав и сроки перенесены без продления. Проверьте даты: новый
          документ будет ожидать подтверждения приёмки.
        </p>
      )}
      {storageError && (
        <p role="alert" className={s.notice}>
          Черновик не удалось сохранить. Введённые данные остаются в форме.
        </p>
      )}
      <form
        ref={errorScrollRef}
        className={s.panel}
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const existing = await readCollection<Delivery>("deliveries");
            if (
              existing.data.some((item) =>
                sameName(item.number, v.number, true),
              )
            ) {
              form.setError("number", {
                message: "Поставка с таким номером уже существует",
              });
              return;
            }
            const expectedAt = v.expectedAt ? moscowToUtc(v.expectedAt) : null;
            let invalid = false;
            const bodyLines = v.lines.map((line, i) => {
              const base = {
                ingredientId: line.ingredientId,
                quantity: quantity(line.quantity),
              };
              try {
                if (line.mode === "explicit") {
                  const expiresAt = moscowToUtc(line.expiresAt);
                  return { ...base, expiresAt };
                }
                const manufacturedAt = moscowToUtc(line.manufacturedAt);
                const hours =
                  line.shelfLifeHours === ""
                    ? ingredients.data!.data.find(
                        (x) => x.id === line.ingredientId,
                      )!.defaultShelfLifeHours
                    : Number(line.shelfLifeHours);
                if (!Number.isInteger(hours) || hours < 1 || hours > 87600) {
                  form.setError(`lines.${i}.shelfLifeHours`, {
                    message: "Целое число от 1 до 87600",
                  });
                  invalid = true;
                }
                return {
                  ...base,
                  manufacturedAt,
                  ...(line.shelfLifeHours !== ""
                    ? { shelfLifeHours: hours }
                    : {}),
                };
              } catch {
                form.setError(
                  `lines.${i}.${line.mode === "explicit" ? "expiresAt" : "manufacturedAt"}`,
                  { message: "Укажите дату и время" },
                );
                invalid = true;
                return { ...base, expiresAt: "" };
              }
            });
            if (invalid) return;
            const body: DeliveryInput = {
              number: v.number.trim(),
              expectedAt,
              note: v.note || null,
              lines: bodyLines,
            };
            const pending = beginPending(
              context,
              "/deliveries",
              body,
              draftName,
            );
            const response = await sendPending<Delivery>(pending, context);
            clearDraft(context, draftName);
            await client.invalidateQueries({ queryKey: queryPrefix });
            setResult(response.data.id);
          } catch (e) {
            if (e instanceof HttpError && e.code === "DELIVERY_NUMBER_EXISTS")
              form.setError("number", {
                message: "Поставка с таким номером уже существует",
              });
            setError(e);
            fieldErrors(e, form);
          }
        })}
      >
        <div className={s.grid}>
          <Field
            label="Номер поставки"
            error={errors.number?.message}
            hint={
              numbers.isFetching
                ? "Подбираем номер…"
                : "Номер можно изменить вручную"
            }
          >
            <input
              {...form.register("number")}
              onFocus={() => {
                numbered.current = true;
              }}
            />
          </Field>
          <Controller
            name="expectedAt"
            control={form.control}
            render={({ field }) => (
              <DateTimePicker
                {...field}
                label="Ожидаемая доставка · Москва (UTC+3)"
                error={errors.expectedAt?.message}
              />
            )}
          />
          <Field label="Заметка (необязательно)" error={errors.note?.message}>
            <textarea {...form.register("note")} />
          </Field>
        </div>
        <QueryState query={ingredients}>
          {(items) => (
            <>
              {lines.fields.map((line, i) => {
                const item = items.find(
                  (x) => x.id === values.lines[i]?.ingredientId,
                );
                const mode = values.lines[i]?.mode;
                let expiry: string | null = null;
                try {
                  const row = values.lines[i];
                  if (mode === "explicit" && row.expiresAt)
                    expiry = moscowToUtc(row.expiresAt);
                  else if (
                    mode === "manufactured" &&
                    row.manufacturedAt &&
                    item
                  ) {
                    const hours =
                      row.shelfLifeHours === ""
                        ? item.defaultShelfLifeHours
                        : Number(row.shelfLifeHours);
                    if (Number.isInteger(hours) && hours >= 1 && hours <= 87600)
                      expiry = new Date(
                        Date.parse(moscowToUtc(row.manufacturedAt)) +
                          hours * 3600000,
                      ).toISOString();
                  }
                } catch {
                  /* Invalid input is handled on submit. */
                }
                return (
                  <section className={s.line} key={line.id}>
                    <h2>Позиция {i + 1}</h2>
                    <div className={s.grid}>
                      <Field
                        label="Ингредиент"
                        error={errors.lines?.[i]?.ingredientId?.message}
                      >
                        <select {...form.register(`lines.${i}.ingredientId`)}>
                          <option value="">Выберите ингредиент</option>
                          {items.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} · {units[x.unit]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        label={`Количество, ${item ? units[item.unit] : "базовая единица"}`}
                        error={errors.lines?.[i]?.quantity?.message}
                      >
                        <input
                          inputMode="decimal"
                          {...form.register(`lines.${i}.quantity`)}
                        />
                      </Field>
                      <Field label="Способ задания срока">
                        <select {...form.register(`lines.${i}.mode`)}>
                          <option value="explicit">
                            Точное время истечения
                          </option>
                          <option value="manufactured">
                            Изготовление + срок хранения
                          </option>
                        </select>
                      </Field>
                      {mode === "explicit" ? (
                        <Controller
                          key="expiresAt"
                          name={`lines.${i}.expiresAt`}
                          control={form.control}
                          render={({ field }) => (
                            <DateTimePicker
                              {...field}
                              label="Истекает · Москва (UTC+3)"
                              error={errors.lines?.[i]?.expiresAt?.message}
                            />
                          )}
                        />
                      ) : (
                        <>
                          <Controller
                            key="manufacturedAt"
                            name={`lines.${i}.manufacturedAt`}
                            control={form.control}
                            render={({ field }) => (
                              <DateTimePicker
                                {...field}
                                label="Изготовлено · Москва (UTC+3)"
                                error={
                                  errors.lines?.[i]?.manufacturedAt?.message
                                }
                              />
                            )}
                          />
                          <Field
                            label="Срок хранения, часы"
                            hint={`Оставьте пустым: по умолчанию ${item?.defaultShelfLifeHours || "—"} ч`}
                            error={errors.lines?.[i]?.shelfLifeHours?.message}
                          >
                            <input
                              type="number"
                              {...form.register(`lines.${i}.shelfLifeHours`)}
                            />
                          </Field>
                        </>
                      )}
                    </div>
                    {expiry && (
                      <p className={s.muted}>
                        Расчётный срок: {dateTime(expiry)} · Москва
                      </p>
                    )}
                    {expiry && Date.parse(expiry) < Date.now() && (
                      <p className={s.notice}>
                        Историческая партия уже просрочена сейчас. Пригодность
                        на момент приёмки проверит сервер.
                      </p>
                    )}
                    <div className={s.actions}>
                      {" "}
                      <ActionButton
                        type="button"
                        onClick={() => lines.remove(i)}
                      >
                        Удалить позицию {i + 1}
                      </ActionButton>
                      <ActionButton
                        type="button"
                        icon="copy"
                        disabled={lines.fields.length >= 100}
                        aria-label={`Создать копию партии ${i + 1}`}
                        onClick={() =>
                          lines.append({ ...form.getValues(`lines.${i}`) })
                        }
                      />
                    </div>
                  </section>
                );
              })}
              <ActionButton
                type="button"
                disabled={lines.fields.length >= 100}
                onClick={() => lines.append({ ...emptyLine })}
              >
                Добавить позицию
              </ActionButton>
            </>
          )}
        </QueryState>
        <p data-form-error className={s.fieldError}>
          {errors.lines?.message || errors.lines?.root?.message}
        </p>
        <p className={s.muted}>
          Документ создаётся в ожидании приёмки. Каждая строка станет отдельной
          складской партией только после подтверждения менеджером. Повтор
          ингредиента допустим.
        </p>
        <ErrorNotice error={error} />
        <ErrorNotice error={numbers.error} />
        <ActionButton
          showLabel
          icon="delivery"
          className={s.primary}
          disabled={
            !online ||
            form.formState.isSubmitting ||
            !ingredients.data ||
            readPending().some(
              (x) =>
                x.context.userId === context.userId &&
                x.context.warehouseId === context.warehouseId &&
                x.path === "/deliveries",
            )
          }
        >
          Заказать
        </ActionButton>
      </form>
    </>
  );
}
