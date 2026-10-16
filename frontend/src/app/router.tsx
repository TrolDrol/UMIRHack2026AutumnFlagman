import { Combos } from "../pages/Combos";
import { PurchaseRequests } from "../pages/PurchaseRequests";
import { RiskInventory } from "../pages/ExtensionAnalytics";
import { Quarantines, QuarantineDetail } from "../pages/Quarantines";
import { Members } from "../pages/Members";
import { Integrations } from "../pages/Integrations";
import { Enterprises } from "../pages/Workspace";
import { StaffDirectory } from "../pages/StaffDirectory";
import { Register } from "../features/auth/Register";
import {
  createBrowserRouter,
  Outlet,
  Navigate,
  useLocation,
  Link,
  useRouteError,
} from "react-router-dom";
import { AuthProvider } from "./auth";
import { Shell } from "./Shell";
import { Login } from "../features/auth/Login";
import { Dashboard } from "../pages/Dashboard";
import { Inventory, Batches } from "../pages/Inventory";
import { Ingredients, Dishes } from "../pages/Catalogs";
import { Menu, Recommendations, Purchases } from "../pages/Menu";
import { Documents, DocumentDetail, Movements } from "../pages/History";
import { DishEditor } from "../features/dishes/DishEditor";
import { DeliveryEditor } from "../features/deliveries/DeliveryEditor";
import { OrderEditor } from "../features/orders/OrderEditor";
import { ErrorNotice, s } from "../shared/ui";
function ServiceCartRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/service/orders/new${search}`} replace />;
}
function RouteError() {
  const error = useRouteError();
  return (
    <main className={s.panel}>
      <h1>Не удалось открыть страницу</h1>
      <ErrorNotice error={error} />
      <a href="/">Вернуться к обзору</a>
    </main>
  );
}
export const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/register", element: <Register /> },
      { path: "/enterprises", element: <Enterprises /> },
      { path: "/staff", element: <StaffDirectory /> },
      {
        element: <Shell />,
        children: [
          { path: "/", element: <Dashboard /> },
          { path: "/members", element: <Members /> },
          { path: "/integrations", element: <Integrations /> },
          { path: "/service/menu", element: <ServiceCartRedirect /> },
          {
            path: "/service/stop-list",
            element: <ServiceCartRedirect />,
          },
          {
            path: "/service/recommendations",
            element: <ServiceCartRedirect />,
          },
          { path: "/service/orders/new", element: <OrderEditor service /> },
          { path: "/quarantines", element: <Quarantines /> },
          { path: "/quarantines/:id", element: <QuarantineDetail /> },
          { path: "/inventory", element: <Inventory /> },
          { path: "/inventory/:ingredientId", element: <Batches /> },
          { path: "/batches", element: <Batches /> },
          { path: "/ingredients", element: <Ingredients /> },
          { path: "/dishes", element: <Dishes /> },
          { path: "/dishes/new", element: <DishEditor /> },
          { path: "/dishes/:id/edit", element: <DishEditor /> },
          { path: "/deliveries", element: <Documents kind="deliveries" /> },
          { path: "/deliveries/new", element: <DeliveryEditor /> },
          {
            path: "/deliveries/:id",
            element: <DocumentDetail kind="deliveries" />,
          },
          { path: "/combos", element: <Combos /> },
          { path: "/risk-inventory", element: <RiskInventory /> },
          { path: "/menu", element: <Menu /> },
          { path: "/stop-list", element: <Menu stop /> },
          { path: "/orders", element: <Documents kind="orders" /> },
          { path: "/orders/new", element: <OrderEditor /> },
          { path: "/orders/:id", element: <DocumentDetail kind="orders" /> },
          { path: "/recommendations", element: <Recommendations /> },
          { path: "/purchases", element: <Purchases /> },
          { path: "/purchase-requests", element: <PurchaseRequests /> },
          { path: "/movements", element: <Movements /> },
          {
            path: "*",
            element: (
              <section className={s.panel}>
                <h1>Страница не найдена</h1>
                <Link to="/">Открыть обзор</Link>
              </section>
            ),
          },
        ],
      },
    ],
  },
]);
