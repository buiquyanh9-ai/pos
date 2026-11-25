import { createHash } from 'node:crypto';
import { type DB, getSetting, logChange, now, setSetting, slug, tx } from './db.ts';
import { publish } from './events.ts';
import { productImagePath } from './productImages.ts';

// Menu source of truth: the shop's own description file (c:\VISUAL\pos\product\z.product, Markdown).
// Format understood (see the file):
//   ## 2. Mục Đồ ăn                       -> category "Đồ ăn"  (only "## N. Mục <name>" headings)
//   **Hàng 1 – Cơm trắng (50.000đ/món)**  -> new row of 5 slots, default price for the row
//   1. Cơm trắng sườn                     -> slot 1, row price
//   1. Rau thêm – 10.000đ                 -> slot 1, own price
//   4. Slot trống                         -> empty slot (kept in the grid)

export interface MenuProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  row: number;
  col: number;
  image: string; // folder/name in product_img (takeaway items share the dine-in photo)
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
    products.push({ id: `p-${s}`, name: text, category, price, row, col, image: productImagePath(s.replace(/-mang-ve$/, '')) });
  }
  return { categories, products, warnings };
}

export interface ImportResult {
  changed: boolean;
  categories: number;
  products: number;
  deactivated: number;
  warnings: string[];
}

/** Make the database match the menu file. Idempotent. */
export function importMenu(db: DB, md: string, opts: { force?: boolean; tables?: number } = {}): ImportResult {
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

    for (const p of menu.products) {
      const catId = `c-${slug(p.category)}`;
      db.prepare(
        `INSERT INTO products (id, name, category, category_id, price, image_url, grid_row, grid_col, sort, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, category_id = excluded.category_id,
           price = excluded.price, image_url = excluded.image_url, grid_row = excluded.grid_row, grid_col = excluded.grid_col,
           sort = excluded.sort, active = 1, updated_at = excluded.updated_at`,
      ).run(p.id, p.name, p.category, catId, p.price, `/media/products/${p.image}`, p.row, p.col, p.row * 10 + p.col, now());
      db.prepare('DELETE FROM product_option_groups WHERE product_id = ?').run(p.id);
      logChange(db, 'product', p.id, 'upsert');
    }
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
