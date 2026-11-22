import { createHash } from 'node:crypto';
import { type DB, getSetting, logChange, now, setSetting, slug, tx } from './db.ts';
import { moveStock } from './inventory.ts';
import { publish } from './events.ts';

// Menu source of truth: the shop's own description file (c:\VISUAL\pos\product\z.product, Markdown).
// Format understood (see the file):
//   ## 2. Mục Đồ ăn                       -> category "Đồ ăn"  (only "## N. Mục <name>" headings)
//   **Hàng 1 – Cơm trắng (50.000đ/món)**  -> new row of 5 slots, default price for the row
//   1. Cơm trắng sườn                     -> slot 1, row price
//   1. Rau thêm – 10.000đ                 -> slot 1, own price
//   4. Slot trống                         -> empty slot (kept in the grid)
// Stock rules (section 5 of the file) are applied by name, see recipeFor().

export interface MenuProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  row: number;
  col: number;
  image: string; // photo base name in product_img (takeaway items share the dine-in photo)
}

export interface ParsedMenu {
  categories: string[];
  products: MenuProduct[];
  warnings: string[];
}

const money = (s: string) => Number(s.replace(/[^\d]/g, ''));

export function parseMenu(md: string): ParsedMenu {
  const categories: string[] = [];
  const products: MenuProduct[] = [];
  const warnings: string[] = [];
  let category: string | null = null;
  let row = -1;
  let rowPrice: number | null = null;
  for (const [n, raw] of md.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const h2 = line.match(/^##\s+\d+\.\s+(.*)$/);
    if (h2) {
      const m = h2[1].match(/^Mục\s+(.+?)\s*(\(.*\))?$/i);
      category = m ? m[1].trim() : null;
      if (category && !categories.includes(category)) categories.push(category);
      row = -1;
      rowPrice = null;
      continue;
    }
    if (!category) continue;
    const head = line.match(/^\*\*\s*Hàng\s+\d+(.*)\*\*$/i);
    if (head) {
      row++;
      const p = head[1].match(/\(\s*([\d.,]+)\s*đ/i);
      rowPrice = p ? money(p[1]) : null;
      continue;
    }
    const item = line.match(/^(\d+)\.\s+(.+)$/);
    if (!item) continue;
    if (row < 0) row = 0; // items without a "Hàng" heading
    const col = Number(item[1]) - 1;
    let text = item[2].trim();
    if (/^slot trống$/i.test(text)) continue;
    if (col < 0 || col > 4) {
      warnings.push(`Dòng ${n + 1}: vị trí ${col + 1} ngoài 1-5, bỏ qua "${text}"`);
      continue;
    }
    let price = rowPrice;
    const own = text.match(/^(.*?)\s*[–—-]\s*([\d.,]+)\s*đ\s*$/);
    if (own) {
      text = own[1].trim();
      price = money(own[2]);
    }
    if (price === null || !Number.isFinite(price)) {
      warnings.push(`Dòng ${n + 1}: "${text}" chưa có giá, bỏ qua`);
      continue;
    }
    const s = slug(text);
    products.push({ id: `p-${s}`, name: text, category, price, row, col, image: s.replace(/-mang-ve$/, '') });
  }
  return { categories, products, warnings };
}

// ---------------------------------------------------------------- stock rules (section 5)
// Exact stock: counted units, deducted per portion sold. Estimate stock: shown as "còn khoảng",
// managed by the kitchen open/close flow; only takeaway boxes are deducted automatically.
export const MENU_ITEMS: { id: string; name: string; unit: string; kind: 'ingredient' | 'goods'; tracking: 'exact' | 'estimate'; min: number; defaultIssue?: number; sample: number }[] = [
  { id: 'i-suon', name: 'Sườn', unit: 'phần', kind: 'ingredient', tracking: 'exact', min: 10, sample: 60 },
  { id: 'i-xa-xiu', name: 'Xá xíu', unit: 'phần', kind: 'ingredient', tracking: 'exact', min: 10, sample: 50 },
  { id: 'i-ga', name: 'Gà', unit: 'phần', kind: 'ingredient', tracking: 'exact', min: 10, sample: 50 },
  { id: 'i-bo', name: 'Bò', unit: 'phần', kind: 'ingredient', tracking: 'exact', min: 10, sample: 40 },
  { id: 'i-ca-kho', name: 'Cá kho', unit: 'phần', kind: 'ingredient', tracking: 'exact', min: 10, sample: 40 },
  { id: 'i-sua-dau', name: 'Sữa đậu', unit: 'chai', kind: 'goods', tracking: 'exact', min: 12, sample: 48 },
  { id: 'i-coca-cola', name: 'Coca-Cola', unit: 'chai', kind: 'goods', tracking: 'exact', min: 12, sample: 48 },
  { id: 'i-nuoc-gao', name: 'Nước gạo', unit: 'chai', kind: 'goods', tracking: 'exact', min: 12, sample: 36 },
  { id: 'i-nuoc-loc', name: 'Nước lọc', unit: 'chai', kind: 'goods', tracking: 'exact', min: 24, sample: 72 },
  { id: 'i-gao', name: 'Gạo', unit: 'kg', kind: 'ingredient', tracking: 'estimate', min: 30, defaultIssue: 15, sample: 100 },
  { id: 'i-rau', name: 'Rau', unit: 'kg', kind: 'ingredient', tracking: 'estimate', min: 4, defaultIssue: 4, sample: 12 },
  { id: 'i-tra', name: 'Trà', unit: 'g', kind: 'ingredient', tracking: 'estimate', min: 200, defaultIssue: 100, sample: 1000 },
  { id: 'i-hop-mang-ve', name: 'Hộp mang về', unit: 'hộp', kind: 'ingredient', tracking: 'estimate', min: 50, sample: 300 },
];

const CAFE_SAMPLE_ITEMS = [
  'i-ca-phe-hat', 'i-sua-dac', 'i-sua-tuoi', 'i-duong', 'i-da', 'i-tra-den', 'i-dao-ngam',
  'i-tran-chau', 'i-banh-mi', 'i-thit-nguoi', 'i-ly-nhua', 'i-nuoc-suoi', 'i-coca',
];

const MEATS: [RegExp, string][] = [
  [/sườn/i, 'i-suon'],
  [/xá xíu/i, 'i-xa-xiu'],
  [/(^|\s)gà(\s|$)/i, 'i-ga'],
  [/(^|\s)bò(\s|$)/i, 'i-bo'],
  [/cá kho/i, 'i-ca-kho'],
];
const DRINKS: [RegExp, string][] = [
  [/sữa đậu/i, 'i-sua-dau'],
  [/coca/i, 'i-coca-cola'],
  [/nước gạo/i, 'i-nuoc-gao'],
  [/nước lọc/i, 'i-nuoc-loc'],
];

/** Stock consumed by one portion. Rice/vegetables/tea are never deducted per sale. */
export function recipeFor(name: string): { itemId: string; qty: number }[] {
  const out: { itemId: string; qty: number }[] = [];
  const meat = MEATS.find(([re]) => re.test(name));
  if (meat) out.push({ itemId: meat[1], qty: 1 });
  const drink = DRINKS.find(([re]) => re.test(name));
  if (drink) out.push({ itemId: drink[1], qty: 1 });
  // One takeaway box per rice portion or extra meat/fish portion (not for extra rice / vegetables).
  const takeaway = /mang về/i.test(name);
  const isRicePortion = /^cơm (trắng|đảo)/i.test(name) && !/thêm/i.test(name);
  if (takeaway && (isRicePortion || meat)) out.push({ itemId: 'i-hop-mang-ve', qty: 1 });
  return out;
}

export interface ImportResult {
  changed: boolean;
  categories: number;
  products: number;
  deactivated: number;
  warnings: string[];
}

/** Make the database match the menu file. Idempotent; stock quantities are never overwritten
 *  (sampleStock only seeds opening stock for items created now, marked as sample data). */
export function importMenu(db: DB, md: string, opts: { sampleStock?: boolean; force?: boolean; tables?: number } = {}): ImportResult {
  const hash = createHash('sha256').update(md).digest('hex');
  const menu = parseMenu(md);
  if (!opts.force && getSetting(db, 'menu_hash') === hash) {
    return { changed: false, categories: menu.categories.length, products: menu.products.length, deactivated: 0, warnings: menu.warnings };
  }
  if (!menu.products.length) throw new Error('Không đọc được món nào từ file menu');
  let deactivated = 0;
  tx(db, () => {
    // Categories in file order; others hidden.
    menu.categories.forEach((name, i) => {
      const id = `c-${slug(name)}`;
      db.prepare(
        `INSERT INTO categories (id, name, sort, active) VALUES (?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort, active = 1`,
      ).run(id, name, i + 1);
    });
    const keepCats = menu.categories.map((c) => `c-${slug(c)}`);
    db.prepare(`UPDATE categories SET active = 0 WHERE id NOT IN (${keepCats.map(() => '?').join(',')})`).run(...keepCats);

    for (const it of MENU_ITEMS) {
      const exists = db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(it.id);
      if (!exists) {
        db.prepare(
          `INSERT INTO inventory_items (id, name, unit, kind, qty, min_qty, unit_cost, active, tracking, default_issue, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, 0, 1, ?, ?, ?)`,
        ).run(it.id, it.name, it.unit, it.kind, it.min, it.tracking, it.defaultIssue ?? null, now());
        if (opts.sampleStock) moveStock(db, it.id, it.sample, { type: 'adjust', reason: 'Tồn đầu kỳ (dữ liệu mẫu)' });
      } else {
        db.prepare('UPDATE inventory_items SET tracking = ?, default_issue = COALESCE(default_issue, ?), active = 1 WHERE id = ?').run(it.tracking, it.defaultIssue ?? null, it.id);
      }
    }

    for (const p of menu.products) {
      const catId = `c-${slug(p.category)}`;
      db.prepare(
        `INSERT INTO products (id, name, category, category_id, price, image_url, grid_row, grid_col, sort, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, category_id = excluded.category_id,
           price = excluded.price, image_url = excluded.image_url, grid_row = excluded.grid_row, grid_col = excluded.grid_col,
           sort = excluded.sort, active = 1, updated_at = excluded.updated_at`,
      ).run(p.id, p.name, p.category, catId, p.price, `/media/products/${p.image}`, p.row, p.col, p.row * 10 + p.col, now());
      db.prepare('DELETE FROM recipes WHERE product_id = ?').run(p.id);
      for (const r of recipeFor(p.name)) db.prepare('INSERT INTO recipes (product_id, item_id, qty) VALUES (?, ?, ?)').run(p.id, r.itemId, r.qty);
      db.prepare('DELETE FROM product_option_groups WHERE product_id = ?').run(p.id);
      logChange(db, 'product', p.id, 'upsert');
    }
    // The built-in café sample (seed.ts) is not part of a real menu: hide its stock items.
    db.prepare(`UPDATE inventory_items SET active = 0 WHERE id IN (${CAFE_SAMPLE_ITEMS.map(() => '?').join(',')})`).run(...CAFE_SAMPLE_ITEMS);
    const keep = menu.products.map((p) => p.id);
    deactivated = Number(
      db.prepare(`UPDATE products SET active = 0, updated_at = ? WHERE active = 1 AND id NOT IN (${keep.map(() => '?').join(',')})`).run(now(), ...keep).changes,
    );

    // Tables 001..N in one room (layout of the table picker).
    const n = opts.tables ?? 24;
    for (let i = 1; i <= n; i++) {
      const name = String(i).padStart(3, '0');
      db.prepare(
        "INSERT INTO dining_tables (id, name, area, sort, active) VALUES (?, ?, '', ?, 1) ON CONFLICT(id) DO UPDATE SET name = excluded.name, area = '', sort = excluded.sort, active = 1",
      ).run(`t-${name}`, name, i);
    }
    db.prepare("UPDATE dining_tables SET active = 0 WHERE id NOT LIKE 't-0%' OR CAST(SUBSTR(id, 3) AS INTEGER) > ?").run(n);
    setSetting(db, 'menu_hash', hash);
  });
  setImmediate(() => publish('catalog.changed', { at: now() }));
  return { changed: true, categories: menu.categories.length, products: menu.products.length, deactivated, warnings: menu.warnings };
}
