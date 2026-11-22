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
  seedIfEmpty(db);
  server = createApp({ db, apiKey: 'svc-key' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  for (const [who, body] of [
    ['owner', { username: 'chu', password: 'chu123456' }],
    ['cashier', { username: 'thungan', pin: '1111' }],
    ['stock', { username: 'kho', pin: '2222' }],
  ] as const) {
    const r = await call('POST', '/auth/login', body, null);
    assert.equal(r.status, 200, `login ${who}`);
    tokens[who] = r.body.token;
  }
});
after(() => server.close());

type Who = 'owner' | 'cashier' | 'stock' | null;
async function call(method: string, path: string, body?: unknown, who: Who = 'owner') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const item = async (id: string) => (await call('GET', `/inventory/items/${id}`)).body;
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
  assert.equal((await call('GET', '/users', undefined, 'stock')).status, 403);
  assert.equal((await call('POST', '/orders', order(), 'stock')).status, 403);
  assert.equal((await call('GET', `/reports/summary?from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`, undefined, 'cashier')).status, 400);
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
test('products expose category, options, recipe, cost and BOM availability', async () => {
  const { body } = await call('GET', '/products', undefined, 'cashier');
  const cf = body.products.find((p: { id: string }) => p.id === 'p-cf-sua');
  assert.equal(cf.category, 'Cà phê');
  assert.ok(cf.optionGroups.some((g: { name: string }) => g.name === 'Size'));
  assert.ok(cf.recipe.length >= 3);
  assert.ok(cf.cost > 0 && cf.cost < cf.price);
  assert.equal(typeof cf.stock, 'number');
  assert.ok(body.categories.length >= 4);
});

test('owner creates a product with a recipe; untracked products report stock null', async () => {
  const p = await call('POST', '/products', { name: 'Bánh flan', price: 15000, category: 'Tráng miệng', cost: 6000 });
  assert.equal(p.status, 201);
  assert.equal(p.body.stock, null);
  assert.equal(p.body.cost, 6000);
  assert.equal(p.body.category, 'Tráng miệng');
  const q = await call('PUT', `/products/${p.body.id}`, { recipe: [{ itemId: 'i-sua-tuoi', qty: 0.1 }] });
  assert.equal(q.status, 200);
  assert.equal(typeof q.body.stock, 'number');
  assert.equal((await call('PUT', `/products/${p.body.id}`, { recipe: [{ itemId: 'nope', qty: 1 }] })).status, 400);
});

// ---------------------------------------------------------------- sales & stock
test('a sale deducts recipe stock exactly once, even when uploaded twice or concurrently', async () => {
  const before = await item('i-sua-dac');
  const o = order();
  const [a, b] = await Promise.all([call('POST', '/orders', o, 'cashier'), call('POST', '/orders', o, 'cashier')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  const again = await call('POST', '/orders', o, 'cashier');
  assert.equal(again.body.duplicate, true);
  const after = await item('i-sua-dac');
  assert.equal(Math.round((before.qty - after.qty) * 1000) / 1000, 0.06); // 2 x 0.03 kg
  const created = a.status === 201 ? a.body : b.body;
  assert.equal(created.cashier, 'Kim');
  assert.ok(created.costTotal > 0);
  const moves = await call('GET', `/inventory/moves?itemId=i-sua-dac&type=sale`);
  assert.equal(moves.body.moves.filter((m: { refId: string }) => m.refId === o.id).length, 1);
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

test('void restocks; refund keeps stock unless restock=true; both need a reason and only once', async () => {
  const o = order({ items: [{ productId: 'p-nuoc-suoi', name: 'Nước suối', price: 10000, qty: 3 }], paid: 30000 });
  const before = (await item('i-nuoc-suoi')).qty;
  await call('POST', '/orders', o, 'cashier');
  assert.equal((await item('i-nuoc-suoi')).qty, before - 3);
  assert.equal((await call('POST', `/orders/${o.id}/void`, {}, 'cashier')).status, 400);
  const v = await call('POST', `/orders/${o.id}/void`, { reason: 'Nhập nhầm' }, 'cashier');
  assert.equal(v.body.status, 'voided');
  assert.equal((await item('i-nuoc-suoi')).qty, before);
  assert.equal((await call('POST', `/orders/${o.id}/refund`, { reason: 'x' }, 'cashier')).status, 409);

  const o2 = order({ items: [{ productId: 'p-nuoc-suoi', name: 'Nước suối', price: 10000, qty: 1 }], paid: 10000 });
  await call('POST', '/orders', o2, 'cashier');
  const r = await call('POST', `/orders/${o2.id}/refund`, { reason: 'Khách trả' }, 'cashier');
  assert.equal(r.body.status, 'refunded');
  assert.equal(r.body.refundAmount, 10000);
  assert.equal((await item('i-nuoc-suoi')).qty, before - 1); // not restocked
});

test('crossing below minimum creates one stock.low notification', async () => {
  const it = await item('i-coca'); // min 12
  const toSell = Math.ceil(it.qty - it.minQty) + 1;
  await call('POST', '/orders', order({ items: [{ productId: 'p-coca', name: 'Coca', price: 15000, qty: toSell }], paid: 15000 * toSell }), 'cashier');
  await call('POST', '/orders', order({ items: [{ productId: 'p-coca', name: 'Coca', price: 15000, qty: 1 }], paid: 15000 }), 'cashier');
  const n = await call('GET', '/notifications');
  assert.equal(n.body.notifications.filter((x: { type: string; data: { itemId: string } }) => x.type === 'stock.low' && x.data.itemId === 'i-coca').length, 1);
  const low = await call('GET', '/inventory/items?low=1', undefined, 'stock');
  assert.ok(low.body.items.some((i: { id: string }) => i.id === 'i-coca'));
  assert.equal((await product('p-coca')).stock, Math.max(0, Math.floor((await item('i-coca')).qty)));
});

// ---------------------------------------------------------------- shifts & stocktake
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

test('stocktake records variance, adjusts stock, requires a reason and notifies', async () => {
  const it = await item('i-duong');
  assert.equal((await call('POST', '/inventory/stocktakes', { lines: [{ itemId: 'i-duong', counted: it.qty - 0.5 }] }, 'stock')).status, 400);
  const st = await call('POST', '/inventory/stocktakes', { lines: [{ itemId: 'i-duong', counted: it.qty - 0.5, reason: 'Rơi vãi' }, { itemId: 'i-da', counted: (await item('i-da')).qty }] }, 'stock');
  assert.equal(st.status, 201);
  assert.equal(st.body.varianceCount, 1);
  assert.equal(st.body.lines[0].diff, -0.5);
  assert.equal((await item('i-duong')).qty, Math.round((it.qty - 0.5) * 1000) / 1000);
  const n = await call('GET', '/notifications');
  assert.ok(n.body.notifications.some((x: { type: string }) => x.type === 'stock.variance'));
});

// ---------------------------------------------------------------- purchasing
test('purchase: stock proposes, owner approves, stock receives, quantity and cost update', async () => {
  const before = await item('i-tra-den');
  const p = await call('POST', '/purchases', { supplierId: 's-sua', lines: [{ itemId: 'i-tra-den', qty: 2, unitCost: 190000 }] }, 'stock');
  assert.equal(p.body.status, 'pending');
  assert.equal((await call('POST', `/purchases/${p.body.id}/receive`, {}, 'stock')).status, 409);
  assert.equal((await call('POST', `/purchases/${p.body.id}/approve`, {}, 'stock')).status, 403);
  assert.equal((await call('POST', `/purchases/${p.body.id}/approve`, { note: 'OK' })).body.status, 'approved');
  const rec = await call('POST', `/purchases/${p.body.id}/receive`, { lines: [{ itemId: 'i-tra-den', receivedQty: 1.8 }] }, 'stock');
  assert.equal(rec.body.status, 'received');
  const after = await item('i-tra-den');
  assert.equal(Math.round((after.qty - before.qty) * 1000) / 1000, 1.8);
  assert.equal(after.unitCost, 190000);
  const sug = await call('GET', '/purchases/suggestions', undefined, 'stock');
  assert.ok(Array.isArray(sug.body.lines));
});

// ---------------------------------------------------------------- reports
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
  assert.equal(s.byPayment.find((x: { method: string }) => x.method === 'transfer').revenue, 40000);
  assert.equal(s.byCategory[0].category, 'Cà phê');
  assert.ok(s.hasCostData);
  assert.equal(s.grossProfit, s.netRevenue - s.costOfGoods);
  const cmp = (await call('GET', `/reports/summary?${q}&compare=1&deviceId=pos-1`)).body;
  assert.ok('previous' in cmp && 'change' in cmp);
});

test('dashboard, activity and sync feed for Boss', async () => {
  const d = await call('GET', '/dashboard');
  assert.equal(d.status, 200);
  assert.ok('today' in d.body && typeof d.body.lowStockCount === 'number');
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
  await call('PUT', '/notifications/prefs', { prefs: [{ type: 'stock.low', enabled: false }] });
  const prefs = await call('GET', '/notifications/prefs');
  assert.equal(prefs.body.prefs.find((p: { type: string }) => p.type === 'stock.low').enabled, false);
  assert.ok(!(await call('GET', '/notifications')).body.notifications.some((x: { type: string }) => x.type === 'stock.low'));
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

// ---------------------------------------------------------------- CLAUDE.md §4: the mandatory end-to-end flow
test('E2E: POS sale -> stock -> Boss revenue -> low-stock alert -> stocktake -> purchase approve/receive -> stock on both apps', async () => {
  await call('PUT', '/notifications/prefs', { prefs: [{ type: 'stock.low', enabled: true }] }); // an earlier test turned it off
  // Make "Bánh mì ổ" the bottleneck: leave just above its minimum (15).
  const start = await item('i-banh-mi');
  await call('POST', '/inventory/items/i-banh-mi/adjust', { qty: 16, reason: 'E2E setup' }, 'stock');
  const dashBefore = (await call('GET', '/dashboard')).body.today;

  // 1. Cashier opens a shift and sells 2 bánh mì on the POS.
  const shift = (await call('POST', '/shifts/open', { deviceId: 'pos-e2e', openingCash: 0 }, 'cashier')).body;
  const sale = order({ deviceId: 'pos-e2e', shiftId: shift.id, items: [{ productId: 'p-banh-mi', name: 'Bánh mì thịt', price: 25000, qty: 2 }], paid: 50000 });
  assert.equal((await call('POST', '/orders', sale, 'cashier')).status, 201);

  // 2. Backend stored it and deducted stock (16 - 2 = 14, below min 15).
  assert.equal((await item('i-banh-mi')).qty, 14);

  // 3. Boss dashboard shows the new revenue and order.
  const dashAfter = (await call('GET', '/dashboard')).body.today;
  assert.equal(dashAfter.netRevenue - dashBefore.netRevenue, 50000);
  assert.equal(dashAfter.orderCount - dashBefore.orderCount, 1);

  // 4. Low-stock alert was raised for the owner.
  const notes = (await call('GET', '/notifications')).body.notifications;
  assert.ok(notes.some((n: { type: string; data: { itemId?: string } }) => n.type === 'stock.low' && n.data?.itemId === 'i-banh-mi'));

  // 5. End of shift: staff counts 13 (1 missing) and records the variance.
  const st = await call('POST', '/inventory/stocktakes', { shiftId: shift.id, lines: [{ itemId: 'i-banh-mi', counted: 13, reason: 'Hỏng 1 ổ' }] }, 'stock');
  assert.equal(st.body.lines[0].diff, -1);
  await call('POST', `/shifts/${shift.id}/close`, { countedCash: 50000 }, 'cashier');
  const report = (await call('GET', `/shifts/${shift.id}/report`)).body;
  assert.equal(report.shift.cashDifference, 0);
  assert.equal(report.stocktakes.length, 1);

  // 6. Owner reviews and the stock clerk proposes a purchase; owner approves on the phone.
  const sug = (await call('GET', '/purchases/suggestions', undefined, 'stock')).body.lines.find((l: { itemId: string }) => l.itemId === 'i-banh-mi');
  assert.ok(sug && sug.qty > 0);
  const pr = (await call('POST', '/purchases', { lines: [{ itemId: 'i-banh-mi', qty: sug.qty }] }, 'stock')).body;
  assert.equal(pr.status, 'pending');
  assert.equal((await call('POST', `/purchases/${pr.id}/approve`, {})).body.status, 'approved');

  // 7. Goods received -> stock updated, visible to POS (product availability) and Boss (inventory).
  await call('POST', `/purchases/${pr.id}/receive`, {}, 'stock');
  const after = await item('i-banh-mi');
  assert.equal(after.qty, 13 + sug.qty);
  assert.equal(after.low, false);
  assert.ok((await product('p-banh-mi')).stock >= 13 + sug.qty - 1);
  // History shows every step.
  const types = (await call('GET', '/inventory/moves?itemId=i-banh-mi')).body.moves.map((m: { type: string }) => m.type);
  for (const t of ['adjust', 'sale', 'count', 'import']) assert.ok(types.includes(t), `missing ${t}`);
  void start;
});

test('options scale the recipe (size L) and add their own stock (topping); void returns exactly that', async () => {
  const tea0 = (await item('i-tra-den')).qty;
  const pearl0 = (await item('i-tran-chau')).qty;
  const o = order({
    items: [{ productId: 'p-tra-sua', name: 'Trà sữa trân châu', price: 43000, qty: 2, options: 'L, Thêm trân châu', optionIds: ['g-size-1', 'g-topping-0'] }],
    paid: 86000,
  });
  const r = await call('POST', '/orders', o, 'cashier');
  assert.equal(r.status, 201);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  // tea: 0.006 x 1.4 x 2 = 0.0168 ; pearls: (0.05 x 1.4 + 0.03) x 2 = 0.2
  assert.equal(round(tea0 - (await item('i-tra-den')).qty), round(0.0168));
  assert.equal(round(pearl0 - (await item('i-tran-chau')).qty), 0.2);
  assert.ok(r.body.costTotal > 0);
  await call('POST', `/orders/${o.id}/void`, { reason: 'test' }, 'cashier');
  assert.equal(round((await item('i-tran-chau')).qty), round(pearl0));
  const g = (await call('GET', '/option-groups')).body.optionGroups.find((x: { id: string }) => x.id === 'g-topping');
  assert.equal(g.options[0].recipe[0].itemId, 'i-tran-chau');
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
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { username: 'kho', pin: '0000' }, null)).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'kho', pin: '2222' }, null)).status, 429);
  resetLoginGuard();
  assert.equal((await call('POST', '/auth/login', { username: 'kho', pin: '2222' }, null)).status, 200);
});

test('orders can be filtered by payment method', async () => {
  const cash = (await call('GET', '/orders?paymentMethod=cash&limit=1000')).body.orders;
  assert.ok(cash.length > 0 && cash.every((o: { paymentMethod: string }) => o.paymentMethod === 'cash'));
  const tr = (await call('GET', '/orders?paymentMethod=transfer&limit=1000')).body.orders;
  assert.ok(tr.every((o: { paymentMethod: string }) => o.paymentMethod === 'transfer'));
});
