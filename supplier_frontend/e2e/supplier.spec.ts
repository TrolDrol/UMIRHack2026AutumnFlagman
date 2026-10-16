import { test, expect } from "@playwright/test";
import { connection, purchaseRequest } from "../src/test/fixtures";
test("подключение → отдельное согласие → отгрузка → ожидание приёмки", async ({
  page,
}) => {
  let doc = {
    ...purchaseRequest,
    status: "submitted" as string,
    approvedAt: null as string | null,
    deliveryId: null as string | null,
  };
  let shipment: Record<string, unknown> | null = null;
  const actions: string[] = [];
  await page.route("**/integrations/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const payload = req.postDataJSON();
    let data: unknown;
    if (path.endsWith("/identity")) data = connection.identity;
    else if (path.endsWith("/approve")) {
      actions.push("approve");
      expect(payload).toEqual({ version: 2 });
      expect(req.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
      doc = {
        ...doc,
        status: "approved",
        approvedAt: new Date().toISOString(),
        version: 3,
      };
      data = doc;
    } else if (req.method() === "POST" && path.endsWith("/deliveries")) {
      actions.push("delivery");
      expect(actions).toEqual(["approve", "delivery"]);
      expect(payload.purchaseRequestId).toBe(doc.id);
      expect(payload.lines[0].quantity).toBe("0.300");
      shipment = {
        ...payload,
        id: "eeeeeeee-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        receivedAt: null,
        status: "pending",
        source: "integration",
        rejectedAt: null,
        rejectionReason: null,
        lines: payload.lines.map(
          (line: Record<string, unknown>, i: number) => ({
            ...line,
            id: String(i),
            ingredientName: "Молоко",
            unit: "ml",
            manufacturedAt: null,
            shelfLifeHours: 24,
          }),
        ),
      };
      doc = {
        ...doc,
        status: "delivery_pending",
        version: 4,
        deliveryId: shipment!.id as string,
      };
      data = shipment;
    } else if (path.includes("/deliveries/")) data = shipment;
    else if (path.endsWith("/purchase-requests"))
      data = { items: [doc], page: 1, pageSize: 20, total: 1 };
    else data = doc;
    await route.fulfill({
      status: 200,
      json: {
        data,
        meta: {
          serverTime: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        },
      },
    });
  });
  await page.goto("/supplier/requests");
  await page.getByLabel("Идентификатор склада").fill(connection.warehouseId);
  await page.getByLabel("Ключ API").fill(connection.key);
  await page.getByRole("button", { name: "Подключиться" }).click();
  await page.getByRole("link", { name: "ЗП-001", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Оформить отгрузку" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Принять заявку" }).click();
  await expect(
    page.getByText("Заявка принята. Теперь можно оформить отгрузку."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Оформить отгрузку" }).click();
  await page.getByLabel("Номер поставки").fill("П-001");
  await page.getByLabel("Дата партии 1").fill("2026-10-13T12:00");
  await page.getByRole("button", { name: "Зарегистрировать поставку" }).click();
  await expect(
    page.getByText("Поставка зарегистрирована. Ожидается приёмка менеджером."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Поставка П-001" }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain(connection.key);
  await page.reload();
  await expect(page.getByLabel("Ключ API")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Поставка П-001" }),
  ).toHaveCount(0);
});
test("прямой адрес карточки и недоступный API", async ({ page }) => {
  await page.route("**/integrations/v1/**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "RETRY_LATER",
          message: "Сервер недоступен",
          details: {},
        },
        meta: {},
      },
    }),
  );
  await page.goto(`/supplier/requests/${purchaseRequest.id}`);
  await expect(
    page.getByRole("heading", { name: "Подключение к складу" }),
  ).toBeVisible();
  await page.getByLabel("Идентификатор склада").fill(connection.warehouseId);
  await page.getByLabel("Ключ API").fill(connection.key);
  await page.getByRole("button", { name: "Подключиться" }).click();
  await expect(page.getByRole("alert")).toHaveText("Сервер недоступен");
  await expect(
    page.getByRole("heading", { name: "Заявки", exact: true }),
  ).toHaveCount(0);
});
