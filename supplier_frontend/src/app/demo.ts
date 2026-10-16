export type DemoSupplier = {
  warehouseId: string;
  clientId: string;
  name: string;
  warehouseName: string;
};
type DemoBridge = {
  startBrowserDemo: (options: {
    workerUrl: string;
    scope: string;
  }) => Promise<unknown>;
  ensureDemoInitialized?: () => Promise<unknown>;
  listDemoSuppliers?: () => Promise<DemoSupplier[]>;
  connectDemoSupplier?: (input: {
    warehouseId: string;
    clientId: string;
  }) => Promise<{ token?: string; key?: string }>;
};
let bridge: DemoBridge | null = null;
export async function startDemo() {
  if (!navigator.locks || !navigator.serviceWorker)
    throw new Error(
      "Демонстрация требует Web Locks и Service Worker. Откройте сайт по HTTPS или localhost.",
    );
  bridge = (await import("@rims/demo-api")) as unknown as DemoBridge;
  if (
    !bridge.ensureDemoInitialized ||
    !bridge.listDemoSuppliers ||
    !bridge.connectDemoSupplier
  )
    throw new Error(
      "Общая демо-среда ещё не предоставляет bootstrap поставщиков. Подключение будет доступно после реализации R2 в @rims/demo-api.",
    );
  await bridge.startBrowserDemo({
    workerUrl: "/mockServiceWorker.js",
    scope: "/",
  });
  await bridge.ensureDemoInitialized();
  return bridge.listDemoSuppliers();
}
export async function demoKey(supplier: DemoSupplier) {
  if (!bridge?.connectDemoSupplier)
    throw new Error("Общее демо-подключение недоступно.");
  const result = await bridge.connectDemoSupplier({
    warehouseId: supplier.warehouseId,
    clientId: supplier.clientId,
  });
  const key = result.token || result.key;
  if (!key) throw new Error("Демо-среда не вернула ключ подключения.");
  return key;
}
