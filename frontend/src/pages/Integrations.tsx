import { useState } from "react";
import { useApi, useResource } from "../shared/api/queries";
import type {
  IntegrationClient,
  IntegrationKey,
  Page,
} from "../shared/api/types";
import {
  ActionButton,
  Field,
  Heading,
  ErrorNotice,
  QueryState,
  Table,
  Pager,
  useFilters,
  s,
} from "../shared/ui";
import { DateTimePicker } from "../shared/ui/DateTimePicker";
import { dateTime, moscowToUtc } from "../shared/lib/time";
export function Integrations() {
  const { request } = useApi();
  const { params, update } = useFilters([]);
  const query = useResource<Page<IntegrationClient>>(
    "integration-clients",
    params,
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState("supplier");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Heading title="Интеграции" />
      <p>
        Клиенты поставщика и кассы привязаны к этому складу. Выпускайте новый
        ключ для существующего клиента при ротации.
      </p>
      <form
        className={s.panel}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await request("/integration-clients", {
              method: "POST",
              body: JSON.stringify({ name: name.trim(), kind }),
            });
            setName("");
            await query.refetch();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={s.row}>
          <Field label="Название клиента">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Тип интеграции">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="supplier">Поставщик</option>
              <option value="pos">Касса / POS</option>
            </select>
          </Field>
          <ActionButton showLabel disabled={busy}>
            Создать клиента
          </ActionButton>
        </div>
      </form>
      <ErrorNotice error={error} />
      <QueryState query={query}>
        {(data) => (
          <>
            {data.items.map((client) => (
              <ClientKeys key={client.id} client={client} />
            ))}
            <Pager page={data} onChange={update} />
          </>
        )}
      </QueryState>
    </>
  );
}
function ClientKeys({ client }: { client: IntegrationClient }) {
  const { request } = useApi();
  const [page, setPage] = useState(1);
  const query = useResource<Page<IntegrationKey>>(
    `integration-clients/${client.id}/keys`,
    { page: String(page) },
  );
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className={s.panel}>
      <h2>
        {client.name} · {client.kind === "supplier" ? "Поставщик" : "Касса"}
      </h2>
      <p>
        Client ID: <code>{client.id}</code>
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setSecret("");
          setError(null);
          try {
            const result = await request<{
              key: IntegrationKey;
              token: string;
            }>(`/integration-clients/${client.id}/keys`, {
              method: "POST",
              body: JSON.stringify({
                label: label.trim(),
                expiresAt: expiresAt ? moscowToUtc(expiresAt) : null,
              }),
            });
            setSecret(result.data.token);
            setLabel("");
            await query.refetch();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={s.row}>
          <Field label="Название ключа">
            <input
              required
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DateTimePicker
            label="Срок ключа · Москва (UTC+3)"
            value={expiresAt}
            onChange={setExpiresAt}
          />
          <ActionButton showLabel disabled={busy}>
            Выпустить ключ
          </ActionButton>
        </div>
      </form>
      <p className={s.muted}>
        Если ответ с секретом потерян, обновите список, отзовите созданный ключ
        и выпустите новый для этого же клиента. Секрет не восстанавливается из
        списка.
      </p>
      {secret && (
        <div className={s.notice}>
          <strong>Секрет показывается один раз</strong>
          <p>
            <code>{secret}</code>
          </p>
          <ActionButton
            icon="copy"
            aria-label="Скопировать ключ"
            onClick={() =>
              void navigator.clipboard.writeText(secret).catch(setError)
            }
          />
          <ActionButton showLabel onClick={() => setSecret("")}>
            Я сохранил ключ
          </ActionButton>
        </div>
      )}
      <ErrorNotice error={error} />
      <QueryState query={query}>
        {(data) => (
          <>
            <Table
              headers={["Ключ", "Создан", "Истекает", "Статус", "Действия"]}
            >
              {data.items.map((key) => (
                <tr key={key.id}>
                  <td>{key.label}</td>
                  <td>{dateTime(key.createdAt)}</td>
                  <td>{dateTime(key.expiresAt)}</td>
                  <td>
                    {key.revokedAt
                      ? "Отозван"
                      : key.expiresAt && Date.parse(key.expiresAt) <= Date.now()
                        ? "Истёк"
                        : "Активен"}
                  </td>
                  <td>
                    {!key.revokedAt && (
                      <ActionButton
                        icon="disable"
                        aria-label={`Отозвать ключ ${key.label}`}
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Отозвать ключ ${key.label}?`))
                            return;
                          setBusy(true);
                          try {
                            await request(
                              `/integration-clients/${client.id}/keys/${key.id}`,
                              { method: "DELETE" },
                            );
                            await query.refetch();
                          } catch (e) {
                            setError(e);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={data}
              onChange={(key, value) => {
                if (key === "page") setPage(Number(value));
              }}
            />
          </>
        )}
      </QueryState>
      <details>
        <summary>Как подключить внешнюю систему</summary>
        <p>
          API: <code>/integrations/v1/warehouses/{client.warehouseId}</code>.
          Заголовок Authorization: Bearer &lt;ключ&gt;. Для создания документа
          нужны стабильный externalId и UUID Idempotency-Key.
        </p>
        <p>
          {client.kind === "supplier"
            ? "GET /catalog/ingredients; POST /deliveries; GET /deliveries/{id}"
            : "GET /menu, /stop-list, /recommendations; POST /orders; GET /orders/{id}"}
        </p>
        {import.meta.env.VITE_DEMO_MODE === "true" && (
          <p>
            В демо это имитация API. Настоящее подключение проверяется после
            запуска бэкенда.
          </p>
        )}
      </details>
    </section>
  );
}
