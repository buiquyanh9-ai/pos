import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, type DB } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { seedIfEmpty } from '../src/seed.ts';
import { importMenu, parseMenu } from '../src/menu.ts';

const MD = [
  '# CẤU HÌNH MENU',
  '## 1. Quy định chung',
  '- Menu gồm 3 mục',
  '## 2. Mục Đồ ăn',
  '**Hàng 1 – Cơm trắng (50.000đ/món)**',
  '1. Cơm trắng sườn',
  '2. Cơm trắng gà',
  '**Hàng 2 – Món thêm**',
  '1. Rau thêm – 10.000đ',
  '2. Slot trống',
  '3. Gà thêm – 40.000đ',
  '## 3. Mục Đồ uống (cứ tính đơn vị là chai- trừ trà đá)',
  '**Hàng 1**',
  '1. Coca-Cola – 10.000đ',
  '2. Trà đá – 5.000đ',
  '## 4. Mục Mang về',
  '**Hàng 1 – Cơm trắng mang về (55.000đ)**',
  '1. Cơm trắng sườn mang về',
  '## 5. Quản lý tồn kho',
  '1. Không phải món',
].join('\n');

let db: DB;
let server: Server;
let base: string;
let token: string;

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db);
  importMenu(db, MD, { sampleStock: true });
  server = createApp({ db }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'thungan', pin: '1111' }),
  });
  token = (await login.json()).token;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}
const qty = async (id: string) => (await call('GET', `/inventory/items/${id}`)).body.qty as number;

test('parses categories, rows of 5, row prices, own prices, empty slots; ignores non-menu sections', () => {
  const m = parseMenu(MD);
  assert.deepEqual(m.categories, ['Đồ ăn', 'Đồ uống', 'Mang về']);
  const by = (n: string) => m.products.find((p) => p.name === n)!;
  assert.deepEqual([by('Cơm trắng gà').row, by('Cơm trắng gà').col, by('Cơm trắng gà').price], [0, 1, 50000]);
  assert.deepEqual([by('Gà thêm').row, by('Gà thêm').col, by('Gà thêm').price], [1, 2, 40000]);
  assert.equal(by('Cơm trắng sườn mang về').price, 55000);
  assert.equal(by('Cơm trắng sườn mang về').image, 'com-trang-suon');
  assert.equal(m.products.length, 7);
});

test('import: menu replaces old products, tables 001-024, layout in product DTO', async () => {
  const { body } = await call('GET', '/products');
  assert.equal(body.products.length, 7);
  assert.deepEqual(
    body.categories.map((c: { name: string }) => c.name),
    ['Đồ ăn', 'Đồ uống', 'Mang về'],
  );
  const p = body.products.find((x: { name: string }) => x.name === 'Gà thêm');
  assert.equal(p.gridRow, 1);
  assert.equal(p.gridCol, 2);
  assert.equal(p.imageUrl, '/media/products/ga-them');
  const t = (await call('GET', '/tables')).body.tables;
  assert.equal(t.length, 24);
  assert.equal(t[0].name, '001');
  assert.equal(importMenu(db, MD).changed, false); // unchanged file -> no-op
});

test('exact stock: rice + meat portion deducts 1 meat; takeaway also 1 box; drinks; rice never; void returns all', async () => {
  const suon = await qty('i-suon');
  const box = await qty('i-hop-mang-ve');
  const coca = await qty('i-coca-cola');
  const rice = await qty('i-gao');
  const o = {
    id: 'm-1',
    number: 'M-1',
    deviceId: 'pos-m',
    items: [
      { productId: 'p-com-trang-suon', name: 'Cơm trắng sườn', price: 50000, qty: 2 },
      { productId: 'p-com-trang-suon-mang-ve', name: 'Cơm trắng sườn mang về', price: 55000, qty: 1 },
      { productId: 'p-coca-cola', name: 'Coca-Cola', price: 10000, qty: 1 },
      { productId: 'p-tra-da', name: 'Trà đá', price: 5000, qty: 1 },
      { productId: 'p-rau-them', name: 'Rau thêm', price: 10000, qty: 1 },
    ],
    paymentMethod: 'cash',
    paid: 200000,
  };
  assert.equal((await call('POST', '/orders', o)).status, 201);
  assert.equal(await qty('i-suon'), suon - 3);
  assert.equal(await qty('i-hop-mang-ve'), box - 1);
  assert.equal(await qty('i-coca-cola'), coca - 1);
  assert.equal(await qty('i-gao'), rice);
  await call('POST', '/orders/m-1/void', { reason: 'test' });
  assert.equal(await qty('i-suon'), suon);
  assert.equal(await qty('i-hop-mang-ve'), box);
});

test('estimate stock: kitchen open with defaults, top-up, close with remaining/waste, usage report', async () => {
  const cur = (await call('GET', '/kitchen/current')).body;
  assert.equal(cur.session, null);
  assert.equal(cur.items.find((i: { itemId: string }) => i.itemId === 'i-gao').defaultIssue, 15);
  const before = await qty('i-gao');
  const s = (
    await call('POST', '/kitchen/open', {
      lines: [
        { itemId: 'i-gao', qty: 15 },
        { itemId: 'i-rau', qty: 4 },
        { itemId: 'i-tra', qty: 100 },
      ],
    })
  ).body;
  assert.equal(await qty('i-gao'), before - 15);
  assert.equal((await call('POST', '/kitchen/open', { lines: [{ itemId: 'i-gao', qty: 1 }] })).status, 409);
  await call('POST', `/kitchen/${s.id}/add`, { lines: [{ itemId: 'i-gao', qty: 5 }] });
  const noReason = await call('POST', `/kitchen/${s.id}/close`, {
    lines: [
      { itemId: 'i-gao', remaining: 2, waste: 1 },
      { itemId: 'i-rau', remaining: 0 },
      { itemId: 'i-tra', remaining: 0 },
    ],
  });
  assert.equal(noReason.status, 400);
  const c = (
    await call('POST', `/kitchen/${s.id}/close`, {
      lines: [
        { itemId: 'i-gao', remaining: 2, waste: 1, reason: 'Cơm khê' },
        { itemId: 'i-rau', remaining: 0.5 },
        { itemId: 'i-tra', remaining: 0 },
      ],
    })
  ).body;
  const g = c.lines.find((l: { itemId: string }) => l.itemId === 'i-gao');
  assert.deepEqual([g.issued, g.added, g.remaining, g.waste, g.used], [15, 5, 2, 1, 17]);
  assert.equal(await qty('i-gao'), before - 20 + 2);
  assert.equal((await call('GET', '/inventory/items/i-gao')).body.tracking, 'estimate');
  assert.equal((await call('GET', '/inventory/items/i-suon')).body.tracking, 'exact');
  const types = (await call('GET', '/inventory/moves?itemId=i-gao')).body.moves.map((m: { type: string }) => m.type);
  assert.ok(types.includes('issue') && types.includes('return'));
});

test('waste: torn takeaway boxes need a reason', async () => {
  const b = await qty('i-hop-mang-ve');
  assert.equal((await call('POST', '/inventory/items/i-hop-mang-ve/waste', { qty: 3 })).status, 400);
  assert.equal((await call('POST', '/inventory/items/i-hop-mang-ve/waste', { qty: 3, reason: 'Hộp thủng' })).status, 200);
  assert.equal(await qty('i-hop-mang-ve'), b - 3);
});

test('product photos are served without login; unknown photo is 404; bad names rejected', async () => {
  const root = base.replace(/\/api$/, '');
  assert.equal((await fetch(`${root}/media/products/khong-co-anh-nay`)).status, 404);
  assert.equal((await fetch(`${root}/media/products/..%2F..%2Fsecret`)).status, 400);
});
