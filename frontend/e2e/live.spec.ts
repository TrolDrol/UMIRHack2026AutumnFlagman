import { test, expect } from "@playwright/test";
import { utcToMoscow } from "../src/shared/lib/time";
import type {
  Ingredient,
  Dish,
  Envelope,
  Page,
  InventoryRow,
  Order,
  DishAvailability,
} from "../src/shared/api/types";
test("реальный API: партии, FEFO, рекомендации, атомарность, конкуренция и пополнение", async ({
  page,
}) => {
  test.skip(
    process.env.FLAGMAN_LIVE_TESTS !== "1",
    "Нужны отдельная тестовая БД и запущенный backend",
  );
  test.setTimeout(120000);
  await page.goto("/login");
  await page
    .getByLabel("Имя пользователя")
    .fill(process.env.FLAGMAN_USERNAME || "operator");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.FLAGMAN_PASSWORD || "");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  const choose = page.getByRole("button", {
    name: "Открыть предприятие",
    exact: true,
  });
  await choose.first().click();
  await expect(
    page.getByRole("heading", { name: "Обзор ресторана" }),
  ).toBeVisible();
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const selected = await page.evaluate(
      () =>
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith("rims.workspace."))
          .map((key) => sessionStorage.getItem(key))[0],
    );
    return page.evaluate(
      async ({ path, method, body, key, selected }) => {
        const response = await fetch(
          `/api/v2${path.startsWith("/auth/") ? "" : `/warehouses/${selected}`}${path}`,
          {
            method,
            credentials: "include",
            headers: {
              ...(body ? { "Content-Type": "application/json" } : {}),
              ...(key ? { "Idempotency-Key": key } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
        return { status: response.status, payload: await response.json() };
      },
      { path, method, body, key, selected },
    ) as Promise<{ status: number; payload: Envelope<T> }>;
  }
  const now = (await api("/auth/me")).payload.meta.serverTime;
  const T = Date.parse(now);
  const timestamp = (hours: number) =>
    new Date(T + hours * 3600000).toISOString();
  const suffix = crypto.randomUUID().slice(0, 8);
  const ingredients: Ingredient[] = [];
  for (const [name, unit] of [
    ["Томаты", "g"],
    ["Сыр", "g"],
    ["Хлеб", "pcs"],
  ]) {
    const response = await api<Ingredient>("/ingredients", "POST", {
      name: `${name} ${suffix}`,
      unit,
      defaultShelfLifeHours: 72,
      reorderPoint: "0.000",
      targetStock: "0.000",
    });
    expect(response.status).toBe(201);
    ingredients.push(response.payload.data);
  }
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки").fill(`SUP-${suffix}`);
  await page
    .getByLabel("Ожидаемая доставка · Москва (UTC+3)")
    .fill(utcToMoscow(timestamp(-2)));
  const initial = [
    { id: ingredients[0].id, quantity: "300", expiry: 6 },
    { id: ingredients[0].id, quantity: "500", expiry: 72 },
    { id: ingredients[0].id, quantity: "200", expiry: -1 },
    { id: ingredients[1].id, quantity: "150", expiry: 72 },
    { id: ingredients[2].id, quantity: "10", expiry: 72 },
  ];
  for (let i = 0; i < initial.length; i++) {
    if (i) await page.getByRole("button", { name: "Добавить позицию" }).click();
    const section = page
      .getByRole("heading", { name: `Позиция ${i + 1}`, exact: true })
      .locator("..");
    await section
      .getByLabel("Ингредиент", { exact: true })
      .selectOption(initial[i].id);
    await section.getByLabel(/Количество,/).fill(initial[i].quantity);
    await section
      .getByLabel("Истекает · Москва (UTC+3)")
      .fill(utcToMoscow(timestamp(initial[i].expiry)));
  }
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByRole("heading", { name: `SUP-${suffix}`, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Фактическая приёмка · Москва (UTC+3)")
    .fill(utcToMoscow(timestamp(-2)));
  await page
    .getByRole("button", { name: "Подтвердить приёмку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toHaveCount(0);
  const inventory = (
    await api<Page<InventoryRow>>(`/inventory?q=${encodeURIComponent(suffix)}`)
  ).payload.data.items;
  const tomatoes = inventory.find((x) => x.ingredientId === ingredients[0].id)!;
  expect(tomatoes.physicalQuantity).toBe("1000.000");
  expect(tomatoes.availableQuantity).toBe("800.000");
  expect(tomatoes.expiredQuantity).toBe("200.000");
  await page.goto("/dishes/new");
  await page.getByLabel("Название блюда").fill(`Брускетта ${suffix}`);
  for (let i = 0; i < 3; i++) {
    if (i)
      await page
        .getByRole("button", { name: "Добавить ингредиент", exact: true })
        .click();
    await page
      .getByLabel(`Ингредиент ${i + 1}`, { exact: true })
      .selectOption(ingredients[i].id);
    await page
      .getByLabel(/Расход на порцию,/)
      .nth(i)
      .fill(["100", "50", "1"][i]);
  }
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(page).toHaveURL(/\/dishes(?:\?|$)/);
  const dish = (
    await api<Page<Dish>>(`/dishes?q=${encodeURIComponent(suffix)}`)
  ).payload.data.items[0];
  await page.goto("/recommendations");
  const offer = page.getByRole("heading", { name: dish.name }).locator("..");
  await expect(
    offer.getByRole("link", { name: "Добавить 3 порций в заказ" }),
  ).toBeVisible();
  await offer.getByRole("link", { name: "Добавить 3 порций в заказ" }).click();
  await page.getByLabel("Порции блюда 1").fill("2");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Подробности заказа" }),
  ).toBeVisible();
  const cheese = (
    await api<Page<InventoryRow>>(`/inventory?q=${encodeURIComponent(suffix)}`)
  ).payload.data.items.find((x) => x.ingredientId === ingredients[1].id)!;
  expect(cheese.availableQuantity).toBe("50.000");
  const rejected = await api(
    "/orders",
    "POST",
    { lines: [{ dishId: dish.id, portions: 2 }] },
    crypto.randomUUID(),
  );
  expect(rejected.status).toBe(409);
  const keys = [crypto.randomUUID(), crypto.randomUUID()];
  const simultaneous = await Promise.all(
    keys.map((key) =>
      api<Order>(
        "/orders",
        "POST",
        { lines: [{ dishId: dish.id, portions: 1 }] },
        key,
      ),
    ),
  );
  expect(simultaneous.map((x) => x.status).sort()).toEqual([201, 409]);
  const winner = simultaneous.findIndex((x) => x.status === 201);
  const replay = await api<Order>(
    "/orders",
    "POST",
    { lines: [{ dishId: dish.id, portions: 1 }] },
    keys[winner],
  );
  expect(replay.payload.data.id).toBe(simultaneous[winner].payload.data.id);
  await page.goto("/stop-list");
  await expect(page.getByRole("heading", { name: dish.name })).toBeVisible();
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки").fill(`REFILL-${suffix}`);
  await page
    .getByLabel("Ингредиент", { exact: true })
    .selectOption(ingredients[1].id);
  await page.getByLabel("Количество, г").fill("200");
  await page
    .getByLabel("Истекает · Москва (UTC+3)")
    .fill(utcToMoscow(timestamp(72)));
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByRole("heading", { name: `REFILL-${suffix}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить приёмку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toHaveCount(0);
  const availability = (
    await api<Page<DishAvailability>>(
      `/menu/availability?q=${encodeURIComponent(suffix)}`,
    )
  ).payload.data.items[0];
  expect(availability.status).toBe("available");
  expect(availability.maxPortions).toBe(4);
  await page.goto("/stop-list");
  await expect(
    page.getByRole("heading", { name: dish.name }),
  ).not.toBeVisible();
});
