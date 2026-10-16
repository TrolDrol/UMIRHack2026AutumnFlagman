import { ExportTable } from "../shared/TableDownload";
import type { ExportAuthor } from "@rims/demo-api/table-export";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  ExternalDeliveryInput,
  Page,
  PurchaseRequest,
  PurchaseRequestStatus,
  SupplierDelivery,
} from "@rims/portal-contracts";
import {
  type Connection,
  HttpError,
  prefix,
  request,
} from "../shared/api/client";
import {
  clearPending,
  foreignPending,
  expired,
  prepare,
  readPending,
  scope,
  sendOperation,
  type Operation,
} from "../shared/api/operations";
import { useSession } from "./Session";
import { statusLabels } from "../features/requests/labels";
import { formatDate } from "../features/shipment/form";
import { ShipmentEditor } from "../features/shipment/ShipmentEditor";
import s from "../styles/Portal.module.css";
export function Workspace({ connection }: { connection: Connection }) {
  const [exportAuthor, setExportAuthor] = useState<ExportAuthor | null>(null);
  useEffect(
    () => setExportAuthor(null),
    [connection.clientId, connection.warehouseId, connection.backendInstanceId],
  );
  const { disconnect, handleError } = useSession();
  const { id } = useParams();
  const currentDocumentId = useRef(id);
  currentDocumentId.current = id;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status") || "submitted";
  const status: PurchaseRequestStatus =
    Object.hasOwn(statusLabels, rawStatus) && rawStatus !== "draft"
      ? (rawStatus as PurchaseRequestStatus)
      : "submitted";
  const requestedPage = Number(params.get("page"));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const [list, setList] = useState<Page<PurchaseRequest> | null>(null);
  const [document, setDocument] = useState<PurchaseRequest | null>(null);
  const [delivery, setDelivery] = useState<SupplierDelivery | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Operation | null>(null);
  const [storageError, setStorageError] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const revision = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const [fields, setFields] = useState<{ path: string; message: string }[]>([]);
  const route = prefix(connection.warehouseId);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidate();
    };
  }, [invalidate]);
  const restore = useCallback(() => {
    try {
      setPending(readPending(connection));
      setStorageError("");
    } catch (error) {
      setStorageError((error as Error).message);
    }
  }, [connection]);
  useEffect(() => {
    restore();
  }, [restore]);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      if (id) {
        const doc = await request<PurchaseRequest>(
          connection.key,
          `${route}/purchase-requests/${encodeURIComponent(id)}`,
        );
        const linked = doc.deliveryId
          ? await request<SupplierDelivery>(
              connection.key,
              `${route}/deliveries/${encodeURIComponent(doc.deliveryId)}`,
            )
          : null;
        if (alive.current && current === revision.current) {
          setDocument(doc);
          setDelivery(linked);
        }
      } else {
        const result = await request<Page<PurchaseRequest>>(
          connection.key,
          `${route}/purchase-requests?status=${status}&page=${page}&pageSize=20`,
        );
        if (alive.current && current === revision.current) setList(result);
      }
    } catch (error) {
      if (alive.current && current === revision.current) {
        setError((error as Error).message);
        if (error instanceof HttpError && error.status === 404) {
          setDocument(null);
          setDelivery(null);
        }
        handleError(error);
      }
    } finally {
      if (alive.current && current === revision.current) setLoading(false);
    }
  }, [connection, id, route, status, page, handleError]);
  // handleError is stable for the lifetime of a mounted workspace via the session.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    setDocument(null);
    setDelivery(null);
    setList(null);
    setError("");
    setNotice("");
    setLoading(true);
    setEditing(false);
    setRejecting(false);
    setReason("");
    setFields([]);
    void refreshRef.current();
    return () => {
      invalidate();
    };
  }, [id, status, page, invalidate]);
  useEffect(() => {
    const update = () => {
      if (window.document.visibilityState === "visible")
        void refreshRef.current();
    };
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith("rims.demo.")) update();
      if (event.key?.startsWith(`${scope(connection)}.pending.`)) restore();
    };
    const interval = setInterval(update, 15000);
    window.addEventListener("focus", update);
    window.addEventListener("storage", storage);
    window.document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", update);
      window.removeEventListener("storage", storage);
      window.document.removeEventListener("visibilitychange", update);
    };
  }, [connection, restore]);
  const execute = async (operation: Operation) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setFields([]);
    let confirmed = false;
    try {
      const result = await sendOperation<PurchaseRequest | SupplierDelivery>(
        connection,
        operation,
      );
      confirmed = true;
      if (!alive.current) return;
      if (currentDocumentId.current !== operation.requestId) {
        restore();
        await refreshRef.current();
        return;
      }
      if (operation.path === `${route}/deliveries`) {
        const shipment = result as SupplierDelivery;
        setNotice("Поставка зарегистрирована. Ожидается приёмка менеджером.");
        setEditing(false);
        const updatedDelivery = await request<SupplierDelivery>(
          connection.key,
          `${route}/deliveries/${encodeURIComponent(shipment.id)}`,
        );
        if (!alive.current) return;
        setDelivery(updatedDelivery);
      } else {
        setRejecting(false);
        setNotice(
          operation.path.endsWith("/approve")
            ? "Заявка принята. Теперь можно оформить отгрузку."
            : "Заявка отклонена.",
        );
      }
      restore();
      await refreshRef.current();
    } catch (error) {
      if (alive.current) {
        setError(
          error instanceof HttpError && error.unknown && !confirmed
            ? "Результат неизвестен. Повторите сохранённую операцию с тем же ключом."
            : (error as Error).message,
        );
        if (error instanceof HttpError) {
          setFields(error.fields);
          handleError(error);
          if (
            error.code === "VERSION_CONFLICT" ||
            error.code === "PURCHASE_REQUEST_STATE_CONFLICT"
          ) {
            setNotice(
              "Заявка изменилась. Проверьте текущее состояние; введённые данные сохранены.",
            );
            await refreshRef.current();
          }
        }
        restore();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const mutate = (path: string, body: unknown) => {
    if (busyRef.current || pending || storageError || !document) return;
    try {
      const operation = prepare(connection, path, body, document.id);
      setPending(operation);
      void execute(operation);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const send = (body: ExternalDeliveryInput) =>
    mutate(`${route}/deliveries`, body);
  const disabled = busy || !!pending || !!storageError;
  const listQuery = `?status=${status}&page=${page}`;
  return (
    <>
      <header className={s.header}>
        <div>
          <Link className={s.brand} to={`/requests${listQuery}`}>
            Флагман · Поставщик
          </Link>
          <p>
            {connection.identity.name} · Склад {connection.warehouseId}
          </p>
        </div>
        <div className={s.actions}>
          <span className={s.badge}>
            {connection.mode === "demo"
              ? "Демонстрационные данные"
              : "Рабочее подключение"}
          </span>
          <button
            className={s.secondary}
            onClick={() => {
              disconnect();
              navigate("/connect");
            }}
          >
            Отключиться
          </button>
        </div>
      </header>
      <main className={s.main}>
        {foreignPending(connection).map((saved) => (
          <details key={saved.key}>
            <summary>Операция из прежней среды — повтор запрещён</summary>
            <p>
              Сверьте результат в исходной БД и учётной записи. Смена backend
              identity не переносит намерение.
            </p>
            <pre>{saved.saved}</pre>
          </details>
        ))}
        {pending && (
          <section className={s.warning}>
            <h2>Сохранённая операция</h2>
            <p>
              Автоматическая отправка отключена. Проверьте контекст и повторите
              исходный запрос.
            </p>
            <p>
              {pending.path} · {formatDate(pending.createdAt)}
            </p>
            <details>
              <summary>Данные для сверки</summary>
              <p>
                Клиент: {pending.context.clientId} · Склад:{" "}
                {pending.context.warehouseId} · Режим: {pending.context.mode} ·
                Origin: {pending.context.origin}
              </p>
              <p>Idempotency-Key: {pending.key}</p>
              <pre>{pending.body}</pre>
            </details>
            {expired(pending) ? (
              <p>
                Прошло 24 часа. Сверьте результат с администратором по маршруту,
                клиенту, складу и ключу. Новый запрос не создаётся.
              </p>
            ) : (
              <button
                disabled={
                  busy ||
                  !!storageError ||
                  (!!pending.notBefore && pending.notBefore > Date.now())
                }
                onClick={() => void execute(pending)}
              >
                Повторить сохранённую операцию
              </button>
            )}
            {pending.notBefore && (
              <p>
                Повтор доступен после{" "}
                {formatDate(new Date(pending.notBefore).toISOString())}.{" "}
                <button className={s.secondary} onClick={restore}>
                  Проверить время
                </button>
              </p>
            )}
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Результат уже установлен администратором по журналу/replay? Удаление снимка само по себе не подтверждает результат.",
                  )
                ) {
                  try {
                    clearPending(connection, pending.key);
                    restore();
                    void refreshRef.current();
                  } catch (error) {
                    setStorageError((error as Error).message);
                  }
                }
              }}
            >
              Завершить после сверки
            </button>
          </section>
        )}
        {(error || storageError) && (
          <div className={s.error} role="alert">
            {error || storageError}
          </div>
        )}
        {notice && (
          <p className={s.success} role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">Загрузка заявок…</p>
        ) : id ? (
          <>
            <Link to={`/requests${listQuery}`}>← К списку заявок</Link>
            {document ? (
              <>
                <div className={s.title}>
                  <h1>Заявка {document.number}</h1>
                  <span className={s.badge}>
                    {statusLabels[document.status]}
                  </span>
                </div>
                <ol className={s.steps}>
                  <li>Заявка {document.approvedAt ? "принята" : "получена"}</li>
                  <li>
                    {document.deliveryId
                      ? "Поставка отправлена в систему"
                      : ["rejected", "cancelled"].includes(document.status)
                        ? "Отгрузка не выполняется"
                        : "Отгрузка предстоит"}
                  </li>
                  <li>
                    {document.status === "received"
                      ? "Товар принят на склад"
                      : document.status === "delivery_rejected"
                        ? "Отказ в приёмке"
                        : ["rejected", "cancelled"].includes(document.status)
                          ? "Заявка закрыта без приёмки"
                          : "Ожидание приёмки"}
                  </li>
                </ol>
                <section className={s.panel}>
                  <h2>Согласованный состав</h2>
                  <div className={s.tableWrap}>
                    <ExportTable
                      author={exportAuthor}
                      onAuthor={setExportAuthor}
                      connectionInfo={
                        connection.identity.name + " · " + connection.clientId
                      }
                    >
                      <thead>
                        <tr>
                          <th>Ингредиент</th>
                          <th>Количество</th>
                          <th>Единица</th>
                        </tr>
                      </thead>
                      <tbody>
                        {document.lines.map((line) => (
                          <tr key={line.ingredientId}>
                            <td>{line.ingredientName}</td>
                            <td>{line.quantity}</td>
                            <td>{line.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </ExportTable>
                  </div>
                  <p>Ожидаемая дата: {formatDate(document.expectedAt)}</p>
                  <p>Примечание менеджера: {document.note || "Нет"}</p>
                  <dl className={s.timeline}>
                    {(
                      [
                        ["Создана", document.createdAt],
                        ["Отправлена", document.submittedAt],
                        ["Принята поставщиком", document.approvedAt],
                        ["Закрыта", document.closedAt],
                      ] as const
                    )
                      .filter(([, date]) => date)
                      .map(([label, date]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{formatDate(date)}</dd>
                        </div>
                      ))}
                  </dl>
                  {document.rejectionReason && (
                    <p>Причина отказа: {document.rejectionReason}</p>
                  )}
                  {document.status === "submitted" && (
                    <div className={s.actions}>
                      <button
                        disabled={disabled}
                        onClick={() =>
                          mutate(
                            `${route}/purchase-requests/${encodeURIComponent(document.id)}/approve`,
                            { version: document.version },
                          )
                        }
                      >
                        Принять заявку
                      </button>
                      <button
                        className={s.secondary}
                        disabled={disabled}
                        onClick={() => setRejecting(true)}
                      >
                        Отклонить
                      </button>
                    </div>
                  )}
                  {rejecting && document.status === "submitted" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (reason.trim())
                          mutate(
                            `${route}/purchase-requests/${encodeURIComponent(document.id)}/reject`,
                            {
                              version: document.version,
                              reason: reason.trim(),
                            },
                          );
                      }}
                    >
                      <label>
                        Причина отказа
                        <textarea
                          required
                          maxLength={500}
                          disabled={disabled}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <button disabled={disabled || !reason.trim()}>
                        Подтвердить отказ
                      </button>
                    </form>
                  )}
                  {document.status === "approved" && !editing && (
                    <button
                      disabled={disabled}
                      onClick={() => setEditing(true)}
                    >
                      Оформить отгрузку
                    </button>
                  )}
                  {document.status === "delivery_pending" && (
                    <p>
                      Поставка отправлена в систему. Ожидается решение
                      менеджера; товар ещё не принят на склад.
                    </p>
                  )}
                  {document.status === "delivery_rejected" && (
                    <p>
                      Менеджер отказал в приёмке. Для исправления нужна новая
                      заявка.
                    </p>
                  )}
                  {document.status === "cancelled" && (
                    <p>Менеджер отменил заявку. Отгрузка недоступна.</p>
                  )}
                </section>
                {editing && document.status === "approved" && (
                  <ShipmentEditor
                    key={document.id}
                    request={document}
                    connection={connection}
                    disabled={disabled}
                    fields={fields}
                    onSend={send}
                  />
                )}
                {delivery && (
                  <section className={s.panel}>
                    <h2>Поставка {delivery.number}</h2>
                    <p>
                      {delivery.status === "pending"
                        ? "Ожидает приёмки"
                        : delivery.status === "confirmed"
                          ? "Товар принят менеджером"
                          : "Отклонена менеджером"}
                    </p>
                    <p>
                      Создана: {formatDate(delivery.createdAt)} · Ожидается:{" "}
                      {formatDate(delivery.expectedAt)}
                    </p>
                    {delivery.receivedAt && (
                      <p>Принято: {formatDate(delivery.receivedAt)}</p>
                    )}
                    {delivery.rejectionReason && (
                      <p>Причина: {delivery.rejectionReason}</p>
                    )}
                    <p>{delivery.note}</p>
                    <div className={s.tableWrap}>
                      <ExportTable
                        author={exportAuthor}
                        onAuthor={setExportAuthor}
                        connectionInfo={
                          connection.identity.name + " · " + connection.clientId
                        }
                      >
                        <thead>
                          <tr>
                            <th>Ингредиент</th>
                            <th>Количество</th>
                            <th>Годен до (Москва)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {delivery.lines.map((line) => (
                            <tr key={line.id}>
                              <td>{line.ingredientName}</td>
                              <td>
                                {line.quantity} {line.unit}
                              </td>
                              <td>{formatDate(line.expiresAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </ExportTable>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <p>Заявка недоступна.</p>
            )}
          </>
        ) : (
          <>
            <div className={s.title}>
              <div>
                <p className={s.eyebrow}>Работа с поставками</p>
                <h1>Заявки</h1>
              </div>
              <button
                className={s.secondary}
                onClick={() => {
                  setError("");
                  void refreshRef.current();
                }}
              >
                Обновить
              </button>
            </div>
            <label className={s.filter}>
              Состояние
              <select
                value={status}
                onChange={(e) =>
                  setParams({ status: e.target.value, page: "1" })
                }
              >
                {Object.entries(statusLabels)
                  .filter(([key]) => key !== "draft")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {list?.items.length ? (
              <div className={`${s.panel} ${s.tableWrap}`}>
                <ExportTable
                  author={exportAuthor}
                  onAuthor={setExportAuthor}
                  connectionInfo={
                    connection.identity.name + " · " + connection.clientId
                  }
                >
                  <thead>
                    <tr>
                      <th>Заявка</th>
                      <th>Отправлена</th>
                      <th>Ожидаемая дата</th>
                      <th>Состояние</th>
                      <th>Позиций</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <Link
                            to={`/requests/${encodeURIComponent(doc.id)}${listQuery}`}
                          >
                            {doc.number}
                          </Link>
                        </td>
                        <td>{formatDate(doc.submittedAt)}</td>
                        <td>{formatDate(doc.expectedAt)}</td>
                        <td>{statusLabels[doc.status]}</td>
                        <td>{doc.lines.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </ExportTable>
              </div>
            ) : (
              !error && (
                <section className={s.empty}>
                  <h2>Заявок пока нет</h2>
                  <p>
                    Они появятся после отправки менеджером выбранного склада.
                    Проверьте другие состояния или обновите список.
                  </p>
                  <p>
                    В основном интерфейсе откройте «Заявки поставщикам»,
                    выберите эту интеграцию и нажмите «Сохранить и отправить
                    поставщику». Черновики и отдельно созданные входящие
                    поставки здесь не показываются.
                  </p>
                </section>
              )
            )}
            {list && (
              <nav className={s.pagination} aria-label="Страницы заявок">
                <button
                  className={s.secondary}
                  disabled={page <= 1}
                  onClick={() => setParams({ status, page: String(page - 1) })}
                >
                  Назад
                </button>
                <span>
                  Страница {page} · Всего {list.total}
                </span>
                <button
                  className={s.secondary}
                  disabled={page * list.pageSize >= list.total}
                  onClick={() => setParams({ status, page: String(page + 1) })}
                >
                  Далее
                </button>
              </nav>
            )}
          </>
        )}
      </main>
    </>
  );
}
