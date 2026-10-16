import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../app/auth";
import { useWorkspace, roleNames, scopeKey } from "../app/workspace";
import { request } from "../shared/api/client";
import type { Member, Page } from "../shared/api/types";
import { RegisterStaff } from "../shared/ui/RegisterStaff";
import {
  ActionButton,
  Heading,
  Field,
  Table,
  QueryState,
  Pager,
  ErrorNotice,
  s,
} from "../shared/ui";
export function Members() {
  const context = useWorkspace();
  const auth = useAuth();
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [role, setRole] = useState<"manager" | "warehouse" | "waiter">(
    "waiter",
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const path = `/enterprises/${context.enterpriseId}/members`;
  const query = useQuery({
    queryKey: [...scopeKey(context), "members", page],
    queryFn: ({ signal }) =>
      request<Page<Member>>(`${path}?page=${page}&pageSize=50`, {
        signal,
        context,
      }),
    refetchOnWindowFocus: "always",
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15000 : false,
  });
  const mutate = async (route: string, method: string, body?: object) => {
    setBusy(true);
    setError(null);
    try {
      await request(route, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        context,
      });
      await query.refetch();
      await auth.refreshMemberships();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Heading title="Сотрудники" />
      <p>
        Добавление по логину уже зарегистрированного пользователя. Владелец не
        изменяется через этот экран.
      </p>
      {context.role === "super_admin" && (
        <form
          className={s.panel}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              window.confirm(
                "Назначить нового владельца? Прежний владелец станет менеджером.",
              )
            )
              void mutate(
                `/enterprises/${context.enterpriseId}/owner`,
                "POST",
                { ownerUsername: ownerUsername.trim() },
              );
          }}
        >
          <h2>Назначить владельца</h2>
          <Field label="Логин владельца">
            <input
              required
              value={ownerUsername}
              onChange={(event) => setOwnerUsername(event.target.value)}
            />
          </Field>
          <ActionButton showLabel disabled={busy}>
            Назначить владельца
          </ActionButton>
        </form>
      )}
      <form
        className={s.panel}
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(path, "POST", { username: username.trim(), role });
        }}
      >
        <div className={s.row}>
          <Field label="Логин сотрудника">
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Роль нового сотрудника">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {["manager", "warehouse", "waiter"].map((r) => (
                <option key={r} value={r}>
                  {roleNames[r as typeof role]}
                </option>
              ))}
            </select>
          </Field>
          <ActionButton showLabel disabled={busy}>
            Добавить сотрудника
          </ActionButton>
        </div>
      </form>
      <RegisterStaff enterprise={context} onCreated={() => query.refetch()} />
      <ErrorNotice error={error} />
      <QueryState query={query}>
        {(data) => (
          <>
            <Table headers={["Имя", "Логин", "Роль", "Действия"]}>
              {data.items.map((member) => (
                <tr key={member.userId}>
                  <td>{member.displayName}</td>
                  <td>{member.username}</td>
                  <td>
                    {member.role === "owner" ? (
                      roleNames.owner
                    ) : (
                      <select
                        aria-label={`Роль ${member.username}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(e) =>
                          void mutate(`${path}/${member.userId}`, "PATCH", {
                            role: e.target.value,
                          })
                        }
                      >
                        {["manager", "warehouse", "waiter"].map((r) => (
                          <option key={r} value={r}>
                            {roleNames[r as typeof role]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {member.role !== "owner" && (
                      <ActionButton
                        icon="remove"
                        aria-label={`Удалить сотрудника ${member.username}`}
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Удалить доступ ${member.username} к предприятию?`,
                            )
                          )
                            void mutate(`${path}/${member.userId}`, "DELETE");
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
    </>
  );
}
