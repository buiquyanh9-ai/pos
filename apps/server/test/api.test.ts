import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { seedIfEmpty } from '../src/seed.ts';
import { resetLoginGuard } from '../src/routes/auth.ts';

let server: Server;
let base: string;
const tokens: Record<string, string> = {};

before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db, { cafeFixture: true });
  server = createApp({ db, apiKey: 'svc-key' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const [who, body] of [
    ['owner', { username: 'chu', password: 'chu123456' }],
    ['cashier', { username: 'thungan', pin: '1111' }],
    ['minh', { username: 'thungan2', pin: '2222' }],
  ] as const) {
    const r = await call('POST', '/auth/login', body, null);
    assert.equal(r.status, 200, `login ${who}`);
    tokens[who] = r.body.token;
  }
});
after(() => server.close());

type Who = 'owner' | 'cashier' | 'minh' | null;
async function call(method: string, path: string, body?: unknown, who: Who = 'owner') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const product = async (id: string) => (await call('GET', `/products/${id}`)).body;
let seq = 0;
const order = (extra: Record<string, unknown> = {}) => ({
  id: `o-${++seq}`,
  number: `T-${seq}`,
  deviceId: 'pos-1',
  items: [{ productId: 'p-cf-sua', name: 'Cà phê sữa', price: 25000, qty: 2 }],
  paymentMethod: 'cash',
  paid: 50000,
  ...extra,
});

// ---------------------------------------------------------------- auth & roles
test('health is public; everything else needs login', async () => {
  assert.equal((await call('GET', '/health', undefined, null)).status, 200);
  assert.equal((await call('GET', '/products', undefined, null)).status, 401);
  const staff = await call('GET', '/auth/staff', undefined, null);
  assert.ok(staff.body.staff.some((s: { username: string }) => s.username === 'thungan'));
  assert.ok(!JSON.stringify(staff.body).includes('hash'));
});

test('wrong PIN is rejected; me returns the user', async () => {
  assert.equal((await call('POST', '/auth/login', { username: 'thungan', pin: '0000' }, null)).status, 401);
  assert.equal((await call('GET', '/auth/me', undefined, 'cashier')).body.user.role, 'cashier');
});

test('roles are enforced', async () => {
  assert.equal((await call('POST', '/products', { name: 'X', price: 1 }, 'cashier')).status, 403);
  assert.equal((await call('GET', '/users', undefined, 'minh')).status, 403);
  // The former stock-staff account is now a cashier: it can sell, not do owner tasks.
  assert.equal((await call('GET', '/auth/me', undefined, 'minh')).body.user.role, 'cashier');
  assert.equal((await call('POST', '/categories', { name: 'X' }, 'minh')).status, 403);
  assert.equal((await call('GET', `/reports/summary?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`, undefined, 'cashier')).status, 400);
  // The inventory module is gone.
  assert.equal((await call('GET', '/inventory/items')).status, 404);
});

test('owner manages staff; cannot demote the last owner', async () => {
  const u = await call('POST', '/users', { username: 'nv2', name: 'NV 2', role: 'cashier', pin: '4321' });
  assert.equal(u.status, 201);
  assert.equal((await call('POST', '/auth/login', { username: 'nv2', pin: '4321' }, null)).status, 200);
  await call('PUT', `/users/${u.body.id}`, { active: false });
  assert.equal((await call('POST', '/auth/login', { username: 'nv2', pin: '4321' }, null)).status, 401);
  assert.equal((await call('PUT', '/users/u-chu', { role: 'cashier' })).status, 400);
});

// ---------------------------------------------------------------- catalog
test('products expose category, options and an optional manual cost; no stock fields', async () => {
  const { body } = await call('GET', '/products', undefined, 'cashier');
  const cf = body.products.find((p: { id: string }) => p.id === 'p-cf-sua');
  assert.equal(cf.category, 'Cà phê');
  assert.ok(cf.optionGroups.some((g: { name: string }) => g.name === 'Size'));
  assert.equal(cf.cost, null);
  assert.ok(!('stock' in cf) && !('recipe' in cf));
  assert.ok(body.categories.length >= 4);
});

test('owner creates a product with a manual cost and can clear it', async () => {
  const p = await call('POST', '/products', { name: 'Bánh flan', price: 15000, category: 'Tráng miệng', cost: 6000 });
  assert.equal(p.status, 201);
  assert.equal(p.body.cost, 6000);
  assert.equal(p.body.category, 'Tráng miệng');
  const q = await call('PUT', `/products/${p.body.id}`, { cost: null });
  assert.equal(q.status, 200);
  assert.equal(q.body.cost, null);
});

test('a product with no cost entered makes the order cost unknown, not 0đ (no fake 100% profit)', async () => {
  const p = await call('POST', '/products', { name: 'Cơm sườn thử', price: 50000, category: 'Cơm' });
  assert.equal((await product(p.body.id)).cost, null);
  const o = await call('POST', '/orders', order({ items: [{ productId: p.body.id, name: 'Cơm sườn thử', price: 50000, qty: 1 }], paid: 50000 }), 'cashier');
  assert.equal(o.status, 201);
  assert.equal(o.body.costTotal, null);
});

test('an order is stored exactly once, even when uploaded twice or concurrently', async () => {
  const o = order();
  const [a, b] = await Promise.all([call('POST', '/orders', o, 'cashier'), call('POST', '/orders', o, 'cashier')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  const again = await call('POST', '/orders', o, 'cashier');
  assert.equal(again.body.duplicate, true);
  const created = a.status === 201 ? a.body : b.body;
  assert.equal(created.cashier, 'Kim');
  assert.equal(created.total, 50000);
  const list = (await call('GET', '/orders?deviceId=pos-1&limit=1000')).body.orders;
  assert.equal(list.filter((x: { id: string }) => x.id === o.id).length, 1);
});

test('order validation', async () => {
  assert.equal((await call('POST', '/orders', order({ paid: 1000 }), 'cashier')).status, 400);
  assert.equal((await call('POST', '/orders', order({ items: [] }), 'cashier')).status, 400);
  assert.equal((await call('POST', '/orders', order({ paymentMethod: 'transfer', paid: 60000 }), 'cashier')).status, 400);
  const qr = await call('POST', '/orders', order({ paymentMethod: 'qr', paid: 50000 }), 'cashier');
  assert.equal(qr.status, 201);
  assert.equal(qr.body.paymentMethod, 'transfer'); // QR is recorded as a bank transfer
  assert.equal((await call('POST', '/orders', order({ orderType: 'boat' }), 'cashier')).status, 400);
  assert.equal((await call('POST', '/orders', order({ discount: 999999 }), 'cashier')).status, 400);
});

test('void and refund need a reason and happen only once; refund records the amount', async () => {
  const o = order({ items: [{ productId: 'p-nuoc-suoi', name: 'Nước suối', price: 10000, qty: 3 }], paid: 30000 });
  await call('POST', '/orders', o, 'cashier');
  assert.equal((await call('POST', `/orders/${o.id}/void`, {}, 'cashier')).status, 400);
  const v = await call('POST', `/orders/${o.id}/void`, { reason: 'Nhập nhầm' }, 'cashier');
  assert.equal(v.body.status, 'voided');
  assert.equal((await call('POST', `/orders/${o.id}/refund`, { reason: 'x' }, 'cashier')).status, 409);

  const o2 = order({ items: [{ productId: 'p-nuoc-suoi', name: 'Nước suối', price: 10000, qty: 1 }], paid: 10000 });
  await call('POST', '/orders', o2, 'cashier');
  const r = await call('POST', `/orders/${o2.id}/refund`, { reason: 'Khách trả' }, 'cashier');
  assert.equal(r.body.status, 'refunded');
  assert.equal(r.body.refundAmount, 10000);
  const n = (await call('GET', '/notifications')).body.notifications;
  assert.ok(n.some((x: { type: string }) => x.type === 'order.voided') && n.some((x: { type: string }) => x.type === 'order.refunded'));
});

test('shift: open, sell cash, close with counted cash, report and notification', async () => {
  const open = await call('POST', '/shifts/open', { deviceId: 'pos-shift', openingCash: 500000 }, 'cashier');
  assert.equal(open.status, 201);
  assert.equal((await call('POST', '/shifts/open', { deviceId: 'pos-shift' }, 'cashier')).status, 409);
  const cur = await call('GET', '/shifts/current?deviceId=pos-shift', undefined, 'cashier');
  assert.equal(cur.body.shift.id, open.body.id);
  await call('POST', '/orders', order({ deviceId: 'pos-shift', shiftId: open.body.id }), 'cashier'); // 50k cash
  await call('POST', '/orders', order({ deviceId: 'pos-shift', shiftId: open.body.id, paymentMethod: 'transfer' }), 'cashier');
  const closed = await call('POST', `/shifts/${open.body.id}/close`, { countedCash: 540000 }, 'cashier');
  assert.equal(closed.status, 200);
  assert.equal(closed.body.shift.expectedCash, 550000);
  assert.equal(closed.body.shift.cashDifference, -10000);
  assert.equal(closed.body.summary.orderCount, 2);
  assert.equal(closed.body.summary.netRevenue, 100000);
  const win = `from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}`;
  const report = await call('GET', `/reports/summary?${win}&shiftId=${open.body.id}`, undefined, 'cashier');
  assert.equal(report.status, 200);
  assert.equal(report.body.orderCount, 2);
  const n = await call('GET', '/notifications');
  assert.ok(n.body.notifications.some((x: { type: string }) => x.type === 'shift.closed'));
});

test('shift belongs to the person: kept open after logout, others on the device open their own', async () => {
  const kim = await call('POST', '/shifts/open', { deviceId: 'pos-share', openingCash: 0 }, 'cashier');
  assert.equal(kim.status, 201);
  // Minh logs in on the same device: no shift for him yet, and he can open his own.
  assert.equal((await call('GET', '/shifts/current?deviceId=pos-share', undefined, 'minh')).body.shift, null);
  const minh = await call('POST', '/shifts/open', { deviceId: 'pos-share', openingCash: 0 }, 'minh');
  assert.equal(minh.status, 201);
  // Kim comes back (even on another device) and gets her own open shift.
  assert.equal((await call('GET', '/shifts/current?deviceId=pos-other', undefined, 'cashier')).body.shift.id, kim.body.id);
  assert.equal((await call('GET', '/shifts/current?deviceId=pos-share', undefined, 'minh')).body.shift.id, minh.body.id);
  for (const [id, who] of [[kim.body.id, 'cashier'], [minh.body.id, 'minh']] as const) {
    assert.equal((await call('POST', `/shifts/${id}/close`, { countedCash: 0 }, who)).status, 200);
  }
});

test('reports: exact time window, hourly buckets, refunds at refund time, voids excluded', async () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 10, h - 7, m)).toISOString(); // local 2026-01-10 h:m (UTC+7)
  const mk = (h: number, m: number, total: number, extra = {}) =>
    order({ createdAt: at(h, m), items: [{ productId: 'p-cf-den', name: 'Cà phê đen', price: total, qty: 1 }], paid: total, ...extra });
  const a = mk(8, 15, 20000);
  const b = mk(9, 45, 40000, { paymentMethod: 'transfer' });
  const c = mk(11, 40, 30000); // outside 08:00-11:30
  const d = mk(10, 0, 50000); // voided
  for (const o of [a, b, c, d]) assert.equal((await call('POST', '/orders', o, 'cashier')).status, 201);
  await call('POST', `/orders/${d.id}/void`, { reason: 'test' }, 'cashier');
  const q = `from=${encodeURIComponent(at(8))}&to=${encodeURIComponent(at(11, 30))}`;
  const s = (await call('GET', `/reports/summary?${q}&deviceId=pos-1`)).body;
  assert.equal(s.orderCount, 2);
  assert.equal(s.netRevenue, 60000);
  assert.equal(s.voidedCount, 1);
  assert.equal(s.byHour[8].revenue, 20000);
  assert.equal(s.byHour[9].revenue, 40000);
  assert.deepEqual(s.byHour[8].byMethod, { cash: 20000 });
  assert.deepEqual(s.byHour[9].byMethod, { transfer: 40000 });
  assert.equal(s.byPayment.find((x: { method: string }) => x.method === 'transfer').revenue, 40000);
  assert.equal(s.byCategory[0].category, 'Cà phê');
  assert.equal(s.grossProfit, null); // no cost entered for these products
  const cmp = (await call('GET', `/reports/summary?${q}&compare=1&deviceId=pos-1`)).body;
  assert.ok('previous' in cmp && 'change' in cmp);
});

test('dashboard, activity and sync feed for Boss', async () => {
  const d = await call('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.ok('today' in d.body && typeof d.body.openShifts === 'number' && !('lowStockCount' in d.body));
  const a = await call('GET', '/activity?limit=5');
  assert.ok(a.body.orders.length > 0);
  const f = await call('GET', '/sync/changes?since=0&limit=1000');
  assert.ok(f.body.changes.some((c: { entity: string }) => c.entity === 'order'));
  assert.equal((await call('GET', '/activity', undefined, 'cashier')).status, 403);
});

test('notification read state and preferences', async () => {
  const list = await call('GET', '/notifications');
  assert.ok(list.body.unread > 0);
  await call('POST', '/notifications/read', { ids: 'all' });
  assert.equal((await call('GET', '/notifications')).body.unread, 0);
  await call('PUT', '/notifications/prefs', { prefs: [{ type: 'order.voided', enabled: false }] });
  const prefs = await call('GET', '/notifications/prefs');
  assert.equal(prefs.body.prefs.find((p: { type: string }) => p.type === 'order.voided').enabled, false);
  assert.ok(!prefs.body.prefs.some((p: { type: string }) => p.type.startsWith('stock.') || p.type.startsWith('purchase.')));
  assert.ok(!(await call('GET', '/notifications')).body.notifications.some((x: { type: string }) => x.type === 'order.voided'));
  await call('PUT', '/notifications/prefs', { prefs: [{ type: 'order.voided', enabled: true }] });
});

test('SSE stream delivers order.created', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events?token=${tokens.owner}`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  await call('POST', '/orders', order(), 'cashier');
  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('event: order.created') && Date.now() < deadline) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  ctrl.abort();
  assert.ok(text.includes('event: order.created'));
});

test('service API key acts as owner', async () => {
  const res = await fetch(`${base}/users`, { headers: { 'x-api-key': 'svc-key' } });
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------- end-to-end flow (POS -> server -> Boss)
test('E2E: POS shift and sale -> Boss revenue -> refund lowers revenue -> shift close report and notification', async () => {
  const dashBefore = (await call('GET', '/dashboard')).body.today;

  // 1. Cashier opens a shift and sells 2 bánh mì (cash) and 1 coffee (transfer) on the POS.
  const shift = (await call('POST', '/shifts/open', { deviceId: 'pos-e2e', openingCash: 100000 }, 'cashier')).body;
  const cash = order({ deviceId: 'pos-e2e', shiftId: shift.id, items: [{ productId: 'p-banh-mi', name: 'Bánh mì thịt', price: 25000, qty: 2 }], paid: 100000 });
  const transfer = order({ deviceId: 'pos-e2e', shiftId: shift.id, paymentMethod: 'transfer', items: [{ productId: 'p-cf-den', name: 'Cà phê đen', price: 20000, qty: 1 }], paid: 20000 });
  assert.equal((await call('POST', '/orders', cash, 'cashier')).body.change, 50000);
  assert.equal((await call('POST', '/orders', transfer, 'cashier')).status, 201);

  // 2. Boss dashboard shows the new revenue and orders.
  const dashAfter = (await call('GET', '/dashboard')).body.today;
  assert.equal(dashAfter.netRevenue - dashBefore.netRevenue, 70000);
  assert.equal(dashAfter.orderCount - dashBefore.orderCount, 2);

  // 3. A refund lowers today's net revenue at refund time and notifies the owner.
  await call('POST', `/orders/${transfer.id}/refund`, { reason: 'Khách đổi ý', shiftId: shift.id }, 'cashier');
  assert.equal((await call('GET', '/dashboard')).body.today.netRevenue - dashBefore.netRevenue, 50000);

  // 4. Shift close: expected cash = opening + cash sales; report and notification for the owner.
  const closed = (await call('POST', `/shifts/${shift.id}/close`, { countedCash: 150000 }, 'cashier')).body;
  assert.equal(closed.shift.expectedCash, 150000);
  assert.equal(closed.shift.cashDifference, 0);
  assert.ok(!('stocktakes' in closed));
  const notes = (await call('GET', '/notifications')).body.notifications;
  assert.ok(notes.some((n: { type: string; data: { shiftId?: string } }) => n.type === 'shift.closed' && n.data?.shiftId === shift.id));
});

test('options are stored on the line with their names; bad option ids are rejected', async () => {
  const o = order({
    items: [{ productId: 'p-tra-sua', name: 'Trà sữa trân châu', price: 43000, qty: 2, options: 'L, Thêm trân châu', optionIds: ['g-size-1', 'g-topping-0', 'removed-option'] }],
    paid: 86000,
  });
  const r = await call('POST', '/orders', o, 'cashier');
  assert.equal(r.status, 201);
  assert.equal(r.body.items[0].options, 'L, Thêm trân châu');
  assert.equal(r.body.total, 86000);
  const g = (await call('GET', '/option-groups')).body.optionGroups.find((x: { id: string }) => x.id === 'g-topping');
  assert.equal(g.options[0].priceDelta, 5000);
  assert.ok(!('recipe' in g.options[0]));
  assert.equal((await call('POST', '/orders', order({ items: [{ productId: 'p-tra-sua', name: 'x', price: 1, qty: 1, optionIds: 'bad' }], paid: 1 }), 'cashier')).status, 400);
});

test('open orders: one per table, optimistic locking, visible on dashboard, delete when paid', async () => {
  const cart = { lines: [{ key: 'p-cf-den::', productId: 'p-cf-den', name: 'Cà phê đen', price: 20000, qty: 2, note: '', options: [] }], discount: 0 };
  const a = await call('PUT', '/open-orders/oo-1', { deviceId: 'pos-1', tableName: 'Bàn 3', orderType: 'dine_in', cart, itemCount: 2, total: 40000 }, 'cashier');
  assert.equal(a.status, 200);
  assert.equal(a.body.version, 1);
  assert.equal((await call('PUT', '/open-orders/oo-2', { deviceId: 'pos-2', tableName: 'Bàn 3', cart, total: 1 }, 'cashier')).status, 409);
  const b = await call('PUT', '/open-orders/oo-1', { deviceId: 'pos-2', tableName: 'Bàn 3', cart, itemCount: 3, total: 60000, version: 1 }, 'cashier');
  assert.equal(b.body.version, 2);
  assert.equal((await call('PUT', '/open-orders/oo-1', { deviceId: 'pos-1', tableName: 'Bàn 3', cart, total: 1, version: 1 }, 'cashier')).status, 409);
  const d = await call('GET', '/dashboard');
  assert.equal(d.body.openOrders.total, 60000);
  assert.equal((await call('GET', '/open-orders')).body.openOrders[0].cart.lines[0].qty, 2);
  // Move the bill to another table; moving onto an occupied table is refused.
  await call('PUT', '/open-orders/oo-9', { deviceId: 'pos-1', tableName: 'Bàn 4', cart, total: 1 }, 'cashier');
  assert.equal((await call('PUT', '/open-orders/oo-1', { deviceId: 'pos-1', tableName: 'Bàn 4', cart, total: 1, version: 2 }, 'cashier')).status, 409);
  assert.equal((await call('PUT', '/open-orders/oo-1', { deviceId: 'pos-1', tableName: 'Bàn 5', cart, total: 60000, version: 2 }, 'cashier')).body.tableName, 'Bàn 5');
  await call('DELETE', '/open-orders/oo-9', {}, 'cashier');
  assert.equal((await call('DELETE', '/open-orders/oo-1', {}, 'cashier')).status, 204);
  assert.equal((await call('GET', '/open-orders')).body.openOrders.length, 0);
});

test('repeated wrong PINs lock the account for a while', async () => {
  resetLoginGuard();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { username: 'thungan2', pin: '0000' }, null)).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'thungan2', pin: '2222' }, null)).status, 429);
  resetLoginGuard();
  assert.equal((await call('POST', '/auth/login', { username: 'thungan2', pin: '2222' }, null)).status, 200);
});

test('orders can be filtered by payment method', async () => {
  const cash = (await call('GET', '/orders?paymentMethod=cash&limit=1000')).body.orders;
  assert.ok(cash.length > 0 && cash.every((o: { paymentMethod: string }) => o.paymentMethod === 'cash'));
  const tr = (await call('GET', '/orders?paymentMethod=transfer&limit=1000')).body.orders;
  assert.ok(tr.every((o: { paymentMethod: string }) => o.paymentMethod === 'transfer'));
});

test('cash in/out changes expected cash; store settings shared', async () => {
  const s = (await call('POST', '/shifts/open', { deviceId: 'pos-cash', openingCash: 200000 }, 'cashier')).body;
  assert.equal((await call('POST', `/shifts/${s.id}/cash`, { type: 'out', amount: 50000 }, 'cashier')).status, 400);
  await call('POST', `/shifts/${s.id}/cash`, { type: 'out', amount: 50000, reason: 'Trả tiền đá' }, 'cashier');
  await call('POST', `/shifts/${s.id}/cash`, { type: 'in', amount: 100000, reason: 'Nộp tiền lẻ' }, 'cashier');
  assert.equal((await call('GET', `/shifts/${s.id}/cash`)).body.moves.length, 2);
  const closed = (await call('POST', `/shifts/${s.id}/close`, { countedCash: 250000 }, 'cashier')).body;
  assert.equal(closed.shift.expectedCash, 250000);
  assert.equal(closed.shift.cashDifference, 0);
  assert.equal((await call('PUT', '/store', { bank_bin: '970436', bank_account: '0123456789', bank_holder: 'NGUYEN VAN A' }, 'cashier')).status, 403);
  assert.equal((await call('PUT', '/store', { bank_bin: '12' })).status, 400);
  await call('PUT', '/store', { bank_bin: '970436', bank_account: '0123456789', bank_holder: 'NGUYEN VAN A', bank_name: 'Vietcombank' });
  assert.equal((await call('GET', '/store', undefined, 'cashier')).body.bank_account, '0123456789');
});
