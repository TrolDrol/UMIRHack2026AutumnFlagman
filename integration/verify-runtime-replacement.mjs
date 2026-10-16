import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const url = process.env.RIMS_LIVE_URL || 'http://127.0.0.1:4180';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const connection = process.env.RIMS_TEST_POSTGRES;
if (!connection || !/Host=(127\.0\.0\.1|localhost);/i.test(connection) || !/Database=[^;]*test[^;]*(;|$)/i.test(connection))
  throw Error('Explicit RIMS_TEST_POSTGRES loopback test DB required; this test rotates only its runtime identity');
const saved = JSON.parse(await readFile(new URL('./.artifacts/live-browser.json', import.meta.url), 'utf8'));
const password = process.env.RIMS_LIVE_PASSWORD;
assert.ok(password);
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url + '/client/login');
  await page.getByLabel('Логин', { exact: true }).fill(saved.customer);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('heading', { name: 'Выберите заведение' }).waitFor();
  await page.goto(url + `/client/outlets/${saved.warehouse}/menu`);
  await page.getByRole('button', { name: 'Добавить +1', exact: true }).first().click();
  await page.goto(url + `/client/outlets/${saved.warehouse}/cart`);
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/orders')) writes++; });
  await page.evaluate(() => {
    const fetchOriginal = window.fetch.bind(window); let lose = true;
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      if (lose && String(args[0]).endsWith('/orders') && args[1]?.method === 'POST' && response.ok) { lose = false; throw new TypeError('Test: response lost after commit'); }
      return response;
    };
  });
  await page.getByRole('button', { name: 'Оформить заказ' }).click();
  await page.getByRole('heading', { name: 'Восстановление заказа' }).waitFor();
  assert.equal(writes, 1);
  const pending = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.endsWith('.pending'))?.[1]);
  assert.ok(pending);
  const before = (await (await context.request.get(url + '/api/v2/runtime')).json()).data.backendInstanceId;
  const dll = resolve(import.meta.dirname, '../backend/src/RestaurantManagement.WebApi/bin/Release/net10.0/RestaurantManagement.WebApi.dll');
  await promisify(execFile)('dotnet', [dll, 'rotate-instance'], { env: { ...process.env, ConnectionStrings__Default: connection, Logging__LogLevel__Default: 'Critical' }, windowsHide: true });
  const after = (await (await context.request.get(url + '/api/v2/runtime')).json()).data.backendInstanceId;
  assert.notEqual(after, before);
  await page.getByRole('button', { name: 'Повторить прежний запрос' }).click();
  await page.getByText('Источник API изменился.', { exact: false }).waitFor();
  assert.equal(writes, 1, 'old pending must never reach the replacement backend');
  assert.equal(await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.endsWith('.pending'))?.[1]), pending);
  await page.reload();
  assert.ok(await page.evaluate(old => Object.values(sessionStorage).includes(old), pending), 'reload preserves the original intention for reconciliation');
  console.log('PASS real runtime rotation: old pending preserved; no business POST after identity mismatch or reload');
} finally { await browser.close(); }
