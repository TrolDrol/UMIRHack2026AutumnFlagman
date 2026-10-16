import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { runtimeNamespace } from "@rims/demo-api/runtime";
import { useAuth } from "../app/auth";
import { roleNames } from "../app/workspace";
import { request } from "../shared/api/client";
import type { Page, StaffAccount } from "../shared/api/types";
import {
  ActionButton,
  ErrorNotice,
  Field,
  Heading,
  Pager,
  QueryState,
  Table,
  s,
} from "../shared/ui";
import styles from "./StaffDirectory.module.css";

export function StaffDirectory() {
  const auth = useAuth();
  const isSuperAdmin = !!auth.operator?.isSuperAdmin;
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");
  const enterprises = auth.memberships.filter(
    (m) => m.role === "owner" || auth.operator?.isSuperAdmin,
  );
  const allowed =
    !!auth.operator && (auth.operator.isSuperAdmin || enterprises.length > 0);
  const key = ["staff-directory", runtimeNamespace(), auth.operator?.id];
  const query = useQuery({
    queryKey: [...key, search, enterpriseId, page, pageSize],
    enabled: allowed && !auth.loading && !auth.membershipsLoading,
    queryFn: ({ signal }) =>
      request<Page<StaffAccount>>(
        `/staff?${new URLSearchParams({ q: search, ...(enterpriseId ? { enterpriseId } : {}), page: String(page), pageSize: String(pageSize) })}`,
        { signal },
      ),
    retry: false,
    refetchOnWindowFocus: "always",
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15000 : false,
  });
  if (auth.loading) return <main className={s.panel}>Проверка сессии…</main>;
  if (!auth.operator) return <Navigate to="/login" replace />;
  if (auth.membershipsLoading)
    return <main className={s.panel}>Загрузка прав доступа…</main>;
  if (auth.membershipsError)
    return (
      <main className={s.panel}>
        <ErrorNotice error={auth.membershipsError} />
        <Link to="/enterprises">К выбору предприятия</Link>
      </main>
    );
  if (!allowed)
    return (
      <main className={s.panel}>
        <h1>Нет доступа к списку сотрудников</h1>
        <p>Список доступен супер-администратору и владельцам предприятий.</p>
        <Link to="/enterprises">К выбору предприятия</Link>
      </main>
    );
  const remove = async (
    staff: StaffAccount,
    membership?: StaffAccount["memberships"][number],
  ) => {
    const message = membership
      ? `Удалить доступ сотрудника ${staff.username} к предприятию «${membership.enterpriseName}»? Его аккаунт и доступ к другим предприятиям сохранятся.`
      : `Удалить аккаунт ${staff.username} из всех предприятий и завершить его сессии? Документы и история операций сохранятся.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    setSuccess("");
    try {
      await request(
        membership
          ? `/enterprises/${membership.enterpriseId}/members/${staff.userId}`
          : `/staff/${staff.userId}`,
        { method: "DELETE" },
      );
      setSuccess(
        membership
          ? `Доступ ${staff.username} к предприятию «${membership.enterpriseName}» удалён.`
          : `Аккаунт ${staff.username} удалён.`,
      );
      const removesRow =
        !membership ||
        !!enterpriseId ||
        (!isSuperAdmin && staff.memberships.length === 1);
      if (removesRow && page > 1 && query.data?.data.items.length === 1)
        setPage(page - 1);
      await client.invalidateQueries({ queryKey: key });
      await auth.refreshMemberships();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={s.panel}>
      <Heading
        title="Все сотрудники"
        action={<Link to="/enterprises">К выбору предприятия</Link>}
      />
      {import.meta.env.VITE_DEMO_MODE === "true" && (
        <p className={s.notice}>
          Демо · локальные тестовые аккаунты. Изменения не затрагивают настоящий
          сервер.
        </p>
      )}
      <p>
        {auth.operator.isSuperAdmin
          ? "Все рабочие аккаунты RIMS, включая сотрудников без предприятия."
          : "Сотрудники предприятий, которыми вы владеете. Удаление доступа не затрагивает другие предприятия сотрудника."}
      </p>
      <div className={s.row}>
        <Field label="Поиск сотрудника">
          <input
            type="search"
            maxLength={120}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Имя или логин"
          />
        </Field>
        <Field label="Предприятие сотрудников">
          <select
            value={enterpriseId}
            onChange={(e) => {
              setEnterpriseId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">
              {auth.operator.isSuperAdmin
                ? "Все предприятия и сотрудники без предприятия"
                : "Все мои предприятия"}
            </option>
            {enterprises.map((e) => (
              <option key={e.enterpriseId} value={e.enterpriseId}>
                {e.enterpriseName}
              </option>
            ))}
          </select>
        </Field>
        <ActionButton
          showLabel
          disabled={busy || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Обновить список
        </ActionButton>
      </div>
      <ErrorNotice error={error} />
      {success && <p role="status">{success}</p>}
      <QueryState query={query}>
        {(data) => (
          <>
            {!data.items.length && (
              <p>
                {data.total
                  ? "На этой странице нет сотрудников. Перейдите на предыдущую страницу."
                  : "Сотрудники не найдены."}
              </p>
            )}
            <Table headers={["Имя", "Логин", "Предприятия и роли", "Действия"]}>
              {data.items.map((staff) => (
                <tr key={staff.userId}>
                  <td>{staff.displayName}</td>
                  <td>{staff.username}</td>
                  <td>
                    {staff.isSuperAdmin && <p>{roleNames.super_admin}</p>}
                    {!staff.memberships.length &&
                      !staff.isSuperAdmin &&
                      "Без предприятия"}
                    {staff.memberships.map((m) => (
                      <div key={m.enterpriseId} className={styles.membership}>
                        {m.enterpriseName} · {roleNames[m.role]}
                      </div>
                    ))}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      {staff.memberships
                        .filter(
                          (m) => m.role !== "owner" && !staff.isSuperAdmin,
                        )
                        .map((m) => (
                          <ActionButton
                            key={m.enterpriseId}
                            showLabel
                            icon="remove"
                            disabled={busy}
                            aria-label={`Удалить доступ ${staff.username} к ${m.enterpriseName}`}
                            onClick={() => void remove(staff, m)}
                          >
                            Удалить из «{m.enterpriseName}»
                          </ActionButton>
                        ))}
                      {isSuperAdmin && staff.canDeleteAccount && (
                        <ActionButton
                          showLabel
                          icon="remove"
                          disabled={busy}
                          aria-label={`Удалить аккаунт ${staff.username}`}
                          onClick={() => void remove(staff)}
                        >
                          Удалить аккаунт
                        </ActionButton>
                      )}
                      {staff.isSuperAdmin ? (
                        <span className={s.muted}>
                          Аккаунт администратора защищён
                        </span>
                      ) : (
                        staff.memberships.some((m) => m.role === "owner") && (
                          <span className={s.muted}>
                            Для удаления владельца сначала назначьте нового
                          </span>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
            <Pager
              page={data}
              onChange={(name, value) => {
                if (name === "pageSize") {
                  setPageSize(Number(value));
                  setPage(1);
                } else if (name === "page") setPage(Number(value));
              }}
            />
          </>
        )}
      </QueryState>
    </main>
  );
}
