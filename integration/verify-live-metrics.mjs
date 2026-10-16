import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

// GET-only business checks; authentication creates only a temporary staff session.
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { request } = require('playwright');
const gateway = process.env.RIMS_LIVE_URL || 'http://127.0.0.1:4180';
const dockerProject = process.env.RIMS_DOCKER_PROJECT;
if (dockerProject) assert.match(dockerProject, /^rims-integration-[a-z0-9-]+$/, 'Only an explicitly isolated integration project is permitted');
const url = process.env.RIMS_METRICS_URL || (dockerProject ? gateway : 'http://127.0.0.1:5188');
const dockerArgs = [...(process.platform === 'win32' ? ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine'] : []), 'compose', '-p', dockerProject || '', '--env-file', process.env.RIMS_LIVE_ENV_FILE || 'scripts/live.env', '-f', 'scripts/compose.live.yml'];
async function dockerExec(service, args) { return (await promisify(execFile)('docker', [...dockerArgs, 'exec', '-T', service, ...args], { windowsHide: true })).stdout; }
const warehouse = process.env.RIMS_LIVE_WAREHOUSE || 'eeeeeeee-0000-4000-8000-000000000001';
for (const address of [url, gateway]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(address).hostname), 'Only an isolated loopback stack is allowed');
assert.match(warehouse, /^[a-f0-9-]{36}$/i);
const password = process.env.RIMS_LIVE_PASSWORD;
assert.ok(password, 'Set RIMS_LIVE_PASSWORD for the isolated demo-owner');
const context = await request.newContext({ baseURL: url });
const W = `/api/v2/warehouses/${warehouse}`;
async function get(path) {
  const response = await context.get(path);
  assert.equal(response.status(), 200, `GET ${path}`);
  return (await response.json()).data;
}
async function collection(path) {
  const items = [];
  for (let page = 1; ; page++) {
    const data = await get(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    items.push(...data.items);
    if (items.length >= data.total) return items;
    assert.ok(data.items.length, 'Pagination must advance');
  }
}
function sample(text, name, expectedLabels, required = true) {
  for (const line of text.split('\n')) {
    const match = line.match(/^([^ {]+)\{(.*)\}\s+([^ ]+)$/);
    if (!match || match[1] !== name) continue;
    const labels = Object.fromEntries([...match[2].matchAll(/([a-z_]+)="((?:\\.|[^"\\])*)"/g)].map(m => [m[1], m[2]]));
    if (Object.entries(expectedLabels).every(([key, value]) => labels[key] === value)) return Number(match[3]);
  }
  if (required) assert.fail(`Missing live metric ${name} ${JSON.stringify(expectedLabels)}`);
  return null;
}
try {
  const csrf = await get('/api/v2/auth/csrf');
  const login = await context.post('/api/v2/auth/login', { data: { username: process.env.RIMS_LIVE_USERNAME || 'demo-owner', password }, headers: { Origin: gateway, 'X-CSRF-TOKEN': csrf.requestToken } });
  assert.equal(login.status(), 200, 'Isolated staff login');
  const runtime = await get('/api/v2/runtime');
  assert.equal(runtime.sourceKind, 'server');
  assert.equal(runtime.contractVersion, '2.1.0');
  const [inventory, batches, menu, deliveries, offers, orders] = await Promise.all([
    collection(W + '/inventory'), collection(W + '/batches?includeEmpty=true'), collection(W + '/menu/availability'),
    collection(W + '/deliveries'), collection(W + '/recommendations'), collection(W + '/orders'),
  ]);
  // Direct PostgreSQL read verifies that these are the browser warehouse's persisted batches.
  const psql = process.env.RIMS_PSQL || (process.platform === 'win32' ? 'C:/msys64/ucrt64/bin/psql.exe' : 'psql');
  const database = process.env.RIMS_METRICS_DATABASE || 'flagman_browser_test';
  assert.ok(dockerProject || database.includes('test'), 'Only an explicit test database/project is allowed');
  const sql = `SELECT ingredient_id::text,unit,count(*),sum(remaining_quantity),sum(held_quantity) FROM batches WHERE warehouse_id='${warehouse}'::uuid GROUP BY ingredient_id,unit ORDER BY ingredient_id,unit;`;
  const stdout = dockerProject
    ? await dockerExec('db', ['psql', '-U', 'rims', '-d', 'rims', '--tuples-only', '--no-align', '--command', sql])
    : (await promisify(execFile)(psql, ['--host', '127.0.0.1', '--port', process.env.RIMS_POSTGRES_PORT || '55440', '--username', 'rims_test', '--dbname', database, '--tuples-only', '--no-align', '--command', sql])).stdout;
  const dbStock = stdout.trim() ? stdout.trim().split(/\r?\n/).map(line => {
    const [ingredientId, unit, count, physical, held] = line.split('|');
    return { ingredientId, unit, batches: Number(count), physical, held };
  }) : [];
  const dbBatches = dbStock.reduce((count, row) => count + row.batches, 0);
  const scaled = value => { const [whole, fraction = ''] = String(value).split('.'); return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0')); };
  assert.equal(dbBatches, batches.length);
  for (const row of inventory) {
    const stored = dbStock.find(stock => stock.ingredientId === row.ingredientId && stock.unit === row.unit);
    assert.equal(scaled(stored?.physical || '0'), scaled(row.physicalQuantity), `${row.ingredientId}/${row.unit} physical`);
    assert.equal(scaled(stored?.held || '0'), scaled(row.heldQuantity), `${row.ingredientId}/${row.unit} held`);
  }
  assert.ok(dbStock.every(stock => inventory.some(row => row.ingredientId === stock.ingredientId && row.unit === stock.unit)), 'Every SQL stock group must be represented by API');

  // Require the exporter to finish a normal snapshot after all API/SQL reads.
  // This avoids accepting an otherwise fresh snapshot from before the browser's commits.
  const checkpoint = await context.get('/api/v2/runtime');
  assert.equal(checkpoint.status(), 200);
  const checkpointSeconds = Date.parse((await checkpoint.json()).meta.serverTime) / 1000;
  assert.ok(Number.isFinite(checkpointSeconds), 'Server snapshot checkpoint must be a UTC timestamp');
  const deadline = Date.now() + 30000;
  let metrics;
  let snapshotSeconds;
  for (;;) {
    if (dockerProject) metrics = await dockerExec('frontend', ['wget', '-q', '-O', '-', 'http://backend:8080/metrics']);
    else {
      const response = await context.get('/metrics');
      assert.equal(response.status(), 200);
      metrics = await response.text();
    }
    snapshotSeconds = sample(metrics, 'rims_snapshot_timestamp_seconds', { warehouse_id: warehouse }, false);
    const age = Date.now() / 1000 - snapshotSeconds;
    if (snapshotSeconds !== null && snapshotSeconds >= checkpointSeconds && age <= 20 && sample(metrics, 'rims_snapshot_success', { warehouse_id: warehouse }, false) === 1) break;
    if (Date.now() >= deadline) assert.fail(`No successful live snapshot after server checkpoint ${checkpointSeconds}; last snapshot ${snapshotSeconds}`);
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
  }
  assert.equal(sample(metrics, 'rims_source_info', { source_kind: 'live' }), 1);
  assert.ok(!metrics.includes('source_kind="mock"'));
  const labels = { warehouse_id: warehouse };
  const checks = [];
  function equal(name, value, extra = {}) { assert.equal(sample(metrics, name, { ...labels, ...extra }), value, name + JSON.stringify(extra)); checks.push({ metric: name, labels: extra, value }); }
  equal('rims_snapshot_success', 1);
  equal('rims_inventory_low_stock_ingredients', inventory.filter(i => i.isLowStock).length);
  equal('rims_inventory_out_of_stock_ingredients', inventory.filter(i => Number(i.availableQuantity) === 0).length);
  for (const state of ['fresh', 'expiring', 'expired', 'empty']) equal('rims_inventory_batches', batches.filter(b => b.status === state).length, { state });
  for (const state of ['available', 'stopped', 'inactive']) equal('rims_menu_dishes', menu.filter(d => d.status === state).length, { state });
  equal('rims_deliveries_pending', deliveries.filter(d => d.status === 'pending').length);
  equal('rims_hot_offers', offers.length);
  for (const source of ['staff', 'waiter', 'customer', 'integration']) equal('rims_orders_total', orders.filter(o => o.source === source).length, { source, result: 'accepted' });
  const publicMetrics = await fetch(gateway + '/metrics');
  assert.equal(publicMetrics.status, 404, 'Gateway must keep metrics internal');
  await mkdir(new URL('.artifacts/', import.meta.url), { recursive: true });
  await writeFile(process.env.RIMS_METRICS_EVIDENCE || new URL(dockerProject ? '.artifacts/live-metrics-container.json' : '.artifacts/live-metrics.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), warehouse, dockerProject, backendInstanceId: runtime.backendInstanceId, checkpointSeconds, snapshotSeconds, postgres: { database: dockerProject ? 'rims' : database, batches: dbBatches, stockByIngredientUnit: dbStock }, checks, gatewayMetricsStatus: publicMetrics.status }, null, 2));
  console.log(`PASS: ${checks.length} live metrics agree with real API; PostgreSQL ${dbBatches} persisted batches; gateway /metrics=404`);
} finally { await context.dispose(); }
