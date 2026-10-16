import { test, expect, type Page } from "@playwright/test";
const warehouse = "aaaaaaaa-0000-4000-8000-000000000001";
const api = `/api/v2/warehouses/${warehouse}`;
test("изменения сотрудников синхронизируются между вкладками с отдельными входами", async ({
  page,
  context,
}) => {
  const operator = await context.newPage();
  const manager = await context.newPage();
  await login(operator);
  await operator.getByRole("link", { name: /Сменить предприятие/ }).click();
  await operator
    .getByRole("heading", { name: "RIMS · Второй ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await expect(
    operator.getByRole("heading", { name: "Обзор ресторана" }),
  ).toBeVisible();
  await login(manager, "manager");
  await manager.getByRole("link", { name: /Сменить предприятие/ }).click();
  await expect(
    manager.getByRole("heading", {
      name: "RIMS · Второй ресторан",
      exact: true,
    }),
  ).toHaveCount(0);
  await login(page, "superadmin");
  await page.getByRole("link", { name: /Сменить предприятие/ }).click();
  await page
    .getByRole("heading", { name: "RIMS · Второй ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await page.goto("/members");
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Удалить сотрудника operator", exact: true })
    .click();
  await expect(
    operator.getByRole("heading", { name: "Выберите предприятие" }),
  ).toBeVisible();
  await expect(
    operator.getByRole("heading", {
      name: "RIMS · Второй ресторан",
      exact: true,
    }),
  ).toHaveCount(0);
  const secondApi =
    "/api/v2/warehouses/bbbbbbbb-0000-4000-8000-000000000002/inventory";
  expect(
    await operator.evaluate(
      async (path) => (await fetch(path)).status,
      secondApi,
    ),
  ).toBe(404);
  await page.getByLabel("Логин сотрудника").fill("manager");
  await page.getByLabel("Роль нового сотрудника").selectOption("manager");
  await page
    .getByRole("button", { name: "Добавить сотрудника", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", {
      name: "RIMS · Второй ресторан",
      exact: true,
    }),
  ).toBeVisible();
  await manager
    .getByRole("heading", { name: "RIMS · Второй ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await expect(
    manager.getByRole("heading", { name: "Обзор ресторана" }),
  ).toBeVisible();
  expect(
    await manager.evaluate(
      async (path) => (await fetch(path)).status,
      secondApi,
    ),
  ).toBe(200);
  await operator.reload();
  await expect(
    operator.getByRole("heading", {
      name: "RIMS · Второй ресторан",
      exact: true,
    }),
  ).toHaveCount(0);
  await operator.close();
  await manager.close();
});
test("недоступный документ не вызывает бесконечную перепроверку доступа", async ({
  page,
}) => {
  await login(page);
  let reads = 0;
  let membershipReads = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === `${api}/deliveries/00000000-0000-4000-8000-000000000099`)
      reads++;
    if (path.endsWith("/me/memberships")) membershipReads++;
  });
  await page.goto("/deliveries/00000000-0000-4000-8000-000000000099");
  await expect.poll(() => membershipReads).toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole("alert").filter({ hasText: "Поставка не найдена" }),
  ).toBeVisible();
  expect(reads).toBe(1);
});
async function login(page: Page, username = "operator") {
  await page.goto("/login");
  await page.getByLabel("Имя пользователя").fill(username);
  await page.getByLabel("Пароль", { exact: true }).fill("demo");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page
    .getByRole("heading", { name: "RIMS · Центральный ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
}
async function createIncoming(page: Page, number: string) {
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки", { exact: true }).fill(number);
  await page
    .getByLabel("Ингредиент", { exact: true })
    .selectOption({ label: "Молоко · мл" });
  await page.getByLabel("Количество, мл").fill("300");
  await page.getByLabel("Истекает · Москва (UTC+3)").fill("2030-12-31T12:00");
  await page.getByRole("button", { name: "Заказать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: number, exact: true }),
  ).toBeVisible();
}
test("копия поставки сохраняет точный срок с микросекундами", async ({
  page,
}) => {
  await login(page);
  const expiresAt = "2030-12-31T09:00:12.123456Z";
  const document = await page.evaluate(
    async ({ api, expiresAt }) => {
      const response = await fetch(`${api}/deliveries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          number: "MICRO-ORIGINAL",
          expectedAt: null,
          note: null,
          lines: [
            {
              ingredientId: "44444444-4444-4444-8444-444444444444",
              quantity: "10.000",
              expiresAt,
            },
          ],
        }),
      });
      return (await response.json()).data;
    },
    { api, expiresAt },
  );
  await page.goto(`/deliveries/new?copy=${document.id}`);
  await expect(page.getByLabel("Истекает · Москва (UTC+3)")).toHaveValue(
    "2030-12-31T12:00:12.123",
  );
  await expect(
    page.getByText(/Точное время: 2030-12-31 12:00:12.123456/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Заказать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "MICRO-ORIGINAL (копия)", exact: true }),
  ).toBeVisible();
  const copied = await page.evaluate(
    async (api) =>
      (
        await (await fetch(`${api}/deliveries?pageSize=100`)).json()
      ).data.items.find(
        (document: { number: string }) =>
          document.number === "MICRO-ORIGINAL (копия)",
      ),
    api,
  );
  expect(copied.lines[0].expiresAt).toBe(expiresAt);
  expect(copied.status).toBe("pending");
});
test("предприятие создаёт только супер-админ и назначает зарегистрированного владельца", async ({
  page,
}) => {
  await page.goto("/register");
  await page.getByLabel("Имя", { exact: true }).fill("Новый владелец");
  await page.getByLabel("Логин", { exact: true }).fill("new.owner");
  await page.getByLabel("Пароль", { exact: true }).fill("demo-password-123");
  await page
    .getByRole("button", { name: "Зарегистрироваться", exact: true })
    .click();
  await expect(page.getByText(/У вас пока нет членств/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Создать предприятие", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      async () =>
        (
          await fetch("/api/v2/enterprises", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Forbidden",
              ownerUsername: "new.owner",
            }),
          })
        ).status,
    ),
  ).toBe(403);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вход оператора" }),
  ).toBeVisible();
  await login(page, "superadmin");
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Интеграции", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Сменить предприятие/ }).click();
  await expect(
    page.getByRole("button", { name: "Открыть предприятие", exact: true }),
  ).toHaveCount(3);
  await page.getByLabel("Название предприятия").fill("Новый ресторан");
  await page.getByLabel("Логин владельца", { exact: true }).fill("new.owner");
  await page
    .getByRole("button", { name: "Создать предприятие", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Обзор ресторана" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Новый ресторан · Супер-админ/ }),
  ).toBeVisible();
  await page.goto("/members");
  await expect(
    page.getByRole("cell", { name: "new.owner", exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Логин владельца", { exact: true }).fill("manager");
  await page
    .getByRole("button", { name: "Назначить владельца", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "manager", exact: true }),
    }),
  ).toContainText("Владелец");
  await expect(page.getByLabel("Роль new.owner")).toHaveValue("manager");
  await page.getByLabel("Логин владельца", { exact: true }).fill("new.owner");
  await page
    .getByRole("button", { name: "Назначить владельца", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "new.owner", exact: true }),
    }),
  ).toContainText("Владелец");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вход оператора" }),
  ).toBeVisible();
  await page.getByLabel("Имя пользователя").fill("new.owner");
  await page.getByLabel("Пароль", { exact: true }).fill("demo-password-123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Открыть предприятие", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Создать предприятие", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await page.goto("/members");
  await expect(
    page.getByRole("button", { name: "Назначить владельца", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Логин сотрудника").fill("waiter");
  await page
    .getByRole("button", { name: "Добавить сотрудника", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "waiter", exact: true }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(storage).not.toContain("demo-password-123");
});
test("документ ожидает решения, подтверждение создаёт партии", async ({
  page,
}) => {
  await login(page);
  const before = await page.evaluate(
    async (api) =>
      (await (await fetch(`${api}/inventory?pageSize=100`)).json()).data.items,
    api,
  );
  await createIncoming(page, "PENDING-BROWSER");
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async (api) =>
        (await (await fetch(`${api}/inventory?pageSize=100`)).json()).data
          .items,
      api,
    ),
  ).toEqual(before);
  await page
    .getByRole("button", { name: "Подтвердить приёмку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toHaveCount(0);
  const data = await page.evaluate(
    async (api) =>
      (
        await (await fetch(`${api}/deliveries?pageSize=100`)).json()
      ).data.items.find(
        (item: { number: string }) => item.number === "PENDING-BROWSER",
      ),
    api,
  );
  expect(data.status).toBe("confirmed");
  expect(data.batches).toHaveLength(1);
});
test("склад создаёт документ, но не подтверждает и не открывает рецепты", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v2/"))
      paths.push(new URL(request.url()).pathname);
  });
  await login(page, "warehouse");
  await createIncoming(page, "WAREHOUSE-INCOMING");
  await expect(
    page.getByRole("button", { name: "Подтвердить приёмку", exact: true }),
  ).toHaveCount(0);
  await page.goto("/dishes");
  await expect(
    page.getByRole("heading", { name: "Доступ ограничен" }),
  ).toBeVisible();
  expect(paths.some((path) => path.endsWith("/dishes"))).toBe(false);
});
test("официант использует только сервисные маршруты и получает чек", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(api)) paths.push(path.slice(api.length));
  });
  await login(page, "waiter");
  await expect(
    page.getByRole("heading", { name: "Новый заказ" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Основная навигация",
  });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Корзина", exact: true }),
  ).toBeVisible();
  for (const path of [
    "/service/menu",
    "/service/stop-list",
    "/service/recommendations",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/service\/orders\/new/);
    await expect(
      page.getByRole("heading", { name: "Новый заказ" }),
    ).toBeVisible();
  }
  await page.goto("/inventory");
  await expect(
    page.getByRole("heading", { name: "Доступ ограничен" }),
  ).toBeVisible();
  await page.goto("/service/orders/new");
  await page
    .getByRole("button", { name: "Добавить в заказ", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Провести заказ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Заказ .* проведён$/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /История заказов/ })).toHaveCount(
    0,
  );
  expect(paths.every((path) => path.startsWith("/service/"))).toBe(true);
});
test("переключение предприятия изолирует черновики и складские данные", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  const navigation = page.getByRole("navigation", {
    name: "Основная навигация",
  });
  await expect(
    navigation.getByRole("link", {
      name: /^(Сервисное меню|Сервисный стоп-лист|Предложения)$/,
    }),
  ).toHaveCount(0);
  for (const name of ["Меню", "Стоп-лист", "Горячие предложения"]) {
    await expect(
      navigation.getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки", { exact: true }).fill("DRAFT-A");
  await page.getByRole("link", { name: /Сменить предприятие/ }).click();
  await page
    .getByRole("heading", { name: "RIMS · Второй ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await page.goto("/deliveries/new");
  await expect(
    page.getByLabel("Номер поставки", { exact: true }),
  ).not.toHaveValue("DRAFT-A");
  await page.getByRole("link", { name: /Сменить предприятие/ }).click();
  await page
    .getByRole("heading", { name: "RIMS · Центральный ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await page.goto("/deliveries/new");
  await expect(page.getByLabel("Номер поставки", { exact: true })).toHaveValue(
    "DRAFT-A",
  );
});
test("интеграционный секрет показывается один раз и не сохраняется", async ({
  page,
}) => {
  await login(page);
  await page.goto("/integrations");
  await page.getByLabel("Название клиента").fill("Поставщик тест");
  await page
    .getByRole("button", { name: "Создать клиента", exact: true })
    .click();
  await page.getByLabel("Название ключа").fill("Первый ключ");
  await page
    .getByRole("button", { name: "Выпустить ключ", exact: true })
    .click();
  const notice = page
    .getByText("Секрет показывается один раз", { exact: true })
    .locator("..");
  const token = await notice.locator("code").textContent();
  expect(token).toBeTruthy();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(storage).not.toContain(token!);
  await page.reload();
  await expect(
    page.getByText("Секрет показывается один раз", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Первый ключ", exact: true }),
  ).toBeVisible();
});
test("смена и удаление членства убирают прежние управленческие данные", async ({
  page,
}) => {
  await login(page, "manager");
  await page.goto("/dishes");
  await expect(
    page.getByRole("link", { name: "Редактировать", exact: true }).first(),
  ).toBeVisible();
  await page.evaluate(() => {
    const key = "rims.demo.registry.v2";
    const registry = JSON.parse(localStorage.getItem(key)!);
    const user = registry.users.find(
      (user: { username: string }) => user.username === "manager",
    );
    registry.members.find(
      (member: { userId: string }) => member.userId === user.id,
    ).role = "waiter";
    localStorage.setItem(key, JSON.stringify(registry));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("heading", { name: "Доступ ограничен" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Редактировать", exact: true }),
  ).toHaveCount(0);
  await page.goto("/service/menu");
  await expect(
    page.getByRole("heading", { name: "Новый заказ" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const key = "rims.demo.registry.v2";
    const registry = JSON.parse(localStorage.getItem(key)!);
    const user = registry.users.find(
      (user: { username: string }) => user.username === "manager",
    );
    registry.members = registry.members.filter(
      (member: { userId: string }) => member.userId !== user.id,
    );
    localStorage.setItem(key, JSON.stringify(registry));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByText(/У вас пока нет членств/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Новый заказ" })).toHaveCount(
    0,
  );
});
test("неизвестная операция A скрыта в B и при входе другим пользователем", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await login(page);
  await page.goto("/orders/new");
  await page
    .getByRole("button", { name: "Добавить в заказ", exact: true })
    .first()
    .click();
  await page.evaluate((api) => {
    const original = window.fetch.bind(window);
    let loseResponse = true;
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (
        loseResponse &&
        options?.method === "POST" &&
        String(input).endsWith(`${api}/orders`)
      ) {
        loseResponse = false;
        throw new TypeError("Lost response after commit");
      }
      return response;
    };
  }, api);
  await page
    .getByRole("button", { name: "Провести заказ", exact: true })
    .click();
  await expect(
    page.getByText("Результат не подтверждён", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Сменить предприятие/ }).click();
  await page
    .getByRole("heading", { name: "RIMS · Второй ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await expect(
    page.getByText("Результат не подтверждён", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Повторить сохранённый запрос",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вход оператора", exact: true }),
  ).toBeVisible();
  await login(page, "waiter");
  await expect(
    page.getByRole("heading", { name: "Новый заказ" }),
  ).toBeVisible();
  await expect(
    page.getByText("Результат не подтверждён", { exact: true }),
  ).toHaveCount(0);
});
