import { test, expect, type Page } from "@playwright/test";
const fixture = "dddddddd-0000-4000-8000-000000000003";
const central = "aaaaaaaa-0000-4000-8000-000000000001";
async function staffLogin(
  page: Page,
  username = "operator",
  enterprise = "RIMS · Центральный ресторан",
) {
  await page.goto("/login");
  await page.getByLabel("Имя пользователя", { exact: true }).fill(username);
  await page.getByLabel("Пароль", { exact: true }).fill("demo");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите предприятие" }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: enterprise, exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
}
async function buyerLogin(page: Page, name: string) {
  await page.goto("/client/register");
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByLabel("Логин").fill(name);
  await page.getByLabel("Пароль").fill("long_password_123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите заведение" }),
  ).toBeVisible();
}
async function get(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const r = await fetch(p);
    return { status: r.status, body: await r.json() };
  }, path);
}
test("manager publishes a pair, buyer submits mixed cart, shared stock and risk report update", async ({
  page,
  context,
}) => {
  await staffLogin(page, "operator", "RIMS · История за 14 дней (демо)");
  await page.goto(`/combos?warehouse=${fixture}`);
  await page
    .getByRole("button", { name: "Создать комбо", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Название", { exact: true })
    .fill("Обед для двоих · тест");
  await modal
    .getByLabel("Блюдо 1 · одна порция")
    .selectOption({ label: "Кофе · общий ингредиент" });
  await modal
    .getByLabel("Блюдо 2 · одна порция")
    .selectOption({ label: "Какао · общий ингредиент" });
  await modal
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Опубликовать комбо", exact: true })
    .click();
  await expect(
    page.getByText("Опубликовано", { exact: false }).first(),
  ).toBeVisible();
  const before = await get(page, `/api/v2/warehouses/${fixture}/inventory`);
  const milkBefore = before.body.data.items.find(
    (i: { ingredientName: string }) => i.ingredientName === "Молоко · демо",
  );
  const buyer = await context.newPage();
  await buyerLogin(buyer, "combo_buyer");
  await buyer.goto(`/client/outlets/${fixture}/menu`);
  await buyer
    .getByRole("button", { name: "Добавить комплект", exact: true })
    .click();
  await buyer
    .locator("article")
    .filter({
      has: buyer.getByRole("button", {
        name: "Кофе · общий ингредиент",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Добавить +1", exact: true })
    .click();
  await buyer.goto(`/client/outlets/${fixture}/cart`);
  await expect(
    buyer.getByRole("heading", { name: "Обед для двоих · тест" }),
  ).toBeVisible();
  await buyer
    .getByRole("button", { name: "Оформить заказ", exact: true })
    .click();
  await expect(
    buyer.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  await expect(
    buyer.getByText("Обед для двоих · тест", { exact: true }),
  ).toBeVisible();
  const after = await get(page, `/api/v2/warehouses/${fixture}/inventory`);
  const milkAfter = after.body.data.items.find(
    (i: { ingredientName: string }) => i.ingredientName === "Молоко · демо",
  );
  expect(
    Number(milkBefore.physicalQuantity) - Number(milkAfter.physicalQuantity),
  ).toBe(40);
  await page.goto(`/risk-inventory?warehouse=${fixture}`);
  await expect(
    page.getByRole("heading", { name: "Рискованные партии" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Молоко · демо/ }).first(),
  ).toBeVisible();
  await page.goto(`/stop-list?warehouse=${fixture}`);
  await page.getByRole("tab", { name: "Прогноз", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Прогноз стоп-листа" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ожидается остановка", { exact: true }).first(),
  ).toBeVisible();
});
test("warehouse holds part of a batch, manager releases it, buyer availability follows", async ({
  page,
  context,
}) => {
  await staffLogin(page, "warehouse");
  await page.goto(
    `/inventory/22222222-2222-4222-8222-222222222222?warehouse=${central}`,
  );
  await page
    .getByRole("button", { name: "Удержать часть партии", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Количество", { exact: true }).fill("100");
  await modal.getByLabel("Причина", { exact: true }).fill("Проверка качества");
  await modal.getByRole("button", { name: "Удержать", exact: true }).click();
  const manager = await context.newPage();
  await staffLogin(manager);
  await manager.goto(`/quarantines?warehouse=${central}`);
  await manager.locator("tbody a").first().click();
  await expect(
    manager.getByRole("heading", { name: "Решения по карантину" }),
  ).toBeVisible();
  const buyer = await context.newPage();
  await buyerLogin(buyer, "hold_buyer");
  const stopped = await get(
    buyer,
    `/api/v2/customer/warehouses/${central}/menu`,
  );
  expect(
    stopped.body.data.items.find(
      (i: { dishName: string }) => i.dishName === "Салат с томатами и сыром",
    )?.status === "stopped",
  ).toBe(true);
  await manager.getByLabel("Количество", { exact: true }).fill("100");
  await manager
    .getByLabel("Причина освобождения", { exact: true })
    .fill("Качество подтверждено");
  await manager
    .getByRole("button", { name: "Освободить", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "История решений" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const r = await get(buyer, `/api/v2/customer/warehouses/${central}/menu`);
      return (
        r.body.data.items.find(
          (i: { dishName: string }) =>
            i.dishName === "Салат с томатами и сыром",
        )?.status === "available"
      );
    })
    .toBe(true);
});
