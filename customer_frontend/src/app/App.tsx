import { useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  Link,
  NavLink,
  useParams,
} from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { useOutlets } from "../shared/api/queries";
import { CartProvider } from "../features/cart/CartProvider";
import { AuthPage } from "../features/auth/AuthPage";
import { MenuPage } from "../features/menu/MenuPage";
import { CartPage } from "../features/cart/CartPage";
import { OrdersPage, OrderPage } from "../features/orders/OrdersPage";
import { Outlets } from "../pages/Outlets";
import styles from "./site.module.css";
import { StorageBoundary } from "../shared/ui/StorageBoundary";
import { scope, read, write } from "../shared/lib/storage";
function Protected() {
  const auth = useAuth();
  if (auth.loading) return <p role="status">Проверяем сессию…</p>;
  if (auth.error)
    return (
      <div role="alert">
        {auth.error}
        <button onClick={() => void auth.refresh()}>Повторить проверку</button>
      </div>
    );
  return auth.user ? <Outlet /> : <Navigate to="/login" replace />;
}
function OutletLayout() {
  const { warehouseId: id } = useParams();
  const { user } = useAuth();
  const outlets = useOutlets();
  const name = outlets.data?.find((x) => x.warehouseId === id)?.name;
  const nameKey = scope(user!.id, id!) + ".outlet-name";
  useEffect(() => {
    if (name) {
      try {
        write(nameKey, name);
      } catch {
        /* A name cache is optional. */
      }
    }
  }, [name, nameKey]);
  return (
    <StorageBoundary key={user!.id + id}>
      <CartProvider user={user!.id} id={id!}>
        <div className={styles.outletHeader}>
          <Link to="/outlets">← Все заведения</Link>
          <h2>{name || read<string>(nameKey, "Заведение · " + id)}</h2>
          <nav aria-label="Разделы заведения">
            {[
              ["menu", "Меню"],
              ["offers", "Предложения"],
              ["cart", "Корзина"],
              ["orders", "Мои заказы"],
            ].map(([path, label]) => (
              <NavLink key={path} to={`/outlets/${id}/${path}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <Outlet />
      </CartProvider>
    </StorageBoundary>
  );
}
export function App() {
  const { user, logout } = useAuth();
  const cache = useQueryClient();
  useEffect(() => {
    const refresh = (e: StorageEvent) => {
      if (e.key === "rims.demo.revision.v1")
        void cache.invalidateQueries({ queryKey: ["customer"] });
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [cache]);
  return (
    <>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          RIMS<span>Restaurant Inventory &amp; Menu System</span>
        </Link>
        {user && (
          <div>
            <span>{user.displayName}</span>
            <button
              onClick={() =>
                void logout().catch((e) => window.alert(e.message))
              }
            >
              Выйти
            </button>
          </div>
        )}
      </header>
      <div className={styles.container}>
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to="/outlets" /> : <AuthPage />}
          />
          <Route
            path="/register"
            element={
              user ? <Navigate to="/outlets" /> : <AuthPage registering />
            }
          />
          <Route element={<Protected />}>
            <Route path="/" element={<Navigate to="/outlets" replace />} />
            <Route path="/outlets" element={<Outlets />} />
            <Route path="/outlets/:warehouseId" element={<OutletLayout />}>
              <Route path="menu" element={<MenuPage />} />
              <Route path="offers" element={<MenuPage offersOnly />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:id" element={<OrderPage />} />
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <>
                <h1>Страница не найдена</h1>
                <Link to="/outlets">К заведениям</Link>
              </>
            }
          />
        </Routes>
      </div>
      <footer className={styles.footer}>
        RIMS · Restaurant Inventory &amp; Menu System
      </footer>
    </>
  );
}
