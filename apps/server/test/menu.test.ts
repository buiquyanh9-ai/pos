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
  '## 5. Ghi chú',
  '1. Không phải món',
].join('\n');

let db: DB;
let server: Server;
let base: string;
let token: string;

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, { cafeFixture: true });
  importMenu(db, MD);
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

test('parses categories, rows of 5, row prices, own prices, empty slots; ignores non-menu sections', () => {
  const m = parseMenu(MD);
  assert.deepEqual(m.categories, ['Đồ ăn', 'Đồ uống', 'Mang về']);
  const by = (n: string) => m.products.find((p) => p.name === n)!;
  assert.deepEqual([by('Cơm trắng gà').row, by('Cơm trắng gà').col, by('Cơm trắng gà').price], [0, 1, 50000]);
  assert.deepEqual([by('Gà thêm').row, by('Gà thêm').col, by('Gà thêm').price], [1, 2, 40000]);
  assert.equal(by('Cơm trắng sườn mang về').price, 55000);
  assert.equal(by('Cơm trắng sườn mang về').image, 'com-trang/com-trang-suon');
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
  assert.equal(p.imageUrl, '/media/products/mon-them/ga-them');
  const t = (await call('GET', '/tables')).body.tables;
  assert.equal(t.length, 24);
  assert.equal(t[0].name, '001');
  assert.equal(importMenu(db, MD).changed, false); // unchanged file -> no-op
});

test('product photos are served without login; unknown photo is 404; bad names rejected', async () => {
  const root = base.replace(/\/api$/, '');
  assert.equal((await fetch(`${root}/media/products/khong-co-anh-nay`)).status, 404);
  assert.equal((await fetch(`${root}/media/products/..%2F..%2Fsecret`)).status, 400);
});

test('Đồ ăn kèm: own prices, rows and photo folder', () => {
  const m = parseMenu(['## 3. Mục Đồ ăn kèm', '**Hàng 1**', '1. Khoai tây chiên – 30.000đ', '2. Trứng ốp – 8.000đ', '**Hàng 2**', '1. Trứng kho – 10.000đ'].join(String.fromCharCode(10)));
  assert.deepEqual(m.products.map((p) => [p.name, p.category, p.price, p.row, p.col, p.image]), [
    ['Khoai tây chiên', 'Đồ ăn kèm', 30000, 0, 0, 'do-an-kem/khoai-tay-chien'],
    ['Trứng ốp', 'Đồ ăn kèm', 8000, 0, 1, 'do-an-kem/trung-op'],
    ['Trứng kho', 'Đồ ăn kèm', 10000, 1, 0, 'do-an-kem/trung-kho'],
  ]);
});
