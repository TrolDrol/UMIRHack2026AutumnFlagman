import { useErrorScroll } from "../../shared/lib/useErrorScroll";
import { ActionButton } from "../../shared/ui";
import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../../app/auth";
import { ErrorNotice, Field, s } from "../../shared/ui";
import styles from "../../app/app.module.css";
import logo from "../../assets/brand/rims-logo-small.png";
const schema = z.object({
  username: z.string().min(1, "Укажите имя"),
  password: z.string().min(1, "Укажите пароль"),
});
export function Login() {
  const auth = useAuth();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.infer<typeof schema>>({
    shouldFocusError: false,
    resolver: zodResolver(schema),
  });
  const errorScrollRef = useErrorScroll(form, error);
  if (auth.loading)
    return (
      <main className={s.panel}>
        <div
          className={s.skeleton}
          role="status"
          aria-label="Проверка сессии"
        />
      </main>
    );
  if (auth.operator) return <Navigate to="/enterprises" replace />;
  return (
    <div className={styles.login}>
      <section className={styles.loginIntro}>
        <div className={styles.loginBrand}>
          <img src={logo} alt="" />
          <span>
            RIMS<small>Restaurant Inventory &amp; Menu System</small>
          </span>
        </div>
        <div className={s.eyebrow}>Ресторан под контролем</div>
        <h1>
          Свежие продукты.
          <br />
          Точные решения.
        </h1>
        <p>
          Приёмка, рецептуры и заказы в одном месте.
          <br />
          Используйте запасы вовремя и следите за каждым движением.
        </p>
      </section>
      <main className={styles.loginForm}>
        <form
          ref={errorScrollRef}
          onSubmit={form.handleSubmit(async (v) => {
            setError(null);
            try {
              await auth.login(v.username, v.password);
              form.reset();
            } catch (e) {
              setError(e);
            }
          })}
        >
          <h1>Вход оператора</h1>
          {import.meta.env.VITE_DEMO_MODE === "true" && (
            <p className={s.notice}>
              Демо-режим · Логины:{" "}
              <strong>operator, manager, warehouse, waiter</strong>, пароль:{" "}
              <strong>demo</strong>. Все данные тестовые.
            </p>
          )}
          <p className={s.muted}>Используйте учётную запись ресторана.</p>
          <Field
            label="Имя пользователя"
            error={form.formState.errors.username?.message}
          >
            <input autoComplete="username" {...form.register("username")} />
          </Field>
          <Field label="Пароль" error={form.formState.errors.password?.message}>
            <input
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
          </Field>
          <ErrorNotice error={error} />
          <ActionButton
            showLabel
            className={s.primary}
            disabled={form.formState.isSubmitting}
          >
            Войти
          </ActionButton>
          <Link to="/register">Создать учётную запись</Link>
        </form>
      </main>
    </div>
  );
}
