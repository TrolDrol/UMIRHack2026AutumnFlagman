import { beforeEach, describe, it, expect, vi } from "vitest";
import { connection, requestId } from "../../test/fixtures";
import {
  clearPending,
  prepare,
  readPending,
  sendOperation,
  scope,
  foreignPending,
} from "./operations";
import { identify, prefix } from "./client";
const path = `${prefix(connection.warehouseId)}/purchase-requests/${requestId}/approve`;
const envelope = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      data,
      meta: { serverTime: new Date().toISOString(), requestId },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
describe("Восстановление операций", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  it("сохраняет точный запрос до fetch и не сохраняет секрет", async () => {
    const op = prepare(connection, path, { version: 2 }, requestId);
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(readPending(connection)?.body).toBe('{"version":2}');
      expect(init.headers).toHaveProperty("Idempotency-Key", op.key);
      return envelope({ status: "approved" });
    });
    vi.stubGlobal("fetch", fetch);
    expect(JSON.stringify(readPending(connection))).not.toContain(
      connection.key,
    );
    await sendOperation(connection, op);
    expect(readPending(connection)).toBeNull();
  });
  it("после потери ответа повторяет неизменные body/key, блокирует другое намерение", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(envelope({ status: "approved" }));
    vi.stubGlobal("fetch", fetch);
    const op = prepare(connection, path, { version: 2 }, requestId);
    await expect(sendOperation(connection, op)).rejects.toThrow();
    expect(() =>
      prepare(connection, path, { version: 3 }, requestId),
    ).toThrow();
    await sendOperation(connection, readPending(connection)!);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      fetch.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });
  it("не отправляет запрос при недоступном storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      prepare(connection, path, { version: 2 }, requestId),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("изолирует пользователей, склады и режимы; ротация секрета допустима", async () => {
    const op = prepare(connection, path, { version: 2 }, requestId);
    expect(readPending({ ...connection, clientId: "other" })).toBeNull();
    expect(readPending({ ...connection, mode: "demo" })).toBeNull();
    const fetch = vi.fn().mockResolvedValue(envelope({}));
    vi.stubGlobal("fetch", fetch);
    await expect(
      sendOperation({ ...connection, clientId: "other" }, op),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await sendOperation({ ...connection, key: "rotated" }, op);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("показывает прежнюю среду только исходному supplier principal, сохраняя чужие записи", () => {
    const original = { ...connection, backendInstanceId: "old-db" };
    const op = prepare(original, path, { version: 2 }, requestId);
    expect(foreignPending({ ...connection, backendInstanceId: "new-db" })).toEqual([{ key: `${scope(original)}.pending.${op.key}`, saved: JSON.stringify(op) }]);
    expect(foreignPending({ ...connection, clientId: "other-client", backendInstanceId: "new-db" })).toEqual([]);
    expect(foreignPending({ ...connection, warehouseId: "other-warehouse", backendInstanceId: "new-db" })).toEqual([]);
    expect(readPending(original)).toEqual(op);
  });
  it("блокирует повтор спустя 24 часа", async () => {
    const op = prepare(connection, path, { version: 2 }, requestId);
    op.createdAt = new Date(Date.now() - 86400001).toISOString();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(sendOperation(connection, op)).rejects.toThrow("24 часа");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("401 сохраняет неизвестную операцию; конфликт завершает её без новой version", async () => {
    const fetch = vi
      .fn()
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "VERSION_CONFLICT",
              message: "Версия изменилась",
              details: {},
            },
          }),
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const op = prepare(connection, path, { version: 2 }, requestId);
    await expect(sendOperation(connection, op)).rejects.toThrow();
    expect(readPending(connection)).not.toBeNull();
    await expect(sendOperation(connection, op)).rejects.toThrow("Версия");
    expect(readPending(connection)).toBeNull();
  });
  it("учитывает Retry-After и сохраняет снимок на 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "Подождите",
              details: {},
            },
          }),
          { status: 429, headers: { "Retry-After": "90" } },
        ),
      ),
    );
    const op = prepare(connection, path, { version: 2 }, requestId);
    await expect(sendOperation(connection, op)).rejects.toThrow();
    const pending = readPending(connection)!;
    expect(pending.notBefore! - Date.now()).toBeGreaterThan(89000);
    await expect(sendOperation(connection, pending)).rejects.toThrow("частоту");
  });
  it("проверяет identity и отклоняет POS/другой склад", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(envelope({ ...connection.identity, kind: "pos" }))
      .mockResolvedValueOnce(
        envelope({ ...connection.identity, warehouseId: "other" }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      identify("live", connection.warehouseId, connection.key),
    ).rejects.toThrow();
    await expect(
      identify("live", connection.warehouseId, connection.key),
    ).rejects.toThrow();
  });
  it("не доверяет испорченному сохранённому пути", () => {
    const op = prepare(connection, path, { version: 2 }, requestId);
    localStorage.setItem(
      `${scope(connection)}.pending.${op.key}`,
      JSON.stringify({ ...op, path: "/api/v2/admin" }),
    );
    expect(() => readPending(connection)).toThrow();
    clearPending(connection, op.key);
  });
});
