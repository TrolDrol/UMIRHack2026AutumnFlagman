import { useEffect, useState } from "react";
import {
  useScopedNavigate as useNavigate,
  ScopedLink as Link,
} from "../shared/lib/routing";
import type { OrderReceipt } from "../shared/api/types";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import {
  useWorkspace,
  maySend,
  sameScope,
  scopeKey,
  type RequestContext,
} from "./workspace";
import {
  pendingFor,
  sendPending,
  isExpiredPending,
  isSending,
  reconcilePending,
  hasLegacyPending,
  readPending,
  type Pending,
} from "../shared/lib/pending";
import { clearDraft, useOnline } from "../shared/lib/hooks";
import { ActionButton, ErrorNotice, Field, Modal, s } from "../shared/ui";
import { dateTime } from "../shared/lib/time";
export const commandLabels: Record<Pending["kind"], string> = {
  "manual-offer": "Ручное предложение сохранено",
  "purchase-request": "Заявка поставщику сохранена",
  quarantine: "Решение по карантину сохранено",
  combo: "Комбо сохранено",
  "delivery-create": "Документ поставки создан · ожидает приёмки",
  "delivery-confirm": "Приёмка подтверждена",
  "delivery-reject": "Поставка отклонена",
  order: "Заказ проведён",
  "service-order": "Заказ проведён",
  "write-off": "Списание проведено",
};
export function Recovery() {
  const context = useWorkspace();
  const auth = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const [items, setItems] = useState(() => pendingFor(context));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reconcile, setReconcile] = useState<Pending | null>(null);
  const [verified, setVerified] = useState(false);
  const [outcome, setOutcome] = useState<"created" | "rejected">("created");
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<RequestContext>).detail;
      if (!detail || sameScope(detail, context)) setItems(pendingFor(context));
    };
    const confirmed = (event: Event) => {
      const detail = (
        event as CustomEvent<{ context: RequestContext; kind: Pending["kind"] }>
      ).detail;
      if (sameScope(detail.context, context))
        setAnnouncement(commandLabels[detail.kind]);
    };
    window.addEventListener("flagman:pending", update);
    window.addEventListener("flagman:confirmed", confirmed);
    return () => {
      window.removeEventListener("flagman:pending", update);
      window.removeEventListener("flagman:confirmed", confirmed);
    };
  }, [context]);
  const allowed = items.filter((item) => maySend(context.role, item.path));
  return (
    <>
      <div role="status" aria-live="polite">
        {announcement}
      </div>
      {hasLegacyPending() && (
        <p className={s.notice}>
          Есть старые операции без контекста склада. Они не отправляются
          автоматически. Сверьте историю с администратором API.
        </p>
      )}
      {readPending()
        .filter(
          (item) =>
            item.context.userId === context.userId &&
            item.context.runtimeScope !== context.runtimeScope,
        )
        .map((item) => (
          <details key={item.key}>
            <summary>Операция из прежней среды — требуется сверка</summary>
            <p>
              Повтор разрешён только в исходной среде, учётной записи и складе.
              Текущая история не доказывает отказ прежней операции.
            </p>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </details>
        ))}
      {items.length > allowed.length && (
        <p className={s.notice}>
          Есть незавершённая операция, восстановление которой недоступно вашей
          текущей роли. Обратитесь к владельцу.
        </p>
      )}
      {allowed.map((item) => (
        <div className={s.notice} key={item.key}>
          <strong>
            {isSending(item.key)
              ? "Операция отправляется…"
              : "Результат не подтверждён"}
          </strong>
          <p>
            {commandLabels[item.kind]} · {dateTime(item.createdAt)} · Москва
          </p>
          <details>
            <summary>Сохранённый запрос</summary>
            <code>{item.body}</code>
            <p>
              <code>{item.key}</code>
            </p>
          </details>
          {isExpiredPending(item) || item.state === "conflict" ? (
            <>
              <p>
                Сверьте результат и ключ с администратором API до повторной
                отправки.{" "}
                <Link
                  to={
                    context.role === "waiter"
                      ? "/service/orders/new"
                      : item.kind === "write-off"
                        ? "/movements"
                        : item.path.includes("deliveries")
                          ? "/deliveries"
                          : "/orders"
                  }
                >
                  {context.role === "waiter"
                    ? "Открыть корзину"
                    : "Открыть разрешённую историю"}
                </Link>
              </p>
              <ActionButton
                showLabel
                onClick={() => {
                  setVerified(false);
                  setReconcile(item);
                }}
              >
                Завершить после сверки
              </ActionButton>
            </>
          ) : (
            <ActionButton
              showLabel
              disabled={
                !!busy ||
                isSending(item.key) ||
                !online ||
                Boolean(item.retryAt && Date.now() < item.retryAt)
              }
              onClick={async () => {
                setBusy(item.key);
                setError(null);
                try {
                  await auth.refreshMemberships();
                  const result = await sendPending<OrderReceipt>(item, context);
                  if (item.draftName) clearDraft(context, item.draftName);
                  await client.invalidateQueries({
                    queryKey: scopeKey(context),
                  });
                  setAnnouncement(commandLabels[item.kind]);
                  if (item.kind === "service-order")
                    navigate("/service/orders/new", {
                      state: { receipt: result.data },
                    });
                  else if (item.path.includes("deliveries"))
                    navigate(`/deliveries/${result.data.id}`);
                  else if (item.kind === "order")
                    navigate(`/orders/${result.data.id}`);
                  else if (item.kind === "quarantine") navigate("/quarantines");
                  else if (item.kind === "combo") navigate("/combos");
                  else if (item.kind === "manual-offer")
                    navigate("/recommendations");
                  else navigate("/movements?type=write_off");
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy("");
                }
              }}
            >
              Повторить сохранённый запрос
            </ActionButton>
          )}
        </div>
      ))}
      <ErrorNotice error={error} />
      {reconcile && (
        <Modal
          title="Сверка результата операции"
          onClose={() => setReconcile(null)}
        >
          <p>
            Сверьте историю и ключ с администратором API. Здесь завершается
            только локальное восстановление; складской запрос не отправляется.
          </p>
          <code>{reconcile.key}</code>
          <Field label="Подтверждённый результат">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as typeof outcome)}
            >
              <option value="created">Результат найден</option>
              <option value="rejected">Операция отклонена</option>
            </select>
          </Field>
          <Field label="Я сверил историю и ключ с администратором API">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
          </Field>
          <ActionButton
            showLabel
            disabled={!verified}
            onClick={() => {
              try {
                reconcilePending(reconcile, context, outcome);
                setReconcile(null);
                setAnnouncement("Сверка завершена");
              } catch (e) {
                setError(e);
              }
            }}
          >
            Подтвердить сверку
          </ActionButton>
        </Modal>
      )}
    </>
  );
}
