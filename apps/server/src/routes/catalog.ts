import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, type Row, audit, logChange, now, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { publish } from '../events.ts';
import { availability, productUnitCost } from '../inventory.ts';
import { HttpError, MAX_MONEY, bad, int, isoDate, reqInt, reqStr, str } from '../validate.ts';

function num(v: unknown, field: string, opts: { min?: number; optional?: boolean } = {}): number | undefined {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw bad(`${field} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${field} must be a number`);
  if (opts.min !== undefined && v < opts.min) throw bad(`${field} must be >= ${opts.min}`);
  return v;
}
export { num };

export function catalogRoutes(db: DB) {
  const r = Router();
  const changed = () => setImmediate(() => publish('catalog.changed', { at: now() }));

  // ---------------------------------------------------------------- read model
  function optionGroupsByProduct() {
    const groups = db.prepare('SELECT * FROM option_groups').all();
    const opts = db.prepare('SELECT * FROM options ORDER BY sort, name').all();
    const byGroup = new Map<string, Row[]>();
    for (const o of opts) byGroup.set(o.group_id as string, [...(byGroup.get(o.group_id as string) ?? []), o]);
    const groupDto = new Map(
      groups.map((g) => [
        g.id as string,
        {
          id: g.id as string,
          name: g.name as string,
          multi: Number(g.multi) === 1,
          required: Number(g.required) === 1,
          options: (byGroup.get(g.id as string) ?? []).map((o) => ({ id: o.id as string, name: o.name as string, priceDelta: Number(o.price_delta) })),
        },
      ]),
    );
    const links = db.prepare('SELECT * FROM product_option_groups ORDER BY sort').all();
    const out = new Map<string, unknown[]>();
    for (const l of links) {
      const g = groupDto.get(l.group_id as string);
      if (g) out.set(l.product_id as string, [...(out.get(l.product_id as string) ?? []), g]);
    }
    return { out, all: [...groupDto.values()] };
  }

  function recipesByProduct() {
    const rows = db
      .prepare('SELECT r.*, i.name AS item_name, i.unit FROM recipes r JOIN inventory_items i ON i.id = r.item_id ORDER BY i.name')
      .all();
    const out = new Map<string, { itemId: string; itemName: string; unit: string; qty: number }[]>();
    for (const x of rows) {
      const pid = x.product_id as string;
      out.set(pid, [...(out.get(pid) ?? []), { itemId: x.item_id as string, itemName: x.item_name as string, unit: x.unit as string, qty: Number(x.qty) }]);
    }
    return out;
  }

  function productsDto(rows: Row[]) {
    const avail = availability(db);
    const { out: groups } = optionGroupsByProduct();
    const recipes = recipesByProduct();
    return rows.map((p) => {
      const id = p.id as string;
      return {
        id,
        sku: (p.sku as string | null) ?? null,
        barcode: (p.barcode as string | null) ?? null,
        name: p.name as string,
        categoryId: (p.category_id as string | null) ?? null,
        category: (p.category_name as string | null) ?? (p.category as string) ?? '',
        imageUrl: (p.image_url as string | null) ?? null,
        price: Number(p.price),
        cost: productUnitCost(db, id),
        /** Portions that can still be made from stock; null = stock not tracked for this product. */
        stock: avail.has(id) ? avail.get(id)! : null,
        active: Number(p.active) === 1,
        sort: Number(p.sort ?? 0),
        optionGroups: groups.get(id) ?? [],
        recipe: recipes.get(id) ?? [],
        updatedAt: p.updated_at as string,
      };
    });
  }

  const productSelect = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
  const getProduct = (id: string) => {
    const row = db.prepare(`${productSelect} WHERE p.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'product not found');
    return productsDto([row])[0];
  };

  // ---------------------------------------------------------------- categories
  r.get('/categories', (_req, res) => {
    const rows = db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort, name').all();
    res.json({ categories: rows.map((c) => ({ id: c.id, name: c.name, sort: Number(c.sort), color: c.color })) });
  });

  r.post('/categories', allow('owner'), (req, res) => {
    const name = reqStr(req.body?.name, 'name', 64);
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO categories (id, name, sort, color) VALUES (?, ?, ?, ?)').run(
        id,
        name,
        int(req.body?.sort, 'sort', { optional: true }) ?? 0,
        str(req.body?.color, 'color', { optional: true, max: 16 }) ?? '',
      );
    } catch {
      throw new HttpError(409, 'category name already exists');
    }
    audit(db, actorId(req), 'category.create', 'category', id, { name });
    changed();
    res.status(201).json({ id, name });
  });

  r.put('/categories/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    const name = str(req.body?.name, 'name', { optional: true, max: 64 });
    const sort = int(req.body?.sort, 'sort', { optional: true });
    const color = str(req.body?.color, 'color', { optional: true, max: 16 });
    const active = req.body?.active === undefined ? undefined : req.body.active ? 1 : 0;
    const r1 = db
      .prepare('UPDATE categories SET name = COALESCE(?, name), sort = COALESCE(?, sort), color = COALESCE(?, color), active = COALESCE(?, active) WHERE id = ?')
      .run(name ?? null, sort ?? null, color ?? null, active ?? null, id);
    if (!r1.changes) throw new HttpError(404, 'category not found');
    if (name) db.prepare('UPDATE products SET category = ?, updated_at = ? WHERE category_id = ?').run(name, now(), id);
    audit(db, actorId(req), 'category.update', 'category', id, req.body);
    changed();
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- products
  r.get('/products', (req, res) => {
    const includeInactive = req.query.includeInactive === '1';
    const since = isoDate(req.query.since, 'since', true);
    const where: string[] = [];
    const params: string[] = [];
    if (!includeInactive) where.push('p.active = 1');
    if (since) (where.push('p.updated_at > ?'), params.push(since));
    const rows = db
      .prepare(`${productSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(c.sort, 999), p.sort, p.name`)
      .all(...params);
    const cats = db.prepare('SELECT id, name, sort, color FROM categories WHERE active = 1 ORDER BY sort, name').all();
    res.json({ products: productsDto(rows), categories: cats, optionGroups: optionGroupsByProduct().all, serverTime: now() });
  });

  r.get('/products/:id', (req, res) => {
    res.json(getProduct(req.params.id as string));
  });

  function resolveCategory(v: unknown): { id: string | null; name: string } | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return { id: null, name: '' };
    const s = reqStr(v, 'categoryId', 64);
    const c = db.prepare('SELECT id, name FROM categories WHERE id = ? OR name = ?').get(s, s);
    if (c) return { id: c.id as string, name: c.name as string };
    // Unknown name: create the category on the fly (handy for imports and the legacy "category" field).
    const id = randomUUID();
    db.prepare('INSERT INTO categories (id, name, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM categories))').run(id, s);
    return { id, name: s };
  }

  function writeRecipe(productId: string, recipe: unknown) {
    if (recipe === undefined) return;
    if (!Array.isArray(recipe)) throw bad('recipe must be an array');
    db.prepare('DELETE FROM recipes WHERE product_id = ?').run(productId);
    const ins = db.prepare('INSERT INTO recipes (product_id, item_id, qty) VALUES (?, ?, ?)');
    for (const [i, raw] of recipe.entries()) {
      const line = (raw ?? {}) as Row;
      const itemId = reqStr(line.itemId, `recipe[${i}].itemId`, 64);
      if (!db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(itemId)) throw bad(`recipe[${i}].itemId not found`);
      const qty = num(line.qty, `recipe[${i}].qty`, { min: 0.0001 })!;
      ins.run(productId, itemId, qty);
    }
  }

  function writeOptionGroups(productId: string, ids: unknown) {
    if (ids === undefined) return;
    if (!Array.isArray(ids)) throw bad('optionGroupIds must be an array');
    db.prepare('DELETE FROM product_option_groups WHERE product_id = ?').run(productId);
    const ins = db.prepare('INSERT INTO product_option_groups (product_id, group_id, sort) VALUES (?, ?, ?)');
    ids.forEach((g, i) => {
      if (typeof g !== 'string' || !db.prepare('SELECT 1 FROM option_groups WHERE id = ?').get(g)) throw bad(`option group ${g} not found`);
      ins.run(productId, g, i);
    });
  }

  r.post('/products', allow('owner'), (req, res) => {
    const b = (req.body ?? {}) as Row;
    const id = str(b.id, 'id', { optional: true, max: 64 }) ?? randomUUID();
    const name = reqStr(b.name, 'name');
    const price = reqInt(b.price, 'price', { min: 0, max: MAX_MONEY });
    tx(db, () => {
      if (db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(409, 'product id already exists');
      const sku = str(b.sku, 'sku', { optional: true, max: 64 }) ?? null;
      if (sku && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) throw new HttpError(409, 'sku already exists');
      const cat = resolveCategory(b.categoryId ?? b.category) ?? { id: null, name: '' };
      db.prepare(
        `INSERT INTO products (id, sku, barcode, name, category, category_id, image_url, price, cost, sort, stock, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        sku,
        str(b.barcode, 'barcode', { optional: true, max: 64 }) ?? null,
        name,
        cat.name,
        cat.id,
        str(b.imageUrl, 'imageUrl', { optional: true, max: 2000 }) ?? null,
        price,
        int(b.cost, 'cost', { optional: true, min: 0, max: MAX_MONEY }) ?? null,
        int(b.sort, 'sort', { optional: true }) ?? 0,
        b.active === false ? 0 : 1,
        now(),
      );
      writeRecipe(id, b.recipe);
      writeOptionGroups(id, b.optionGroupIds);
      logChange(db, 'product', id, 'upsert');
      audit(db, actorId(req), 'product.create', 'product', id, { name, price });
    });
    changed();
    res.status(201).json(getProduct(id));
  });

  r.put('/products/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    const b = (req.body ?? {}) as Row;
    tx(db, () => {
      const before = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!before) throw new HttpError(404, 'product not found');
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      const set = (col: string, v: string | number | null | undefined) => {
        if (v === undefined) return;
        sets.push(`${col} = ?`);
        params.push(v);
      };
      const sku = str(b.sku, 'sku', { optional: true, max: 64 });
      if (sku && db.prepare('SELECT 1 FROM products WHERE sku = ? AND id <> ?').get(sku, id)) throw new HttpError(409, 'sku already exists');
      set('sku', sku);
      set('barcode', str(b.barcode, 'barcode', { optional: true, max: 64 }));
      set('name', str(b.name, 'name', { optional: true }));
      set('image_url', b.imageUrl === null ? null : str(b.imageUrl, 'imageUrl', { optional: true, max: 2000 }));
      set('price', int(b.price, 'price', { optional: true, min: 0, max: MAX_MONEY }));
      set('cost', b.cost === null ? null : int(b.cost, 'cost', { optional: true, min: 0, max: MAX_MONEY }));
      set('sort', int(b.sort, 'sort', { optional: true }));
      if (b.active !== undefined) set('active', b.active ? 1 : 0);
      const cat = resolveCategory(b.categoryId ?? b.category);
      if (cat) (set('category_id', cat.id), set('category', cat.name));
      set('updated_at', now());
      db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      writeRecipe(id, b.recipe);
      writeOptionGroups(id, b.optionGroupIds);
      logChange(db, 'product', id, 'upsert');
      audit(db, actorId(req), 'product.update', 'product', id, { ...b, priceBefore: Number(before.price) });
    });
    changed();
    res.json(getProduct(id));
  });

  // Soft delete keeps order history readable.
  r.delete('/products/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    const result = tx(db, () => {
      const x = db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(now(), id);
      if (x.changes) {
        logChange(db, 'product', id, 'delete');
        audit(db, actorId(req), 'product.delete', 'product', id);
      }
      return x;
    });
    if (!result.changes) throw new HttpError(404, 'product not found');
    changed();
    res.status(204).end();
  });

  // ---------------------------------------------------------------- option groups (size, đá, đường, topping)
  r.get('/option-groups', (_req, res) => {
    res.json({ optionGroups: optionGroupsByProduct().all });
  });

  function writeGroup(id: string, b: Row, create: boolean) {
    const name = create ? reqStr(b.name, 'name', 64) : str(b.name, 'name', { optional: true, max: 64 });
    if (create) {
      db.prepare('INSERT INTO option_groups (id, name, multi, required) VALUES (?, ?, ?, ?)').run(id, name!, b.multi ? 1 : 0, b.required ? 1 : 0);
    } else {
      const x = db
        .prepare('UPDATE option_groups SET name = COALESCE(?, name), multi = COALESCE(?, multi), required = COALESCE(?, required) WHERE id = ?')
        .run(name ?? null, b.multi === undefined ? null : b.multi ? 1 : 0, b.required === undefined ? null : b.required ? 1 : 0, id);
      if (!x.changes) throw new HttpError(404, 'option group not found');
    }
    if (b.options !== undefined) {
      if (!Array.isArray(b.options) || !b.options.length) throw bad('options must be a non-empty array');
      db.prepare('DELETE FROM options WHERE group_id = ?').run(id);
      const ins = db.prepare('INSERT INTO options (id, group_id, name, price_delta, sort) VALUES (?, ?, ?, ?, ?)');
      b.options.forEach((raw: unknown, i: number) => {
        const o = (raw ?? {}) as Row;
        ins.run(
          str(o.id, `options[${i}].id`, { optional: true, max: 64 }) ?? randomUUID(),
          id,
          reqStr(o.name, `options[${i}].name`, 64),
          int(o.priceDelta, `options[${i}].priceDelta`, { optional: true, min: -MAX_MONEY, max: MAX_MONEY }) ?? 0,
          i,
        );
      });
    }
  }

  r.post('/option-groups', allow('owner'), (req, res) => {
    const id = randomUUID();
    tx(db, () => writeGroup(id, (req.body ?? {}) as Row, true));
    audit(db, actorId(req), 'option_group.create', 'option_group', id, req.body);
    changed();
    res.status(201).json(optionGroupsByProduct().all.find((g) => g.id === id));
  });

  r.put('/option-groups/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    tx(db, () => writeGroup(id, (req.body ?? {}) as Row, false));
    audit(db, actorId(req), 'option_group.update', 'option_group', id, req.body);
    changed();
    res.json(optionGroupsByProduct().all.find((g) => g.id === id));
  });

  // ---------------------------------------------------------------- tables
  const tableDto = (t: Row) => ({ id: t.id as string, name: t.name as string, area: t.area as string, sort: Number(t.sort), active: Number(t.active) === 1 });

  r.get('/tables', (_req, res) => {
    res.json({ tables: db.prepare('SELECT * FROM dining_tables WHERE active = 1 ORDER BY area, sort, name').all().map(tableDto) });
  });

  r.post('/tables', allow('owner'), (req, res) => {
    const id = randomUUID();
    db.prepare('INSERT INTO dining_tables (id, name, area, sort) VALUES (?, ?, ?, ?)').run(
      id,
      reqStr(req.body?.name, 'name', 32),
      str(req.body?.area, 'area', { optional: true, max: 32 }) ?? '',
      int(req.body?.sort, 'sort', { optional: true }) ?? 0,
    );
    audit(db, actorId(req), 'table.create', 'table', id, req.body);
    changed();
    res.status(201).json(tableDto(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(id)!));
  });

  r.put('/tables/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    const x = db
      .prepare('UPDATE dining_tables SET name = COALESCE(?, name), area = COALESCE(?, area), sort = COALESCE(?, sort), active = COALESCE(?, active) WHERE id = ?')
      .run(
        str(req.body?.name, 'name', { optional: true, max: 32 }) ?? null,
        str(req.body?.area, 'area', { optional: true, max: 32 }) ?? null,
        int(req.body?.sort, 'sort', { optional: true }) ?? null,
        req.body?.active === undefined ? null : req.body.active ? 1 : 0,
        id,
      );
    if (!x.changes) throw new HttpError(404, 'table not found');
    changed();
    res.json(tableDto(db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(id)!));
  });

  return r;
}
