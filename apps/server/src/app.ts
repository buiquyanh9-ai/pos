import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { type DB, logChange, now, tx } from './db.ts';
import { HttpError, MAX_MONEY, bad, int, isoDate, reqInt, reqStr, str } from './validate.ts';
import { hardwareRouter } from './hardwareRoutes.ts';

export const API_VERSION = '1';

export interface AppOptions {
  db: DB;
  /** When set, every /api route except /api/health requires header `x-api-key`. */
  apiKey?: string;
}

type Row = Record<string, unknown>;

function productDto(r: Row) {
  return {
    id: r.id as string,
    sku: (r.sku as string | null) ?? null,
    barcode: (r.barcode as string | null) ?? null,
    name: r.name as string,
    category: r.category as string,
    imageUrl: (r.image_url as string | null) ?? null,
    price: Number(r.price),
    stock: Number(r.stock),
    active: Number(r.active) === 1,
    updatedAt: r.updated_at as string,
  };
}

function orderDto(db: DB, r: Row) {
  const items = db
    .prepare('SELECT product_id, name, price, qty, line_total, note FROM order_items WHERE order_id = ? ORDER BY id')
    .all(r.id as string)
    .map((i) => ({
      productId: (i.product_id as string | null) ?? null,
      name: i.name as string,
      price: Number(i.price),
      qty: Number(i.qty),
      lineTotal: Number(i.line_total),
      note: (i.note as string) ?? '',
    }));
  return {
    id: r.id as string,
    number: r.number as string,
    deviceId: r.device_id as string,
    cashier: r.cashier as string,
    orderType: r.order_type as string,
    tableName: r.table_name as string,
    note: r.note as string,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    total: Number(r.total),
    paymentMethod: r.payment_method as string,
    paid: Number(r.paid),
    change: Number(r.change_due),
    status: r.status as string,
    createdAt: r.created_at as string,
    receivedAt: r.received_at as string,
    items,
  };
}

function keyMatches(given: string | undefined, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({ db, apiKey }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- Health (public): lets the POS "Test connection" button check URL and key.
  app.get('/api/health', (req, res) => {
    const given = req.header('x-api-key') ?? undefined;
    const auth = !apiKey ? 'disabled' : !given ? 'missing' : keyMatches(given, apiKey) ? 'ok' : 'invalid';
    res.json({ ok: true, service: 'shopflow-server', apiVersion: API_VERSION, time: now(), auth });
  });

  // ---- Auth for everything else under /api
  app.use('/api', (req, _res, next) => {
    if (!apiKey) return next();
    if (!keyMatches(req.header('x-api-key') ?? undefined, apiKey)) throw new HttpError(401, 'invalid or missing API key');
    next();
  });

  // ---- Products (catalog is managed by ShopFlow Boss, read by POS)
  app.get('/api/products', (req, res) => {
    const includeInactive = req.query.includeInactive === '1';
    const since = isoDate(req.query.since, 'since', true);
    const where: string[] = [];
    const params: string[] = [];
    if (!includeInactive) where.push('active = 1');
    if (since) {
      where.push('updated_at > ?');
      params.push(since);
    }
    const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name`;
    res.json({ products: db.prepare(sql).all(...params).map(productDto), serverTime: now() });
  });

  app.get('/api/products/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'product not found');
    res.json(productDto(row));
  });

  function readProductFields(body: Row, partial: boolean) {
    return {
      sku: str(body.sku, 'sku', { optional: true, max: 64 }),
      barcode: str(body.barcode, 'barcode', { optional: true, max: 64 }),
      name: partial ? str(body.name, 'name', { optional: true }) : reqStr(body.name, 'name'),
      category: str(body.category, 'category', { optional: true, max: 64 }),
      image_url: str(body.imageUrl, 'imageUrl', { optional: true, max: 2000 }),
      price: int(body.price, 'price', { optional: partial, min: 0, max: MAX_MONEY }),
      stock: int(body.stock, 'stock', { optional: true, min: -1_000_000, max: 1_000_000_000 }),
      active: body.active === undefined ? undefined : body.active ? 1 : 0,
    };
  }

  function uniqueSkuGuard(err: unknown): never {
    if (err instanceof Error && /UNIQUE constraint failed: products.sku/.test(err.message)) {
      throw new HttpError(409, 'sku already exists');
    }
    throw err;
  }

  app.post('/api/products', (req, res) => {
    const f = readProductFields(req.body ?? {}, false);
    const id = str(req.body?.id, 'id', { optional: true, max: 64 }) ?? randomUUID();
    const ts = now();
    try {
      tx(db, () => {
        db.prepare(
          `INSERT INTO products (id, sku, barcode, name, category, image_url, price, stock, active, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, f.sku ?? null, f.barcode ?? null, f.name!, f.category ?? '', f.image_url ?? null, f.price!, f.stock ?? 0, f.active ?? 1, ts);
        logChange(db, 'product', id, 'upsert');
      });
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: products.id/.test(err.message)) {
        throw new HttpError(409, 'product id already exists');
      }
      uniqueSkuGuard(err);
    }
    res.status(201).json(productDto(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!));
  });

  app.put('/api/products/:id', (req, res) => {
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'product not found');
    const f = readProductFields(req.body ?? {}, true);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    if (!sets.length) throw bad('no fields to update');
    sets.push('updated_at = ?');
    params.push(now(), id);
    try {
      tx(db, () => {
        db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        logChange(db, 'product', id, 'upsert');
      });
    } catch (err) {
      uniqueSkuGuard(err);
    }
    res.json(productDto(db.prepare('SELECT * FROM products WHERE id = ?').get(id)!));
  });

  // Soft delete: history (order_items) keeps referencing the product.
  app.delete('/api/products/:id', (req, res) => {
    const id = req.params.id;
    const result = tx(db, () => {
      const r = db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(now(), id);
      if (r.changes) logChange(db, 'product', id, 'delete');
      return r;
    });
    if (!result.changes) throw new HttpError(404, 'product not found');
    res.status(204).end();
  });

  // ---- Orders (created by POS; safe to retry thanks to client-generated id)
  app.post('/api/orders', (req, res) => {
    const b = (req.body ?? {}) as Row;
    const id = reqStr(b.id, 'id', 64);
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (existing) {
      res.status(200).json({ ...orderDto(db, existing), duplicate: true });
      return;
    }

    if (!Array.isArray(b.items) || b.items.length === 0) throw bad('items must be a non-empty array');
    if (b.items.length > 500) throw bad('too many items');
    const items = b.items.map((raw: unknown, i: number) => {
      const it = (raw ?? {}) as Row;
      const price = reqInt(it.price, `items[${i}].price`, { min: 0, max: MAX_MONEY });
      const qty = reqInt(it.qty, `items[${i}].qty`, { min: 1, max: 100_000 });
      return {
        productId: str(it.productId, `items[${i}].productId`, { optional: true, max: 64 }) ?? null,
        name: reqStr(it.name, `items[${i}].name`),
        price,
        qty,
        lineTotal: price * qty,
        note: str(it.note, `items[${i}].note`, { optional: true, max: 200 }) ?? '',
      };
    });
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const discount = int(b.discount, 'discount', { optional: true, min: 0, max: subtotal }) ?? 0;
    const total = subtotal - discount;
    const paymentMethod = reqStr(b.paymentMethod, 'paymentMethod');
    if (!['cash', 'card', 'transfer'].includes(paymentMethod)) throw bad('paymentMethod must be cash, card or transfer');
    const paid = reqInt(b.paid, 'paid', { min: 0, max: MAX_MONEY });
    if (paid < total) throw bad('paid is less than total');
    const change = paid - total;
    if (paymentMethod !== 'cash' && change !== 0) throw bad('only cash payments can have change');
    const createdAt = isoDate(b.createdAt, 'createdAt', true) ?? now();

    const deviceId = reqStr(b.deviceId, 'deviceId', 64);
    const number = reqStr(b.number, 'number', 32);
    const cashier = str(b.cashier, 'cashier', { optional: true, max: 64 }) ?? '';
    const orderType = str(b.orderType, 'orderType', { optional: true, max: 16 }) ?? 'dine_in';
    if (!['dine_in', 'takeaway', 'delivery'].includes(orderType)) throw bad('orderType must be dine_in, takeaway or delivery');
    const tableName = str(b.tableName, 'tableName', { optional: true, max: 32 }) ?? '';
    const note = str(b.note, 'note', { optional: true, max: 500 }) ?? '';

    tx(db, () => {
      db.prepare(
        `INSERT INTO orders (id, number, device_id, cashier, order_type, table_name, note, subtotal, discount, total, payment_method, paid, change_due, status, created_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      ).run(id, number, deviceId, cashier, orderType, tableName, note, subtotal, discount, total, paymentMethod, paid, change, createdAt, now());
      const insItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, name, price, qty, line_total, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      // Stock may go negative: an offline sale already happened and must be recorded.
      const decStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?');
      const ts = now();
      for (const it of items) {
        insItem.run(id, it.productId, it.name, it.price, it.qty, it.lineTotal, it.note);
        if (it.productId && decStock.run(it.qty, ts, it.productId).changes) logChange(db, 'product', it.productId, 'upsert');
      }
      logChange(db, 'order', id, 'upsert');
    });
    res.status(201).json(orderDto(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(id)!));
  });

  app.get('/api/orders', (req, res) => {
    const from = isoDate(req.query.from, 'from', true);
    const to = isoDate(req.query.to, 'to', true);
    const deviceId = str(req.query.deviceId, 'deviceId', { optional: true, max: 64 });
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (from) (where.push('created_at >= ?'), params.push(from));
    if (to) (where.push('created_at < ?'), params.push(to));
    if (deviceId) (where.push('device_id = ?'), params.push(deviceId));
    params.push(limit);
    const rows = db
      .prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...params);
    res.json({ orders: rows.map((r) => orderDto(db, r)) });
  });

  app.get('/api/orders/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!row) throw new HttpError(404, 'order not found');
    res.json(orderDto(db, row));
  });

  app.post('/api/orders/:id/void', (req, res) => {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'order not found');
    if (row.status !== 'voided') {
      tx(db, () => {
        db.prepare("UPDATE orders SET status = 'voided' WHERE id = ?").run(id);
        const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL').all(id);
        const inc = db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?');
        const ts = now();
        for (const it of items) {
          if (inc.run(Number(it.qty), ts, it.product_id as string).changes) logChange(db, 'product', it.product_id as string, 'upsert');
        }
        logChange(db, 'order', id, 'upsert');
      });
    }
    res.json(orderDto(db, db.prepare('SELECT * FROM orders WHERE id = ?').get(id)!));
  });

  // ---- Reports (for POS end-of-day and Boss dashboard)
  app.get('/api/reports/summary', (req, res) => {
    const from = isoDate(req.query.from, 'from');
    const to = isoDate(req.query.to, 'to');
    const base = "FROM orders WHERE status = 'completed' AND created_at >= ? AND created_at < ?";
    const totals = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount),0) AS discount ${base}`).get(from!, to!)!;
    const byPayment = db
      .prepare(`SELECT payment_method AS method, COUNT(*) AS n, SUM(total) AS amount ${base} GROUP BY payment_method`)
      .all(from!, to!)
      .map((r) => ({ method: r.method as string, count: Number(r.n), amount: Number(r.amount) }));
    const topProducts = db
      .prepare(
        `SELECT i.product_id AS productId, i.name AS name, SUM(i.qty) AS qty, SUM(i.line_total) AS amount
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?
         GROUP BY COALESCE(i.product_id, i.name) ORDER BY qty DESC LIMIT 10`,
      )
      .all(from!, to!)
      .map((r) => ({ productId: (r.productId as string | null) ?? null, name: r.name as string, qty: Number(r.qty), amount: Number(r.amount) }));
    res.json({ from, to, orderCount: Number(totals.n), revenue: Number(totals.revenue), discount: Number(totals.discount), byPayment, topProducts });
  });

  // ---- Sync feed for ShopFlow Boss: pull changes after a cursor, returns current snapshots.
  app.get('/api/sync/changes', (req, res) => {
    const since = Math.max(Number(req.query.since) || 0, 0);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const rows = db.prepare('SELECT * FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?').all(since, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
    const changes = page.map((c) => {
      const entityId = c.entity_id as string;
      const snap = c.entity === 'product' ? getProduct.get(entityId) : getOrder.get(entityId);
      const data = !snap ? null : c.entity === 'product' ? productDto(snap) : orderDto(db, snap);
      return { seq: Number(c.seq), entity: c.entity as string, id: entityId, op: c.op as string, at: c.at as string, data };
    });
    const cursor = page.length ? Number(page[page.length - 1].seq) : since;
    res.json({ changes, cursor, hasMore });
  });

  // ---- Devices (POS terminals and Boss apps report in)
  app.post('/api/devices/heartbeat', (req, res) => {
    const b = (req.body ?? {}) as Row;
    const id = reqStr(b.id, 'id', 64);
    const name = str(b.name, 'name', { optional: true, max: 64 }) ?? id;
    const kind = str(b.kind, 'kind', { optional: true, max: 16 }) ?? 'pos';
    const appVersion = str(b.appVersion, 'appVersion', { optional: true, max: 32 }) ?? null;
    db.prepare(
      `INSERT INTO devices (id, name, kind, app_version, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, app_version = excluded.app_version, last_seen = excluded.last_seen`,
    ).run(id, name, kind, appVersion, now());
    res.json({ ok: true, serverTime: now() });
  });

  app.get('/api/devices', (_req, res) => {
    const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all();
    res.json({
      devices: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, appVersion: r.app_version, lastSeen: r.last_seen })),
    });
  });

  app.use('/api/hardware', hardwareRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not found')));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'invalid JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
