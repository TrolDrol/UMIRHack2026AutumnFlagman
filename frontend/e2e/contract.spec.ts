import { test, expect, type Page } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const dishId = "22222222-2222-4222-8222-222222222222";
const ingredientId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const documentId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "aaaaaaaa-0000-4000-8000-000000000001";
const membership = {
  enterpriseId: "aaaaaaaa-0000-4000-8000-000000000011",
  enterpriseName: "Тест",
  warehouseId,
  role: "owner",
};
const time = new Date().toISOString();
const future = new Date(Date.now() + 72 * 3600000).toISOString();
const ingredient = {
  id: ingredientId,
  name: "Сыр",
  unit: "g",
  defaultShelfLifeHours: 72,
  reorderPoint: "50.000",
  targetStock: "200.000",
};
const dish = {
  id: dishId,
  name: "Брускетта",
  active: true,
  recipe: [{ ingredientId, quantity: "50.000" }],
  createdAt: time,
  updatedAt: time,
};
const batch = {
  id: batchId,
  deliveryId: documentId,
  deliveryItemId: documentId,
  deliveryNumber: "SUP-001",
  ingredientId,
  ingredientName: "Сыр",
  unit: "g",
  receivedAt: time,
  manufacturedAt: null,
  shelfLifeHours: 72,
  expiresAt: future,
  initialQuantity: "150.000",
  remainingQuantity: "150.000",
  status: "fresh",
  remainingSeconds: 259200,
};
const order = {
  id: documentId,
  number: "ORD-001",
  createdAt: time,
  status: "completed",
  source: "staff",
  externalId: null,
  lines: [{ dishId, dishName: "Брускетта", portions: 3 }],
  allocations: [
    { batchId, ingredientId, quantity: "150.000", expiresAt: future },
  ],
};
const delivery = {
  id: documentId,
  number: "SUP-001",
  createdAt: time,
  receivedAt: time,
  expectedAt: null,
  status: "confirmed",
  source: "manual",
  externalId: null,
  confirmedByUserId: id,
  rejectedAt: null,
  rejectedByUserId: null,
  rejectionReason: null,
  note: null,
  lines: [
    {
      id: documentId,
      ingredientId,
      ingredientName: "Сыр",
      unit: "g",
      quantity: "150.000",
      manufacturedAt: null,
      shelfLifeHours: 72,
      expiresAt: future,
    },
  ],
  batches: [batch],
};
const envelope = (data: unknown) => ({
  data,
  meta: {
    serverTime: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  },
});
const collection = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
});
test("закупить всё включает рекомендации за пределами текущей страницы", async ({
  page,
}) => {
  await mockApi(page);
  const ingredients = Array.from({ length: 26 }, (_, index) => ({
    ...ingredient,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Ингредиент ${index + 1}`,
  }));
  const suggestions = ingredients.map((item, index) => ({
    ingredientId: item.id,
    ingredientName: item.name,
    unit: item.unit,
    availableQuantity: "0.000",
    expiringQuantity: "0.000",
    planningQuantity: "0.000",
    reorderPoint: "50.000",
    targetStock: "200.000",
    targetQuantity: "200.000",
    suggestedQuantity: `${index + 1}.000`,
    reasons: ["below_minimum"],
    affectedDishIds: [],
  }));
  await page.route("**/api/v2/warehouses/*/ingredients**", (route) =>
    route.fulfill({ json: envelope(collection(ingredients)) }),
  );
  await page.route("**/api/v2/warehouses/*/purchase-suggestions**", (route) =>
    route.fulfill({ json: envelope(collection(suggestions)) }),
  );
  await page.goto("/purchases?pageSize=25");
  await expect(page.locator("main article")).toHaveCount(25);
  const bulk = page.getByRole("button", {
    name: "Закупить всё рекомендуемое",
    exact: true,
  });
  await expect(bulk).toHaveText("Закупить всё рекомендуемое");
  await bulk.click();
  await expect(
    page.getByRole("heading", { name: /^Позиция \d+$/ }),
  ).toHaveCount(26);
  const last = page
    .getByRole("heading", { name: "Позиция 26", exact: true })
    .locator("..");
  await expect(last.getByLabel("Ингредиент", { exact: true })).toHaveValue(
    ingredients[25].id,
  );
  await expect(last.getByLabel("Количество, г", { exact: true })).toHaveValue(
    "26.000",
  );
});

test("мобильная навигация, пояснения и поставка из всего стоп-листа", async ({
  page,
}, testInfo) => {
  await mockApi(page);
  const milk = { ...ingredient, name: "Молоко", unit: "ml" };
  const stopped = (
    dishName: string,
    requiredQuantity: string,
    uuid: string,
  ) => ({
    dishId: uuid,
    dishName,
    active: true,
    status: "stopped",
    maxPortions: 0,
    shortages: [
      {
        ingredientId,
        ingredientName: "Молоко",
        unit: "ml",
        requiredQuantity,
        availableQuantity: "0.000",
        missingQuantity: requiredQuantity,
      },
    ],
  });
  const stopItems = [
    stopped("Каша", "10.000", dishId),
    stopped("Омлет", "20.000", id),
  ];
  await page.route("**/api/v2/warehouses/*/stop-list**", (route) =>
    route.fulfill({ json: envelope(collection(stopItems)) }),
  );
  await page.route("**/api/v2/warehouses/*/ingredients**", (route) =>
    route.fulfill({ json: envelope(collection([milk])) }),
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/stop-list");
  const navigation = page.getByRole("navigation", {
    name: "Основная навигация",
  });
  await expect(navigation).toBeVisible();
  expect(
    await navigation.evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Каша", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Поиск по названию").fill("Каша");
  await expect(
    page.getByRole("heading", { name: "Омлет", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Недостающий ингредиент").selectOption(ingredientId);
  const supplyButton = page.getByRole("button", {
    name: "Заказать недостающее",
    exact: true,
  });
  const help = supplyButton
    .locator("..")
    .getByRole("button", { name: "Пояснение к действию" });
  await help.click();
  await expect(
    page.getByRole("note").filter({ hasText: "Общие ингредиенты суммируются" }),
  ).toBeVisible();
  await help.click();
  await page.screenshot({
    path: testInfo.outputPath("stop-list-mobile.png"),
    fullPage: true,
  });
  await supplyButton.click();
  await expect(page).toHaveURL(/\/deliveries\/new(?:\?|$)/);
  await expect(page.getByLabel("Ингредиент", { exact: true })).toHaveValue(
    ingredientId,
  );
  await expect(page.getByLabel("Количество, мл", { exact: true })).toHaveValue(
    "300.000",
  );
  await expect(page.getByLabel("Количество, мл", { exact: true })).toHaveCount(
    1,
  );
});
test("иконки действий, подсказки и раздел Блюда", async ({
  page,
}, testInfo) => {
  await mockApi(page);
  let currentDish = { ...dish };
  await page.route("**/api/v2/warehouses/*/dishes**", async (route) => {
    if (route.request().method() === "PUT")
      currentDish = { ...currentDish, ...route.request().postDataJSON() };
    const data = new URL(route.request().url()).pathname.endsWith("/dishes")
      ? collection([currentDish])
      : currentDish;
    await route.fulfill({ json: envelope(data) });
  });
  await page.goto("/dishes");
  await expect(
    page.getByRole("heading", { name: "Блюда", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Блюда", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Нажмите на заголовок для сортировки загруженных строк."),
  ).toHaveCount(0);
  const edit = page.getByRole("link", { name: "Редактировать", exact: true });
  await edit.hover();
  await expect(edit).toHaveAttribute(
    "title",
    "Редактировать блюдо «Брускетта»",
  );
  await expect(edit.locator('[data-icon="edit"]')).toBeVisible();
  await expect(edit).toHaveText("");
  const disable = page.getByRole("button", { name: "Отключить Брускетта" });
  await expect(disable).toHaveAttribute("title", "Отключить Брускетта");
  await expect(disable.locator('[data-icon="disable"]')).toHaveCount(1);
  await disable.click();
  await expect(
    page.getByRole("cell", { name: "Неактивно", exact: true }),
  ).toBeVisible();
  const enable = page.getByRole("button", { name: "Включить Брускетта" });
  await expect(enable).toHaveAttribute("title", "Включить Брускетта");
  await enable.click();
  await expect(
    page.getByRole("cell", { name: "Активно", exact: true }),
  ).toBeVisible();
  for (const button of await page.locator("main button").all()) {
    if (await button.evaluate((element) => !!element.closest("thead")))
      continue;
    await expect(button.locator("[data-icon]")).toHaveCount(1);
    await expect(button).toHaveText("");
    expect(await button.getAttribute("title")).toBeTruthy();
    expect(await button.getAttribute("aria-label")).toBeTruthy();
  }
  await page.screenshot({
    path: testInfo.outputPath("dishes-icons-desktop.png"),
    fullPage: true,
  });
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const buttons = page
      .locator("tbody td:last-child")
      .first()
      .locator(
        'a:has([data-icon]), button:has([data-icon]:not([data-icon="help"]))',
      );
    let previousRight = 0;
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBe(44);
      expect(box!.height).toBe(44);
      if (previousRight)
        expect(box!.x - previousRight).toBeGreaterThanOrEqual(8);
      previousRight = box!.x + box!.width;
      await expect(button.locator("[data-icon]")).toHaveCSS(
        "mask-repeat",
        "no-repeat",
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await edit.click();
  await expect(page.getByLabel("Название блюда")).toHaveValue("Брускетта");
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(page).toHaveURL(/\/dishes(?:\?|$)/);
});
test("разделы выбора блюд и карточки корзины", async ({ page }, testInfo) => {
  await mockApi(page);
  const available = Array.from({ length: 24 }, (_, i) => ({
    dishId:
      i === 0
        ? dishId
        : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    dishName: i === 0 ? "Брускетта" : `Блюдо ${i + 1}`,
    active: true,
    status: "available",
    maxPortions: 20,
    shortages: [],
  }));
  const stopped = Array.from({ length: 12 }, (_, i) => ({
    ...available[i],
    dishId: `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
    dishName: `Стоп ${i + 1}`,
    status: "stopped",
    maxPortions: 0,
  }));
  await page.route("**/api/v2/warehouses/*/menu/availability**", (route) =>
    route.fulfill({ json: envelope(collection([...available, ...stopped])) }),
  );
  await page.route("**/api/v2/warehouses/*/recommendations**", (route) =>
    route.fulfill({
      json: envelope(
        collection(
          available.slice(0, 12).map((dish) => ({
            ...dish,
            score: 80,
            suggestedPortions: 2,
            explanation: "Используйте истекающие продукты",
            reasons: [],
            earliestExpiresAt: future,
          })),
        ),
      ),
    }),
  );
  await page.goto("/menu");
  await expect(page.locator('a[href="#menu-note"]')).toHaveCount(0);
  await expect(page.locator("#menu-note")).toHaveCount(0);
  await expect(page.getByText("Доступно", { exact: true })).toHaveCount(0);
  await page.goto("/stop-list");
  await expect(page.getByText("⚠ Стоп", { exact: true })).toHaveCount(0);
  await page.goto("/orders/new");
  const hot = page.getByRole("region", { name: "Горячие предложения: блюда" });
  const regular = page.getByRole("region", { name: "Обычные блюда: блюда" });
  await expect(
    hot.getByRole("button", { name: "Добавить в заказ" }),
  ).toHaveCount(10);
  await expect(
    regular.getByRole("button", { name: "Добавить в заказ" }),
  ).toHaveCount(10);
  await expect(page.locator("main details > summary")).toHaveText([
    /Горячие предложения/,
    /Обычные блюда/,
    /Блюда в стоп-листе/,
  ]);
  const stoppedSection = page.locator("main details").filter({
    has: page.locator("summary", { hasText: "Блюда в стоп-листе" }),
  });
  await expect(stoppedSection).not.toHaveAttribute("open");
  await page.getByText("Блюда в стоп-листе", { exact: true }).click();
  const stop = page.getByRole("region", { name: "Блюда в стоп-листе: блюда" });
  await expect(
    stop.getByRole("button", { name: "Добавить в заказ" }),
  ).toHaveCount(10);
  for (const button of await stop
    .getByRole("button", { name: "Добавить в заказ", exact: true })
    .all())
    await expect(button).toBeDisabled();
  await hot.evaluate((element) => {
    element.scrollTop = 100;
  });
  await regular.evaluate((element) => {
    element.scrollTop = 50;
  });
  expect(await hot.evaluate((element) => element.scrollTop)).toBe(100);
  expect(await regular.evaluate((element) => element.scrollTop)).toBe(50);
  await page
    .getByRole("button", { name: "Горячие предложения: следующая страница" })
    .click();
  await expect(
    hot.getByRole("button", { name: "Добавить в заказ" }),
  ).toHaveCount(2);
  expect(await hot.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await regular.evaluate((element) => element.scrollTop)).toBe(50);
  await expect(regular.getByText("Блюдо 13", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Блюда в стоп-листе: следующая страница" })
    .click();
  await expect(
    stop.getByRole("button", { name: "Добавить в заказ" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Горячие предложения: предыдущая страница" })
    .click();
  await hot
    .getByText("Брускетта", { exact: true })
    .locator("..")
    .getByRole("button", { name: "Добавить в заказ" })
    .click();
  const cart = page.getByRole("article", { name: "В корзине: Брускетта" });
  await expect(cart.getByLabel("Порции блюда 1")).toHaveValue("2");
  await cart.getByLabel("Порции блюда 1").fill("1");
  await expect(cart.getByLabel("Порции блюда 1")).toHaveValue("1");
  await expect(
    cart.getByRole("button", { name: "Уменьшить количество: Брускетта" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Проверить заказ", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await cart
    .getByRole("button", { name: "Увеличить количество: Брускетта" })
    .click();
  await expect(cart.getByLabel("Порции блюда 1")).toHaveValue("2");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await cart
    .getByRole("button", { name: "Уменьшить количество: Брускетта" })
    .click();
  await cart
    .getByRole("button", { name: "Удалить Брускетта из корзины" })
    .click();
  await page.getByRole("button", { name: "Оставить в корзине" }).click();
  await expect(cart).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("order-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("order-mobile.png"),
    fullPage: true,
  });
  await cart
    .getByRole("button", { name: "Удалить Брускетта из корзины" })
    .click();
  await page
    .getByRole("button", { name: "Удалить блюдо", exact: true })
    .click();
  await expect(cart).toHaveCount(0);
  await page.getByText("Обычные блюда", { exact: true }).click();
  await expect(regular).not.toBeVisible();
  await expect(hot).toBeVisible();
});
async function mockApi(page: Page) {
  await page.addInitScript(
    ({ id, warehouseId }) =>
      sessionStorage.setItem(`rims.workspace.${id}`, warehouseId),
    { id, warehouseId },
  );
  const state = {
    stock: "150.000",
    recipe: false,
    delivery: false,
    deliveryStatus: "pending",
    orders: 0,
    loggedIn: true,
    failOrder: false,
    keys: new Map<string, unknown>(),
    posts: [] as { path: string; key: string; body: string }[],
  };
  await page.route("**/api/v2/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(
      /^\/api\/v2(?:\/warehouses\/[^/]+)?/,
      "",
    );
    const method = req.method();
    const respond = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(envelope(data)),
      });
    if (path === "/me/memberships") return respond([membership]);
    if (path === "/auth/me") {
      if (!state.loggedIn)
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "UNAUTHENTICATED", message: "Войдите", details: {} },
            meta: envelope(null).meta,
          }),
        });
      return respond({ id, username: "operator", displayName: "Оператор" });
    }
    if (path === "/auth/login") {
      state.loggedIn = true;
      return respond({ id, username: "operator", displayName: "Оператор" });
    }
    if (path === "/auth/logout") {
      state.loggedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/config")
      return respond({
        restaurantName: "Ресторан RIMS",
        timeZone: "Europe/Moscow",
        expiryWarningPercent: 10,
        hotOfferMaxPortions: 20,
        contractVersion: "2.0.0",
      });
    if (path === "/dashboard")
      return respond({
        ingredientCount: 1,
        activeDishCount: state.recipe ? 1 : 0,
        stoppedDishCount: state.stock === "0.000" ? 1 : 0,
        lowStockIngredientCount: 0,
        expiringBatchCount: 0,
        expiredBatchCount: 0,
        todayOrderCount: state.orders,
        hotOfferCount: 1,
        pendingDeliveryCount: 0,
      });
    if (path === "/ingredients") return respond(collection([ingredient]));
    if (path === "/dishes" && method === "POST") {
      state.recipe = true;
      return respond(dish, 201);
    }
    if (path === "/dishes")
      return respond(collection(state.recipe ? [dish] : []));
    if (path.startsWith("/dishes/")) return respond(dish);
    if (
      ["/deliveries", "/orders", "/write-offs"].includes(path) &&
      method === "POST"
    ) {
      const key = req.headers()["idempotency-key"];
      state.posts.push({ path, key, body: req.postData()! });
      if (state.keys.has(key)) return respond(state.keys.get(key), 201);
      if (path === "/deliveries") {
        state.delivery = true;
        state.deliveryStatus = "pending";
        const result = {
          ...delivery,
          number: req.postDataJSON().number,
          status: "pending",
          receivedAt: null,
          confirmedByUserId: null,
          batches: [],
        };
        state.keys.set(key, result);
        delivery.number = result.number;
        return respond(result, 201);
      }
      if (path === "/write-offs") {
        state.stock = "100.000";
        return respond(
          { id: documentId, ...req.postDataJSON(), createdAt: time },
          201,
        );
      }
      state.orders++;
      state.stock = "0.000";
      state.keys.set(key, order);
      if (state.failOrder) {
        state.failOrder = false;
        return route.abort("failed");
      }
      return respond(order, 201);
    }
    if (path.endsWith("/confirm") && method === "POST") {
      state.deliveryStatus = "confirmed";
      state.stock = "150.000";
      return respond(delivery);
    }
    if (path === "/deliveries")
      return respond(
        collection(
          state.delivery ? [{ ...delivery, status: state.deliveryStatus }] : [],
        ),
      );
    if (path.startsWith("/deliveries/"))
      return respond({
        ...delivery,
        status: state.deliveryStatus,
        receivedAt: state.deliveryStatus === "confirmed" ? time : null,
        batches:
          state.deliveryStatus === "confirmed"
            ? [{ ...batch, remainingQuantity: state.stock }]
            : [],
      });
    if (path === "/orders")
      return respond(collection(state.orders ? [order] : []));
    if (path.startsWith("/orders/") && path !== "/orders/preview")
      return respond(order);
    if (path === "/orders/preview")
      return respond({
        canCreate: state.stock !== "0.000",
        requirements: [
          {
            ingredientId,
            ingredientName: "Сыр",
            unit: "g",
            requiredQuantity: "150.000",
            availableQuantity: state.stock,
            missingQuantity: state.stock === "0.000" ? "150.000" : "0.000",
          },
        ],
        allocations: state.stock === "0.000" ? [] : order.allocations,
      });
    if (path === "/inventory")
      return respond(
        collection([
          {
            ingredientId,
            ingredientName: "Сыр",
            unit: "g",
            physicalQuantity: state.stock,
            availableQuantity: state.stock,
            expiringQuantity: "0.000",
            expiredQuantity: "0.000",
            nearestExpiresAt: future,
            reorderPoint: "50.000",
            targetStock: "200.000",
            isLowStock: state.stock === "0.000",
          },
        ]),
      );
    if (path === "/batches")
      return respond(
        collection([{ ...batch, remainingQuantity: state.stock }]),
      );
    const availability = {
      dishId,
      dishName: "Брускетта",
      active: true,
      maxPortions: state.stock === "0.000" ? 0 : 3,
      status: state.stock === "0.000" ? "stopped" : "available",
      shortages:
        state.stock === "0.000"
          ? [
              {
                ingredientId,
                ingredientName: "Сыр",
                unit: "g",
                requiredQuantity: "50.000",
                availableQuantity: "0.000",
                missingQuantity: "50.000",
              },
            ]
          : [],
    };
    if (path === "/menu/availability")
      return respond(collection([availability]));
    if (path === "/stop-list")
      return respond(collection(state.stock === "0.000" ? [availability] : []));
    if (path === "/recommendations")
      return respond(
        collection([
          {
            dishId,
            dishName: "Брускетта",
            score: 87.5,
            maxPortions: 3,
            suggestedPortions: 3,
            earliestExpiresAt: future,
            reasons: [
              {
                ingredientId,
                ingredientName: "Сыр",
                unit: "g",
                batchIds: [batchId],
                usableExpiringQuantity: "150.000",
                plannedUsage: "150.000",
                earliestExpiresAt: future,
              },
            ],
            explanation: "Используйте сыр из истекающей партии",
          },
        ]),
      );
    if (path === "/purchase-suggestions" || path === "/movements")
      return respond(collection([]));
    throw new Error(`Unexpected API route ${method} ${path}`);
  });
  return state;
}
async function fillDelivery(page: Page, number: string) {
  await page.getByLabel("Номер поставки").fill(number);
  await page
    .getByLabel("Ингредиент", { exact: true })
    .selectOption(ingredientId);
  await page.getByLabel("Количество, г").fill("150");
  await page
    .getByLabel("Истекает · Москва (UTC+3)", { exact: true })
    .fill(new Date(Date.now() + 75 * 3600000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByRole("heading", { name: number, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить приёмку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toHaveCount(0);
}
test("приёмка → рецепт → предложение → заказ → стоп → пополнение", async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto("/deliveries/new");
  await fillDelivery(page, "SUP-001");
  expect(state.delivery).toBe(true);
  await page.goto("/dishes/new");
  await page.getByLabel("Название блюда").fill("Брускетта");
  await page
    .getByLabel("Ингредиент 1", { exact: true })
    .selectOption(ingredientId);
  await page.getByLabel("Расход на порцию, г").fill("50");
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(page).toHaveURL(/\/dishes(?:\?|$)/);
  await page.goto("/recommendations");
  await page.getByRole("link", { name: "Добавить 3 порций в заказ" }).click();
  await expect(page.getByLabel("Порции блюда 1")).toHaveValue("3");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByRole("heading", { name: "ORD-001" })).toBeVisible();
  expect(state.stock).toBe("0.000");
  await page.goto("/inventory");
  await expect(page.getByText("⚠ Дефицит")).toBeVisible();
  await page.goto("/stop-list");
  await expect(page.getByRole("heading", { name: "Брускетта" })).toBeVisible();
  await page.goto("/deliveries/new");
  await fillDelivery(page, "REFILL-SUP-001");
  await page.goto("/stop-list");
  await expect(
    page.getByText("Все активные блюда доступны. Стоп-лист пуст."),
  ).toBeVisible();
});
test("неизвестный заказ после reload и 401 восстанавливает тот же ключ без второго документа", async ({
  page,
}) => {
  const state = await mockApi(page);
  state.failOrder = true;
  await page.goto("/orders/new");
  await page.getByRole("button", { name: "Добавить в заказ" }).click();
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByText("Результат не подтверждён")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeDisabled();
  state.loggedIn = false;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Вход оператора" }),
  ).toBeVisible();
  await page.getByLabel("Имя пользователя").fill("operator");
  await page.getByLabel("Пароль", { exact: true }).fill("test");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Повторить сохранённый запрос" })
    .click();
  await expect(page.getByRole("heading", { name: "ORD-001" })).toBeVisible();
  expect(state.orders).toBe(1);
  expect(state.posts.filter((x) => x.path === "/orders")[0]).toEqual(
    state.posts.filter((x) => x.path === "/orders")[1],
  );
});
test("360px, клавиатура диалога, offline сохраняет форму", async ({
  page,
  context,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/ingredients");
  await page.getByRole("button", { name: "Добавить ингредиент" }).click();
  await page
    .locator("dialog")
    .getByLabel("Название", { exact: true })
    .fill("Томаты");
  await page.keyboard.press("Tab");
  await expect(page.locator("dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Добавить ингредиент" }).click();
  await expect(
    page.locator("dialog").getByLabel("Название", { exact: true }),
  ).toHaveValue("Томаты");
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки").fill("OFFLINE-DRAFT");
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Заказать" })).toBeDisabled();
  await expect(page.getByLabel("Номер поставки")).toHaveValue("OFFLINE-DRAFT");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Заказать" })).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("частичное списание обновляет остаток", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/batches");
  await page.getByRole("button", { name: "Списать", exact: true }).click();
  await page.getByLabel("Количество списания, г").fill("50");
  await page.getByRole("button", { name: "Подтвердить списание" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  expect(state.stock).toBe("100.000");
  await expect(
    page.getByRole("cell", { name: "150 / 100 г", exact: true }),
  ).toBeVisible();
});
test("склад отображает просроченный запас отдельно от доступного", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/v2/warehouses/*/inventory?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        envelope(
          collection([
            {
              ingredientId,
              ingredientName: "Сыр",
              unit: "g",
              physicalQuantity: "200.000",
              availableQuantity: "0.000",
              expiringQuantity: "0.000",
              expiredQuantity: "200.000",
              nearestExpiresAt: null,
              reorderPoint: "50.000",
              targetStock: "200.000",
              isLowStock: true,
            },
          ]),
        ),
      ),
    }),
  );
  await page.goto("/inventory");
  const row = page.getByRole("row").nth(1);
  await expect(row.getByRole("cell").nth(1)).toHaveText("200 г");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0 г");
  await expect(row.getByRole("cell").nth(4)).toHaveText("200 г");
});
