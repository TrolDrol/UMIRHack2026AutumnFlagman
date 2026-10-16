import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace, scopeKey, management } from "../app/workspace";
import { useResource, useDirectory } from "../shared/api/queries";
import type { ManualOffer, Dish, Page } from "../shared/api/types";
import { beginPending, sendPending, pendingFor } from "../shared/lib/pending";
import {
  useDraft,
  loadDraft,
  clearDraft,
  useUnsaved,
} from "../shared/lib/hooks";
import { moscowToUtc, utcToMoscow, dateTime } from "../shared/lib/time";
import { DateTimePicker } from "../shared/ui/DateTimePicker";
import {
  ActionButton,
  Field,
  ErrorNotice,
  QueryState,
  Pager,
  Search,
  s,
} from "../shared/ui";

type Form = {
  dishId: string;
  title: string;
  publicText: string;
  startsAt: string;
  endsAt: string;
  startMode: string;
  id: string;
  version: number;
};
const empty: Form = {
  dishId: "",
  title: "",
  publicText: "",
  startsAt: "",
  endsAt: "",
  startMode: "publish",
  id: "",
  version: 0,
};
const states = {
  draft: "Черновик",
  scheduled: "Запланировано",
  visible: "Действует",
  unavailable: "Блюдо недоступно",
  ended: "Завершено",
  archived: "Архив",
};
export function ManualOffers() {
  const context = useWorkspace();
  const client = useQueryClient();
  const [params, setParams] = useState<Record<string, string>>({});
  const query = useResource<Page<ManualOffer>>(
    "manual-offers",
    params,
    management(context.role),
  );
  const dishes = useDirectory<Dish>("dishes", management(context.role));
  const form = useForm<Form>({
    defaultValues: loadDraft(context, "manual-offer", empty),
  });
  const storageError = useDraft(context, "manual-offer", form);
  useUnsaved(form.formState.isDirty);
  const value = form.watch();
  const [open, setOpen] = useState(Boolean(value.title || value.id));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (!management(context.role)) return null;
  const update = (key: string, v: string) =>
    setParams((p) => ({
      ...p,
      [key]: v,
      ...(key !== "page" ? { page: "1" } : {}),
    }));
  const send = async (
    path: string,
    body: object,
    method: "POST" | "PUT" = "POST",
  ) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await sendPending<ManualOffer>(
        beginPending(context, path, body, "manual-offer", method),
        context,
      );
      await client.invalidateQueries({ queryKey: scopeKey(context) });
      setNotice("Предложение сохранено.");
      return result.data;
    } catch (e) {
      setError(e);
      await query.refetch();
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.panel}>
      <h2>Управление ручными предложениями</h2>
      <ActionButton
        showLabel
        disabled={busy}
        onClick={() => {
          form.reset(empty);
          setOpen(true);
          setError(null);
        }}
      >
        Добавить предложение
      </ActionButton>
      <div className={s.toolbar}>
        <Search value={params.q} onChange={(v) => update("q", v)} />
        <Field label="Статус">
          <select
            value={params.status || ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="draft">Черновики</option>
            <option value="published">Опубликованные</option>
            <option value="archived">Архив</option>
          </select>
        </Field>
      </div>
      <ErrorNotice error={error} />
      {notice && <p role="status">{notice}</p>}
      {storageError && (
        <p role="alert">Не удалось сохранить черновик в браузере.</p>
      )}
      {open && (
        <form
          onSubmit={form.handleSubmit(async (v) => {
            let startsAt: string | null = null,
              endsAt: string;
            try {
              if (v.startMode === "explicit")
                startsAt = moscowToUtc(v.startsAt);
              endsAt = moscowToUtc(v.endsAt);
            } catch {
              form.setError("endsAt", {
                message: "Укажите корректные даты в Москве",
              });
              return;
            }
            if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
              form.setError("endsAt", {
                message: "Окончание должно быть позже начала",
              });
              return;
            }
            const result = await send(
              v.id ? `/manual-offers/${v.id}` : "/manual-offers",
              {
                dishId: v.dishId,
                title: v.title.trim(),
                publicText: v.publicText || null,
                startsAt,
                endsAt,
                ...(v.id ? { expectedVersion: v.version } : {}),
              },
              v.id ? "PUT" : "POST",
            );
            if (result) {
              form.reset(empty);
              clearDraft(context, "manual-offer");
              setOpen(false);
            }
          })}
        >
          <h3>{value.id ? "Редактировать черновик" : "Новый черновик"}</h3>
          <p>
            Заголовок и описание будут видны покупателям. Сохранение черновика
            не публикует его.
          </p>
          <Field label="Блюдо" error={form.formState.errors.dishId?.message}>
            <select
              disabled={!!value.id}
              {...form.register("dishId", { required: "Выберите блюдо" })}
            >
              <option value="">Выберите блюдо</option>
              {dishes.data?.data
                .filter((d) => d.active || d.id === value.dishId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </Field>
          <ErrorNotice error={dishes.error} />
          <Field
            label="Публичный заголовок"
            error={form.formState.errors.title?.message}
          >
            <input
              maxLength={120}
              {...form.register("title", {
                validate: (v) => !!v.trim() || "Укажите заголовок",
                maxLength: 120,
              })}
            />
          </Field>
          <Field label="Публичное описание">
            <textarea
              maxLength={500}
              {...form.register("publicText", { maxLength: 500 })}
            />
          </Field>
          <Field label="Начало">
            <select {...form.register("startMode")}>
              <option value="publish">Начать при публикации</option>
              <option value="explicit">Указать начало</option>
            </select>
          </Field>
          {value.startMode === "explicit" && (
            <DateTimePicker
              label="Начало · Москва"
              value={value.startsAt}
              onChange={(v) =>
                form.setValue("startsAt", v, { shouldDirty: true })
              }
            />
          )}
          <DateTimePicker
            label="Окончание · Москва"
            value={value.endsAt}
            onChange={(v) => form.setValue("endsAt", v, { shouldDirty: true })}
            error={form.formState.errors.endsAt?.message}
          />
          {value.id && (
            <p>
              Версия {value.version}. При конфликте введённый текст сохраняется:
              перечитайте запись и сверьте изменения перед повторным
              сохранением.
            </p>
          )}
          <ActionButton
            showLabel
            disabled={
              busy ||
              pendingFor(context).some((p) => p.resource === "manual-offers")
            }
          >
            Сохранить черновик
          </ActionButton>
          <ActionButton showLabel type="button" onClick={() => setOpen(false)}>
            Закрыть форму
          </ActionButton>
        </form>
      )}
      <QueryState query={query}>
        {(page) => (
          <>
            <div className={s.cards}>
              {page.items.map((o) => (
                <article className={s.panel} key={o.id}>
                  <h3>
                    {o.title} · {o.dishName}
                  </h3>
                  <p>
                    {states[o.effectiveState]} · версия {o.version}
                  </p>
                  <p>{o.publicText}</p>
                  <p>До {dateTime(o.endsAt)} · Москва</p>
                  {o.unavailableReason && <p>{o.unavailableReason}</p>}
                  {o.status === "draft" && (
                    <ActionButton
                      showLabel
                      onClick={() => {
                        form.reset({
                          id: o.id,
                          version: o.version,
                          dishId: o.dishId,
                          title: o.title,
                          publicText: o.publicText || "",
                          startsAt: o.startsAt ? utcToMoscow(o.startsAt) : "",
                          endsAt: utcToMoscow(o.endsAt),
                          startMode: o.startsAt ? "explicit" : "publish",
                        });
                        setOpen(true);
                      }}
                    >
                      Редактировать
                    </ActionButton>
                  )}
                  {o.status !== "archived" && (
                    <>
                      <ActionButton
                        showLabel
                        disabled={busy}
                        onClick={() =>
                          void send(
                            `/manual-offers/${o.id}/${o.status === "draft" ? "publish" : "unpublish"}`,
                            { expectedVersion: o.version },
                          )
                        }
                      >
                        {o.status === "draft"
                          ? "Опубликовать предложение"
                          : "Снять с публикации"}
                      </ActionButton>
                      <ActionButton
                        showLabel
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Архивировать предложение? Восстановление из архива недоступно.",
                            )
                          )
                            void send(`/manual-offers/${o.id}/archive`, {
                              expectedVersion: o.version,
                            });
                        }}
                      >
                        Архивировать
                      </ActionButton>
                    </>
                  )}
                </article>
              ))}
            </div>
            {!page.items.length && <p>Ручных предложений нет.</p>}
            <Pager page={page} onChange={update} />
          </>
        )}
      </QueryState>
    </section>
  );
}
