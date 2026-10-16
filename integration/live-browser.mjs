import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const url = process.env.RIMS_LIVE_URL || 'http://127.0.0.1:4180';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Acceptance requires loopback isolated stack');
const password = process.env.RIMS_LIVE_PASSWORD;
if (!password) throw Error('Set RIMS_LIVE_PASSWORD for the isolated demo-owner account');
const warehouse = 'eeeeeeee-0000-4000-8000-000000000001';
const W = `/api/v2/warehouses/${warehouse}`;
const suffix = Date.now().toString(36);
const results = [];
const browser = await chromium.launch({ headless: true });
const staffContext = await browser.newContext();
const supplierContext = await browser.newContext();
const customerContext = await browser.newContext();
const staff = await staffContext.newPage();
const supplier = await supplierContext.newPage();
const customer = await customerContext.newPage();
for (const p of [staff, supplier, customer]) p.setDefaultTimeout(20000);
async function visible(locator) { await locator.waitFor({ state: 'visible' }); }
async function api(context, path, method = 'GET', body, key, bearer) {
  let headers = { Origin: url };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (method !== 'GET') {
    const prefix = path.startsWith('/api/v2/customer') ? '/api/v2/customer' : '/api/v2';
    const csrf = await context.request.get(url + prefix + '/auth/csrf');
    headers['X-CSRF-TOKEN'] = (await csrf.json()).data.requestToken;
    const me = await context.request.get(url + prefix + '/auth/me');
    if (me.ok()) headers['X-Rims-Expected-User-Id'] = (await me.json()).data.id;
  }
  if (key) headers['Idempotency-Key'] = key;
  const r = await context.request.fetch(url + path, { method, data: body, headers });
  const payload = r.status() === 204 ? null : await r.json();
  assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${JSON.stringify(payload)}`);
  return payload?.data;
}
async function collection(context, path) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = await api(context, `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    items.push(...data.items);
    if (items.length >= data.total) return items;
    assert.ok(data.items.length, 'Pagination must advance');
  }
}
try {
  const runtime = await api(staffContext, '/api/v2/runtime');
  assert.equal(runtime.sourceKind, 'server'); assert.equal(runtime.contractVersion, '2.1.0');
  await staff.goto(url + '/login');
  await staff.getByLabel('Имя пользователя').fill('demo-owner');
  await staff.getByLabel('Пароль', { exact: true }).fill(password);
  await staff.getByRole('button', { name: 'Войти', exact: true }).click();
  await staff.getByRole('button', { name: 'Открыть предприятие' }).first().click();
  await visible(staff.getByRole('heading', { name: 'Обзор ресторана' }));
  assert.equal(await staff.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  results.push('staff login/runtime/server/no MSW');

  const catalog = await collection(staffContext, W + '/ingredients');
  const ingredient = catalog.find(i => i.name === 'Сыр');
  // Replenish only this isolated, explicitly seeded test warehouse so repeated
  // runs do not depend on quantities left by earlier acceptance runs.
  const fixture = await api(staffContext, W + '/deliveries', 'POST', { number: `FIXTURE-${suffix}`, expectedAt: null, note: 'isolated acceptance fixture', lines: catalog.filter(i => ['Томаты', 'Сыр', 'Хлеб'].includes(i.name)).map(i => ({ ingredientId: i.id, quantity: i.unit === 'pcs' ? '20.000' : '1000.000', expiresAt: new Date(Date.now() + 172800000).toISOString() })) }, crypto.randomUUID());
  await api(staffContext, W + `/deliveries/${fixture.id}/confirm`, 'POST', { receivedAtMode: 'server' }, crypto.randomUUID());
  const client = await api(staffContext, W + '/integration-clients', 'POST', { name: `Live supplier ${suffix}`, kind: 'supplier' }, crypto.randomUUID());
  const issued = await api(staffContext, W + `/integration-clients/${client.id}/keys`, 'POST', { label: 'isolated browser test', expiresAt: new Date(Date.now() + 86400000).toISOString() }, crypto.randomUUID());
  const before = (await api(staffContext, W + '/inventory')).items.find(i => i.ingredientId === ingredient.id).physicalQuantity;

  await staff.goto(url + '/purchase-requests');
  await staff.getByLabel('Поставщик', { exact: true }).selectOption(client.id);
  await staff.getByLabel('Ингредиент 1', { exact: true }).selectOption(ingredient.id);
  await staff.getByLabel('Количество в базовой единице').fill('200');
  await staff.getByLabel('Примечание', { exact: true }).fill(`browser-${suffix}`);
  await staff.getByRole('button', { name: 'Сохранить черновик' }).click();
  const card = staff.locator('article').filter({ hasText: `browser-${suffix}` });
  await card.getByRole('button', { name: 'Отправить поставщику' }).click();
  await visible(card.getByRole('heading', { name: /Отправлена поставщику/ }));
  const request = (await collection(staffContext, W + '/purchase-requests')).find(r => r.note === `browser-${suffix}`);
  assert.equal(request.status, 'submitted');

  await supplier.goto(url + `/supplier/requests/${request.id}`);
  await supplier.getByLabel('Идентификатор склада').fill(warehouse);
  await supplier.getByLabel('Ключ API').fill(issued.token);
  await supplier.getByRole('button', { name: 'Подключиться' }).click();
  await supplier.getByRole('button', { name: 'Принять заявку' }).click();
  await supplier.getByRole('button', { name: 'Оформить отгрузку' }).click();
  await supplier.getByLabel('Номер поставки').fill(`LIVE-${suffix}`);
  const expires = new Date(Date.now() + 86400000);
  const moscow = new Date(expires.getTime() + 3 * 3600000).toISOString().slice(0, 16);
  await supplier.getByLabel('Дата партии 1').fill(moscow);
  await supplier.getByRole('button', { name: 'Зарегистрировать поставку' }).click();
  await visible(supplier.getByRole('heading', { name: `Поставка LIVE-${suffix}` }));
  assert.equal((await api(staffContext, W + '/inventory')).items.find(i => i.ingredientId === ingredient.id).physicalQuantity, before);
  const shipped = (await api(staffContext, W + `/purchase-requests/${request.id}`));
  await staff.goto(url + `/deliveries/${shipped.deliveryId}`);
  await staff.getByRole('button', { name: 'Подтвердить приёмку', exact: true }).click();
  await staff.getByRole('heading', { name: 'Решение по входящей поставке' }).waitFor({ state: 'hidden' });
  assert.equal((await api(staffContext, W + `/purchase-requests/${request.id}`)).status, 'received');
  assert.equal(Number((await api(staffContext, W + '/inventory')).items.find(i => i.ingredientId === ingredient.id).physicalQuantity), Number(before) + 200);
  assert.ok(!(await supplier.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(issued.token));
  results.push('staff create/submit → supplier approve/ship → staff confirm; stock changes once after receipt');

  const dish = (await collection(staffContext, W + '/dishes')).find(d => d.name === 'Брускетта');
  const secondDish = await api(staffContext, W + '/dishes', 'POST', { name: `Cheese ${suffix}`, active: true, recipe: [{ ingredientId: ingredient.id, quantity: '1.000' }] });
  await staff.goto(url + '/combos');
  await staff.getByRole('button', { name: 'Создать комбо', exact: true }).click();
  await staff.getByLabel('Название', { exact: true }).fill(`Combo ${suffix}`);
  await staff.getByLabel('Блюдо 1 · одна порция').selectOption(dish.id);
  await staff.getByLabel('Блюдо 2 · одна порция').selectOption(secondDish.id);
  await staff.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  const comboCard = staff.locator('article').filter({ has: staff.getByRole('heading', { name: `Combo ${suffix}`, exact: true }) });
  await comboCard.getByRole('button', { name: 'Опубликовать комбо' }).click();
  await visible(comboCard.getByText('Опубликовано', { exact: false }));
  const combo = (await collection(staffContext, W + '/combos')).find(c => c.title === `Combo ${suffix}`);
  await customer.goto(url + '/client/register');
  await customer.getByLabel('Ваше имя').fill(`Live ${suffix}`);
  await customer.getByLabel('Логин', { exact: true }).fill(`live_${suffix}`);
  await customer.getByLabel('Пароль', { exact: true }).fill(password);
  await customer.getByRole('button', { name: 'Создать аккаунт' }).click();
  await visible(customer.getByRole('heading', { name: 'Выберите заведение' }));
  await staff.goto(url + '/menu');
  const publication = await api(staffContext, W + '/customer-publication');
  if (!publication.enabled) await staff.getByRole('button', { name: 'Опубликовать заведение', exact: true }).click();
  const outlet = customer.locator('a[href="/client/outlets/' + warehouse + '/menu"]');
  await outlet.waitFor({ state: 'visible', timeout: 25000 });
  await outlet.click();
  assert.ok(customer.url().endsWith(`/client/outlets/${warehouse}/menu`));
  await customer.getByRole('button', { name: 'Добавить +1', exact: true }).first().click();
  await customer.locator('article').filter({ has: customer.getByRole('heading', { name: `Combo ${suffix}`, exact: true }) }).getByRole('button', { name: 'Добавить комплект' }).click();
  await customer.goto(url + `/client/outlets/${warehouse}/cart`);
  // Fault injection drops only a real response after the server has committed.
  // No request or database result is mocked.
  await customer.evaluate(() => {
    const original = window.fetch.bind(window); let lose = true;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (lose && String(args[0]).endsWith('/orders') && args[1]?.method === 'POST' && response.ok) { lose = false; throw new TypeError('Test: lost committed response'); }
      return response;
    };
  });
  await customer.getByRole('button', { name: 'Оформить заказ' }).click();
  await visible(customer.getByRole('heading', { name: 'Восстановление заказа' }));
  await customerContext.clearCookies({ name: 'rims_csrf' });
  await customer.getByRole('button', { name: 'Повторить прежний запрос' }).click();
  await visible(customer.getByRole('heading', { name: 'Заказ зарегистрирован' }));
  const C = `/api/v2/customer/warehouses/${warehouse}`;
  const orders = await api(customerContext, C + '/orders');
  assert.equal(orders.total, 1);
  const receipt = orders.items[0];
  const detail = await api(customerContext, C + `/orders/${receipt.id}`);
  assert.ok(JSON.stringify(detail.composition).includes(combo.id), 'mixed order preserves combo composition');
  assert.equal((await api(staffContext, W + `/orders/${receipt.id}`)).id, receipt.id);
  const newProfile = await browser.newContext();
  await api(newProfile, '/api/v2/customer/auth/login', 'POST', { username: `live_${suffix}`, password });
  assert.equal((await api(newProfile, C + `/orders/${receipt.id}`)).id, receipt.id);
  await newProfile.close();
  results.push('customer register/menu/order/lost response/replay; one receipt shared with staff and fresh browser profile');
  const batch = (await collection(staffContext, W + '/batches')).find(b => b.deliveryId === shipped.deliveryId);
  const hold = await api(staffContext, W + '/quarantines', 'POST', { batchId: batch.id, expectedBatchVersion: batch.version, quantity: '2.000', reason: 'isolated inspection', note: null }, crypto.randomUUID());
  await staff.goto(url + `/quarantines/${hold.id}`);
  await staff.getByLabel('Количество', { exact: true }).fill('1');
  await staff.getByLabel('Причина освобождения').fill('partial inspection complete');
  await staff.getByRole('button', { name: 'Освободить', exact: true }).click();
  await visible(staff.getByRole('cell', { name: 'partial inspection complete', exact: true }));
  assert.equal((await api(staffContext, W + `/quarantines/${hold.id}`)).remainingHeldQuantity, '1.000');
  await staff.goto(url + '/stop-list');
  await staff.getByRole('tab', { name: 'Прогноз', exact: true }).click();
  await visible(staff.getByRole('heading', { name: 'Прогноз стоп-листа' }));
  await staff.goto(url + '/risk-inventory');
  await visible(staff.getByRole('heading', { name: /Риск/ }).first());
  assert.ok(Array.isArray((await api(staffContext, W + '/stop-list/forecast?historyDays=14&horizonHours=48')).items));
  results.push('combo draft/publish/mixed customer composition; partial quarantine release; live forecast/risk UI');
  // Register the real previous MSW script, then verify live startup removes it
  // across navigation. The worker is never configured to intercept test traffic.
  await staff.evaluate(async () => { await navigator.serviceWorker.register('/mockServiceWorker.js', { scope: '/' }); await navigator.serviceWorker.ready; });
  await staff.reload();
  await staff.getByRole('heading', { name: /Риск/ }).first().waitFor();
  assert.equal(await staff.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).filter(r => [r.active, r.waiting, r.installing].some(w => w?.scriptURL.endsWith('/mockServiceWorker.js'))).length), 0);
  assert.equal(await staff.evaluate(() => navigator.serviceWorker.controller?.scriptURL?.endsWith('/mockServiceWorker.js') ?? false), false);
  results.push('existing actual MSW registration/controller removed on live navigation');
  assert.equal((await staffContext.request.get(url + '/metrics')).status(), 404);
  assert.equal((await staffContext.request.get(url + '/client/assets/missing.js')).status(), 404);
  results.push('gateway keeps metrics private and missing assets return 404');
  const offlineContext = await browser.newContext();
  const offline = await offlineContext.newPage();
  await offline.goto(url + '/client/login');
  await offline.getByLabel('Логин', { exact: true }).fill(`live_${suffix}`);
  await offline.getByLabel('Пароль', { exact: true }).fill(password);
  await offlineContext.setOffline(true);
  await offline.getByRole('button', { name: 'Войти', exact: true }).click();
  await visible(offline.getByRole('alert').filter({ hasText: /Соединение|API|сервер/ }));
  assert.equal(await offline.getByRole('heading', { name: 'Выберите заведение' }).count(), 0);
  await offlineContext.close();
  results.push('offline live login reports failure; no mock success');
  await mkdir(new URL('./.artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('./.artifacts/live-browser.json', import.meta.url), JSON.stringify({ status: 'passed', results, runtime, warehouse, requestId: request.id, deliveryId: shipped.deliveryId, orderId: receipt.id, customer: `live_${suffix}`, comboId: combo.id }, null, 2));
  console.log(JSON.stringify({ status: 'passed', results }, null, 2));
} catch (error) {
  await mkdir(new URL('./.artifacts/', import.meta.url), { recursive: true });
  for (const [name, page] of [['staff', staff], ['supplier', supplier], ['customer', customer]]) {
    await page.screenshot({ path: new URL(`./.artifacts/${name}.png`, import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ''), fullPage: true }).catch(() => {});
    await writeFile(new URL(`./.artifacts/${name}.html`, import.meta.url), await page.content());
  }
  throw error;
} finally { await browser.close(); }
