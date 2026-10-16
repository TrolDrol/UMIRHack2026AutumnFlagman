/* global document, innerWidth */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const origin = process.env.PORTAL_ORIGIN || "http://127.0.0.1:8090";
for (const [path, expected] of [
  ["/", 200],
  ["/client/login", 200],
  ["/client/outlets/example/orders/example", 200],
  ["/client/assets/missing.js", 404],
  ["/api/v2/customer/outlets", 503],
  ["/integrations/v1/missing", 503],
  ["/mockServiceWorker.js", 200],
]) {
  const response = await fetch(origin + path);
  assert.equal(response.status, expected, path);
  if (path === "/mockServiceWorker.js")
    assert.match(response.headers.get("content-type"), /javascript/);
}
assert.equal(
  (await fetch(origin + "/client", { redirect: "manual" })).status,
  308,
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(origin + "/client/register");
  const name = "smoke_" + Date.now();
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByLabel("Логин").fill(name);
  await page.getByLabel("Пароль").fill("long_password_123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page
    .getByRole("link", { name: /Открыть меню/ })
    .first()
    .click();
  await page.getByRole("heading", { name: "Меню", exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/customer-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({
    path: "test-results/customer-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    origin + "/mockServiceWorker.js",
  );
} finally {
  await browser.close();
}
console.log(
  "Portal smoke passed: routes, assets, API 503, root worker, registration, menu, 360 px.",
);
