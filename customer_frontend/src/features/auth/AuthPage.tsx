import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/auth";
import { ApiError, request } from "../../shared/api/client";
import styles from "../../app/site.module.css";
export function AuthPage({ registering = false }: { registering?: boolean }) {
  const schema = z.object({
    username: z
      .string()
      .regex(
        /^[a-zA-Z0-9_.-]{3,64}$/,
        "От 3 до 64 латинских букв, цифр, _, . или -",
      ),
    password: z.string().min(12, "Минимум 12 символов").max(128),
    displayName: registering
      ? z.string().trim().min(1, "Укажите имя").max(120)
      : z.string().optional(),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });
  const auth = useAuth();
  const navigate = useNavigate();
  const submit = handleSubmit(async (values) => {
    try {
      await request(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(
          registering
            ? values
            : { username: values.username, password: values.password },
        ),
      });
      await auth.refresh();
      navigate("/outlets");
    } catch (e) {
      setError("root", {
        message: e instanceof Error ? e.message : "Ошибка входа",
      });
      if (e instanceof ApiError)
        for (const f of e.fields)
          if (["username", "password", "displayName"].includes(f.path))
            setError(f.path as "username", { message: f.message });
    }
  });
  return (
    <main className={styles.auth}>
      <div>
        <h1>RIMS</h1>
        <p>Restaurant Inventory &amp; Menu System</p>
      </div>
      <form onSubmit={submit} className={styles.panel}>
        <h2>{registering ? "Регистрация" : "Вход"}</h2>
        {registering && (
          <label>
            Ваше имя
            <input autoComplete="name" {...register("displayName")} />
            <span role="alert">{errors.displayName?.message}</span>
          </label>
        )}
        <label>
          Логин
          <input autoComplete="username" {...register("username")} />
          <span role="alert">{errors.username?.message}</span>
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            {...register("password")}
          />
          <span role="alert">{errors.password?.message}</span>
        </label>
        {errors.root && <p role="alert">{errors.root.message}</p>}
        <button disabled={isSubmitting}>
          {isSubmitting
            ? "Проверяем…"
            : registering
              ? "Создать аккаунт"
              : "Войти"}
        </button>
        <Link to={registering ? "/login" : "/register"}>
          {registering
            ? "Уже есть аккаунт? Войти"
            : "Первый визит? Зарегистрироваться"}
        </Link>
      </form>
    </main>
  );
}
