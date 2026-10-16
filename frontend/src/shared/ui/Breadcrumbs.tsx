import { ScopedLink as Link } from "../lib/routing";
import { useLocation } from "react-router-dom";
import s from "./ui.module.css";
import { useContext } from "react";
import { WorkspaceContext, homeFor } from "../../app/workspace";
const sections: Record<string, string> = {
  inventory: "Остатки",
  quarantines: "Карантин",
  combos: "Комбо",
  "risk-inventory": "Рискованные партии",
  batches: "Партии",
  ingredients: "Ингредиенты",
  dishes: "Блюда",
  deliveries: "Поставки",
  menu: "Меню",
  "stop-list": "Стоп-лист",
  orders: "Заказы",
  recommendations: "Горячие предложения",
  purchases: "Закупки",
  movements: "Движения",
  members: "Сотрудники",
  integrations: "Интеграции",
};
export function Breadcrumbs() {
  const context = useContext(WorkspaceContext);
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [
    { label: "RIMS", path: context ? homeFor(context.role) : "/" },
  ];
  if (parts[0] === "service") {
    crumbs.push({ label: "Корзина", path: "/service/orders/new" });
  }
  if (parts[0] && sections[parts[0]])
    crumbs.push({ label: sections[parts[0]], path: `/${parts[0]}` });
  if (parts[1] && parts[0] !== "service")
    crumbs.push({
      label: parts[1] === "new" ? "Создание" : parts[1],
      path:
        parts[0] === "dishes" && parts[1] !== "new"
          ? `/dishes/${parts[1]}/edit`
          : `/${parts[0]}/${parts[1]}`,
    });
  if (parts[2] === "edit")
    crumbs.push({ label: "Редактирование", path: pathname });
  return (
    <nav className={s.breadcrumbs} aria-label="Путь страницы">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={`${index}.${crumb.path}`}>
            <Link
              to={crumb.path}
              aria-current={index === crumbs.length - 1 ? "page" : undefined}
            >
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
