import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipmentEditor } from "./ShipmentEditor";
import { connection, purchaseRequest } from "../../test/fixtures";
describe("Редактор партий", () => {
  it("привязывает ошибки к строкам и сохраняет externalId черновика", async () => {
    const send = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <ShipmentEditor
        request={purchaseRequest}
        connection={connection}
        disabled={false}
        fields={[]}
        onSend={send}
      />,
    );
    await user.type(screen.getByLabelText("Номер поставки"), "П-001");
    await user.click(
      screen.getByRole("button", { name: "Зарегистрировать поставку" }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("lines.0.expiresAt");
    await user.type(screen.getByLabelText("Дата партии 1"), "2026-10-13T12:00");
    await user.click(
      screen.getByRole("button", { name: "Зарегистрировать поставку" }),
    );
    expect(send).toHaveBeenCalledOnce();
    const externalId = send.mock.calls[0][0].externalId;
    view.unmount();
    render(
      <ShipmentEditor
        request={purchaseRequest}
        connection={connection}
        disabled={false}
        fields={[]}
        onSend={send}
      />,
    );
    expect(screen.getByLabelText("Номер поставки")).toHaveValue("П-001");
    await user.click(
      screen.getByRole("button", { name: "Зарегистрировать поставку" }),
    );
    expect(send.mock.calls[1][0].externalId).toBe(externalId);
  });
  it("снимок партии другого поставщика не восстанавливается", async () => {
    const view = render(
      <ShipmentEditor
        request={purchaseRequest}
        connection={connection}
        disabled={false}
        fields={[]}
        onSend={vi.fn()}
      />,
    );
    await userEvent.type(
      screen.getByLabelText("Номер поставки"),
      "Чужой документ",
    );
    view.unmount();
    render(
      <ShipmentEditor
        request={purchaseRequest}
        connection={{ ...connection, clientId: "other" }}
        disabled={false}
        fields={[]}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Номер поставки")).toHaveValue("");
  });
});
