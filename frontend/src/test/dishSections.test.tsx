import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DishSection } from "../features/orders/DishPicker";

it("paginates sections independently with no more than ten dishes per page", async () => {
  const user = userEvent.setup();
  const items = (prefix: string) =>
    Array.from({ length: 21 }, (_, i) => ({
      id: `${prefix}-${i}`,
      content: (
        <strong>
          {prefix} {i + 1}
        </strong>
      ),
    }));
  render(
    <>
      <DishSection title="Горячие предложения" items={items("Горячее")} />
      <DishSection title="Обычные блюда" items={items("Обычное")} />
    </>,
  );
  const hot = screen.getByRole("region", {
    name: "Горячие предложения: блюда",
  });
  const regular = screen.getByRole("region", { name: "Обычные блюда: блюда" });
  expect(within(hot).getAllByText(/^Горячее /)).toHaveLength(10);
  expect(within(regular).getAllByText(/^Обычное /)).toHaveLength(10);
  await user.click(
    screen.getByRole("button", {
      name: "Горячие предложения: следующая страница",
    }),
  );
  expect(within(hot).getByText("Горячее 11")).toBeVisible();
  expect(within(regular).getByText("Обычное 1")).toBeVisible();
  await user.click(
    screen.getByRole("button", {
      name: "Горячие предложения: следующая страница",
    }),
  );
  expect(within(hot).getAllByText(/^Горячее /)).toHaveLength(1);
  expect(
    screen.getByRole("button", {
      name: "Горячие предложения: следующая страница",
    }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Обычные блюда: следующая страница" }),
  );
  expect(within(hot).getByText("Горячее 21")).toBeVisible();
  expect(within(regular).getByText("Обычное 11")).toBeVisible();
});
