import { useState, useRef, useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../app/auth";
import { homeFor, roleNames } from "../app/workspace";
import { request } from "../shared/api/client";
import type { Enterprise } from "../shared/api/types";
import { ActionButton, Field, ErrorNotice, Heading, s } from "../shared/ui";
import { useErrorScroll } from "../shared/lib/useErrorScroll";
import { RegisterStaff } from "../shared/ui/RegisterStaff";
export function Enterprises() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const form = useForm<{ name: string; ownerUsername: string }>({
    resolver: zodResolver(
      z.object({
        name: z.string().trim().min(1, "Укажите название").max(120),
        ownerUsername: z
          .string()
          .trim()
          .min(1, "Укажите логин владельца")
          .max(64),
      }),
    ),
    shouldFocusError: false,
  });
  const ref = useErrorScroll(form, error);
  if (auth.loading) return <main className={s.panel}>Проверка сессии…</main>;
  if (!auth.operator) return <Navigate to="/login" replace />;
  return (
    <main className={s.panel}>
      <Heading
        title="Выберите предприятие"
        action={
          (auth.operator.isSuperAdmin ||
            auth.memberships.some((m) => m.role === "owner")) && (
            <Link to="/staff" className={s.action}>
              Все сотрудники
            </Link>
          )
        }
      />
      <p>
        {auth.operator.displayName} · каждое предприятие имеет отдельный склад.
      </p>
      {import.meta.env.VITE_DEMO_MODE === "true" && (
        <p className={s.notice}>
          Демо · mock API. Серверная изоляция и внешняя интеграция пока не
          проверены.
        </p>
      )}
      <ErrorNotice error={auth.membershipsError} />
      {auth.membershipsLoading ? (
        <p role="status">Загрузка членств…</p>
      ) : (
        <div className={s.cards}>
          {auth.memberships.map((m) => (
            <section key={m.warehouseId} className={s.line}>
              <h2>{m.enterpriseName}</h2>
              <p>{roleNames[m.role]}</p>
              <ActionButton
                showLabel
                disabled={form.formState.isSubmitting}
                onClick={async () => {
                  try {
                    await auth.select(m.warehouseId);
                    navigate(homeFor(m.role));
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Открыть предприятие
              </ActionButton>
            </section>
          ))}
        </div>
      )}
      {!auth.memberships.length && !auth.membershipsLoading && (
        <p>
          У вас пока нет членств. Попросите владельца добавить ваш
          зарегистрированный логин или супер-админа назначить вас владельцем.
        </p>
      )}
      {(auth.operator.isSuperAdmin ||
        auth.memberships.some((m) => m.role === "owner")) && (
        <p className={s.notice}>
          Новые предприятия скрыты от покупателей. Откройте предприятие → Меню →
          Публикация для покупателей, чтобы проверить статус и опубликовать
          заведение.
        </p>
      )}
      <RegisterStaff />
      {auth.operator.isSuperAdmin && (
        <form
          ref={ref}
          onSubmit={form.handleSubmit(async ({ name, ownerUsername }) => {
            setError(null);
            try {
              const result = await request<Enterprise>("/enterprises", {
                method: "POST",
                body: JSON.stringify({ name, ownerUsername }),
              });
              if (!alive.current) return;
              await auth.refreshMemberships();
              if (!alive.current) return;
              form.reset();
              await auth.select(result.data.warehouseId);
              navigate("/");
            } catch (e) {
              setError(e);
            }
          })}
        >
          <h2>Создать предприятие</h2>
          <Field
            label="Название предприятия"
            error={form.formState.errors.name?.message}
          >
            <input {...form.register("name")} />
          </Field>
          <Field
            label="Логин владельца"
            error={form.formState.errors.ownerUsername?.message}
          >
            <input {...form.register("ownerUsername")} />
          </Field>
          <p className={s.muted}>
            Владелец должен быть зарегистрирован в RIMS.
          </p>
          <ActionButton showLabel disabled={form.formState.isSubmitting}>
            Создать предприятие
          </ActionButton>
        </form>
      )}
      <ErrorNotice error={error} />
      <div className={s.row}>
        {auth.workspace && (
          <Link to={homeFor(auth.workspace.role)}>Вернуться к работе</Link>
        )}
        <ActionButton
          showLabel
          onClick={() => void auth.logout().catch(setError)}
        >
          Выйти
        </ActionButton>
      </div>
    </main>
  );
}
