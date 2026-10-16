import { useState } from "react";
import { useAuth } from "../../app/auth";
import { roleNames } from "../../app/workspace";
import { request } from "../api/client";
import type { Membership } from "../api/types";
import { ActionButton, ErrorNotice, Field, s } from "./index";

export function RegisterStaff({
  enterprise,
  onCreated,
}: {
  enterprise?: Membership;
  onCreated?: () => Promise<unknown>;
}) {
  const auth = useAuth();
  const eligible = auth.memberships.filter((m) =>
    ["owner", "super_admin"].includes(m.role),
  );
  const [enterpriseId, setEnterpriseId] = useState(
    enterprise?.enterpriseId || "",
  );
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("waiter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState("");
  if (!auth.operator || (!auth.operator.isSuperAdmin && !eligible.length))
    return null;
  const selected =
    enterprise || eligible.find((m) => m.enterpriseId === enterpriseId);
  return (
    <form
      className={s.panel}
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setSuccess("");
        if (!selected && !auth.operator?.isSuperAdmin) {
          setError(new Error("Выберите предприятие"));
          return;
        }
        setBusy(true);
        try {
          await request(
            selected
              ? `/enterprises/${selected.enterpriseId}/members/register`
              : "/enterprises/staff",
            {
              method: "POST",
              body: JSON.stringify({
                username: username.trim(),
                displayName: displayName.trim(),
                password,
                ...(selected ? { role } : {}),
              }),
            },
          );
          setSuccess(
            selected
              ? `Сотрудник ${username.trim()} создан и добавлен в «${selected.enterpriseName}».`
              : `Пользователь ${username.trim()} создан. Его можно назначить владельцем при создании предприятия.`,
          );
          setUsername("");
          setDisplayName("");
          setPassword("");
          await onCreated?.();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Зарегистрировать сотрудника</h2>
      <p>
        Создайте новый логин и передайте сотруднику заданный пароль. Ваша сессия
        сохранится.
      </p>
      <fieldset disabled={busy}>
        {!enterprise && (
          <Field label="Предприятие сотрудника">
            <select
              required={!auth.operator.isSuperAdmin}
              value={enterpriseId}
              onChange={(event) => setEnterpriseId(event.target.value)}
            >
              <option value="">
                {auth.operator.isSuperAdmin
                  ? "Без предприятия — будущий владелец"
                  : "Выберите предприятие"}
              </option>
              {eligible.map((m) => (
                <option key={m.enterpriseId} value={m.enterpriseId}>
                  {m.enterpriseName}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Имя нового сотрудника">
          <input
            required
            maxLength={120}
            value={displayName}
            autoComplete="off"
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label="Новый логин">
          <input
            required
            minLength={3}
            maxLength={64}
            pattern="[A-Za-z0-9_.\-]{3,64}"
            title="3–64 символа: латинские буквы, цифры, точка, подчёркивание и дефис"
            value={username}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label="Пароль нового сотрудника">
          <input
            required
            type="password"
            minLength={12}
            maxLength={128}
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {selected && (
          <Field label="Роль сотрудника">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {["manager", "warehouse", "waiter"].map((r) => (
                <option key={r} value={r}>
                  {roleNames[r as "manager" | "warehouse" | "waiter"]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ActionButton showLabel disabled={busy}>
          {busy ? "Создание сотрудника…" : "Зарегистрировать сотрудника"}
        </ActionButton>
      </fieldset>
      <ErrorNotice error={error} />
      {success && <p role="status">{success}</p>}
    </form>
  );
}
