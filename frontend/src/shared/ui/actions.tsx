import {
  Children,
  useId,
  createContext,
  useContext,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { type LinkProps } from "react-router-dom";
import { ScopedLink as Link } from "../lib/routing";
import s from "./ui.module.css";
import atlas from "../../assets/icons/actions-atlas.png";
import { atlasSize, glyphs } from "../../assets/icons/atlas";

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((part) =>
      isValidElement<{ children?: ReactNode }>(part)
        ? text(part.props.children)
        : String(part),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
type IconName =
  | "filter-remove"
  | "copy"
  | "filter"
  | "edit"
  | "disable"
  | "enable"
  | "add"
  | "remove"
  | "minus"
  | "refresh"
  | "save"
  | "check"
  | "cancel"
  | "back"
  | "next"
  | "logout"
  | "login"
  | "cart"
  | "delivery"
  | "hot"
  | "purchase"
  | "history"
  | "view";
function iconFor(label: string): IconName {
  if (/копи|Повторить заказ|Повторить поставку|Повторить списание/i.test(label))
    return "copy";
  if (/Редакт|рецептур/i.test(label))
    return /Сохранить/i.test(label) ? "save" : "edit";
  if (/Отключить/i.test(label)) return "disable";
  if (/Включить/i.test(label)) return "enable";
  if (/Удалить|Убрать|Списать/i.test(label)) return "remove";
  if (/Уменьшить/i.test(label)) return "minus";
  if (/Увеличить/i.test(label)) return "add";
  if (/предыдущая|Назад|К истории/i.test(label)) return "back";
  if (/следующая|Далее/i.test(label)) return "next";
  if (/Обнов|Повторить|Проверка…/i.test(label)) return "refresh";
  if (/Выйти/i.test(label)) return "logout";
  if (/^(Войти|Вход)(\s|$)/i.test(label)) return "login";
  if (/Закрыть|Оставить|Отмен/i.test(label)) return "cancel";
  if (/Проверить|Подтвердить|сверк|Провести заказ/i.test(label)) return "check";
  if (/Сохранить/i.test(label)) return "save";
  if (/поставк|приёмк/i.test(label)) return "delivery";
  if (/истекающ|Использовать запасы|предложени/i.test(label)) return "hot";
  if (/закуп/i.test(label)) return "purchase";
  if (/заказ|корзин/i.test(label)) return "cart";
  if (/Добавить/i.test(label)) return "add";
  if (/Движени|истори/i.test(label)) return "history";
  return "view";
}
function Icon({ name }: { name: IconName }) {
  if (name === "filter-remove")
    return (
      <svg
        className={s.actionSvg}
        data-icon={name}
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d="M20 3H4l6 8v8l4 2V11z" />
        <path d="m18 13 4 4m0-4-4 4" />
      </svg>
    );
  const glyph = glyphs[name];
  const scale = 20 / glyph.size;
  return (
    <span
      className={s.actionIcon}
      data-icon={name}
      aria-hidden="true"
      style={{
        maskImage: `url(${atlas})`,
        maskSize: `${atlasSize.width * scale}px ${atlasSize.height * scale}px`,
        maskPosition: `${16 - glyph.x * scale}px ${16 - glyph.y * scale}px`,
      }}
    />
  );
}

export const ActionHelpEnabled = createContext(true);
export function ActionHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const enabled = useContext(ActionHelpEnabled);
  if (!enabled) return <>{children}</>;
  const descriptions: Partial<Record<IconName, string>> = {
    copy: "Открывает новую позицию с исходными данными. Проверьте и измените поля перед сохранением.",
    edit: "Открывает форму редактирования. Изменения применяются после сохранения.",
    remove:
      "Удаляет выбранную позицию. Если нужно подтверждение, сначала откроется диалог.",
    disable: "Выключает блюдо для новых заказов.",
    enable: "Включает блюдо. Доступность зависит от запасов ингредиентов.",
    save: "Проверяет и сохраняет данные формы.",
    check: "Проверяет данные и подтверждает операцию.",
    refresh: "Повторно загружает актуальные данные.",
    add: "Добавляет позицию или увеличивает количество на одну порцию.",
    minus: "Уменьшает количество на одну порцию.",
    back: "Открывает предыдущую страницу или возвращает к списку.",
    next: "Открывает следующую страницу списка.",
    cart: "Открывает заказ или добавляет выбранное блюдо в корзину.",
    delivery:
      "Открывает форму поставки. Проверьте количества и заполните сроки годности перед проведением.",
    cancel: "Закрывает диалог или отменяет действие.",
    logout: "Завершает сеанс оператора.",
    login: "Выполняет вход с указанными учётными данными.",
    history: "Открывает историю операций.",
    filter: "Ограничивает список выбранным значением.",
    purchase: "Открывает список ингредиентов для закупки.",
    hot: "Открывает предложения для использования запасов с истекающим сроком.",
    view: "Открывает подробную информацию.",
  };
  const description = label.startsWith("Сортировка")
    ? "Сортирует загруженные строки по этому столбцу. Повторное нажатие меняет направление, третье возвращает исходный порядок."
    : descriptions[iconFor(label)];
  return (
    <span className={s.actionWithHelp}>
      {children}
      <button
        type="button"
        className={s.actionHelp}
        popoverTarget={id}
        title={`${label}. ${description}`}
        aria-label="Пояснение к действию"
        aria-describedby={id}
      >
        <span data-icon="help" aria-hidden="true" />
      </button>
      <span id={id} popover="auto" className={s.actionExplanation} role="note">
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
    </span>
  );
}

export function ActionButton({
  children,
  className,
  icon,
  showLabel = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  showLabel?: boolean;
}) {
  const label = props["aria-label"] || text(children);
  return (
    <ActionHelp label={props.title || label}>
      <button
        {...props}
        aria-label={label}
        title={props.title || label}
        className={`${showLabel ? s.textAction : s.iconAction} ${className || ""}`}
      >
        <Icon name={icon || iconFor(label)} />
        {showLabel && <span>{children || label}</span>}
      </button>
    </ActionHelp>
  );
}
export function ActionLink({
  children,
  className,
  icon,
  showLabel = false,
  ...props
}: LinkProps & { icon?: IconName; showLabel?: boolean }) {
  const label = props["aria-label"] || text(children);
  return (
    <ActionHelp label={props.title || label}>
      <Link
        {...props}
        aria-label={label}
        title={props.title || label}
        className={`${showLabel ? s.textAction : s.iconAction} ${className || ""}`}
      >
        <Icon name={icon || iconFor(label)} />
        {showLabel && <span>{children || label}</span>}
      </Link>
    </ActionHelp>
  );
}
