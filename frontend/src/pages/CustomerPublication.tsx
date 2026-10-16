import { useState } from "react";
import { useWorkspace } from "../app/workspace";
import { useResource, useApi } from "../shared/api/queries";
import { ActionButton, ErrorNotice, s } from "../shared/ui";
import { ScopedLink } from "../shared/lib/routing";
export function CustomerPublicationStatus() {
  const { role } = useWorkspace();
  const allowed = role === "owner" || role === "super_admin";
  const query = useResource<{ enabled: boolean }>(
    "customer-publication",
    {},
    allowed,
  );
  if (!allowed) return null;
  return (
    <section className={s.panel}>
      <h2>Видимость для покупателей</h2>
      <p>
        {!query.data
          ? query.isError
            ? "Статус публикации недоступен"
            : "Проверяем публикацию…"
          : query.data.data.enabled
            ? "Заведение опубликовано"
            : "Заведение скрыто"}
      </p>
      <ScopedLink to="/menu">
        Проверить и изменить публикацию в меню →
      </ScopedLink>
      <ErrorNotice error={query.error} />
    </section>
  );
}
export function CustomerPublication() {
  const context = useWorkspace();
  const allowed = context.role === "owner" || context.role === "super_admin";
  const query = useResource<{ enabled: boolean }>(
    "customer-publication",
    {},
    allowed,
  );
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState<unknown>(null);
  if (!allowed) return null;
  return (
    <section className={s.panel}>
      <h2>Публикация для покупателей</h2>
      <p>
        {!query.data
          ? query.isError
            ? "Не удалось проверить публикацию."
            : "Проверяем публикацию…"
          : query.data.data.enabled
            ? "Заведение опубликовано в клиентском портале."
            : "Заведение скрыто от покупателей."}
      </p>
      <ErrorNotice error={error || query.error} />
      {success && <p role="status">{success}</p>}
      {query.isError && (
        <ActionButton showLabel onClick={() => void query.refetch()}>
          Повторить проверку
        </ActionButton>
      )}
      {query.data?.data.enabled && (
        <p>
          <a href={`/client/outlets/${context.warehouseId}/menu`}>
            Открыть клиентское меню
          </a>{" "}
          · Может потребоваться вход покупателя.
        </p>
      )}
      <ActionButton
        showLabel
        disabled={busy || !query.data}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setSuccess("");
          try {
            await api.request("/customer-publication", {
              method: "PATCH",
              body: JSON.stringify({ enabled: !query.data!.data.enabled }),
            });
            await query.refetch();
            setSuccess("Состояние публикации обновлено.");
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {query.data?.data.enabled
          ? "Скрыть заведение"
          : "Опубликовать заведение"}
      </ActionButton>
    </section>
  );
}
