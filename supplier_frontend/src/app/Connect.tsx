import { useEffect, useRef, useState } from "react";
import { useSession } from "./Session";
import { demoKey, startDemo, type DemoSupplier } from "./demo";
import s from "../styles/Portal.module.css";
export const demoBuild = import.meta.env.VITE_DEMO_MODE === "true";
export function Connect() {
  const { connect, error, connecting } = useSession();
  const [warehouse, setWarehouse] = useState("");
  const [key, setKey] = useState("");
  const [suppliers, setSuppliers] = useState<DemoSupplier[]>([]);
  const [selected, setSelected] = useState("");
  const [demoError, setDemoError] = useState("");
  const [loadingDemo, setLoadingDemo] = useState(demoBuild);
  const launched = useRef(false);
  useEffect(() => {
    if (!demoBuild || launched.current) return;
    launched.current = true;
    void startDemo()
      .then((items) => {
        setSuppliers(items);
        if (items[0])
          setSelected(`${items[0].warehouseId}/${items[0].clientId}`);
      })
      .catch((error) => setDemoError((error as Error).message))
      .finally(() => setLoadingDemo(false));
  }, []);
  return (
    <main className={s.connect}>
      <p className={s.eyebrow}>Флагман · Поставщик</p>
      <h1>Подключение к складу</h1>
      <p>Получайте заявки, оформляйте отгрузку и отслеживайте приёмку.</p>
      <p className={s.badge}>
        {demoBuild ? "Демонстрационные данные" : "Рабочее подключение"}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (demoBuild) {
              const supplier = suppliers.find(
                (item) => `${item.warehouseId}/${item.clientId}` === selected,
              );
              if (!supplier) return;
              const secret = await demoKey(supplier);
              await connect("demo", supplier.warehouseId, secret);
            } else {
              const secret = key;
              setKey("");
              await connect("live", warehouse.trim(), secret);
            }
          } catch (error) {
            if (demoBuild) setDemoError((error as Error).message);
          }
        }}
      >
        <fieldset disabled={connecting || loadingDemo}>
          {demoBuild ? (
            <label>
              Тестовый поставщик и склад
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Выберите поставщика</option>
                {suppliers.map((item) => (
                  <option
                    key={`${item.warehouseId}/${item.clientId}`}
                    value={`${item.warehouseId}/${item.clientId}`}
                  >
                    {item.name} · {item.warehouseName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Идентификатор склада
                <input
                  required
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Ключ API
                <input
                  required
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className={s.muted}>
                Ключ хранится в памяти этой вкладки. После обновления страницы
                потребуется повторное подключение.
              </p>
            </>
          )}
          <button disabled={demoBuild && !selected} type="submit">
            {connecting ? "Проверяем подключение…" : "Подключиться"}
          </button>
        </fieldset>
      </form>
      {loadingDemo && <p role="status">Запуск общей демонстрационной среды…</p>}
      {(error || demoError) && (
        <p className={s.error} role="alert">
          {error || demoError}
        </p>
      )}
      <a href="/" target="_blank" rel="noopener noreferrer">
        Основное приложение
      </a>
    </main>
  );
}
