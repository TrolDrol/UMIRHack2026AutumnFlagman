import { test, expect, type Page } from "@playwright/test";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const root = `/api/v2/customer/warehouses/${A}`;
async function register(page: Page, name: string) {
  await page.goto("/client/register");
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByLabel("Логин").fill(name);
  await page.getByLabel("Пароль").fill("long_password_123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите заведение" }),
  ).toBeVisible();
}
async function api(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  return page.evaluate(
    async ({ path, method, body, key }) => {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body, key },
  );
}
test("mobile keyboard flow, favorite, one-portion offers, receipt and new intent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await register(page, "mobile_buyer");
  await page
    .getByRole("link", { name: /Открыть меню/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Меню", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Добавить +1" }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Добавить в избранное/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Избранное", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Добавить +1" }).first().click();
  await page.getByRole("link", { name: /Корзина · 1 порций/ }).click();
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Оплачен");
  await page.getByRole("button", { name: "Повторить в новую корзину" }).click();
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  expect(page.url()).not.toBe(url);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("timeout replay keeps one order, shared manager source, independent sessions", async ({
  page,
}) => {
  await register(page, "retry_buyer");
  await page.goto(`/client/outlets/${A}/menu`);
  await page.getByRole("button", { name: "Добавить +1" }).first().click();
  await page.goto(`/client/outlets/${A}/cart`);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let lose = true;
    window.fetch = async (...args) => {
      const response = await original(...args);
      const url = String(args[0]);
      if (lose && url.endsWith("/orders") && args[1]?.method === "POST") {
        lose = false;
        throw new TypeError("lost response");
      }
      return response;
    };
  });
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Восстановление заказа" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Повторить прежний запрос" }).click();
  await expect(
    page.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  expect((await api(page, root + "/orders")).body.data.total).toBe(1);
  await api(page, "/api/v2/auth/login", "POST", {
    username: "manager",
    password: "demo",
  });
  const shared = await api(page, `/api/v2/warehouses/${A}/orders`);
  expect(shared.body.data.items[0].source).toBe("customer");
  await api(page, "/api/v2/customer/auth/logout", "POST");
  expect((await api(page, "/api/v2/auth/me")).status).toBe(200);
});
test("two customer tabs serialize the last portion and protect own history", async ({
  page,
  context,
}) => {
  await register(page, "race_buyer_a");
  const second = await context.newPage();
  await register(second, "race_buyer_b");
  const menu = (await api(page, root + "/menu")).body.data.items;
  const dish = menu.find((x: { status: string }) => x.status === "available");
  await page.evaluate(
    ({ A, dishId }) => {
      const key = "rims.demo.database.v2." + A;
      const db = JSON.parse(localStorage.getItem(key)!);
      const recipe = db.dishes.find(
        (d: { id: string }) => d.id === dishId,
      ).recipe;
      for (const delivery of db.deliveries)
        for (const batch of delivery.batches) batch.remainingQuantity = "0.000";
      for (const item of recipe) {
        const batch = db.deliveries
          .flatMap((d: { batches: unknown[] }) => d.batches)
          .find(
            (b: { ingredientId: string; expiresAt: string }) =>
              b.ingredientId === item.ingredientId &&
              Date.parse(b.expiresAt) > Date.now(),
          );
        batch.remainingQuantity = item.quantity;
      }
      localStorage.setItem(key, JSON.stringify(db));
    },
    { A, dishId: dish.dishId },
  );
  const body = { lines: [{ dishId: dish.dishId, portions: 1 }] };
  const results = await Promise.all([
    api(page, root + "/orders", "POST", body, crypto.randomUUID()),
    api(second, root + "/orders", "POST", body, crypto.randomUUID()),
  ]);
  expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
  const winner = results[0].status === 201 ? page : second,
    loser = winner === page ? second : page;
  const receipt = results.find((x) => x.status === 201)!.body.data;
  expect((await api(loser, root + "/orders/" + receipt.id)).status).toBe(404);
  expect((await api(loser, root + "/orders")).body.data.total).toBe(0);
  expect((await api(winner, root + "/orders")).body.data.total).toBe(1);
});
test("live build never claims mock success when API is unavailable", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4175/client/login");
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.getByLabel("Логин").fill("live_buyer");
  await page.getByLabel("Пароль").fill("long_password_123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Live API" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Выберите заведение" }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v2/customer/outlets")).status()).toBe(
    503,
  );
  expect((await page.request.get("/client/assets/missing.js")).status()).toBe(
    404,
  );
});

test("keyboard dialog restores focus and layout remains usable at 200%", async ({
  page,
}) => {
  await register(page, "keyboard_buyer");
  await page.goto(`/client/outlets/${A}/menu`);
  const title = page.locator("article").first().locator("button").nth(1);
  await title.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Порции")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(title).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("customer order appears in a separate manager interface on the same origin", async ({
  page,
  context,
}) => {
  await register(page, "shared_buyer");
  await page.goto(`/client/outlets/${A}/menu`);
  await page.getByRole("button", { name: "Добавить +1" }).first().click();
  await page.goto(`/client/outlets/${A}/cart`);
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Заказ зарегистрирован" }),
  ).toBeVisible();
  const number = await page.locator("h2").last().textContent();
  const manager = await context.newPage();
  await manager.goto("/login");
  await manager.getByLabel("Имя пользователя").fill("manager");
  await manager.getByLabel("Пароль", { exact: true }).fill("demo");
  await manager.getByRole("button", { name: "Войти", exact: true }).click();
  await manager
    .getByRole("button", { name: "Открыть предприятие" })
    .first()
    .click();
  await manager.goto("/orders");
  await expect(
    manager.getByRole("cell", { name: number!, exact: true }),
  ).toBeVisible();
  await expect(
    manager.getByRole("cell", { name: "Покупатель", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await manager.reload();
  await expect(
    manager.getByRole("cell", { name: number!, exact: true }),
  ).toBeVisible();
});

test("drafts and favorites survive only for the same customer and outlet", async ({
  page,
}) => {
  await register(page, "scope_buyer_a");
  await page.goto(`/client/outlets/${A}/menu`);
  await page
    .getByRole("button", { name: /Добавить в избранное/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Добавить +1" }).first().click();
  await page.goto(`/client/outlets/bbbbbbbb-0000-4000-8000-000000000002/cart`);
  await expect(
    page.getByText("Корзина пока пуста.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  await register(page, "scope_buyer_b");
  await page.goto(`/client/outlets/${A}/menu`);
  await page.getByRole("button", { name: "Избранное", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(0);
  await page.goto(`/client/outlets/${A}/cart`);
  await expect(
    page.getByText("Корзина пока пуста.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.getByLabel("Логин").fill("scope_buyer_a");
  await page.getByLabel("Пароль").fill("long_password_123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите заведение" }),
  ).toBeVisible();
  await page.goto(`/client/outlets/${A}/menu`);
  await page.getByRole("button", { name: "Избранное", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "В корзине 1 · ещё +1" }),
  ).toBeVisible();
});

test("late preview cannot submit a former outlet cart", async ({ page }) => {
  await register(page, "late_buyer");
  await page.goto(`/client/outlets/${A}/menu`);
  await page.getByRole("button", { name: "Добавить +1" }).first().click();
  await page.goto(`/client/outlets/${A}/cart`);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith("/orders/preview"))
        await new Promise((resolve) => setTimeout(resolve, 500));
      return response;
    };
  });
  await page.getByRole("button", { name: "Оформить заказ" }).click();
  await page.getByRole("link", { name: "Все заведения", exact: false }).click();
  await page.getByRole("heading", { name: "Выберите заведение" }).waitFor();
  await page.waitForTimeout(700);
  expect((await api(page, root + "/orders")).body.data.total).toBe(0);
  await page.goto(`/client/outlets/${A}/cart`);
  await expect(
    page.getByRole("heading", { name: "Восстановление заказа" }),
  ).toHaveCount(0);
});
