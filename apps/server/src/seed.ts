import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createUser } from './auth.ts';
import { type DB, getSetting, logChange, now, openDb, setSetting, tx } from './db.ts';
import { importMenu } from './menu.ts';
import { defaultMenuPath } from './menuWatch.ts';

// SAMPLE DATA ONLY. Everything created here is marked: store name "Cửa hàng mẫu", demo accounts,
// and generated orders on device "demo-seed" with note "[MẪU]".
// Real deployments: start with SEED=0 and create the owner via `npm run create-owner -w apps/server`.

export const DEMO_ACCOUNTS = [
  { username: 'thungan', name: 'Kim', role: 'cashier', password: 'thungan123', pin: '1111' },
  { username: 'thungan2', name: 'Minh', role: 'cashier', password: 'thungan2123', pin: '2222' },
  { username: 'chu', name: 'Hiền', role: 'owner', password: 'chu123456', pin: '3333' },
] as const;

// ---- Test fixture only: the old café catalog. Server tests rely on it; real/fresh installs get the menu
// from product/z.product instead (see menuWatch.ts), so it is NOT inserted unless `cafeFixture` is set.
const CATEGORIES = [
  ['c-ca-phe', 'Cà phê', '#8B5E3C'],
  ['c-tra', 'Trà & Trà sữa', '#3F8F5B'],
  ['c-do-an', 'Đồ ăn', '#D97706'],
  ['c-dong-chai', 'Đồ đóng chai', '#2563EB'],
] as const;

// id, sku, barcode, name, category, price, option groups
const PRODUCTS: [string, string, string | null, string, string, number, string[]][] = [
  ['p-cf-den', 'CF-DEN', null, 'Cà phê đen', 'c-ca-phe', 20000, ['g-size', 'g-da', 'g-duong']],
  ['p-cf-sua', 'CF-SUA', null, 'Cà phê sữa', 'c-ca-phe', 25000, ['g-size', 'g-da']],
  ['p-bac-xiu', 'BAC-XIU', null, 'Bạc xỉu', 'c-ca-phe', 29000, ['g-size', 'g-da']],
  ['p-tra-dao', 'TRA-DAO', null, 'Trà đào cam sả', 'c-tra', 35000, ['g-size', 'g-da', 'g-duong']],
  ['p-tra-sua', 'TRA-SUA', null, 'Trà sữa trân châu', 'c-tra', 32000, ['g-size', 'g-da', 'g-duong', 'g-topping']],
  ['p-banh-mi', 'BANH-MI', null, 'Bánh mì thịt', 'c-do-an', 25000, []],
  ['p-banh-mi-trung', 'BANH-MI-TRUNG', null, 'Bánh mì ốp la', 'c-do-an', 20000, []],
  ['p-nuoc-suoi', 'NUOC-SUOI', '8934588012228', 'Nước suối 500ml', 'c-dong-chai', 10000, []],
  ['p-coca', 'COCA', '8935049500445', 'Coca-Cola lon', 'c-dong-chai', 15000, []],
];

// group id, name, multi, required, options [name, price delta]
const OPTION_GROUPS: [string, string, boolean, boolean, [string, number][]][] = [
  ['g-size', 'Size', false, true, [['M', 0], ['L', 6000]]],
  ['g-da', 'Đá', false, false, [['Bình thường', 0], ['Ít đá', 0], ['Không đá', 0]]],
  ['g-duong', 'Đường', false, false, [['100%', 0], ['70%', 0], ['50%', 0], ['0%', 0]]],
  ['g-topping', 'Topping', true, false, [['Thêm trân châu', 5000], ['Thạch dừa', 5000], ['Kem cheese', 8000]]],
];

export function seedIfEmpty(db: DB, opts: { cafeFixture?: boolean } = {}) {
  const n = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n);
  if (n > 0) return false;
  tx(db, () => {
    for (const a of DEMO_ACCOUNTS) createUser(db, { ...a, id: `u-${a.username}` });
    setSetting(db, 'store_name', 'Cửa hàng mẫu ShopFlow');
    setSetting(db, 'receipt_footer', 'Cảm ơn quý khách, hẹn gặp lại!');
    setSetting(db, 'sample_data', '1');

    for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO dining_tables (id, name, area, sort) VALUES (?, ?, 'Trong nhà', ?)").run(`t-${i}`, `Bàn ${i}`, i);
    for (let i = 1; i <= 4; i++) db.prepare("INSERT INTO dining_tables (id, name, area, sort) VALUES (?, ?, 'Sân vườn', ?)").run(`t-s${i}`, `S${i}`, i);
    if (opts.cafeFixture) seedCafeFixture(db);
  });
  console.log('Seeded SAMPLE data (demo accounts: chu / thungan / thungan2, see README)');
  return true;
}

function seedCafeFixture(db: DB) {
  {

    CATEGORIES.forEach(([id, name, color], i) =>
      db.prepare('INSERT OR IGNORE INTO categories (id, name, sort, color) VALUES (?, ?, ?, ?)').run(id, name, i + 1, color),
    );

    for (const [id, name, multi, required, opts] of OPTION_GROUPS) {
      db.prepare('INSERT INTO option_groups (id, name, multi, required) VALUES (?, ?, ?, ?)').run(id, name, multi ? 1 : 0, required ? 1 : 0);
      opts.forEach(([o, delta], i) => {
        db.prepare('INSERT INTO options (id, group_id, name, price_delta, sort) VALUES (?, ?, ?, ?, ?)').run(`${id}-${i}`, id, o, delta, i);
      });
    }

    // Remove v1 sample products that are not part of the v2 menu (keeps history intact via soft delete).
    db.prepare(`UPDATE products SET active = 0 WHERE id NOT IN (${PRODUCTS.map(() => '?').join(',')})`).run(...PRODUCTS.map((p) => p[0]));
    PRODUCTS.forEach(([id, sku, barcode, name, cat, price, groups], i) => {
      const catName = CATEGORIES.find((c) => c[0] === cat)![1];
      db.prepare(
        `INSERT INTO products (id, sku, barcode, name, category, category_id, price, sort, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, barcode = excluded.barcode, name = excluded.name, category = excluded.category,
           category_id = excluded.category_id, price = excluded.price, sort = excluded.sort, active = 1, updated_at = excluded.updated_at`,
      ).run(id, sku, barcode, name, catName, cat, price, i, now());
      groups.forEach((g, j) => db.prepare('INSERT OR IGNORE INTO product_option_groups (product_id, group_id, sort) VALUES (?, ?, ?)').run(id, g, j));
      logChange(db, 'product', id, 'upsert');
    });
  }
}

/** Generate realistic-looking SAMPLE sales for the last `days` days (device "demo-seed", note "[MẪU]"),
 *  so reports and the Boss app have something to show. */
export function seedDemoSales(db: DB, days = 14, seed = 42) {
  if (getSetting(db, 'demo_sales') === '1') return 0;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  // Sell whatever is on the current menu (imported from z.product), not a hard-coded catalog.
  const products = (db.prepare('SELECT id, name, price, category FROM products WHERE active = 1 ORDER BY sort').all() as { id: string; name: string; price: number; category: string }[])
    .map((p) => ({ id: p.id, name: p.name, price: Number(p.price), cat: p.category }));
  if (!products.length) {
    console.log('No active products yet (import the menu first), skipping demo sales');
    return 0;
  }
  // Earlier items on the menu sell more often.
  const weighted = products.flatMap((p, i) => Array(Math.max(1, 8 - Math.floor(i / 3))).fill(p) as (typeof p)[]);
  const hourWeights = [0, 0, 0, 0, 0, 0, 2, 6, 9, 7, 5, 6, 8, 6, 4, 4, 5, 6, 7, 6, 4, 2, 0, 0];
  const hours = hourWeights.flatMap((w, h) => Array(w).fill(h) as number[]);
  // Two shifts: Kim in the morning, Minh from 14:00.
  const cashierOf = (hour: number) => (hour < 14 ? { id: 'u-thungan', name: 'Kim' } : { id: 'u-thungan2', name: 'Minh' });
  let count = 0;
  tx(db, () => {
    for (let d = days; d >= 1; d--) {
      const day = new Date();
      day.setUTCDate(day.getUTCDate() - d);
      const nOrders = 45 + Math.floor(rand() * 30) + (day.getUTCDay() % 6 === 0 ? 20 : 0);
      for (let k = 0; k < nOrders; k++) {
        const hour = pick(hours);
        // Local (UTC+7) time of day -> UTC timestamp.
        const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - 7, Math.floor(rand() * 60), Math.floor(rand() * 60));
        const lines = new Map<string, { p: (typeof products)[number]; qty: number }>();
        const nLines = 1 + Math.floor(rand() * 3);
        for (let j = 0; j < nLines; j++) {
          const p = pick(weighted);
          const l = lines.get(p.id) ?? { p, qty: 0 };
          l.qty += 1 + (rand() < 0.2 ? 1 : 0);
          lines.set(p.id, l);
        }
        const items = [...lines.values()];
        const subtotal = items.reduce((a, l) => a + l.p.price * l.qty, 0);
        const discount = rand() < 0.08 ? Math.round(subtotal * 0.1 / 1000) * 1000 : 0;
        const total = subtotal - discount;
        const method = pick(['cash', 'cash', 'cash', 'transfer', 'transfer'] as const);
        const paid = method === 'cash' ? Math.ceil(total / 10000) * 10000 : total;
        const id = randomUUID();
        const createdAt = new Date(t).toISOString();
        const type = pick(['dine_in', 'dine_in', 'takeaway', 'takeaway', 'delivery'] as const);
        const cashier = cashierOf(hour);
        db.prepare(
          `INSERT INTO orders (id, number, device_id, cashier_id, cashier, order_type, table_name, note, subtotal, discount, total, payment_method, paid, change_due, status, cost_total, created_at, received_at)
           VALUES (?, ?, 'demo-seed', ?, ?, ?, ?, '[MẪU]', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
        ).run(id, `MAU-${String(++count).padStart(5, '0')}`, cashier.id, cashier.name, type, type === 'dine_in' ? `Bàn ${1 + Math.floor(rand() * 8)}` : '', subtotal, discount, total, method, paid, paid - total,
          null, createdAt, createdAt);
        for (const l of items) {
          db.prepare('INSERT INTO order_items (order_id, product_id, name, category, price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            id, l.p.id, l.p.name, l.p.cat, l.p.price, l.qty, l.p.price * l.qty,
          );
        }
        // ~1% refunded the same day
        if (rand() < 0.01) {
          db.prepare("UPDATE orders SET status = 'refunded', refund_amount = total, status_reason = 'Khách đổi ý (mẫu)', status_at = ? WHERE id = ?").run(
            new Date(t + 600_000).toISOString(), id,
          );
        }
      }
    }
    setSetting(db, 'demo_sales', '1');
  });
  console.log(`Seeded ${count} SAMPLE orders over ${days} days`);
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_PATH ?? './data/shopflow.db');
  seedIfEmpty(db);
  if (process.argv.includes('--demo-sales')) {
    const menu = defaultMenuPath();
    if (existsSync(menu)) importMenu(db, readFileSync(menu, 'utf8'));
    seedDemoSales(db);
  }
}
