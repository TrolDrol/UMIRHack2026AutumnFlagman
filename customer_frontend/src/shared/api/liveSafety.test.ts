import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("a late response from a previous session cannot replace the server clock", async () => {
  vi.resetModules();
  let resolveOld!: (response: Response) => void;
  let first = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      first
        ? ((first = false),
          await new Promise<Response>((resolve) => {
            resolveOld = resolve;
          }))
        : Response.json({
            data: { id: "current" },
            meta: { serverTime: "2026-10-15T12:00:00Z", requestId: "current" },
          }),
    ),
  );
  const { request, invalidateSession, serverNow } = await import("./client");
  const old = request("/auth/me");
  invalidateSession();
  expect(serverNow()).toBeNull();
  await request("/auth/me");
  const before = serverNow()!;
  resolveOld(
    Response.json({
      data: { id: "old" },
      meta: { serverTime: "2020-01-01T00:00:00Z", requestId: "old" },
    }),
  );
  await old;
  expect(serverNow()!).toBeGreaterThanOrEqual(before);
  expect(serverNow()! - before).toBeLessThan(1000);
});
it("lost receipt then expired CSRF preserves the original key, body and principal on replay", async () => {
  vi.resetModules();
  const commands: RequestInit[] = [];
  let tokens = 0;
  const meta = { serverTime: new Date().toISOString(), requestId: "test" };
  const receipt = { id: "original-receipt" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/auth/me"))
        return Response.json({ data: { id: "customer-A" }, meta });
      if (url.endsWith("/auth/csrf"))
        return Response.json({
          data: { requestToken: `csrf-${++tokens}` },
          meta,
        });
      commands.push(options);
      if (commands.length === 1)
        throw new TypeError("Response lost after commit");
      if (commands.length === 2)
        return Response.json(
          {
            error: { code: "CSRF_INVALID", message: "Expired", details: {} },
            meta,
          },
          { status: 403 },
        );
      return Response.json({ data: receipt, meta });
    }),
  );
  const { request } = await import("./client");
  await request("/auth/me");
  const intention = {
    method: "POST",
    body: '{"lines":[],"combos":[{"comboId":"combo-A","version":1,"quantity":2}]}',
    headers: { "Idempotency-Key": "same-key" },
    expectedUserId: "customer-A",
  };
  await expect(
    request("/warehouses/warehouse-A/orders", intention),
  ).rejects.toThrow();
  await expect(
    request("/warehouses/warehouse-A/orders", intention),
  ).resolves.toEqual(receipt);
  expect(commands).toHaveLength(3);
  for (const command of commands) {
    expect(command.body).toBe(intention.body);
    expect(command.headers).toMatchObject({
      "Idempotency-Key": "same-key",
      "X-Rims-Expected-User-Id": "customer-A",
    });
  }
  expect(commands[2].headers).toMatchObject({ "X-CSRF-TOKEN": "csrf-2" });
});
