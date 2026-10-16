import type { UseQueryResult } from "@tanstack/react-query";
import styles from "../../app/site.module.css";
export function Feedback({ query }: { query: UseQueryResult<unknown, Error> }) {
  if (query.isPending)
    return (
      <div className={styles.skeleton} role="status">
        Загружаем…
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className={styles.error}>
        {query.error.message}{" "}
        <button onClick={() => void query.refetch()}>Повторить загрузку</button>
      </div>
    );
  return null;
}
export const moscow = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value)) + " МСК";
