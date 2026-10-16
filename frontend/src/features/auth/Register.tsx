import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../../app/auth";
import { ActionButton, Field, ErrorNotice, s } from "../../shared/ui";
import { useErrorScroll } from "../../shared/lib/useErrorScroll";
const schema = z.object({
  username: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9_.-]{3,64}$/,
      "Логин: 3–64 латинских букв, цифр или _ . -",
    ),
  password: z.string().min(12, "Минимум 12 символов").max(128),
  displayName: z.string().trim().min(1, "Укажите имя").max(120),
});
export function Register() {
  const auth = useAuth();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    shouldFocusError: false,
  });
  const ref = useErrorScroll(form, error);
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
    <main className={s.panel}>
      <h1>RIMS · Регистрация</h1>
      <form
        ref={ref}
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await auth.register(v.username, v.password, v.displayName);
            form.reset();
          } catch (e) {
            setError(e);
          }
        })}
      >
        <Field label="Имя" error={form.formState.errors.displayName?.message}>
          <input autoComplete="name" {...form.register("displayName")} />
        </Field>
        <Field label="Логин" error={form.formState.errors.username?.message}>
          <input autoComplete="username" {...form.register("username")} />
        </Field>
        <Field
          label="Пароль"
          hint="От 12 до 128 символов"
          error={form.formState.errors.password?.message}
        >
          <input
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
        </Field>
        <ErrorNotice error={error} />
        <ActionButton showLabel disabled={form.formState.isSubmitting}>
          Зарегистрироваться
        </ActionButton>
      </form>
      <Link to="/login">Уже есть учётная запись · Войти</Link>
    </main>
  );
}
