import { Router } from 'express';
import { type DB, type Row, audit, now, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { publish } from '../events.ts';
import { HttpError, MAX_MONEY, bad, int, reqStr, str } from '../validate.ts';

// Open (unpaid) orders: a table's running bill that can be edited from any POS and is visible
// to the owner as "Hoá đơn hiện tại". Paying converts it into a normal order (POST /orders)
// and the POS then deletes the open order. The cart is stored as opaque JSON owned by the POS.

const dto = (r: Row) => ({
  id: r.id as string,
  deviceId: r.device_id as string,
  tableName: r.table_name as string,
  orderType: r.order_type as string,
  note: r.note as string,
  itemCount: Number(r.item_count),
  total: Number(r.total),
  cart: JSON.parse(r.cart as string) as unknown,
  cashierId: (r.cashier_id as string | null) ?? null,
  cashierName: (r.cashier_name as string | null) ?? null,
  version: Number(r.version),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export function openOrderRoutes(db: DB) {
  const r = Router();
  const select = 'SELECT o.*, u.name AS cashier_name FROM open_orders o LEFT JOIN users u ON u.id = o.cashier_id';
  const changed = () => setImmediate(() => publish('open_orders.changed', { at: now() }));

  r.get('/open-orders', (_req, res) => {
    res.json({ openOrders: db.prepare(`${select} ORDER BY o.updated_at DESC`).all().map(dto) });
  });

  // Create or replace. `version` gives optimistic locking: two terminals editing the same bill
  // cannot silently overwrite each other (409 -> the POS reloads and retries).
  r.put('/open-orders/:id', allow('cashier'), (req, res) => {
    const id = reqStr(req.params.id, 'id', 64);
    const b = (req.body ?? {}) as Row;
    if (typeof b.cart !== 'object' || b.cart === null) throw bad('cart must be an object');
    const cart = JSON.stringify(b.cart);
    if (cart.length > 100_000) throw bad('cart too large');
    const version = int(b.version, 'version', { optional: true, min: 0 });
    const fields = {
      deviceId: reqStr(b.deviceId, 'deviceId', 64),
      tableName: str(b.tableName, 'tableName', { optional: true, max: 32 }) ?? '',
      orderType: str(b.orderType, 'orderType', { optional: true, max: 16 }) ?? 'dine_in',
      note: str(b.note, 'note', { optional: true, max: 500 }) ?? '',
      itemCount: int(b.itemCount, 'itemCount', { optional: true, min: 0, max: 100_000 }) ?? 0,
      total: int(b.total, 'total', { optional: true, min: 0, max: MAX_MONEY }) ?? 0,
    };
    const row = tx(db, () => {
      const cur = db.prepare('SELECT version FROM open_orders WHERE id = ?').get(id);
      if (cur && version !== undefined && Number(cur.version) !== version) {
        throw new HttpError(409, 'Đơn này vừa được sửa trên máy khác, hãy tải lại');
      }
      // One open bill per table (also when a bill is moved to another table).
      const clash =
        fields.tableName && fields.orderType === 'dine_in'
          ? db.prepare("SELECT id FROM open_orders WHERE table_name = ? AND order_type = 'dine_in' AND id <> ?").get(fields.tableName, id)
          : undefined;
      if (clash) throw new HttpError(409, `${fields.tableName} đang có đơn mở`);
      if (!cur) {
        db.prepare(
          `INSERT INTO open_orders (id, device_id, table_name, order_type, note, item_count, total, cart, cashier_id, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).run(id, fields.deviceId, fields.tableName, fields.orderType, fields.note, fields.itemCount, fields.total, cart, actorId(req), now(), now());
      } else {
        db.prepare(
          `UPDATE open_orders SET device_id = ?, table_name = ?, order_type = ?, note = ?, item_count = ?, total = ?, cart = ?,
             cashier_id = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        ).run(fields.deviceId, fields.tableName, fields.orderType, fields.note, fields.itemCount, fields.total, cart, actorId(req), now(), id);
      }
      return db.prepare(`${select} WHERE o.id = ?`).get(id)!;
    });
    changed();
    res.json(dto(row));
  });

  // Paid (the POS uploaded the real order) or cancelled before anything was served.
  r.delete('/open-orders/:id', allow('cashier'), (req, res) => {
    const id = req.params.id as string;
    const row = db.prepare('SELECT * FROM open_orders WHERE id = ?').get(id);
    if (row) {
      db.prepare('DELETE FROM open_orders WHERE id = ?').run(id);
      const reason = str(req.body?.reason, 'reason', { optional: true, max: 200 });
      // Cancelling a bill that had items is worth an audit entry; paying it is not.
      if (reason) audit(db, actorId(req), 'open_order.cancel', 'open_order', id, { reason, total: Number(row.total), tableName: row.table_name });
      changed();
    }
    res.status(204).end();
  });

  return r;
}
