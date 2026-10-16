import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  csvBytes,
  snapshotTable,
  xlsxBytes,
  type TableExport,
} from "@rims/demo-api/table-export";
import { CopyUuid, Table } from "../shared/ui";
import { ExportAuthorContext } from "../shared/ui/TableDownload";
const author = { displayName: "Анна Петрова", username: "anna" };
const fixture: TableExport = {
  title: "Остатки",
  author,
  generatedAt: "2026-10-15T23:00:00.123Z",
  headers: ["Имя", "Количество"],
  rows: [
    ['Сыр; "Пармезан"\nНовая строка', "9007199254740993.001"],
    ['=HYPERLINK("evil")', "001"],
    [" +1+1", "@SUM(1)"],
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("CSV uses UTF-8 BOM, quotes, CRLF, provenance and protects spreadsheet formulas", () => {
  const bytes = csvBytes(fixture),
    text = new TextDecoder().decode(bytes);
  expect(Array.from(bytes.slice(0, 3))).toEqual([239, 187, 191]);
  for (const value of [
    author.displayName,
    author.username,
    "2026-10-15T23:00:00.123Z",
    "16.10.2026",
    "9007199254740993.001",
    '"Сыр; ""Пармезан""\nНовая строка"',
  ])
    expect(text).toContain(value);
  expect(text).toContain("'=HYPERLINK");
  expect(text).toContain("' +1+1");
  expect(text).toContain("'@SUM");
  expect(text).toContain("\r\n");
});
it("XLSX is a ZIP workbook with inline strings, exact values and author/core metadata", () => {
  const bytes = xlsxBytes(fixture);
  expect(Array.from(bytes.slice(0, 4))).toEqual([80, 75, 3, 4]);
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain("xl/worksheets/sheet1.xml");
  expect(text).toContain("dc:creator");
  expect(text).toContain("Анна Петрова (anna)");
  expect(text).toContain("9007199254740993.001");
  expect(text).toContain('t="inlineStr"');
  expect(text).not.toContain("<f>");
  expect(text).toContain("&quot;evil&quot;");
});
it("one icon trigger opens format dropdown; export preserves sorted visible rows and omits actions and hidden help", async () => {
  const user = userEvent.setup(),
    create = vi.fn(() => "blob:test"),
    revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  render(
    <ExportAuthorContext.Provider value={author}>
      <h1>Партии</h1>
      <Table headers={["Название", "Количество", "Действия"]}>
        <tr>
          <td>
            Яблоко<span hidden>Не экспортировать</span>
            <span popover="auto">Подсказка</span>
          </td>
          <td>2.000</td>
          <td>
            <button>Удалить</button>
          </td>
        </tr>
        <tr>
          <td>Арбуз</td>
          <td>1.000</td>
          <td>
            <button>Удалить</button>
          </td>
        </tr>
      </Table>
    </ExportAuthorContext.Provider>,
  );
  expect(
    screen.queryByRole("columnheader", { name: "Действия" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(2);
  await user.click(screen.getAllByText("Операции")[0]);
  expect(screen.getAllByRole("button", { name: "Удалить" })[0].closest("details")).toHaveAttribute("open");
  const trigger = screen.getByRole("button", { name: "Скачать таблицу" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Название" }));
  const snapshot = snapshotTable(screen.getByRole("table") as HTMLTableElement);
  expect(snapshot.headers).toEqual(["Название", "Количество"]);
  expect(snapshot.rows).toEqual([
    ["Арбуз", "1.000"],
    ["Яблоко", "2.000"],
  ]);
  expect(snapshot.title).toBe("Партии");
  await user.click(trigger);
  const menu = screen.getByRole("menu");
  fireEvent.scroll(document);
  fireEvent.resize(window);
  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "CSV (.csv)" }));
  expect(create).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  click.mockRestore();
});
it("missing identity disables export instead of inventing an author", () => {
  render(
    <Table headers={["Название"]}>
      <tr>
        <td>Строка</td>
      </tr>
    </Table>,
  );
  expect(
    screen.getByRole("button", { name: "Скачать таблицу" }),
  ).toBeDisabled();
  expect(() =>
    csvBytes({ ...fixture, author: { displayName: "", username: "" } }),
  ).toThrow("Укажите имя");
});
it("exports the selected human-readable role, not all options or an empty control", () => {
  render(
    <Table headers={["Имя", "Роль"]}>
      <tr>
        <td>Анна</td>
        <td>
          <select defaultValue="manager">
            <option value="manager">Менеджер</option>
            <option value="waiter">Официант</option>
          </select>
        </td>
      </tr>
    </Table>,
  );
  const table = screen.getByRole("table") as HTMLTableElement;
  expect(snapshotTable(table).rows).toEqual([["Анна", "Менеджер"]]);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "waiter" },
  });
  expect(snapshotTable(table).rows).toEqual([["Анна", "Официант"]]);
});

it("keeps the complete batch UUID in exported cells while excluding operation controls", () => {
  const batchId = "5a533e2d-1234-4567-8901-123456789abc";
  render(
    <Table headers={["Партия", "Повторить"]}>
      <tr>
        <td>
          <CopyUuid value={batchId} />
          <button>Фильтровать по партии</button>
        </td>
        <td>
          <button>Повторить списание</button>
        </td>
      </tr>
    </Table>,
  );
  expect(screen.getByText(batchId)).toBeInTheDocument();
  expect(
    screen.queryByRole("columnheader", { name: "Повторить" }),
  ).not.toBeInTheDocument();
  const snapshot = snapshotTable(screen.getByRole("table") as HTMLTableElement);
  expect(snapshot.headers).toEqual(["Партия"]);
  expect(snapshot.rows).toEqual([[batchId]]);
});
