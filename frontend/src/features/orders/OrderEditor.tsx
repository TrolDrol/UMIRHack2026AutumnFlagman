import {
  AvailabilityStatus,
  useAvailability,
} from "../../shared/api/availability";
import type { PublicCombo } from "@rims/demo-api/contracts";
import { useScopedNavigate as useNavigate } from "../../shared/lib/routing";
import { useApi } from "../../shared/api/queries";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { AnimatedCollapse } from "../../shared/ui/AnimatedCollapse";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type {
  Dish,
  Envelope,
  Order,
  OrderInput,
  OrderPreview,
  ServicePreview,
  OrderReceipt,
  ServiceMenuItem,
  DishAvailability,
} from "../../shared/api/types";
import {
  useDirectory,
  useResource,
  useLiveCollection,
} from "../../shared/api/queries";
import { copyOrder } from "../../shared/lib/copy";
import { orderSchema } from "../../shared/lib/schemas";
import {
  beginPending,
  sendPending,
  readPending,
} from "../../shared/lib/pending";

import {
  loadDraft,
  useDraft,
  clearDraft,
  fieldErrors,
  useUnsaved,
  useOnline,
} from "../../shared/lib/hooks";
import {
  Heading,
  QueryState,
  Field,
  ErrorNotice,
  Requirements,
  ServiceShortages,
  Allocations,
  Modal,
  s,
} from "../../shared/ui";
import { dateTime } from "../../shared/lib/time";
import { DishPicker } from "./DishPicker";
import styles from "./orders.module.css";
export function OrderEditor({ service = false }: { service?: boolean }) {
  const [search] = useSearchParams();
  const copyId = search.get("copy");
  const query = useResource<Order>(
    `orders/${copyId}`,
    {},
    !!copyId && !service,
  );
  if (copyId && !service)
    return (
      <>
        <Heading title="Повторить заказ" />
        <QueryState query={query}>
          {(source) => <OrderForm key={copyId} source={source} />}
        </QueryState>
      </>
    );
  return <OrderForm key={service ? "service" : "new"} service={service} />;
}
function OrderForm({
  source,
  service = false,
}: {
  source?: Order;
  service?: boolean;
}) {
  const { context, request } = useApi();
  const endpoint = service ? "/service/orders" : "/orders";
  const location = useLocation();
  const proposed = location.state as {
    dishId?: string;
    portions?: number;
    warehouseId?: string;
  } | null;
  const add =
    proposed?.warehouseId && proposed.warehouseId !== context.warehouseId
      ? null
      : proposed;
  const form = useForm<OrderInput>({
    shouldFocusError: false,
    resolver: zodResolver(orderSchema),
    defaultValues: loadDraft(
      context,
      source
        ? `order.copy.${source.id}`
        : service
          ? "service.order.new"
          : "order.new",
      source ? copyOrder(source) : { lines: [] },
    ),
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const combos = useFieldArray({ control: form.control, name: "combos" });
  const comboCatalog = useLiveCollection<PublicCombo>("service/combos");
  const values = form.watch();
  const signature = JSON.stringify(values);
  const current = useRef(signature);
  current.current = signature;
  const availability = useAvailability();
  const [preview, setPreview] = useState<{
    signature: string;
    response: Envelope<OrderPreview | ServicePreview>;
  } | null>(null);
  useEffect(() => {
    setPreview(null);
  }, [availability.epoch]);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(() => {
    const saved = location.state as {
      warehouseId?: string;
      receipt?: OrderReceipt;
    } | null;
    return service && saved?.warehouseId === context.warehouseId
      ? saved.receipt || null
      : null;
  });
  const [result, setResult] = useState("");
  useEffect(() => {
    const saved = location.state as {
      warehouseId?: string;
      receipt?: OrderReceipt;
    } | null;
    if (service && saved?.warehouseId === context.warehouseId && saved.receipt)
      setReceipt(saved.receipt);
  }, [location.state, service, context.warehouseId]);
  const online = useOnline();
  const client = useQueryClient();
  const navigate = useNavigate();
  const dishes = useDirectory<Dish>("dishes", !service);
  const serviceMenu = useLiveCollection<ServiceMenuItem | DishAvailability>(
    service ? "service/menu" : "menu/availability",
  );
  const [dishNames, setDishNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      source?.lines.map((line) => [line.dishId, line.dishName]) || [],
    ),
  );
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(
    null,
  );
  const abort = useRef<AbortController | null>(null);
  const addDish = useCallback(
    (dishId: string, portions = 1, dishName?: string) => {
      if (dishName)
        setDishNames((previous) => ({ ...previous, [dishId]: dishName }));
      const index = form
        .getValues("lines")
        .findIndex((x) => x.dishId === dishId);
      if (index >= 0) {
        const n = form.getValues(`lines.${index}.portions`) + portions;
        if (n > 1000) {
          setError(new Error("Не более 1000 порций одного блюда"));
          return;
        }
        form.setValue(`lines.${index}.portions`, n, { shouldDirty: true });
      } else if (form.getValues("lines").length < 100)
        lines.append({ dishId, portions: Math.min(1000, portions) });
      else setError(new Error("Не более 100 блюд в заказе"));
    },
    [form, lines],
  );
  const added = useRef(false);
  useEffect(() => {
    if (add?.dishId && !added.current) {
      added.current = true;
      addDish(
        add.dishId,
        add.portions || 1,
        "dishName" in add ? String(add.dishName) : undefined,
      );
      navigate(service ? "/service/orders/new" : "/orders/new", {
        replace: true,
        state: null,
      });
    }
  }, [add, navigate, addDish, service]);
  useEffect(() => {
    abort.current?.abort();
    setError(null);
  }, [signature]);
  useEffect(() => () => abort.current?.abort(), []);
  const draftName = source
    ? `order.copy.${source.id}`
    : service
      ? "service.order.new"
      : "order.new";
  const storageError = useDraft(context, draftName, form);
  useUnsaved(form.formState.isDirty && !result);
  useEffect(() => {
    if (result && !service) navigate(`/orders/${result}`);
  }, [result, navigate, service]);
  const validPreview =
    preview?.signature === signature ? preview.response : null;
  const errorScrollRef = useErrorScroll(
    form,
    validPreview?.data.canCreate === false ? validPreview : error,
  );
  const pending = readPending().some(
    (x) =>
      x.context.userId === context.userId &&
      x.context.warehouseId === context.warehouseId &&
      x.path === endpoint,
  );
  const submit = form.handleSubmit(async (submittedValues) => {
    const body = submittedValues.combos?.length
      ? submittedValues
      : { lines: submittedValues.lines };
    if (!online || pending || submitting.current || result) return;
    submitting.current = true;
    setError(null);
    setPreview(null);
    setSaving(true);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const submitted = signature;
    try {
      const response = await request<OrderPreview | ServicePreview>(
        `${endpoint}/preview`,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || current.current !== submitted) return;
      if (!response.data.canCreate) {
        setPreview({ signature: submitted, response });
        return;
      }
      const saved = beginPending(context, endpoint, body, draftName);
      const created = await sendPending<Order | OrderReceipt>(saved, context);
      clearDraft(context, draftName);
      await client.invalidateQueries({
        queryKey: ["warehouse", context.userId, context.warehouseId],
      });
      setResult(created.data.id);
      if (service) setReceipt(created.data);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e);
        fieldErrors(e, form);
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  });
  if (receipt)
    return (
      <section className={s.panel}>
        <h1>Заказ {receipt.number} проведён</h1>
        <p>{dateTime(receipt.createdAt)} · Москва</p>
        {(
          receipt.composition ??
          receipt.lines.map((l) => ({ kind: "dish" as const, ...l }))
        ).map((item, i) => (
          <p key={i}>
            {item.kind === "dish"
              ? `${item.dishName} · ${item.portions}`
              : `${item.title} · ${item.quantity} · ${item.components.map((c) => c.dishName).join(" + ")}`}
          </p>
        ))}
        <ActionButton
          showLabel
          onClick={() => {
            form.reset({ lines: [] });
            setReceipt(null);
            setResult("");
            setPreview(null);
            navigate("/service/orders/new", { replace: true, state: null });
          }}
        >
          Новый заказ
        </ActionButton>
      </section>
    );
  return (
    <>
      {!source && <Heading title="Новый заказ" />}
      <AvailabilityStatus />
      {source && (
        <p className={s.muted}>
          Блюда и порции перенесены из {source.number}. Перед проведением
          проверьте текущие остатки.
        </p>
      )}
      {storageError && (
        <p role="alert" className={s.notice}>
          Черновик не удалось сохранить. Введённые данные остаются в форме.
        </p>
      )}
      <details className={s.panel}>
        <summary>Комбо</summary>
        <QueryState query={comboCatalog}>
          {(items) => (
            <div className={styles.cartGrid}>
              {items.map((c) => (
                <article className={styles.cartCard} key={c.id}>
                  <h3>{c.title}</h3>
                  <p>
                    {c.components.map((p) => p.dishName + " · 1").join(" + ")}
                  </p>
                  <p>
                    {c.status === "available"
                      ? `До ${c.maxUnits} комплектов`
                      : c.unavailableReason}
                  </p>
                  <ActionButton
                    icon="add"
                    title={`Добавить комбо ${c.title}`}
                    disabled={pending || saving || c.status !== "available"}
                    onClick={() => {
                      const list = form.getValues("combos") ?? [];
                      const index = list.findIndex(
                        (x) => x.comboId === c.id && x.version === c.version,
                      );
                      if (index < 0)
                        combos.append({
                          comboId: c.id,
                          version: c.version,
                          quantity: 1,
                        });
                      else
                        form.setValue(
                          `combos.${index}.quantity`,
                          Math.min(1000, list[index].quantity + 1),
                          { shouldDirty: true },
                        );
                    }}
                  />
                </article>
              ))}
            </div>
          )}
        </QueryState>
      </details>
      <DishPicker
        service={service}
        onAdd={addDish}
        disabled={pending || saving}
      />
      <form ref={errorScrollRef} className={s.panel} onSubmit={submit}>
        <h2>Корзина</h2>
        <p className={s.muted}>
          Блюда могут использовать общие ингредиенты. Проверка учитывает весь
          заказ.
        </p>
        {!lines.fields.length && !combos.fields.length && (
          <p>Корзина пуста. Добавьте блюдо из меню или горячих предложений.</p>
        )}
        <div className={styles.cartGrid}>
          {combos.fields.map((line, i) => {
            const c = comboCatalog.data?.data.find(
                (c) => c.id === line.comboId,
              ),
              count = values.combos?.[i]?.quantity ?? 1,
              changed = c?.version !== line.version;
            return (
              <article className={styles.cartCard} key={line.id}>
                <h3>{c?.title ?? "Комбо"}</h3>
                <p>{c?.components.map((p) => p.dishName).join(" + ")}</p>
                <p>Версия {line.version}</p>
                {changed && (
                  <p role="alert">
                    Версия изменилась. Удалите позицию и добавьте актуальную.
                  </p>
                )}
                <div className={styles.quantity}>
                  <ActionButton
                    icon="minus"
                    title="Уменьшить количество комплектов"
                    disabled={pending || saving || count <= 1}
                    onClick={() =>
                      form.setValue(`combos.${i}.quantity`, count - 1, {
                        shouldDirty: true,
                      })
                    }
                  />
                  <Field
                    label="Комплекты"
                    error={form.formState.errors.combos?.[i]?.quantity?.message}
                  >
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      disabled={pending || saving}
                      {...form.register(`combos.${i}.quantity`, {
                        valueAsNumber: true,
                      })}
                    />
                  </Field>
                  <ActionButton
                    icon="add"
                    title="Увеличить количество комплектов"
                    disabled={pending || saving || changed || count >= 1000}
                    onClick={() =>
                      form.setValue(`combos.${i}.quantity`, count + 1, {
                        shouldDirty: true,
                      })
                    }
                  />
                  <ActionButton
                    icon="remove"
                    title="Удалить комбо"
                    disabled={pending || saving}
                    onClick={() => {
                      if (window.confirm("Удалить комбо из корзины?"))
                        combos.remove(i);
                    }}
                  />
                </div>
              </article>
            );
          })}
          {lines.fields.map((line, i) => {
            const name =
              dishes.data?.data.find((x) => x.id === line.dishId)?.name ||
              dishNames[line.dishId] ||
              serviceMenu.data?.data.find((x) => x.dishId === line.dishId)
                ?.dishName ||
              (service ? "Блюдо недоступно" : line.dishId);
            const portions = values.lines[i]?.portions;
            const locked = pending || saving;
            const change = (delta: number) => {
              const next = Math.max(
                1,
                Math.min(
                  1000,
                  (Number.isFinite(portions) ? portions : 1) + delta,
                ),
              );
              form.setValue(`lines.${i}.portions`, next, {
                shouldDirty: true,
                shouldValidate: true,
              });
            };
            return (
              <article
                className={styles.cartCard}
                key={line.id}
                aria-label={`В корзине: ${name}`}
              >
                <div className={styles.cartHeader}>
                  <strong>{name}</strong>
                  <ActionButton
                    type="button"
                    className={`${styles.iconButton} ${styles.deleteButton}`}
                    aria-label={`Удалить ${name} из корзины`}
                    disabled={locked}
                    onClick={() => setRemoving({ id: line.id, name })}
                  />
                </div>
                <p>
                  {(() => {
                    const item = serviceMenu.data?.data.find(
                      (x) => x.dishId === line.dishId,
                    );
                    return item
                      ? item.status === "available"
                        ? `Доступно порций: ${item.maxPortions}`
                        : "Блюдо сейчас в стоп-листе"
                      : "Доступность уточняется";
                  })()}
                </p>
                <div className={styles.quantity}>
                  <ActionButton
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Уменьшить количество: ${name}`}
                    disabled={locked || portions <= 1}
                    onClick={() => change(-1)}
                  >
                    −
                  </ActionButton>
                  <Field
                    label="Порции"
                    error={form.formState.errors.lines?.[i]?.portions?.message}
                  >
                    <input
                      type="number"
                      aria-label={`Порции блюда ${i + 1}`}
                      min="1"
                      max="1000"
                      disabled={locked}
                      {...form.register(`lines.${i}.portions`, {
                        valueAsNumber: true,
                      })}
                    />
                  </Field>
                  <ActionButton
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Увеличить количество: ${name}`}
                    disabled={locked || portions >= 1000}
                    onClick={() => change(1)}
                  >
                    +
                  </ActionButton>
                </div>
              </article>
            );
          })}
        </div>
        <p data-form-error className={s.fieldError}>
          {form.formState.errors.lines?.message ||
            form.formState.errors.lines?.root?.message}
        </p>
        <AnimatedCollapse>
          {error ? <ErrorNotice error={error} /> : null}
        </AnimatedCollapse>
        <div className={s.row}>
          <ActionButton
            type="submit"
            className={s.primary}
            title="Провести заказ: проверить ингредиенты и сразу оформить заказ, если их хватает"
            aria-busy={saving}
            disabled={
              !online ||
              (!lines.fields.length && !combos.fields.length) ||
              saving ||
              !!result ||
              form.formState.isSubmitting ||
              pending
            }
          >
            Провести заказ
          </ActionButton>
        </div>
        <AnimatedCollapse>
          {validPreview ? (
            <section
              className={s.line}
              data-form-error={!validPreview.data.canCreate || undefined}
            >
              <h2>
                {validPreview.data.canCreate
                  ? "Остатки проверены. При проведении проверим их ещё раз"
                  : "Не хватает ингредиентов"}
              </h2>
              <p className={s.muted}>
                Снимок: {dateTime(validPreview.meta.serverTime)} · Москва.
                Проверка не резервирует остатки.
              </p>
              {"requirements" in validPreview.data ? (
                <Requirements items={validPreview.data.requirements} />
              ) : (
                <ServiceShortages items={validPreview.data.shortages} />
              )}
              {validPreview.data.canCreate &&
                "allocations" in validPreview.data && (
                  <>
                    <h3>План списания FEFO</h3>
                    <Allocations items={validPreview.data.allocations} />
                  </>
                )}
            </section>
          ) : null}
        </AnimatedCollapse>
      </form>
      {removing && (
        <Modal
          title="Удалить блюдо из корзины?"
          onClose={() => setRemoving(null)}
        >
          <p className={styles.confirmText}>
            Блюдо «{removing.name}» будет удалено из заказа.
          </p>
          <div className={s.row}>
            <ActionButton type="button" onClick={() => setRemoving(null)}>
              Оставить в корзине
            </ActionButton>
            <ActionButton
              type="button"
              className={s.primary}
              disabled={pending || saving}
              onClick={() => {
                const index = lines.fields.findIndex(
                  (line) => line.id === removing.id,
                );
                if (index >= 0) lines.remove(index);
                setRemoving(null);
              }}
            >
              Удалить блюдо
            </ActionButton>
          </div>
        </Modal>
      )}
    </>
  );
}
