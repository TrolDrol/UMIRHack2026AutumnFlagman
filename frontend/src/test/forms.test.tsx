import { testContext, activateTestContext } from "./context";
import { WorkspaceContext } from "../app/workspace";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { IngredientEditor } from "../features/ingredients/IngredientEditor";
import { OrderEditor } from "../features/orders/OrderEditor";
import type { DishAvailability, Requirement } from "../shared/api/types";
const dishId = "22222222-2222-4222-8222-222222222222";
const ingredientId = "33333333-3333-4333-8333-333333333333";
const operatorId = "11111111-1111-4111-8111-111111111111";
const meta = { serverTime: "2026-10-09T09:00:00Z", requestId: "request" };
const envelope = (data: unknown) => ({ data, meta });
const menu: DishAvailability = {
  dishId,
  dishName: "Брускетта",
  active: true,
  maxPortions: 3,
  status: "available",
  shortages: [],
};
const shortage: Requirement = {
  ingredientId,
  ingredientName: "Сыр",
  unit: "g",
  requiredQuantity: "100.000",
  availableQuantity: "50.000",
  missingQuantity: "50.000",
};
const server = setupServer(
  http.get("/api/v2/auth/csrf", () =>
    HttpResponse.json({ data: { requestToken: "test-csrf" }, meta: {} }),
  ),
  http.get("/api/v2/warehouses/:id/service/combos", () =>
    HttpResponse.json(
      envelope({ items: [], page: 1, pageSize: 100, total: 0 }),
    ),
  ),
  http.get(
    "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/offers",
    () =>
      HttpResponse.json(
        envelope({ items: [], page: 1, pageSize: 100, total: 0 }),
      ),
  ),
  http.get(
    "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/ingredients",
    () =>
      HttpResponse.json(
        envelope({
          items: [
            {
              id: ingredientId,
              name: "Сыр",
              unit: "g",
              defaultShelfLifeHours: 48,
              reorderPoint: "0.000",
              targetStock: "0.000",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
        }),
      ),
  ),
  http.get(
    "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/dishes",
    () =>
      HttpResponse.json(
        envelope({
          items: [
            {
              id: dishId,
              name: "Брускетта",
              active: true,
              recipe: [],
              createdAt: meta.serverTime,
              updatedAt: meta.serverTime,
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
        }),
      ),
  ),
  http.get("/api/v2/auth/me", () =>
    HttpResponse.json(
      envelope({
        id: operatorId,
        username: "operator",
        displayName: "Оператор",
      }),
    ),
  ),
  http.get(
    "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/config",
    () =>
      HttpResponse.json(
        envelope({
          restaurantName: "Тест",
          timeZone: "Europe/Moscow",
          expiryWarningPercent: 10,
          hotOfferMaxPortions: 20,
          contractVersion: "2.0.0",
        }),
      ),
  ),
  http.get(
    "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/menu/availability",
    () =>
      HttpResponse.json(
        envelope({ items: [menu], page: 1, pageSize: 50, total: 1 }),
      ),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function mount(element: React.ReactNode) {
  activateTestContext();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <WorkspaceContext.Provider value={testContext}>
          {element}
        </WorkspaceContext.Provider>
      ),
    },
    { path: "/orders/:id", element: <p>Заказ создан</p> },
  ]);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}
it("422 сохраняет введённую форму и привязывает ошибку к полю", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v2/warehouses/:warehouse/service/combos", () =>
      HttpResponse.json({
        data: { items: [], page: 1, pageSize: 100, total: 0 },
        meta: {
          serverTime: new Date().toISOString(),
          requestId: crypto.randomUUID(),
        },
      }),
    ),
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/ingredients",
      () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Ошибка поля",
              details: {
                fields: [{ path: "name", message: "Название уже занято" }],
              },
            },
            meta,
          },
          { status: 422 },
        ),
    ),
  );
  // Editor requires an authenticated operator; render only after session check.
  function ReadyEditor() {
    return (
      <AuthReady>
        <IngredientEditor onClose={() => {}} />
      </AuthReady>
    );
  }
  mount(<ReadyEditor />);
  const input = await screen.findByLabelText("Название");
  await user.type(input, "Томаты");
  await user.click(
    screen.getByRole("button", { name: "Сохранить ингредиент" }),
  );
  expect(await screen.findByText("Название уже занято")).toBeVisible();
  expect(input).toHaveValue("Томаты");
  expect(input).toHaveAttribute("aria-invalid", "true");
});

function AuthReady({ children }: { children: React.ReactNode }) {
  return children;
}
async function order() {
  const user = userEvent.setup();
  mount(
    <AuthReady>
      <OrderEditor />
    </AuthReady>,
  );
  await user.click(
    await screen.findByRole("button", { name: "Добавить в заказ" }),
  );
  return user;
}
it("одно нажатие проверяет текущую корзину и создаёт заказ", async () => {
  const calls: string[] = [];
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders/preview",
      async ({ request }) => {
        calls.push("preview");
        expect(await request.json()).toEqual({
          lines: [{ dishId, portions: 2 }],
        });
        return HttpResponse.json(
          envelope({ canCreate: true, requirements: [], allocations: [] }),
        );
      },
    ),
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      async ({ request }) => {
        calls.push("create");
        expect(await request.json()).toEqual({
          lines: [{ dishId, portions: 2 }],
        });
        expect(request.headers.get("Idempotency-Key")).toBeTruthy();
        return HttpResponse.json(envelope({ id: dishId }), { status: 201 });
      },
    ),
  );
  const user = await order();
  expect(
    screen.queryByRole("button", { name: "Проверить заказ" }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("Порции блюда 1"));
  await user.type(screen.getByLabelText("Порции блюда 1"), "2");
  await user.click(screen.getByRole("button", { name: "Провести заказ" }));
  expect(await screen.findByText("Заказ создан")).toBeVisible();
  expect(calls).toEqual(["preview", "create"]);
});
it("проверка блокирует корзину и повторную отправку", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let previews = 0;
  let creations = 0;
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders/preview",
      async () => {
        previews++;
        await gate;
        return HttpResponse.json(
          envelope({ canCreate: true, requirements: [], allocations: [] }),
        );
      },
    ),
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      () => {
        creations++;
        return HttpResponse.json(envelope({ id: dishId }), { status: 201 });
      },
    ),
  );
  const user = await order();
  const submit = screen.getByRole("button", { name: "Провести заказ" });
  await user.click(submit);
  await waitFor(() => expect(previews).toBe(1));
  expect(submit).toBeDisabled();
  expect(screen.getByLabelText("Порции блюда 1")).toBeDisabled();
  fireEvent.submit(submit.closest("form")!);
  release();
  expect(await screen.findByText("Заказ создан")).toBeVisible();
  expect(previews).toBe(1);
  expect(creations).toBe(1);
});
it("409 показывает серверные shortages и сохраняет корзину", async () => {
  server.use(
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders/preview",
      () =>
        HttpResponse.json(
          envelope({ canCreate: true, requirements: [], allocations: [] }),
        ),
    ),
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders",
      () =>
        HttpResponse.json(
          {
            error: {
              code: "INSUFFICIENT_STOCK",
              message: "Недостаточно ингредиентов",
              details: { shortages: [shortage] },
            },
            meta,
          },
          { status: 409 },
        ),
    ),
  );
  const user = await order();
  await user.click(screen.getByRole("button", { name: "Провести заказ" }));
  expect(await screen.findByText("Сыр")).toBeVisible();
  expect(screen.getByText("Недостаточно ингредиентов")).toBeVisible();
  expect(screen.getByLabelText("Порции блюда 1")).toHaveValue(1);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Провести заказ" }),
    ).toBeEnabled(),
  );
});
it("совместный дефицит двух блюд блокирует заказ несмотря на их доступность", async () => {
  server.use(
    http.get(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/menu/availability",
      () =>
        HttpResponse.json(
          envelope({
            items: [
              menu,
              {
                ...menu,
                dishId: "44444444-4444-4444-8444-444444444444",
                dishName: "Салат",
              },
            ],
            page: 1,
            pageSize: 50,
            total: 2,
          }),
        ),
    ),
    http.post(
      "/api/v2/warehouses/aaaaaaaa-0000-4000-8000-000000000001/orders/preview",
      () =>
        HttpResponse.json(
          envelope({
            canCreate: false,
            requirements: [shortage],
            allocations: [],
          }),
        ),
    ),
  );
  const user = userEvent.setup();
  mount(
    <AuthReady>
      <OrderEditor />
    </AuthReady>,
  );
  await screen.findByText("Салат");
  for (const button of screen.getAllByRole("button", {
    name: "Добавить в заказ",
  }))
    await user.click(button);
  await user.click(screen.getByRole("button", { name: "Провести заказ" }));
  expect(await screen.findByText("Не хватает ингредиентов")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Провести заказ" }),
    ).toBeEnabled(),
  );
});
