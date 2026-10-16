import { ActionButton, ActionHelpEnabled } from "./actions";
import { TableDownload } from "./TableDownload";
import { Breadcrumbs } from "./Breadcrumbs";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type {
  Envelope,
  Page,
  Requirement,
  Allocation,
  Ingredient,
} from "../api/types";
import { useDirectory } from "../api/queries";
import type { ServiceShortage } from "../api/types";
import { HttpError, message } from "../api/client";
import { dateTime } from "../lib/time";
import { displayQuantity, units } from "../lib/decimal";
import s from "./ui.module.css";
export { s };
export { ActionButton, ActionLink } from "./actions";
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: `${id}-input`,
        "aria-describedby": `${id}-description`,
        "aria-invalid": !!error,
      })
    : children;
  return (
    <div className={s.field}>
      <label htmlFor={`${id}-input`}>{label}</label>
      {control}
      <span
        id={`${id}-description`}
        data-form-error={error ? true : undefined}
        className={error ? s.fieldError : s.muted}
      >
        {error || hint}
      </span>
    </div>
  );
}
export function Heading({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.heading}>
      <div>
        <Breadcrumbs />
        <h1>{title}</h1>
        {children}
      </div>
      {action}
    </div>
  );
}
export function FootnoteMarker({ id }: { id: string }) {
  return (
    <sup>
      <a
        className={s.footnoteMarker}
        href={`#${id}`}
        aria-label="Перейти к сноске"
      >
        *
      </a>
    </sup>
  );
}
export function Footnote({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className={s.footnote}>
      <span aria-hidden="true">* </span>
      {children}
    </p>
  );
}
const statusLabels: Record<string, string> = {
  pending: "Ожидает приёмки",
  confirmed: "Приёмка подтверждена",
  rejected: "Отклонена",
  manual: "Ручная",
  integration: "Интеграция",
  fresh: "Свежая",
  expiring: "⚠ Скоро истечёт",
  expired: "⚠ Просрочена",
  empty: "Пустая",
  available: "Доступно",
  stopped: "⚠ Стоп",
  inactive: "Неактивно",
  completed: "Проведён",
  receipt: "Приход",
  order: "Заказ",
  quarantine_open: "Удержание",
  quarantine_release: "Освобождение",
  write_off: "Списание",
};
export function Status({
  value,
  footnote,
}: {
  value: string;
  footnote?: string;
}) {
  return (
    <span
      className={s.badge}
      data-tone={
        ["expired", "stopped"].includes(value)
          ? "danger"
          : value === "expiring"
            ? "warning"
            : "normal"
      }
    >
      {statusLabels[value] || value}
      {footnote && <FootnoteMarker id={footnote} />}
    </span>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className={`${s.notice} ${s.error}`}>
      {message(error)}
      {error instanceof HttpError && (
        <>
          <div>
            <small>
              Код: {error.code} · Запрос: {error.payload.meta.requestId}
            </small>
          </div>
          {error.retryAt > Date.now() && (
            <p>
              Повтор после {dateTime(new Date(error.retryAt).toISOString())}{" "}
              (Москва).
            </p>
          )}
          {error.payload.error.details.shortages &&
            (error.payload.error.details.shortages.every(
              (item) => "ingredientId" in item,
            ) ? (
              <Requirements
                items={fullRequirements(error.payload.error.details.shortages)}
              />
            ) : (
              <ServiceShortages items={error.payload.error.details.shortages} />
            ))}{" "}
          {[
            "BATCH_NOT_EXPIRED",
            "INSUFFICIENT_BATCH_STOCK",
            "DISH_INACTIVE",
          ].includes(error.code) && (
            <p>Состояние изменилось. Обновите данные и проверьте форму.</p>
          )}
        </>
      )}
    </div>
  );
}
export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<Envelope<T>, Error>;
  children: (data: T) => ReactNode;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  if (
    query.error instanceof HttpError &&
    [403, 404].includes(query.error.status)
  )
    return <ErrorNotice error={query.error} />;
  if (!query.data)
    return query.isError ? (
      <>
        <ErrorNotice error={query.error} />
        <ActionButton onClick={() => query.refetch()}>
          Повторить загрузку
        </ActionButton>
      </>
    ) : (
      <div className={s.skeleton} aria-label="Загрузка" role="status" />
    );
  const missed = query.isStale && now - query.dataUpdatedAt > 45000;
  return (
    <>
      <div className={`${s.row} ${s.muted} ${s.refresh}`}>
        <p>
          Обновлено: {dateTime(query.data.meta.serverTime)} · Москва{" "}
          {query.isFetching && "· Обновление…"}{" "}
          {(query.isError || missed || !navigator.onLine) && "· Не обновлено"}
        </p>
        <ActionButton
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          Обновить
        </ActionButton>
      </div>
      {query.isError && <ErrorNotice error={query.error} />}{" "}
      {children(query.data.data)}
    </>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [sort, setSort] = useState<{
    column: number;
    direction: 1 | -1;
  } | null>(null);
  useEffect(() => {
    const reset = () => setSort(null);
    window.addEventListener("rims:reset-filters", reset);
    return () => window.removeEventListener("rims:reset-filters", reset);
  }, []);
  function content(node: ReactNode): string {
    return Children.toArray(node)
      .map((part) => {
        if (
          isValidElement<{
            children?: ReactNode;
            value?: string;
            "data-sort-value"?: string | number;
          }>(part)
        ) {
          if (part.props["data-sort-value"] !== undefined)
            return String(part.props["data-sort-value"]);
          if (part.type === Status)
            return (
              statusLabels[part.props.value || ""] || part.props.value || ""
            );
          return content(part.props.children);
        }
        return String(part);
      })
      .join(" ")
      .trim();
  }
  function value(row: ReactNode, column: number) {
    if (!isValidElement<{ children: ReactNode }>(row)) return "";
    return content(Children.toArray(row.props.children)[column]);
  }
  const rows = Children.toArray(children);
  if (sort)
    rows.sort((a, b) => {
      const left = value(a, sort.column),
        right = value(b, sort.column);
      // Decimal quantities stay exact, including values beyond Number.MAX_SAFE_INTEGER.
      const decimal = /^[-+]?\d+(?:[.,]\d+)?$/;
      let compared: number;
      if (decimal.test(left) && decimal.test(right)) {
        const parts = [left, right].map((x) => x.replace(",", ".").split("."));
        const scale = Math.max(...parts.map((x) => x[1]?.length || 0));
        const [l, r] = parts.map(([whole, fraction = ""]) =>
          BigInt(whole + fraction.padEnd(scale, "0")),
        );
        compared = l < r ? -1 : l > r ? 1 : 0;
      } else if (
        /^\d{4}-\d{2}-\d{2}T/.test(left) &&
        /^\d{4}-\d{2}-\d{2}T/.test(right)
      ) {
        compared = Date.parse(left) - Date.parse(right);
      } else
        compared = left.localeCompare(right, "ru", {
          numeric: true,
          sensitivity: "base",
        });
      return compared * sort.direction;
    });
  const actionColumns = new Set(
    headers.flatMap((header, index) =>
      /^(Действия|Управление|Повторить)$/i.test(header.trim()) ? [index] : [],
    ),
  );
  const visibleRows = rows.map((row) => {
    if (!actionColumns.size || !isValidElement<{ children: ReactNode }>(row))
      return row;
    const cells = Children.toArray(row.props.children);
    const actions = cells.filter((_, index) => actionColumns.has(index));
    const visible = cells.filter((_, index) => !actionColumns.has(index));
    const first = visible[0];
    if (isValidElement<{ children: ReactNode }>(first)) {
      visible[0] = cloneElement(
        first,
        {},
        <>
          {first.props.children}
          <details className={s.rowOperations} data-export-ignore>
            <summary>Операции</summary>
            <div>
              {actions.map((cell) =>
                isValidElement<{ children: ReactNode }>(cell)
                  ? cell.props.children
                  : cell,
              )}
            </div>
          </details>
        </>,
      );
    }
    return cloneElement(row, {}, visible);
  });
  return (
    <>
      <TableDownload table={tableRef} />
      <div
        className={s.tableWrap}
        tabIndex={0}
        role="region"
        aria-label="Таблица данных"
      >
        <ActionHelpEnabled.Provider value={false}>
          <table className={s.table} ref={tableRef}>
            <thead>
              <tr>
                {headers.map((h, column) =>
                  actionColumns.has(column) ? null : (
                    <th
                      scope="col"
                      aria-label={h}
                      key={h}
                      aria-sort={
                        sort?.column === column
                          ? sort.direction === 1
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        className={s.sortButton}
                        title={`Сортировка загруженных строк: ${h}`}
                        onClick={() =>
                          setSort(
                            sort?.column === column
                              ? sort.direction === 1
                                ? { column, direction: -1 }
                                : null
                              : { column, direction: 1 },
                          )
                        }
                      >
                        {h}{" "}
                        <span aria-hidden="true">
                          {sort?.column === column
                            ? sort.direction === 1
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>{visibleRows}</tbody>
          </table>
        </ActionHelpEnabled.Provider>
      </div>
    </>
  );
}
export function Empty({
  children = "Данных пока нет. Добавьте первый документ или измените фильтры.",
}: {
  children?: ReactNode;
}) {
  return <div className={s.empty}>{children}</div>;
}
export function useFilters(allowed: string[]) {
  const [search, setSearch] = useSearchParams();
  const params: Record<string, string> = {
    page: /^[1-9]\d*$/.test(search.get("page") || "")
      ? search.get("page")!
      : "1",
    pageSize: ["25", "50", "100"].includes(search.get("pageSize") || "")
      ? search.get("pageSize")!
      : "50",
  };
  for (const key of allowed)
    if (search.get(key)) params[key] = search.get(key)!;
  const update = (key: string, value: string) => {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: true },
    );
  };
  return { params, update };
}
const filterKeys = [
  "q",
  "active",
  "lowStock",
  "status",
  "includeEmpty",
  "ingredientId",
  "batchId",
  "type",
];
export function ResetFilters() {
  const [search, setSearch] = useSearchParams();
  return (
    <div className={s.resetFilters}>
      <ActionButton
        icon="filter-remove"
        aria-label="Сбросить все фильтры"
        title="Сбросить все фильтры и сортировки таблиц"
        onClick={() => {
          const next = new URLSearchParams(search);
          for (const key of filterKeys) next.delete(key);
          next.delete("page");
          setSearch(next, { replace: true });
          window.dispatchEvent(new Event("rims:reset-filters"));
        }}
      />
    </div>
  );
}
export function CopyUuid({ value }: { value: string }) {
  const [result, setResult] = useState("");
  return (
    <span className={s.copyUuidWrap} data-export-value={value}>
      <code>{value}</code>
      <button
        type="button"
        className={s.copyUuid}
        title={`Скопировать UUID: ${value}`}
        aria-label={`Скопировать UUID партии ${value}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setResult("Скопировано");
          } catch {
            setResult("Не удалось скопировать");
          }
        }}
      >
        <span aria-hidden="true">⧉</span>
      </button>
      <span className={s.copyResult} role="status">
        {result}
      </span>
    </span>
  );
}
export function Search({
  value = "",
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (text.trim() !== value) cb.current(text.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [text, value]);
  return (
    <Field label="Поиск по названию">
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Введите название"
      />
    </Field>
  );
}
export function Pager({
  page,
  onChange,
}: {
  page: Page<unknown>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className={s.pager}>
      <span>
        Всего: {page.total} · Страница {page.page} из{" "}
        {Math.max(1, Math.ceil(page.total / page.pageSize))}
      </span>
      <Field label="На странице">
        <select
          value={page.pageSize}
          onChange={(e) => onChange("pageSize", e.target.value)}
        >
          {[25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </Field>
      <ActionButton
        disabled={page.page <= 1}
        onClick={() => onChange("page", String(page.page - 1))}
      >
        Назад
      </ActionButton>
      <ActionButton
        disabled={page.page * page.pageSize >= page.total}
        onClick={() => onChange("page", String(page.page + 1))}
      >
        Далее
      </ActionButton>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  dirty = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = () => {
    if (
      !dirty ||
      window.confirm(
        "Закрыть с несохранёнными изменениями? Черновик будет сохранён.",
      )
    )
      onClose();
  };
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className={s.heading}>
        <h2 id={titleId}>{title}</h2>
        <ActionButton type="button" aria-label="Закрыть диалог" onClick={close}>
          ×
        </ActionButton>
      </div>
      {children}
    </dialog>
  );
}
export function Requirements({ items }: { items: Requirement[] }) {
  return (
    <Table headers={["Ингредиент", "Требуется", "Доступно", "Не хватает"]}>
      {items.map((x) => (
        <tr key={x.ingredientId}>
          <td>{x.ingredientName}</td>
          <td data-sort-value={x.requiredQuantity}>
            {displayQuantity(x.requiredQuantity)} {units[x.unit]}
          </td>
          <td data-sort-value={x.availableQuantity}>
            {displayQuantity(x.availableQuantity)} {units[x.unit]}
          </td>
          <td data-sort-value={x.missingQuantity}>
            {displayQuantity(x.missingQuantity)} {units[x.unit]}
          </td>
        </tr>
      ))}
    </Table>
  );
}
export function Allocations({ items }: { items: Allocation[] }) {
  const ingredients = useDirectory<Ingredient>("ingredients");
  return (
    <Table headers={["Ингредиент / партия", "Количество", "Срок (Москва)"]}>
      {items.map((x) => (
        <tr key={x.batchId}>
          <td>
            <a href={`/inventory/${x.ingredientId}`}>
              {ingredients.data?.data.find((i) => i.id === x.ingredientId)
                ?.name || <code>{x.ingredientId}</code>}
            </a>
            <br />
            <a href={`/movements?batchId=${x.batchId}`}>
              <code>{x.batchId}</code>
            </a>
          </td>
          <td data-sort-value={x.quantity}>
            {displayQuantity(x.quantity)}{" "}
            {ingredients.data?.data.find((i) => i.id === x.ingredientId)?.unit
              ? units[
                  ingredients.data.data.find((i) => i.id === x.ingredientId)!
                    .unit
                ]
              : "баз. ед."}
          </td>
          <td data-sort-value={x.expiresAt || ""}>{dateTime(x.expiresAt)}</td>
        </tr>
      ))}
    </Table>
  );
}

export function ServiceShortages({ items }: { items: ServiceShortage[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          {item.ingredientName}: {displayQuantity(item.missingQuantity)}{" "}
          {units[item.unit]}
        </li>
      ))}
    </ul>
  );
}

function fullRequirements(items: ServiceShortage[]) {
  return items.filter((item): item is Requirement => "ingredientId" in item);
}
