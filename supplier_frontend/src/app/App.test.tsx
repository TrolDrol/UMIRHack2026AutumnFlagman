import { prepareRuntime } from "@rims/demo-api/runtime";
import { beforeEach } from "vitest";
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          backendInstanceId: "test-server",
          sourceKind: "server",
          contractVersion: "2.1.0",
        },
        meta: {},
      }),
    ),
  );
  await prepareRuntime("live");
});
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { connection, purchaseRequest, requestId } from "../test/fixtures";
const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({
      data,
      meta: { serverTime: new Date().toISOString(), requestId },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
describe("Подключение кабинета", () => {
  it("сначала проверяет identity, не сохраняет секрет, disconnect скрывает документы", async () => {
    history.replaceState(null, "", "/supplier/requests");
    const fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        envelope(
          url.endsWith("/identity")
            ? connection.identity
            : {
                items: [{ ...purchaseRequest, status: "submitted" }],
                page: 1,
                pageSize: 20,
                total: 1,
              },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Идентификатор склада"),
      connection.warehouseId,
    );
    await user.type(screen.getByLabelText("Ключ API"), connection.key);
    await user.click(screen.getByRole("button", { name: "Подключиться" }));
    await screen.findByText("ЗП-001");
    expect(fetch.mock.calls[0][0]).toContain("/identity");
    expect(Object.values(localStorage)).not.toContain(connection.key);
    expect(Object.values(sessionStorage)).not.toContain(connection.key);
    await user.click(screen.getByRole("button", { name: "Отключиться" }));
    expect(screen.queryByText("ЗП-001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ключ API")).toHaveValue("");
  });
  it("401 возвращает к подключению", async () => {
    history.replaceState(null, "", "/supplier/requests");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(envelope(connection.identity))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "INVALID_INTEGRATION_KEY",
                message: "Ключ недействителен",
                details: {},
              },
            }),
            { status: 401 },
          ),
        ),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Идентификатор склада"),
      connection.warehouseId,
    );
    await user.type(screen.getByLabelText("Ключ API"), connection.key);
    await user.click(screen.getByRole("button", { name: "Подключиться" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Подключитесь повторно",
      ),
    );
    expect(screen.getByLabelText("Ключ API")).toHaveValue("");
  });
});
