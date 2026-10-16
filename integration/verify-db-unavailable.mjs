import assert from 'node:assert/strict';
const api = process.env.RIMS_API_URL || 'http://127.0.0.1:5188';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(api).hostname));
const warehouse = 'eeeeeeee-0000-4000-8000-000000000001';
const ready = await fetch(api + '/health/ready');
assert.equal(ready.status, 503, 'Stop only the isolated test DB before this check');
assert.equal((await fetch(api + '/health/live')).status, 200);
const deadline = Date.now() + 35000;
function sample(text, name) {
  const row = text.split('\n').find(line => line.startsWith(name + '{') && line.includes(`warehouse_id="${warehouse}"`));
  assert.ok(row, `${name} must retain the known warehouse on snapshot failure`);
  return Number(row.split('}')[1].trim());
}
for (;;) {
  const response = await fetch(api + '/metrics');
  assert.equal(response.status, 200);
  const text = await response.text();
  if (sample(text, 'rims_snapshot_success') === 0) {
    assert.ok(sample(text, 'rims_snapshot_timestamp_seconds') > 0, 'last successful timestamp must remain, rather than healthy zero');
    console.log('PASS DB unavailable: readiness503, liveness200, failed snapshot preserves known source/timestamp');
    break;
  }
  assert.ok(Date.now() < deadline, 'Exporter must report snapshot failure');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
