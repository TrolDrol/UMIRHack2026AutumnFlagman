import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table } from "../shared/ui";

it("sorts every column, preserves exact decimals and restores original order", async () => {
  const user = userEvent.setup();
  render(
    <Table headers={["Название", "Количество", "Дата"]}>
      <tr>
        <td>Яблоко</td>
        <td data-sort-value="9007199254740993.002">Большой запас</td>
        <td data-sort-value="2026-11-01T00:00:00Z">01.11.2026</td>
      </tr>
      <tr>
        <td>Арбуз</td>
        <td data-sort-value="9007199254740993.001">Меньший запас</td>
        <td data-sort-value="2026-10-02T00:00:00Z">02.10.2026</td>
      </tr>
      <tr>
        <td>Банан</td>
        <td data-sort-value="-0.003">Отрицательный</td>
        <td data-sort-value="2026-10-02T01:00:00+03:00">02.10.2026</td>
      </tr>
    </Table>,
  );
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
  await user.click(screen.getByRole("button", { name: "Количество" }));
  expect(names()).toEqual(["Банан", "Арбуз", "Яблоко"]);
  expect(
    screen.getByRole("columnheader", { name: "Количество" }),
  ).toHaveAttribute("aria-sort", "ascending");
  await user.click(screen.getByRole("button", { name: "Количество" }));
  expect(names()).toEqual(["Яблоко", "Арбуз", "Банан"]);
  await user.click(screen.getByRole("button", { name: "Количество" }));
  expect(names()).toEqual(["Яблоко", "Арбуз", "Банан"]);
  expect(
    screen.getByRole("columnheader", { name: "Количество" }),
  ).toHaveAttribute("aria-sort", "none");
  await user.click(screen.getByRole("button", { name: "Дата" }));
  expect(names()).toEqual(["Банан", "Арбуз", "Яблоко"]);
  await user.click(screen.getByRole("button", { name: "Название" }));
  expect(names()).toEqual(["Арбуз", "Банан", "Яблоко"]);
});
