import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  downloadTable,
  type ExportAuthor,
  type ExportFormat,
} from "@rims/demo-api/table-export";
import s from "./tableDownload.module.css";
function TableDownload({
  table,
  author,
  onAuthor,
  connectionInfo,
}: {
  table: RefObject<HTMLTableElement | null>;
  author: ExportAuthor | null;
  onAuthor: (author: ExportAuthor) => void;
  connectionInfo: string;
}) {
  const [requested, setRequested] = useState<ExportFormat | null>(null),
    [displayName, setDisplayName] = useState(""),
    [username, setUsername] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (requested) dialog.current?.showModal();
  }, [requested]);
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 }),
    [error, setError] = useState("");
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const reposition = useCallback(() => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)),
      top:
        r.bottom + 190 < window.innerHeight
          ? r.bottom + 6
          : Math.max(8, r.top - 190),
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const scroll = () => reposition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", scroll);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", scroll);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, reposition]);
  const show = () => {
    reposition();
    setOpen((v) => !v);
  };
  const save = (format: ExportFormat) => {
    try {
      if (!author) {
        setRequested(format);
        close();
        return;
      }
      if (!table.current) throw new Error("Таблица недоступна");
      downloadTable(
        table.current,
        {
          ...author,
          source:
            "Указано пользователем; подключение поставщика: " + connectionInfo,
        },
        format,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    close();
  };
  return (
    <div className={s.toolbar} data-export-ignore>
      <button
        ref={trigger}
        className={s.trigger}
        type="button"
        title="Скачать показанные строки таблицы"
        aria-label="Скачать таблицу"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) show();
          }
        }}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className={s.menu}
            style={position}
            role="menu"
            aria-label="Формат скачивания"
            onKeyDown={(e) => {
              const items = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>("button"),
              );
              const current = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (e.key === "Escape" || e.key === "Tab") {
                e.preventDefault();
                close();
              }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                items[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (current +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length
                ]?.focus({ preventScroll: true });
              }
            }}
          >
            <p role="presentation">Показанные строки текущей страницы</p>
            <button role="menuitem" type="button" onClick={() => save("csv")}>
              CSV (.csv)
            </button>
            <button role="menuitem" type="button" onClick={() => save("xlsx")}>
              Excel (.xlsx)
            </button>
          </div>,
          document.body,
        )}
      {error && <p role="alert">{error}</p>}
      <dialog
        ref={dialog}
        className={s.dialog}
        onCancel={() => setRequested(null)}
        onClose={() => setRequested(null)}
        aria-labelledby={id + "-author"}
      >
        <h2 id={id + "-author"}>Автор выгрузки</h2>
        <p>
          Вход поставщика выполнен по API-ключу, личная учётная запись
          отсутствует. Укажите имя и логин автора; эти данные будут отмечены в
          файле как указанные пользователем.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !displayName.trim() ||
              !username.trim() ||
              !requested ||
              !table.current
            )
              return;
            const next = {
              displayName: displayName.trim(),
              username: username.trim(),
            };
            try {
              downloadTable(
                table.current,
                {
                  ...next,
                  source:
                    "Указано пользователем; подключение поставщика: " +
                    connectionInfo,
                },
                requested,
              );
              onAuthor(next);
              setError("");
              dialog.current?.close();
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          <label>
            Имя автора
            <input
              required
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>
            Логин автора
            <input
              required
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button type="submit">Скачать файл</button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Отмена
          </button>
        </form>
      </dialog>
    </div>
  );
}

export function ExportTable({
  children,
  author,
  onAuthor,
  connectionInfo,
}: {
  children: ReactNode;
  author: ExportAuthor | null;
  onAuthor: (author: ExportAuthor) => void;
  connectionInfo: string;
}) {
  const table = useRef<HTMLTableElement>(null);
  return (
    <>
      <TableDownload
        table={table}
        author={author}
        onAuthor={onAuthor}
        connectionInfo={connectionInfo}
      />
      <table ref={table}>{children}</table>
    </>
  );
}
