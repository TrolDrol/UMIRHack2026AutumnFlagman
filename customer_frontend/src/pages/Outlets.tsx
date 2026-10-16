import { Link } from "react-router-dom";
import { useOutlets } from "../shared/api/queries";
import { Feedback } from "../shared/ui/Feedback";
import styles from "../app/site.module.css";
export function Outlets() {
  const query = useOutlets();
  return (
    <>
      <h1>Выберите заведение</h1>

      <button onClick={() => void query.refetch()} disabled={query.isFetching}>
        Обновить
      </button>
      {query.isError && query.data && (
        <p role="alert">Не удалось обновить список. Данные могли устареть.</p>
      )}
      <Feedback query={query} />
      <div className={styles.grid}>
        {query.data?.map((outlet, i) => (
          <Link
            className={styles.outlet}
            to={`/outlets/${outlet.warehouseId}/menu`}
            key={outlet.warehouseId}
          >
            <span className={styles.outletNumber}>0{i + 1}</span>
            <h2>{outlet.name}</h2>
            <span>Открыть меню ↗</span>
          </Link>
        ))}
      </div>
      {query.isSuccess && query.data?.length === 0 && (
        <p>Пока нет доступных заведений.</p>
      )}
    </>
  );
}
