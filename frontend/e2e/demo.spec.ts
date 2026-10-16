import { test, expect } from "@playwright/test";
import type {
  Ingredient,
  Dish,
  Delivery,
  Order,
  WriteOff,
} from "../src/shared/api/types";
test("даты приёмки сохраняются без отдельных кнопок календаря", async ({
  page,
}) => {
  await page.goto("/deliveries/new");
  await expect(
    page.getByRole("heading", { name: "Позиция 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Открыть календарь/ }),
  ).toHaveCount(0);
  await page
    .getByLabel("Номер поставки", { exact: true })
    .fill("DATE-PICKER-TEST");
  await page
    .getByLabel("Ожидаемая доставка · Москва (UTC+3)", { exact: true })
    .fill("2026-10-08T09:30");
  const expiryLabel = "Истекает · Москва (UTC+3)";
  await expect(page.getByLabel(expiryLabel, { exact: true })).toHaveAttribute(
    "type",
    "datetime-local",
  );
  await page.getByLabel(expiryLabel, { exact: true }).fill("2026-11-12T15:45");
  const mode = page.getByLabel("Способ задания срока", { exact: true });
  await mode.selectOption("manufactured");
  const manufacturedLabel = "Изготовлено · Москва (UTC+3)";
  await expect(page.getByLabel(manufacturedLabel, { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel(manufacturedLabel, { exact: true })
    .fill("2026-10-07T08:10");
  await page.getByLabel("Срок хранения, часы", { exact: true }).fill("48");
  for (let count = 0; count < 3; count++) {
    await mode.selectOption("explicit");
    await expect(page.getByLabel(expiryLabel, { exact: true })).toHaveValue(
      "2026-11-12T15:45",
    );
    await mode.selectOption("manufactured");
    await expect(
      page.getByLabel(manufacturedLabel, { exact: true }),
    ).toHaveValue("2026-10-07T08:10");
    await expect(
      page.getByLabel("Срок хранения, часы", { exact: true }),
    ).toHaveValue("48");
  }
  await page.reload();
  await expect(mode).toHaveValue("manufactured");
  await expect(page.getByLabel(manufacturedLabel, { exact: true })).toHaveValue(
    "2026-10-07T08:10",
  );
  await mode.selectOption("explicit");
  await expect(page.getByLabel(expiryLabel, { exact: true })).toHaveValue(
    "2026-11-12T15:45",
  );
  let creates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/deliveries"
    )
      creates++;
  });
  await page
    .getByRole("button", { name: "Удалить позицию 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Заказать", exact: true }).click();
  await expect(
    page.getByText("Добавьте хотя бы одну позицию", { exact: true }),
  ).toBeVisible();
  expect(creates).toBe(0);
});
test("рекомендации закупок не подменяются обычным черновиком", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const db = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "rims.demo.database.v2.aaaaaaaa-0000-4000-8000-000000000001",
      )!,
    ),
  );
  const bread = db.ingredients.find((item: Ingredient) => item.name === "Хлеб");
  await page.goto("/deliveries/new");
  await page.getByLabel("Ингредиент", { exact: true }).selectOption(bread.id);
  await page.getByLabel("Количество, шт").fill("7");
  await page.getByLabel("Номер поставки").fill("СТАРЫЙ-ЧЕРНОВИК");
  await page.goto("/purchases");
  await expect(page.locator("main article").first()).toBeVisible();
  const suggestions = await page.evaluate(
    async () =>
      (
        await (
          await fetch(
            "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/purchase-suggestions?pageSize=100",
          )
        ).json()
      ).data.items,
  );
  const milk = suggestions.find(
    (item: { ingredientName: string }) => item.ingredientName === "Молоко",
  );
  await page
    .getByRole("heading", { name: "Молоко", exact: true })
    .locator("..")
    .getByRole("button", { name: "Перейти к приёмке", exact: true })
    .click();
  await expect(page.getByLabel("Ингредиент", { exact: true })).toHaveValue(
    milk.ingredientId,
  );
  await expect(page.getByLabel("Количество, мл", { exact: true })).toHaveValue(
    milk.suggestedQuantity,
  );
  await expect(page.getByLabel("Номер поставки")).toHaveValue(/^SUP-\d+$/);
  await page.getByLabel("Номер поставки").fill("ЗАКУПКА-МОЛОКА");
  await page.reload();
  await expect(page.getByLabel("Номер поставки")).toHaveValue("ЗАКУПКА-МОЛОКА");
  await expect(page.getByLabel("Ингредиент", { exact: true })).toHaveValue(
    milk.ingredientId,
  );
  await page.goto("/purchases");
  await page
    .getByRole("button", { name: "Закупить всё рекомендуемое", exact: true })
    .click();
  await expect(page.locator("main section")).toHaveCount(suggestions.length);
  for (let index = 0; index < suggestions.length; index++) {
    const line = page
      .getByRole("heading", { name: `Позиция ${index + 1}`, exact: true })
      .locator("..");
    await expect(line.getByLabel("Ингредиент", { exact: true })).toHaveValue(
      suggestions[index].ingredientId,
    );
    await expect(line.locator('input[inputmode="decimal"]')).toHaveValue(
      suggestions[index].suggestedQuantity,
    );
  }
  await page.goto("/deliveries");
  await page
    .getByRole("link", { name: "Создать входящую поставку", exact: true })
    .click();
  await expect(page.getByLabel("Номер поставки")).toHaveValue(
    "СТАРЫЙ-ЧЕРНОВИК",
  );
  await expect(page.getByLabel("Ингредиент", { exact: true })).toHaveValue(
    bread.id,
  );
});
test("сброс справа очищает сортировку без активных фильтров", async ({
  page,
}) => {
  await page.goto("/ingredients");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const original = await page.locator("tbody tr").allTextContents();
  const heading = page.getByRole("columnheader", { name: /Название/ });
  await heading.getByRole("button", { name: "Название", exact: true }).click();
  await expect(heading).toHaveAttribute("aria-sort", "ascending");
  const reset = page.getByRole("button", {
    name: "Сбросить все фильтры",
    exact: true,
  });
  await expect(reset).toBeEnabled();
  await expect(reset.locator('[data-icon="filter-remove"]')).toBeVisible();
  await expect(reset.locator('svg[data-icon="filter-remove"]')).toHaveAttribute(
    "fill",
    "none",
  );
  await expect(
    reset.locator('svg[data-icon="filter-remove"] path'),
  ).toHaveCount(2);
  await expect(reset.locator('svg[data-icon="filter-remove"]')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await reset.screenshot({ path: "test-results/filter-reset-icon.png" });
  await reset.click();
  await expect(heading).toHaveAttribute("aria-sort", "none");
  expect(await page.locator("tbody tr").allTextContents()).toEqual(original);
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const wrapper = reset.locator("../..");
    const actionBounds = (await wrapper.boundingBox())!;
    const toolbarBounds = (await wrapper.locator("..").boundingBox())!;
    expect(
      Math.abs(
        actionBounds.x +
          actionBounds.width -
          toolbarBounds.x -
          toolbarBounds.width,
      ),
    ).toBeLessThan(2);
    await page.getByLabel("Поиск по названию", { exact: true }).fill("Томаты");
    await expect(page).toHaveURL(/q=/);
    await heading
      .getByRole("button", { name: "Название", exact: true })
      .click();
    await reset.click();
    await expect(heading).toHaveAttribute("aria-sort", "none");
    await expect(
      page.getByLabel("Поиск по названию", { exact: true }),
    ).toHaveValue("");
  }
});
test("сброс фильтров, колонки стоп-листа и копирование полного UUID", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Создать заказ", exact: true }),
  ).toHaveCount(0);
  await page.goto("/stop-list");
  const columns = page.getByLabel("Колонки", { exact: true });
  await expect(columns).toHaveValue("2");
  const grid = page.locator("main article").first().locator("..");
  for (const count of [1, 2, 3, 4]) {
    await columns.selectOption(String(count));
    const tracks = await grid.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
    expect(tracks).toBe(count);
  }
  await page
    .getByLabel("Поиск по названию", { exact: true })
    .fill("Несуществующее блюдо");
  await expect(page).toHaveURL(/q=/);
  await page.getByRole("button", { name: "Сбросить все фильтры" }).click();
  await expect(
    page.getByLabel("Поиск по названию", { exact: true }),
  ).toHaveValue("");
  await expect(page).not.toHaveURL(/q=/);
  await expect(columns).toHaveValue("4");
  await page.goto("/movements");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = page
    .getByRole("button", { name: /^Скопировать UUID партии / })
    .first();
  await expect(copy).toHaveText(/^[a-f0-9]{8}…$/);
  const uuid = (await copy.getAttribute("aria-label"))!.replace(
    "Скопировать UUID партии ",
    "",
  );
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(uuid);
  await expect(copy.locator("..").getByRole("status")).toHaveText(
    "Скопировано",
  );
});
test("доступное меню, текстовая закупка и навигация по пути страницы", async ({
  page,
}) => {
  await page.goto("/menu");
  await expect(
    page.getByRole("heading", { name: "Доступность меню" }),
  ).toBeVisible();
  await expect(page.locator("main article").first()).toBeVisible();
  // Demo API runs in the browser worker.
  const availability = await page.evaluate(async () => {
    const response = await fetch(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/menu/availability?pageSize=100",
    );
    return response.json();
  });
  await expect(page.locator("main article")).toHaveCount(
    availability.data.items.filter(
      (dish: { status: string }) => dish.status === "available",
    ).length,
  );
  const card = page.locator("main article").first();
  await expect(card.getByRole("link")).toHaveCount(3);
  const bounds = await card
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => link.getBoundingClientRect().y),
    );
  expect(Math.max(...bounds) - Math.min(...bounds)).toBeLessThan(2);
  await page.getByRole("link", { name: "Недоступные позиции →" }).click();
  await expect(
    page.getByRole("button", { name: "Заказать недостающее", exact: true }),
  ).toHaveText("Заказать недостающее");
  await page
    .getByRole("button", { name: "Заказать недостающее", exact: true })
    .click();
  const crumbs = page.getByRole("navigation", { name: "Путь страницы" });
  await expect(crumbs.getByRole("link", { name: "Создание" })).toBeVisible();
  await crumbs.getByRole("link", { name: "Поставки", exact: true }).click();
  await expect(page).toHaveURL(/\/deliveries(?:\?|$)/);
  await page
    .locator('main a[href^="/deliveries/"]:not([href^="/deliveries/new"])')
    .first()
    .click();
  const deliveryId = new URL(page.url()).pathname.split("/")[2];
  await expect(
    crumbs.getByRole("link", { name: deliveryId, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await crumbs.getByRole("link", { name: "Поставки", exact: true }).click();
  await expect(page).toHaveURL(/\/deliveries(?:\?|$)/);
  await page
    .getByRole("navigation", { name: "Путь страницы" })
    .getByRole("link", { name: "RIMS", exact: true })
    .click();
  await expect(page).toHaveURL(/\/(?:\?|$)/);
});
test("копирование всех сущностей и проверки уникальности", async ({ page }) => {
  test.setTimeout(120000);
  const readDb = () =>
    page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "rims.demo.database.v2.aaaaaaaa-0000-4000-8000-000000000001",
          )!,
        ) as {
          ingredients: Ingredient[];
          dishes: Dish[];
          deliveries: Delivery[];
          orders: Order[];
          writeOffs: WriteOff[];
          replays: Record<string, unknown>;
        },
    );
  const original = await readDb();
  const tomato = original.ingredients.find((item) => item.name === "Томаты")!;
  const dish = original.dishes.find((item) => item.name === "Брускетта")!;
  await page.goto("/ingredients");
  await page
    .getByRole("button", { name: "Создать копию ингредиента «Томаты»" })
    .click();
  await expect(
    page.locator("dialog").getByLabel("Название", { exact: true }),
  ).toHaveValue("Томаты (копия)");
  await expect(page.getByLabel("Единица измерения")).toBeEnabled();
  await expect(page.getByLabel("Порог пополнения")).toHaveValue(
    tomato.reorderPoint,
  );
  await page
    .locator("dialog")
    .getByLabel("Название", { exact: true })
    .fill(" тОМАТЫ ");
  await page.getByRole("button", { name: "Сохранить ингредиент" }).click();
  await expect(
    page.getByText("Ингредиент с таким названием уже существует"),
  ).toBeVisible();
  expect((await readDb()).ingredients).toHaveLength(
    original.ingredients.length,
  );
  await page
    .locator("dialog")
    .getByLabel("Название", { exact: true })
    .fill("Томаты (копия)");
  await page.getByRole("button", { name: "Сохранить ингредиент" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  const afterIngredient = await readDb();
  expect(
    afterIngredient.ingredients.find((item) => item.id === tomato.id),
  ).toEqual(tomato);
  expect(
    afterIngredient.ingredients.find((item) => item.name === "Томаты (копия)")!
      .id,
  ).not.toBe(tomato.id);
  await page
    .getByRole("button", { name: "Создать копию ингредиента «Томаты»" })
    .click();
  await expect(
    page.locator("dialog").getByLabel("Название", { exact: true }),
  ).toHaveValue("Томаты (копия 2)");
  await page.getByRole("button", { name: "Закрыть диалог" }).click();

  await page.goto("/dishes");
  await page
    .getByRole("link", { name: "Создать копию блюда «Брускетта»" })
    .click();
  await expect(page.getByLabel("Название блюда")).toHaveValue(
    "Брускетта (копия)",
  );
  await expect(page.getByLabel("Ингредиент 1", { exact: true })).toHaveValue(
    dish.recipe[0].ingredientId,
  );
  await page.getByLabel("Название блюда").fill(" БРУСКЕТТА ");
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(
    page.getByText("Блюдо с таким названием уже существует"),
  ).toBeVisible();
  expect((await readDb()).dishes).toHaveLength(original.dishes.length);
  await page.getByLabel("Название блюда").fill("Брускетта (копия)");
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(page).toHaveURL(/\/dishes(?:\?|$)/);
  const afterDish = await readDb();
  expect(afterDish.dishes.find((item) => item.id === dish.id)).toEqual(dish);
  expect(
    afterDish.dishes.find((item) => item.name === "Брускетта (копия)")!.recipe,
  ).toEqual(dish.recipe);

  // A copy uses its own draft and cannot erase an unrelated unfinished order.
  await page.goto("/orders/new");
  await page
    .getByText("Брускетта", { exact: true })
    .first()
    .locator("..")
    .getByRole("button", { name: "Добавить в заказ" })
    .click();
  await page.getByLabel("Порции блюда 1").fill("2");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByRole("heading", { name: "ORD-0001" })).toBeVisible();
  const oldOrder = (await readDb()).orders[0];
  await page.evaluate(
    (dishId) =>
      sessionStorage.setItem(
        "rims.draft.v2.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.aaaaaaaa-0000-4000-8000-000000000001.order.new",
        JSON.stringify({ lines: [{ dishId, portions: 7 }] }),
      ),
    dish.id,
  );
  await page.getByRole("link", { name: "Повторить заказ ORD-0001" }).click();
  await expect(page.getByLabel("Порции блюда 1")).toHaveValue("2");
  await page.reload();
  await expect(page.getByLabel("Порции блюда 1")).toHaveValue("2");
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(
    page.getByRole("heading", { name: "Не хватает ингредиентов" }),
  ).toBeVisible();
  const warning = page
    .getByRole("heading", {
      name: "Не хватает ингредиентов",
      includeHidden: true,
    })
    .locator("../..")
    .locator("..");
  await expect(warning).toHaveAttribute("data-open", "true");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByLabel("Порции блюда 1").fill("1");
  await expect(warning).toHaveAttribute("data-open", "false");
  await expect(warning.locator("h2")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByRole("heading", { name: "ORD-0002" })).toBeVisible();
  const afterOrders = await readDb();
  expect(afterOrders.orders).toHaveLength(2);
  expect(afterOrders.orders.find((item) => item.id === oldOrder.id)).toEqual(
    oldOrder,
  );
  expect(Object.keys(afterOrders.replays)).toHaveLength(2);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        sessionStorage.getItem(
          "rims.draft.v2.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.aaaaaaaa-0000-4000-8000-000000000001.order.new",
        )!,
      ),
    ),
  ).toEqual({ lines: [{ dishId: dish.id, portions: 7 }] });

  await page.goto("/deliveries");
  await page
    .getByRole("link", { name: "Создать копию поставки DEMO-001" })
    .click();
  const number = page.getByLabel("Номер поставки");
  await expect(number).toHaveValue("DEMO-001 (копия)");
  await expect(
    page.getByRole("heading", { name: /^Позиция \d+$/ }),
  ).toHaveCount(5);
  await expect(page.getByLabel("Количество, г").first()).toHaveValue("300.000");
  await number.fill("DEMO-001");
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByText("Поставка с таким номером уже существует"),
  ).toBeVisible();
  expect((await readDb()).deliveries).toHaveLength(1);
  await number.fill("DEMO-001 (копия)");
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByRole("heading", { name: "DEMO-001 (копия)", exact: true }),
  ).toBeVisible();
  const afterDelivery = await readDb();
  expect(afterDelivery.deliveries).toHaveLength(2);
  const copiedDelivery = afterDelivery.deliveries.find(
    (item) => item.number === "DEMO-001 (копия)",
  )!;
  expect(copiedDelivery.status).toBe("pending");
  expect(copiedDelivery.batches).toEqual([]);
  expect(copiedDelivery.lines.map((line) => line.quantity)).toEqual(
    original.deliveries[0].lines.map((line) => line.quantity),
  );
  expect(copiedDelivery.id).not.toBe(original.deliveries[0].id);
  expect(copiedDelivery.receivedAt).toBeNull();
  expect(
    copiedDelivery.lines.map((line) => Date.parse(line.expiresAt)),
  ).toEqual(
    original.deliveries[0].lines.map((line) => Date.parse(line.expiresAt)),
  );

  await page.goto("/batches?status=expired");
  await page.getByRole("button", { name: "Списать", exact: true }).click();
  await page.getByLabel("Количество списания, г").fill("50");
  await page.getByRole("button", { name: "Подтвердить списание" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.goto("/movements?type=write_off");
  await page.getByRole("button", { name: /^Повторить списание/ }).click();
  await expect(page.getByLabel("Количество списания, г")).toHaveValue("50.000");
  await page.getByRole("button", { name: "Подтвердить списание" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  expect((await readDb()).writeOffs).toHaveLength(2);
  const sourceBatch = original.deliveries[0].batches[0];
  await page.goto("/batches?includeEmpty=true");
  await page
    .getByRole("link", { name: `Создать копию партии ${sourceBatch.id}` })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Позиция \d+$/ }),
  ).toHaveCount(1);
  await expect(page.getByLabel("Количество, г")).toHaveValue(
    sourceBatch.initialQuantity,
  );
  await page.getByRole("button", { name: "Создать копию партии 1" }).click();
  await expect(
    page.getByRole("heading", { name: /^Позиция \d+$/ }),
  ).toHaveCount(2);
});
test("отступы, сноски, сортировка и полный placeholder", async ({
  page,
}, testInfo) => {
  await expect(
    page.getByRole("link", { name: /Ингредиентов ↗/ }),
  ).toBeVisible();
  const cards = await page
    .getByRole("link", { name: /Ингредиентов ↗/ })
    .locator("..")
    .boundingBox();
  const panel = await page
    .getByRole("heading", { name: "Быстрые действия" })
    .locator("..")
    .boundingBox();
  expect(panel!.y - (cards!.y + cards!.height)).toBeGreaterThanOrEqual(20);
  await page.goto("/inventory");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const table = await page.getByRole("table").boundingBox();
  const refresh = await page
    .getByRole("button", { name: "Обновить", exact: true })
    .boundingBox();
  expect(table!.y - (refresh!.y + refresh!.height)).toBeGreaterThanOrEqual(20);
  const footer = page.locator("#inventory-note");
  await expect(footer).toContainText(/^\*/);
  expect((await footer.boundingBox())!.y).toBeGreaterThan(
    table!.y + table!.height,
  );
  await expect(page.locator('a[href="#inventory-note"]').first()).toHaveText(
    "*",
  );
  await page.getByRole("button", { name: "Доступно", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Доступно", exact: true }),
  ).toHaveAttribute("aria-sort", "ascending");
  await page.setViewportSize({ width: 360, height: 800 });
  const search = page.getByLabel("Поиск по названию");
  expect(
    await search.evaluate((element) => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = style.font;
      return (
        context.measureText(input.placeholder).width <
        input.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) -
          24
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("inventory-mobile.png"),
    fullPage: true,
  });
  await page.goto("/recommendations");
  await expect(
    page.getByText(/Приоритет \d+(\.\d+)? из 100/).first(),
  ).toBeVisible();
  await expect(page.locator('a[href="#offers-note"]').first()).toHaveText("*");
});
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Имя пользователя").fill("operator");
  await page.getByLabel("Пароль", { exact: true }).fill("demo");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page
    .getByRole("heading", { name: "RIMS · Центральный ресторан", exact: true })
    .locator("..")
    .getByRole("button", { name: "Открыть предприятие", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Обзор ресторана" }),
  ).toBeVisible();
});

test("production-стили, контраст действий и неподвижное меню", async ({
  page,
}, testInfo) => {
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ink")
        .trim(),
    ),
  ).toBe("#18382d");
  await expect(page.locator("body")).toHaveCSS("font-family", /Inter/);
  const logout = page.getByRole("button", { name: "Выйти", exact: true });
  await expect(logout).toHaveCSS("color", "rgb(24, 56, 45)");
  await expect(logout).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await logout
    .locator("..")
    .getByRole("button", { name: "Пояснение к действию" })
    .click();
  await expect(
    page.getByRole("note").filter({ hasText: "Завершает сеанс оператора" }),
  ).toHaveCSS("color", "rgb(24, 56, 45)");
  await page.keyboard.press("Escape");
  await page.goto("/ingredients");
  await expect(page.locator("table")).toHaveCSS("border-collapse", "collapse");
  await expect(page.locator("tbody td").first()).toHaveCSS("padding", "16px");
  await page.goto("/orders/new");
  await expect(page.getByRole("heading", { name: "Корзина" })).toBeVisible();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 600 });
    const sidebar = page.locator("aside");
    const before = await sidebar.boundingBox();
    const scrolled = await page.locator("main").evaluate((element) => {
      const pane = element.parentElement!;
      pane.scrollTop = 250;
      return { top: pane.scrollTop, windowTop: window.scrollY };
    });
    expect(scrolled.top).toBeGreaterThan(0);
    expect(scrolled.windowTop).toBe(0);
    expect((await sidebar.boundingBox())!.y).toBe(before!.y);
    await page.screenshot({
      path: testInfo.outputPath(`fixed-menu-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  const login = page.getByRole("button", { name: "Войти", exact: true });
  await expect(login).toHaveText("Войти");
  await expect(login).toHaveCSS("background-color", "rgb(24, 56, 45)");
  await expect(login).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({
    path: testInfo.outputPath("login-contrast.png"),
    fullPage: true,
  });
});
test("MSW demo: рекомендация → FEFO-заказ → стоп → пополнение", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/inventory");
  const tomato = page.getByRole("row").filter({ hasText: "Томаты" });
  await expect(tomato.getByRole("cell").nth(1)).toHaveText("1000 г");
  await expect(tomato.getByRole("cell").nth(2)).toHaveText("800 г");
  await page.goto("/recommendations");
  const offer = page
    .getByRole("heading", { name: "Брускетта", exact: true })
    .locator("..");
  await offer.getByRole("link", { name: "Добавить 3 порций в заказ" }).click();
  await page.getByLabel("Порции блюда 1").fill("2");
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByRole("heading", { name: "ORD-0001" })).toBeVisible();
  await page.goto("/orders/new");
  const menuItem = page
    .getByText("Брускетта", { exact: true })
    .first()
    .locator("..");
  await menuItem.getByRole("button", { name: "Добавить в заказ" }).click();
  await expect(
    page.getByRole("button", { name: "Провести заказ" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Провести заказ" }).click();
  await expect(page.getByRole("heading", { name: "ORD-0002" })).toBeVisible();
  await page.goto("/stop-list");
  await expect(
    page.getByRole("heading", { name: "Брускетта", exact: true }),
  ).toBeVisible();
  await page.goto("/deliveries/new");
  await page.getByLabel("Номер поставки").fill("DEMO-REFILL");
  await page
    .getByLabel("Ингредиент", { exact: true })
    .selectOption({ label: "Сыр · г" });
  await page.getByLabel("Количество, г").fill("200");
  await page
    .getByLabel("Истекает · Москва (UTC+3)", { exact: true })
    .fill(new Date(Date.now() + 75 * 3600000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Заказать" }).click();
  await expect(
    page.getByRole("heading", { name: "DEMO-REFILL" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить приёмку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Решение по входящей поставке" }),
  ).toHaveCount(0);
  await page.goto("/menu");
  const item = page
    .getByRole("heading", { name: "Брускетта", exact: true })
    .locator("../..");
  await expect(item.getByText("До 4 порций")).toBeVisible();
  expect(errors).toEqual([]);
});
test("все экраны demo, 360px и масштаб 200%", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of [
    "/",
    "/inventory",
    "/batches",
    "/ingredients",
    "/dishes",
    "/dishes/new",
    "/deliveries",
    "/deliveries/new",
    "/menu",
    "/stop-list",
    "/orders",
    "/orders/new",
    "/recommendations",
    "/purchases",
    "/movements",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator('[aria-label="Загрузка"]')).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /Ингредиентов ↗/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/deliveries/new");
  await expect(page.getByLabel("Ингредиент", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("delivery-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory");
  await expect(
    page.getByRole("link", { name: "Томаты", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("inventory-200-percent.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("создание ингредиента, редактирование PATCH и рецепт с дробными штуками", async ({
  page,
}) => {
  await page.goto("/ingredients");
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByLabel("Название", { exact: true })
    .fill("Яйцо");
  await page.getByLabel("Единица измерения").selectOption("pcs");
  await page.getByLabel("Порог пополнения").fill("3");
  await page.locator("dialog").getByLabel("Целевой запас").fill("12");
  await page.getByRole("button", { name: "Сохранить ингредиент" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Редактировать Яйцо" }).click();
  await expect(page.getByLabel("Единица измерения")).toBeDisabled();
  await page.locator("dialog").getByLabel("Целевой запас").fill("20");
  await page.getByRole("button", { name: "Сохранить ингредиент" }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.goto("/dishes/new");
  await page.getByLabel("Название блюда").fill("Пол-яйца");
  await page
    .getByLabel("Ингредиент 1", { exact: true })
    .selectOption({ label: "Яйцо · шт." });
  await page.getByLabel("Расход на порцию, шт.").fill("0.5");
  await page.getByRole("button", { name: "Сохранить рецептуру" }).click();
  await expect(page).toHaveURL(/\/dishes(?:\?|$)/);
  await expect(
    page.getByRole("cell", { name: "Пол-яйца", exact: true }),
  ).toBeVisible();
});

test("автоматический номер и прокрутка к ошибке поставки", async ({ page }) => {
  await page.goto("/deliveries/new");
  const number = page.getByLabel("Номер поставки", { exact: true });
  await expect(number).toHaveValue(/^SUP-\d+$/);
  await number.fill("MANUAL-123");
  await page.reload();
  await expect(number).toHaveValue("MANUAL-123");
  await page.setViewportSize({ width: 1000, height: 500 });
  await page.getByRole("button", { name: "Заказать", exact: true }).click();
  const invalid = page.locator('form [aria-invalid="true"]').first();
  await expect(invalid).toBeFocused();
  await expect
    .poll(async () => {
      const box = await invalid.boundingBox();
      return Boolean(box && box.y >= 0 && box.y + box.height <= 500);
    })
    .toBe(true);
});
