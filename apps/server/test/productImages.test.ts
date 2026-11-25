import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { importMenu } from '../src/menu.ts';
import { productImagePath } from '../src/productImages.ts';

test('labeled images, legacy links, stored URL migration and invalid paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopflow-images-'));
  const db = openDb(':memory:');
  const samples = {
    'com-trang': ['com-trang-suon', 'com-trang-xa-xiu', 'com-trang-ga', 'com-trang-bo', 'com-trang-ca-kho'],
    'com-dao': ['com-dao-suon', 'com-dao-xa-xiu', 'com-dao-ga', 'com-dao-bo', 'com-dao-ca-kho'],
    'mon-them': ['suon-them', 'xa-xiu-them', 'ga-them', 'bo-them', 'ca-kho-them', 'rau-them', 'com-trang-them', 'com-dao-them'],
    'do-uong': ['sua-dau', 'coca-cola', 'tra-da', 'nuoc-gao', 'nuoc-loc'],
    'do-an-kem': ['khoai-tay-chien', 'trung-op', 'ngo-chien', 'lap-xuong', 'xuc-xich', 'trung-kho'],
  };
  for (const [group, names] of Object.entries(samples)) {
    mkdirSync(join(dir, group));
    for (const name of names) writeFileSync(join(dir, group, `${name}.jpg`), `photo:${name}`);
  }
  importMenu(db, '## 2. Mục Đồ ăn\n**Hàng 1 – Cơm trắng (50.000đ/món)**\n1. Cơm trắng sườn');
  db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run('/media/products/com-trang-suon.jpg', 'p-com-trang-suon');
  const oldDir = process.env.MENU_IMG_DIR;
  process.env.MENU_IMG_DIR = dir;
  const app = createApp({ db });
  if (oldDir === undefined) delete process.env.MENU_IMG_DIR;
  else process.env.MENU_IMG_DIR = oldDir;
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media/products`;
    assert.equal(db.prepare('SELECT image_url FROM products WHERE id = ?').get('p-com-trang-suon')!.image_url,
      '/media/products/com-trang/com-trang-suon.jpg');
    for (const [group, names] of Object.entries(samples)) {
      for (const name of names) {
        assert.equal(productImagePath(name), `${group}/${name}`);
        for (const path of [`${group}/${name}`, `${group}/${name}.jpg`, name, `${name}.jpg`]) {
          const response = await fetch(`${root}/${path}`);
          assert.equal(response.status, 200, path);
          assert.equal(await response.text(), `photo:${name}`);
        }
      }
    }
    assert.equal((await fetch(`${root}/do-an-kem/missing`)).status, 404);
    assert.equal((await fetch(`${root}/invalid/trung-op`)).status, 400);
    assert.equal((await fetch(`${root}/do-an-kem/..%2Fsecret`)).status, 400);
    assert.equal((await fetch(`${root}/..%2Fdo-an-kem/trung-op`)).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
