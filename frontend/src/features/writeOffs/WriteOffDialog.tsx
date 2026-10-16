import { useApi } from "../../shared/api/queries";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import type { Batch, WriteOffInput } from "../../shared/api/types";
import { positiveQuantity } from "../../shared/lib/schemas";
import {
  quantity,
  thousandths,
  displayQuantity,
  units,
} from "../../shared/lib/decimal";
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
  useOnline,
  useUnsaved,
} from "../../shared/lib/hooks";
import { Modal, Field, ErrorNotice, s } from "../../shared/ui";
export function WriteOffDialog({
  batch,
  initialQuantity,
  copyId,
  onClose,
}: {
  batch: Batch;
  initialQuantity?: string;
  copyId?: string;
  onClose: () => void;
}) {
  const { context } = useApi();

  const name = copyId ? `writeoff.copy.${copyId}` : `writeoff.${batch.id}`;
  const client = useQueryClient();
  const online = useOnline();
  const free = thousandths(batch.remainingQuantity) - thousandths(batch.heldQuantity);
  const freeQuantity = `${free / 1000n}.${String(free % 1000n).padStart(3,"0")}`;
  const [error, setError] = useState<unknown>(null);
  const schema = z
    .object({
      batchId: z.string().uuid(),
      quantity: positiveQuantity,
      reason: z.enum(["expired", "damaged"]),
      note: z.string().max(500).nullable(),
    })
    .refine(
      (v) => {
        try {
          return (
            thousandths(v.quantity) <=
            thousandths(batch.remainingQuantity) -
              thousandths(batch.heldQuantity ?? "0.000")
          );
        } catch {
          return true;
        }
      },
      { path: ["quantity"], message: "Количество превышает остаток партии" },
    );
  const form = useForm<WriteOffInput>({
    shouldFocusError: false,
    resolver: zodResolver(schema),
    defaultValues: loadDraft(context, name, {
      batchId: batch.id,
      quantity: initialQuantity || freeQuantity,
      reason: batch.status === "expired" ? "expired" : "damaged",
      note: "",
    }),
  });
  const errorScrollRef = useErrorScroll(form, error);
  const storageError = useDraft(context, name, form);
  useUnsaved(form.formState.isDirty);
  return (
    <Modal
      title={copyId ? "Повторить списание" : "Списать из партии"}
      onClose={onClose}
      dirty={form.formState.isDirty}
    >
      {storageError && (
        <p role="alert" className={s.notice}>
          Черновик не удалось сохранить. Введённые данные остаются в форме.
        </p>
      )}
      {copyId && (
        <p className={s.muted}>
          Количество перенесено из истории. Выберите причину и укажите заметку
          для нового списания.
        </p>
      )}
      <p>
        {batch.ingredientName} · Поставка {batch.deliveryNumber}
        <br />
        <code>{batch.id}</code>
      </p>
      <p>
        Осталось:{" "}
        <strong>
          {displayQuantity(batch.remainingQuantity)} {units[batch.unit]}
        </strong>
      </p>
      <form
        ref={errorScrollRef}
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            const pending = beginPending(
              context,
              "/write-offs",
              {
                ...v,
                quantity: quantity(v.quantity),
                note: v.note || null,
              },
              name,
            );
            await sendPending(pending, context);
            clearDraft(context, name);
            await client.invalidateQueries({
              queryKey: ["warehouse", context.userId, context.warehouseId],
            });
            onClose();
          } catch (e) {
            setError(e);
            fieldErrors(e, form);
          }
        })}
      >
        <div className={s.grid}>
          <Field
            label={`Количество списания, ${units[batch.unit]}`}
            error={form.formState.errors.quantity?.message}
          >
            <input inputMode="decimal" {...form.register("quantity")} />
          </Field>
          <Field label="Причина">
            <select {...form.register("reason")}>
              <option value="expired" disabled={batch.status !== "expired"}>
                Истёк срок
              </option>
              <option value="damaged">Повреждение</option>
            </select>
          </Field>
          <Field label="Заметка" error={form.formState.errors.note?.message}>
            <textarea {...form.register("note")} />
          </Field>
        </div>
        <p className={s.notice}>
          Подтверждаю списание {form.watch("quantity")} {units[batch.unit]} из
          указанной партии. Остаток физически уменьшится.
        </p>
        <ErrorNotice error={error} />
        <div className={s.row}>
          <ActionButton
            className={s.primary}
            disabled={
              !online ||
              form.formState.isSubmitting ||
              readPending().some(
                (x) =>
                  x.context.userId === context.userId &&
                  x.context.warehouseId === context.warehouseId &&
                  x.path === "/write-offs",
              )
            }
          >
            Подтвердить списание
          </ActionButton>
          <ActionButton
            type="button"
            onClick={() =>
              void client.invalidateQueries({
                queryKey: ["warehouse", context.userId, context.warehouseId],
              })
            }
          >
            Обновить остатки
          </ActionButton>
        </div>
      </form>
    </Modal>
  );
}
