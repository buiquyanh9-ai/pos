import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { seedIfEmpty } from '../src/seed.ts';

const KEY = 'test-key';
let server: Server;
let base: string;

before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  server = createApp({ db, apiKey: KEY }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  number: 'A-0001',
  deviceId: 'pos-1',
  items: [
    { productId: 'p-cf-den', name: 'Cà phê đen', price: 20000, qty: 2 },
    { productId: 'p-banh-mi', name: 'Bánh mì thịt', price: 25000, qty: 1 },
  ],
  discount: 5000,
  paymentMethod: 'cash',
  paid: 100000,
  createdAt: '2026-11-22T10:00:00.000Z',
  ...extra,
});

test('health is public and reports key status', async () => {
  assert.equal((await call('GET', '/health', undefined, null)).body.auth, 'missing');
  assert.equal((await call('GET', '/health', undefined, 'wrong')).body.auth, 'invalid');
  assert.equal((await call('GET', '/health')).body.auth, 'ok');
});

test('API key is required for other routes', async () => {
  assert.equal((await call('GET', '/products', undefined, null)).status, 401);
  assert.equal((await call('GET', '/products', undefined, 'wrong')).status, 401);
});

test('lists seeded products', async () => {
  const { status, body } = await call('GET', '/products');
  assert.equal(status, 200);
  assert.ok(body.products.length >= 10);
  assert.equal(typeof body.products[0].price, 'number');
});

test('product create / update / soft delete', async () => {
  const c = await call('POST', '/products', { sku: 'T-1', name: 'Test', price: 1000, stock: 5 });
  assert.equal(c.status, 201);
  assert.equal((await call('POST', '/products', { sku: 'T-1', name: 'Dup', price: 1 })).status, 409);
  assert.equal((await call('POST', '/products', { name: 'Bad', price: -1 })).status, 400);
  const u = await call('PUT', `/products/${c.body.id}`, { price: 1500 });
  assert.equal(u.body.price, 1500);
  assert.equal((await call('DELETE', `/products/${c.body.id}`)).status, 204);
  const list = await call('GET', '/products');
  assert.ok(!list.body.products.some((p: { id: string }) => p.id === c.body.id));
});

test('order totals computed by server, stock decremented, upload idempotent', async () => {
  const before = (await call('GET', '/products/p-cf-den')).body.stock;
  const r1 = await call('POST', '/orders', order('o-1'));
  assert.equal(r1.status, 201);
  assert.equal(r1.body.subtotal, 65000);
  assert.equal(r1.body.total, 60000);
  assert.equal(r1.body.change, 40000);
  const r2 = await call('POST', '/orders', order('o-1'));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.duplicate, true);
  assert.equal((await call('GET', '/products/p-cf-den')).body.stock, before - 2);
});

test('order validation', async () => {
  assert.equal((await call('POST', '/orders', order('o-bad1', { paid: 1000 }))).status, 400);
  assert.equal((await call('POST', '/orders', order('o-bad2', { items: [] }))).status, 400);
  assert.equal((await call('POST', '/orders', order('o-bad3', { paymentMethod: 'card', paid: 100000 }))).status, 400);
  assert.equal((await call('POST', '/orders', order('o-bad4', { discount: 999999 }))).status, 400);
  assert.equal((await call('POST', '/orders', order('o-bad5', { items: [{ name: 'x', price: 1.5, qty: 1 }] }))).status, 400);
});

test('void restocks and summary excludes voided orders', async () => {
  await call('POST', '/orders', order('o-2', { createdAt: '2026-11-23T10:00:00.000Z' }));
  const stock = (await call('GET', '/products/p-cf-den')).body.stock;
  const v = await call('POST', '/orders/o-2/void');
  assert.equal(v.body.status, 'voided');
  assert.equal((await call('GET', '/products/p-cf-den')).body.stock, stock + 2);
  const s = await call('GET', '/reports/summary?from=2026-11-23T00:00:00Z&to=2026-11-24T00:00:00Z');
  assert.equal(s.body.orderCount, 0);
  const s2 = await call('GET', '/reports/summary?from=2026-11-22T00:00:00Z&to=2026-11-23T00:00:00Z');
  assert.equal(s2.body.orderCount, 1);
  assert.equal(s2.body.revenue, 60000);
});

test('sync feed pages with cursor and includes snapshots', async () => {
  let cursor = 0;
  let all: { entity: string; id: string; data: unknown }[] = [];
  for (let i = 0; i < 100; i++) {
    const r = await call('GET', `/sync/changes?since=${cursor}&limit=5`);
    all = all.concat(r.body.changes);
    cursor = r.body.cursor;
    if (!r.body.hasMore) break;
  }
  assert.ok(all.some((c) => c.entity === 'order' && c.id === 'o-1' && c.data));
  assert.ok(all.some((c) => c.entity === 'product'));
  const tail = await call('GET', `/sync/changes?since=${cursor}`);
  assert.equal(tail.body.changes.length, 0);
  assert.equal(tail.body.cursor, cursor);
});

test('device heartbeat', async () => {
  await call('POST', '/devices/heartbeat', { id: 'pos-1', name: 'Quầy 1', appVersion: '0.1.0' });
  const d = await call('GET', '/devices');
  assert.equal(d.body.devices[0].name, 'Quầy 1');
});
