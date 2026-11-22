import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUser } from './auth.ts';
import { type DB, getSetting, logChange, now, openDb, setSetting, tx } from './db.ts';
import { applyOrderStock, moveStock, productUnitCost } from './inventory.ts';

// SAMPLE DATA ONLY. Everything created here is marked: store name "Cửa hàng mẫu", demo accounts,
// supplier names starting with "NCC mẫu", and generated orders on device "demo-seed" with note "[MẪU]".
// Real deployments: start with SEED=0 and create the owner via `npm run create-owner -w apps/server`.

export const DEMO_ACCOUNTS = [
  { username: 'chu', name: 'Chủ cửa hàng (mẫu)', role: 'owner', password: 'chu123456', pin: '9999' },
  { username: 'thungan', name: 'Thu ngân Lan (mẫu)', role: 'cashier', password: 'thungan123', pin: '1111' },
  { username: 'kho', name: 'Kho Minh (mẫu)', role: 'stock', password: 'kho123456', pin: '2222' },
] as const;

const CATEGORIES = [
  ['c-ca-phe', 'Cà phê', '#8B5E3C'],
  ['c-tra', 'Trà & Trà sữa', '#3F8F5B'],
  ['c-do-an', 'Đồ ăn', '#D97706'],
  ['c-dong-chai', 'Đồ đóng chai', '#2563EB'],
] as const;

// id, name, unit, kind, qty, min, unit cost (VND / unit)
const ITEMS: [string, string, string, 'ingredient' | 'goods', number, number, number][] = [
  ['i-ca-phe-hat', 'Cà phê hạt', 'kg', 'ingredient', 5, 1, 320_000],
  ['i-sua-dac', 'Sữa đặc', 'kg', 'ingredient', 6, 1.5, 70_000],
  ['i-sua-tuoi', 'Sữa tươi', 'l', 'ingredient', 10, 3, 32_000],
  ['i-duong', 'Đường', 'kg', 'ingredient', 8, 2, 22_000],
  ['i-da', 'Đá viên', 'kg', 'ingredient', 40, 10, 2_000],
  ['i-tra-den', 'Trà đen', 'kg', 'ingredient', 2, 0.5, 180_000],
  ['i-dao-ngam', 'Đào ngâm', 'hộp', 'ingredient', 12, 4, 45_000],
  ['i-tran-chau', 'Trân châu', 'kg', 'ingredient', 4, 1, 60_000],
  ['i-banh-mi', 'Bánh mì ổ', 'ổ', 'ingredient', 40, 15, 3_500],
  ['i-thit-nguoi', 'Thịt nguội', 'kg', 'ingredient', 3, 1, 180_000],
  ['i-ly-nhua', 'Ly nhựa + nắp', 'cái', 'ingredient', 500, 100, 900],
  ['i-nuoc-suoi', 'Nước suối 500ml', 'chai', 'goods', 48, 12, 4_000],
  ['i-coca', 'Coca-Cola lon', 'lon', 'goods', 24, 12, 7_500],
];

// id, sku, barcode, name, category, price, recipe [item, qty per portion], option groups
const PRODUCTS: [string, string, string | null, string, string, number, [string, number][], string[]][] = [
  ['p-cf-den', 'CF-DEN', null, 'Cà phê đen', 'c-ca-phe', 20000, [['i-ca-phe-hat', 0.02], ['i-duong', 0.01], ['i-da', 0.15], ['i-ly-nhua', 1]], ['g-size', 'g-da', 'g-duong']],
  ['p-cf-sua', 'CF-SUA', null, 'Cà phê sữa', 'c-ca-phe', 25000, [['i-ca-phe-hat', 0.02], ['i-sua-dac', 0.03], ['i-da', 0.15], ['i-ly-nhua', 1]], ['g-size', 'g-da']],
  ['p-bac-xiu', 'BAC-XIU', null, 'Bạc xỉu', 'c-ca-phe', 29000, [['i-ca-phe-hat', 0.012], ['i-sua-dac', 0.03], ['i-sua-tuoi', 0.08], ['i-da', 0.15], ['i-ly-nhua', 1]], ['g-size', 'g-da']],
  ['p-tra-dao', 'TRA-DAO', null, 'Trà đào cam sả', 'c-tra', 35000, [['i-tra-den', 0.006], ['i-dao-ngam', 0.1], ['i-duong', 0.02], ['i-da', 0.2], ['i-ly-nhua', 1]], ['g-size', 'g-da', 'g-duong']],
  ['p-tra-sua', 'TRA-SUA', null, 'Trà sữa trân châu', 'c-tra', 32000, [['i-tra-den', 0.006], ['i-sua-tuoi', 0.1], ['i-tran-chau', 0.05], ['i-duong', 0.02], ['i-da', 0.15], ['i-ly-nhua', 1]], ['g-size', 'g-da', 'g-duong', 'g-topping']],
  ['p-banh-mi', 'BANH-MI', null, 'Bánh mì thịt', 'c-do-an', 25000, [['i-banh-mi', 1], ['i-thit-nguoi', 0.05]], []],
  ['p-banh-mi-trung', 'BANH-MI-TRUNG', null, 'Bánh mì ốp la', 'c-do-an', 20000, [['i-banh-mi', 1]], []],
  ['p-nuoc-suoi', 'NUOC-SUOI', '8934588012228', 'Nước suối 500ml', 'c-dong-chai', 10000, [['i-nuoc-suoi', 1]], []],
  ['p-coca', 'COCA', '8935049500445', 'Coca-Cola lon', 'c-dong-chai', 15000, [['i-coca', 1]], []],
];

// group id, name, multi, required, options [name, price delta, recipe factor, extra recipe]
const OPTION_GROUPS: [string, string, boolean, boolean, [string, number, number?, [string, number][]?][]][] = [
  ['g-size', 'Size', false, true, [['M', 0], ['L', 6000, 1.4]]],
  ['g-da', 'Đá', false, false, [['Bình thường', 0], ['Ít đá', 0], ['Không đá', 0]]],
  ['g-duong', 'Đường', false, false, [['100%', 0], ['70%', 0], ['50%', 0], ['0%', 0]]],
  ['g-topping', 'Topping', true, false, [['Thêm trân châu', 5000, 1, [['i-tran-chau', 0.03]]], ['Thạch dừa', 5000], ['Kem cheese', 8000, 1, [['i-sua-tuoi', 0.03]]]]],
];

export function seedIfEmpty(db: DB) {
  const n = Number(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n);
  if (n > 0) return false;
  tx(db, () => {
    for (const a of DEMO_ACCOUNTS) createUser(db, { ...a, id: `u-${a.username}` });
    setSetting(db, 'store_name', 'Cửa hàng mẫu ShopFlow');
    setSetting(db, 'sample_data', '1');

    CATEGORIES.forEach(([id, name, color], i) =>
      db.prepare('INSERT OR IGNORE INTO categories (id, name, sort, color) VALUES (?, ?, ?, ?)').run(id, name, i + 1, color),
    );
    db.prepare("INSERT INTO suppliers (id, name, phone, note) VALUES ('s-cafe', 'NCC mẫu - Cà phê Tây Nguyên', '0900000001', 'Dữ liệu mẫu')").run();
    db.prepare("INSERT INTO suppliers (id, name, phone, note) VALUES ('s-sua', 'NCC mẫu - Sữa & nguyên liệu', '0900000002', 'Dữ liệu mẫu')").run();

    for (const [id, name, unit, kind, qty, min, cost] of ITEMS) {
      const supplier = id === 'i-ca-phe-hat' ? 's-cafe' : ['i-sua-dac', 'i-sua-tuoi', 'i-duong', 'i-tran-chau'].includes(id) ? 's-sua' : null;
      db.prepare(
        'INSERT INTO inventory_items (id, name, unit, kind, qty, min_qty, unit_cost, supplier_id, active, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 1, ?)',
      ).run(id, name, unit, kind, min, cost, supplier, now());
      moveStock(db, id, qty, { type: 'adjust', reason: 'Tồn đầu kỳ (dữ liệu mẫu)' });
    }

    for (const [id, name, multi, required, opts] of OPTION_GROUPS) {
      db.prepare('INSERT INTO option_groups (id, name, multi, required) VALUES (?, ?, ?, ?)').run(id, name, multi ? 1 : 0, required ? 1 : 0);
      opts.forEach(([o, delta, factor, extra], i) => {
        db.prepare('INSERT INTO options (id, group_id, name, price_delta, recipe_factor, sort) VALUES (?, ?, ?, ?, ?, ?)').run(`${id}-${i}`, id, o, delta, factor ?? 1, i);
        for (const [item, q] of extra ?? []) db.prepare('INSERT INTO option_recipes (option_id, item_id, qty) VALUES (?, ?, ?)').run(`${id}-${i}`, item, q);
      });
    }

    // Remove v1 sample products that are not part of the v2 menu (keeps history intact via soft delete).
    db.prepare(`UPDATE products SET active = 0 WHERE id NOT IN (${PRODUCTS.map(() => '?').join(',')})`).run(...PRODUCTS.map((p) => p[0]));
    PRODUCTS.forEach(([id, sku, barcode, name, cat, price, recipe, groups], i) => {
      const catName = CATEGORIES.find((c) => c[0] === cat)![1];
      db.prepare(
        `INSERT INTO products (id, sku, barcode, name, category, category_id, price, sort, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, barcode = excluded.barcode, name = excluded.name, category = excluded.category,
           category_id = excluded.category_id, price = excluded.price, sort = excluded.sort, active = 1, updated_at = excluded.updated_at`,
      ).run(id, sku, barcode, name, catName, cat, price, i, now());
      db.prepare('DELETE FROM recipes WHERE product_id = ?').run(id);
      for (const [item, qty] of recipe) db.prepare('INSERT INTO recipes (product_id, item_id, qty) VALUES (?, ?, ?)').run(id, item, qty);
      groups.forEach((g, j) => db.prepare('INSERT OR IGNORE INTO product_option_groups (product_id, group_id, sort) VALUES (?, ?, ?)').run(id, g, j));
      logChange(db, 'product', id, 'upsert');
    });

    for (let i = 1; i <= 8; i++) db.prepare("INSERT INTO dining_tables (id, name, area, sort) VALUES (?, ?, 'Trong nhà', ?)").run(`t-${i}`, `Bàn ${i}`, i);
    for (let i = 1; i <= 4; i++) db.prepare("INSERT INTO dining_tables (id, name, area, sort) VALUES (?, ?, 'Sân vườn', ?)").run(`t-s${i}`, `S${i}`, i);
  });
  console.log('Seeded SAMPLE data (demo accounts: chu / thungan / kho, see README)');
  return true;
}

/** Generate realistic-looking SAMPLE sales for the last `days` days (device "demo-seed", note "[MẪU]"),
 *  so reports and the Boss app have something to show. Stock is deducted like real sales, then
 *  topped up so the demo store does not start empty. */
export function seedDemoSales(db: DB, days = 14, seed = 42) {
  if (getSetting(db, 'demo_sales') === '1') return 0;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const products = PRODUCTS.map(([id, , , name, cat, price]) => ({ id, name, price, cat: CATEGORIES.find((c) => c[0] === cat)![1] }));
  const weights = [6, 9, 5, 7, 6, 5, 3, 3, 2];
  const weighted = products.flatMap((p, i) => Array(weights[i]).fill(p) as (typeof p)[]);
  const hourWeights = [0, 0, 0, 0, 0, 0, 2, 6, 9, 7, 5, 6, 8, 6, 4, 4, 5, 6, 7, 6, 4, 2, 0, 0];
  const hours = hourWeights.flatMap((w, h) => Array(w).fill(h) as number[]);
  const cashierId = 'u-thungan';
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
        const method = pick(['cash', 'cash', 'cash', 'transfer', 'qr', 'card'] as const);
        const paid = method === 'cash' ? Math.ceil(total / 10000) * 10000 : total;
        const id = randomUUID();
        const createdAt = new Date(t).toISOString();
        const type = pick(['dine_in', 'dine_in', 'takeaway', 'takeaway', 'delivery'] as const);
        const costs = items.map((l) => productUnitCost(db, l.p.id) ?? 0);
        db.prepare(
          `INSERT INTO orders (id, number, device_id, cashier_id, cashier, order_type, table_name, note, subtotal, discount, total, payment_method, paid, change_due, status, cost_total, created_at, received_at)
           VALUES (?, ?, 'demo-seed', ?, 'Thu ngân Lan (mẫu)', ?, ?, '[MẪU]', ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
        ).run(id, `MAU-${String(++count).padStart(5, '0')}`, cashierId, type, type === 'dine_in' ? `Bàn ${1 + Math.floor(rand() * 8)}` : '', subtotal, discount, total, method, paid, paid - total,
          items.reduce((a, l, i) => a + costs[i] * l.qty, 0), createdAt, createdAt);
        items.forEach((l, i) =>
          db.prepare('INSERT INTO order_items (order_id, product_id, name, category, price, qty, line_total, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
            id, l.p.id, l.p.name, l.p.cat, l.p.price, l.qty, l.p.price * l.qty, costs[i],
          ),
        );
        applyOrderStock(db, id, items.map((l) => ({ productId: l.p.id, qty: l.qty })), -1, { type: 'sale', userId: cashierId });
        // ~1% refunded the same day
        if (rand() < 0.01) {
          db.prepare("UPDATE orders SET status = 'refunded', refund_amount = total, status_reason = 'Khách đổi ý (mẫu)', status_at = ? WHERE id = ?").run(
            new Date(t + 600_000).toISOString(), id,
          );
        }
      }
    }
    // Top stock back up so the demo store can keep selling (as if goods were received).
    for (const [id, , , , qty] of ITEMS) {
      const cur = Number(db.prepare('SELECT qty FROM inventory_items WHERE id = ?').get(id)!.qty);
      if (cur < qty) moveStock(db, id, qty - cur, { type: 'import', reason: 'Nhập bù dữ liệu mẫu' });
    }
    setSetting(db, 'demo_sales', '1');
  });
  console.log(`Seeded ${count} SAMPLE orders over ${days} days`);
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_PATH ?? './data/shopflow.db');
  seedIfEmpty(db);
  if (process.argv.includes('--demo-sales')) seedDemoSales(db);
}
