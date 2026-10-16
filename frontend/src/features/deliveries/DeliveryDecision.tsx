import { serverNow } from "../../shared/api/client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkspace, management, scopeKey } from "../../app/workspace";
import {
  beginPending,
  sendPending,
  pendingFor,
} from "../../shared/lib/pending";
import type { Delivery } from "../../shared/api/types";
import { ActionButton, Field, ErrorNotice, s } from "../../shared/ui";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { useOnline, useUnsaved, fieldErrors } from "../../shared/lib/hooks";
import { moscowToUtc } from "../../shared/lib/time";
import { DateTimePicker } from "../../shared/ui/DateTimePicker";
export function DeliveryDecision({ delivery }: { delivery: Delivery }) {
  const context = useWorkspace();
  const online = useOnline();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<"server" | "explicit">("server");
  const confirm = useForm<{ receivedAt: string }>({
    defaultValues: { receivedAt: "" },
    shouldFocusError: false,
  });
  const reject = useForm<{ reason: string }>({
    defaultValues: { reason: "" },
    shouldFocusError: false,
  });
  const confirmRef = useErrorScroll(confirm, error);
  const rejectRef = useErrorScroll(reject, error);
  useUnsaved(confirm.formState.isDirty || reject.formState.isDirty);
  const receivedAt = confirm.watch("receivedAt");
  const historical = delivery.lines.some(
    (line) =>
      serverNow() !== null && Date.parse(line.expiresAt) <= serverNow()!,
  );
  const decide = async (action: "confirm" | "reject", body: object) => {
    setError(null);
    try {
      const pending = beginPending(
        context,
        `/deliveries/${delivery.id}/${action}`,
        body,
      );
      await sendPending<Delivery>(pending, context);
      confirm.reset();
      reject.reset();
      await client.invalidateQueries({ queryKey: scopeKey(context) });
    } catch (e) {
      setError(e);
      if (action === "confirm") fieldErrors(e, confirm);
    }
  };
  if (delivery.status !== "pending" || !management(context.role)) return null;
  const busy =
    confirm.formState.isSubmitting ||
    reject.formState.isSubmitting ||
    pendingFor(context).some((p) =>
      p.path.startsWith(`/deliveries/${delivery.id}/`),
    );
  return (
    <section className={s.panel}>
      <h2>Решение по входящей поставке</h2>
      <p>
        До подтверждения складской приход отсутствует. Сроки исходных строк не
        продлеваются.
      </p>
      {historical && (
        <p className={s.notice}>
          В документе есть позиции, просроченные на текущий момент. Историческая
          приёмка допустима, если срок ещё не истёк в указанное время приёмки;
          такие партии сейчас будут просроченными и недоступными для заказа.
        </p>
      )}
      <form
        ref={confirmRef}
        onSubmit={confirm.handleSubmit(async (value) => {
          try {
            if (mode === "server") {
              await decide("confirm", { receivedAtMode: "server" });
              return;
            }
            const utc = moscowToUtc(value.receivedAt);
            await decide("confirm", { receivedAt: utc });
          } catch {
            confirm.setError("receivedAt", { message: "Укажите дату и время" });
          }
        })}
      >
        <Field label="Время приёмки">
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as "server" | "explicit");
              confirm.clearErrors("receivedAt");
              setError(null);
            }}
          >
            <option value="server">Принять сейчас</option>
            <option value="explicit">Указать фактическую дату</option>
          </select>
        </Field>
        {mode === "server" && (
          <p>
            Время будет зафиксировано сервером при подтверждении. Сроки годности
            проверит сервер.
          </p>
        )}
        {mode === "explicit" && (
          <DateTimePicker
            label="Фактическая приёмка · Москва (UTC+3)"
            value={receivedAt}
            onChange={(value) => {
              confirm.setValue("receivedAt", value, { shouldDirty: true });
              confirm.clearErrors("receivedAt");
            }}
            error={confirm.formState.errors.receivedAt?.message}
          />
        )}
        <ActionButton showLabel icon="check" disabled={!online || busy}>
          Подтвердить приёмку
        </ActionButton>
        <ErrorNotice error={error} />
      </form>
      <form
        ref={rejectRef}
        onSubmit={reject.handleSubmit((value) =>
          decide("reject", { reason: value.reason.trim() }),
        )}
      >
        <Field
          label="Причина отклонения"
          error={reject.formState.errors.reason?.message}
        >
          <textarea
            maxLength={500}
            {...reject.register("reason", {
              required: "Укажите причину",
              validate: (value) => Boolean(value.trim()) || "Укажите причину",
            })}
          />
        </Field>
        <ActionButton showLabel icon="disable" disabled={!online || busy}>
          Отклонить поставку
        </ActionButton>
      </form>
    </section>
  );
}
