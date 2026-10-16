import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});
const meta = {
  serverTime: "2026-10-14T12:00:00.000Z",
  requestId: "11111111-1111-4111-8111-111111111111",
};
it("live mutations refresh CSRF after login and keep expected principal/key/body", async () => {
  vi.stubEnv("VITE_DEMO_MODE", "false");
  vi.resetModules();
  let tokens = 0;
  const calls: { url: string; options: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return Response.json({
        data: url.endsWith("/auth/csrf")
          ? { requestToken: `token-${++tokens}` }
          : url.endsWith("/auth/login")
            ? {
                id: "11111111-1111-4111-8111-111111111112",
                username: "staff",
                displayName: "Staff",
              }
            : { id: "ok" },
        meta,
      });
    }),
  );
  const { request } = await import("./client");
  await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username: "staff",
      password: "example-test-password",
    }),
  });
  const body = '{"name":"Example","ownerUsername":"owner"}';
  const key = "11111111-1111-4111-8111-111111111113";
  await request("/enterprises", { method: "POST", body, key });
  const sent = calls.at(-1)!.options;
  expect(sent.body).toBe(body);
  expect(sent.headers).toMatchObject({
    "X-CSRF-TOKEN": "token-2",
    "X-Rims-Expected-User-Id": "11111111-1111-4111-8111-111111111112",
    "Idempotency-Key": key,
  });
});
it("CSRF_INVALID refreshes the token for an explicit retry without changing intention", async () => {
  vi.stubEnv("VITE_DEMO_MODE", "false");
  vi.resetModules();
  let tokens = 0;
  let commands = 0;
  const sent: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/auth/csrf"))
        return Response.json({
          data: { requestToken: `token-${++tokens}` },
          meta,
        });
      if (url.endsWith("/auth/me"))
        return Response.json({
          data: { id: "11111111-1111-4111-8111-111111111112" },
          meta,
        });
      sent.push(options);
      return ++commands === 1
        ? Response.json(
            {
              error: {
                code: "CSRF_INVALID",
                message: "Обновите токен",
                details: {},
              },
              meta,
            },
            { status: 403 },
          )
        : Response.json({ data: { id: "ok" }, meta });
    }),
  );
  const { request } = await import("./client");
  await request("/auth/me");
  const options = {
    method: "POST",
    body: '{"name":"Example","ownerUsername":"owner"}',
    key: "11111111-1111-4111-8111-111111111113",
  };
  await expect(request("/enterprises", options)).resolves.toHaveProperty(
    "data",
  );
  expect(sent[0].body).toBe(sent[1].body);
  expect(sent[0].headers).toMatchObject({
    "Idempotency-Key": options.key,
    "X-CSRF-TOKEN": "token-1",
  });
  expect(sent[1].headers).toMatchObject({
    "Idempotency-Key": options.key,
    "X-CSRF-TOKEN": "token-2",
  });
});
