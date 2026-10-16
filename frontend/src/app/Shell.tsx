import { useWorkspace, homeFor, mayVisit, roleNames } from "./workspace";
import { ActionButton } from "../shared/ui";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { Recovery } from "./Recovery";
import { useOnline } from "../shared/lib/hooks";
import { ErrorNotice, s } from "../shared/ui";
import styles from "./app.module.css";
import logo from "../assets/brand/rims-logo-small.png";
const nav = [
  ["/", "Обзор"],
  ["/inventory", "Остатки"],
  ["/quarantines", "Карантин"],
  ["/batches", "Партии"],
  ["/ingredients", "Ингредиенты"],
  ["/dishes", "Блюда"],
  ["/deliveries", "Поставки"],
  ["/combos", "Комбо"],
  ["/risk-inventory", "Рискованные партии"],
  ["/menu", "Меню"],
  ["/stop-list", "Стоп-лист"],
  ["/orders", "Заказы"],
  ["/recommendations", "Горячие предложения"],
  ["/purchases", "Закупки"],
  ["/purchase-requests", "Заявки поставщикам"],
  ["/service/orders/new", "\u041a\u043e\u0440\u0437\u0438\u043d\u0430"],
  ["/members", "\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438"],
  [
    "/integrations",
    "\u0418\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u0438",
  ],
  ["/movements", "Движения"],
];
function WorkspaceShell() {
  const context = useWorkspace();
  const auth = useAuth();
  const location = useLocation();
  const online = useOnline();
  const [error, setError] = useState<unknown>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    if (window.matchMedia("(max-width: 900px)").matches) {
      const current = navigationRef.current?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      current?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [location.pathname, auth.operator?.id]);
  if (auth.loading)
    return (
      <main className={s.panel}>
        <div role="status">Проверка сессии…</div>
      </main>
    );
  if (!auth.operator)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  const navigation = (
    <nav
      ref={navigationRef}
      className={styles.nav}
      aria-label="Основная навигация"
    >
      {nav
        .filter(([path]) => mayVisit(context.role, path))
        .map(([path, label]) => (
          <NavLink end={path === "/"} to={path} key={path}>
            {label}
          </NavLink>
        ))}
      <div className={styles.user}>
        <span>{auth.operator.displayName}</span>
        <ActionButton
          onClick={async () => {
            try {
              await auth.logout();
            } catch (e) {
              setError(e);
            }
          }}
        >
          Выйти
        </ActionButton>
      </div>
    </nav>
  );
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Перейти к содержимому
      </a>
      <aside className={styles.sidebar}>
        <Link to={homeFor(context.role)} className={styles.brand}>
          <span className={styles.brandLine}>
            <img src={logo} alt="" className={styles.brandIcon} />
            <span>RIMS</span>
          </span>
          <small>ОПЕРАЦИОННАЯ СИСТЕМА</small>
        </Link>
        {navigation}
      </aside>
      <div ref={contentRef} className={styles.content}>
        <main id="main" className={styles.main}>
          {import.meta.env.VITE_DEMO_MODE === "true" && (
            <div className={s.notice}>
              Демо-режим · Тестовые данные сохраняются в текущей вкладке. Все
              операции выполняет mock API.
            </div>
          )}
          {!online && (
            <div role="status" className={s.notice}>
              Нет соединения. Введённые данные остаются в форме; проведение
              недоступно.
            </div>
          )}
          <ErrorNotice error={error} />
          <div className={s.row}>
            <Link to="/enterprises">
              {context.enterpriseName} · {roleNames[context.role]} · Сменить
              предприятие
            </Link>
          </div>
          <Recovery />
          {mayVisit(context.role, location.pathname) &&
          (!new URLSearchParams(location.search).get("warehouse") ||
            new URLSearchParams(location.search).get("warehouse") ===
              context.warehouseId) ? (
            <Outlet />
          ) : (
            <section className={s.panel}>
              <h1>Доступ ограничен</h1>
              <p>Ваши права не позволяют просматривать эту страницу.</p>
              <Link to={homeFor(context.role)}>Вернуться к работе</Link>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export function Shell() {
  const auth = useAuth();
  if (auth.loading || auth.membershipsLoading)
    return <main role="status">Проверяем доступ…</main>;
  if (!auth.operator) return <Navigate to="/login" replace />;
  if (!auth.workspace) return <Navigate to="/enterprises" replace />;
  return (
    <WorkspaceShell
      key={`${auth.workspace.userId}.${auth.workspace.warehouseId}.${auth.workspace.role}.${auth.workspace.sessionVersion}`}
    />
  );
}
