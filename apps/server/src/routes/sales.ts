import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, type Row, audit, logChange, now, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { publish } from '../events.ts';
import { applyOrderStock, productUnitCost } from '../inventory.ts';
import { createNotification } from '../notifications.ts';
import { expectedCash, rowToShift, summarize } from '../reports.ts';
import { HttpError, MAX_MONEY, bad, int, isoDate, reqInt, reqStr, str } from '../validate.ts';

export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;
export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;

const fmt = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;

export function orderDto(db: DB, r: Row) {
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(r.id as string)
    .map((i) => ({
      productId: (i.product_id as string | null) ?? null,
      name: i.name as string,
      category: i.category as string,
      price: Number(i.price),
      qty: Number(i.qty),
      lineTotal: Number(i.line_total),
      note: (i.note as string) ?? '',
      options: (i.options as string) ?? '',
    }));
  return {
    id: r.id as string,
    number: r.number as string,
    deviceId: r.device_id as string,
    shiftId: (r.shift_id as string | null) ?? null,
    cashierId: (r.cashier_id as string | null) ?? null,
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
    status: r.status as 'completed' | 'voided' | 'refunded',
    statusReason: (r.status_reason as string) ?? '',
    statusAt: (r.status_at as string | null) ?? null,
    refundAmount: Number(r.refund_amount ?? 0),
    costTotal: r.cost_total === null || r.cost_total === undefined ? null : Number(r.cost_total),
    createdAt: r.created_at as string,
    receivedAt: r.received_at as string,
    items,
  };
}

export function salesRoutes(db: DB) {
  const r = Router();
  const getOrderRow = (id: string) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

  // ---------------------------------------------------------------- orders
  r.post('/orders', allow('cashier'), (req, res) => {
    const b = (req.body ?? {}) as Row;
    const id = reqStr(b.id, 'id', 64);
    const existing = getOrderRow(id);
    if (existing) {
      res.status(200).json({ ...orderDto(db, existing), duplicate: true });
      return;
    }

    if (!Array.isArray(b.items) || b.items.length === 0) throw bad('items must be a non-empty array');
    if (b.items.length > 500) throw bad('too many items');
    const productInfo = db.prepare('SELECT p.id, COALESCE(c.name, p.category) AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?');
    const items = b.items.map((raw: unknown, i: number) => {
      const it = (raw ?? {}) as Row;
      const price = reqInt(it.price, `items[${i}].price`, { min: 0, max: MAX_MONEY });
      const qty = reqInt(it.qty, `items[${i}].qty`, { min: 1, max: 100_000 });
      let productId = str(it.productId, `items[${i}].productId`, { optional: true, max: 64 }) ?? null;
      const info = productId ? productInfo.get(productId) : undefined;
      if (productId && !info) productId = null; // product deleted meanwhile: keep the sale, skip stock
      const rawIds = it.optionIds;
      if (rawIds !== undefined && (!Array.isArray(rawIds) || rawIds.length > 20 || rawIds.some((x) => typeof x !== 'string'))) {
        throw bad(`items[${i}].optionIds must be an array of ids`);
      }
      // Unknown option ids (deleted meanwhile) are ignored for stock but the sale is kept.
      const optionIds = ((rawIds as string[] | undefined) ?? []).filter((x) => db.prepare('SELECT 1 FROM options WHERE id = ?').get(x));
      const unitCost = productId ? productUnitCost(db, productId, optionIds) : null;
      return {
        productId,
        name: reqStr(it.name, `items[${i}].name`),
        category: (info?.category as string) ?? '',
        price,
        qty,
        lineTotal: price * qty,
        note: str(it.note, `items[${i}].note`, { optional: true, max: 200 }) ?? '',
        options: str(it.options, `items[${i}].options`, { optional: true, max: 300 }) ?? '',
        optionIds,
        unitCost,
      };
    });
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const discount = int(b.discount, 'discount', { optional: true, min: 0, max: subtotal }) ?? 0;
    const total = subtotal - discount;
    // A QR payment is a bank transfer; older terminals may still send 'qr'.
    const rawMethod = reqStr(b.paymentMethod, 'paymentMethod');
    const paymentMethod = rawMethod === 'qr' ? 'transfer' : rawMethod;
    if (!(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) throw bad(`paymentMethod must be one of ${PAYMENT_METHODS.join(', ')}`);
    const paid = reqInt(b.paid, 'paid', { min: 0, max: MAX_MONEY });
    if (paid < total) throw bad('paid is less than total');
    const change = paid - total;
    if (paymentMethod !== 'cash' && change !== 0) throw bad('only cash payments can have change');
    const orderType = str(b.orderType, 'orderType', { optional: true, max: 16 }) ?? 'dine_in';
    if (!(ORDER_TYPES as readonly string[]).includes(orderType)) throw bad('orderType must be dine_in, takeaway or delivery');
    const createdAt = isoDate(b.createdAt, 'createdAt', true) ?? now();
    const deviceId = reqStr(b.deviceId, 'deviceId', 64);
    const number = reqStr(b.number, 'number', 32);
    const shiftId = str(b.shiftId, 'shiftId', { optional: true, max: 64 }) ?? null;
    if (shiftId && !db.prepare('SELECT 1 FROM shifts WHERE id = ?').get(shiftId)) throw bad('shiftId not found');
    // The logged-in user is the cashier; an API-key client may name one explicitly.
    const cashierId = actorId(req) ?? str(b.cashierId, 'cashierId', { optional: true, max: 64 }) ?? null;
    const cashierName =
      (cashierId && (db.prepare('SELECT name FROM users WHERE id = ?').get(cashierId)?.name as string)) ||
      str(b.cashier, 'cashier', { optional: true, max: 64 }) ||
      '';
    const costTotal = items.every((it) => it.unitCost !== null) ? items.reduce((s, it) => s + it.unitCost! * it.qty, 0) : null;

    const created = tx(db, () => {
      // Re-check inside the write lock: two concurrent uploads of the same order must not both deduct stock.
      if (getOrderRow(id)) return false;
      db.prepare(
        `INSERT INTO orders (id, number, device_id, shift_id, cashier_id, cashier, order_type, table_name, note, subtotal, discount, total,
                             payment_method, paid, change_due, status, cost_total, created_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      ).run(
        id, number, deviceId, shiftId, cashierId, cashierName, orderType,
        str(b.tableName, 'tableName', { optional: true, max: 32 }) ?? '',
        str(b.note, 'note', { optional: true, max: 500 }) ?? '',
        subtotal, discount, total, paymentMethod, paid, change, costTotal, createdAt, now(),
      );
      const ins = db.prepare(
        'INSERT INTO order_items (order_id, product_id, name, category, price, qty, line_total, note, options, option_ids, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const it of items) ins.run(id, it.productId, it.name, it.category, it.price, it.qty, it.lineTotal, it.note, it.options, it.optionIds.join(','), it.unitCost);
      applyOrderStock(db, id, items, -1, { type: 'sale', userId: cashierId });
      logChange(db, 'order', id, 'upsert');
      return true;
    });
    const dto = orderDto(db, getOrderRow(id)!);
    if (!created) {
      res.status(200).json({ ...dto, duplicate: true });
      return;
    }
    setImmediate(() => publish('order.created', dto));
    res.status(201).json(dto);
  });

  r.get('/orders', (req, res) => {
    const from = isoDate(req.query.from, 'from', true);
    const to = isoDate(req.query.to, 'to', true);
    const where: string[] = [];
    const params: (string | number)[] = [];
    const eq = (col: string, v: unknown, name: string) => {
      const s = str(v, name, { optional: true, max: 64 });
      if (s) (where.push(`${col} = ?`), params.push(s));
    };
    if (from) (where.push('created_at >= ?'), params.push(from));
    if (to) (where.push('created_at < ?'), params.push(to));
    eq('device_id', req.query.deviceId, 'deviceId');
    eq('shift_id', req.query.shiftId, 'shiftId');
    eq('status', req.query.status, 'status');
    eq('order_type', req.query.orderType, 'orderType');
    eq('cashier_id', req.query.cashierId, 'cashierId');
    eq('payment_method', req.query.paymentMethod, 'paymentMethod');
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    params.push(limit);
    const rows = db
      .prepare(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...params);
    res.json({ orders: rows.map((x) => orderDto(db, x)) });
  });

  r.get('/orders/:id', (req, res) => {
    const row = getOrderRow(req.params.id as string);
    if (!row) throw new HttpError(404, 'order not found');
    res.json(orderDto(db, row));
  });

  function changeStatus(req: import('express').Request, kind: 'void' | 'refund') {
    const id = req.params.id as string;
    const reason = reqStr(req.body?.reason, 'reason', 200);
    const restock = kind === 'void' ? true : req.body?.restock === true;
    const shiftId = str(req.body?.shiftId, 'shiftId', { optional: true, max: 64 }) ?? null;
    const userId = actorId(req);
    const result = tx(db, () => {
      const row = getOrderRow(id);
      if (!row) throw new HttpError(404, 'order not found');
      if (row.status !== 'completed') throw new HttpError(409, `order is already ${row.status}`);
      const status = kind === 'void' ? 'voided' : 'refunded';
      db.prepare(
        'UPDATE orders SET status = ?, status_reason = ?, status_at = ?, status_by = ?, refund_amount = ?, refund_shift_id = ? WHERE id = ?',
      ).run(status, reason, now(), userId, kind === 'refund' ? Number(row.total) : 0, kind === 'refund' ? shiftId : null, id);
      if (restock) {
        const lines = db.prepare('SELECT product_id, qty, option_ids FROM order_items WHERE order_id = ?').all(id);
        applyOrderStock(
          db,
          id,
          lines.map((l) => ({
            productId: (l.product_id as string | null) ?? null,
            qty: Number(l.qty),
            optionIds: ((l.option_ids as string) || '').split(',').filter(Boolean),
          })),
          1,
          { type: kind, userId, reason },
        );
      }
      logChange(db, 'order', id, 'upsert');
      audit(db, userId, `order.${kind}`, 'order', id, { reason, restock });
      createNotification(db, {
        type: kind === 'void' ? 'order.voided' : 'order.refunded',
        title: `${kind === 'void' ? 'Huỷ đơn' : 'Hoàn tiền'} ${row.number}: ${fmt(Number(row.total))}`,
        body: `${req.user?.name ?? ''}: ${reason}`,
        data: { orderId: id },
      });
      return orderDto(db, getOrderRow(id)!);
    });
    setImmediate(() => publish('order.updated', result));
    return result;
  }

  r.post('/orders/:id/void', allow('cashier'), (req, res) => {
    res.json(changeStatus(req, 'void'));
  });
  r.post('/orders/:id/refund', allow('cashier'), (req, res) => {
    res.json(changeStatus(req, 'refund'));
  });

  // ---------------------------------------------------------------- shifts
  const shiftSelect = 'SELECT s.*, u.name AS cashier_name FROM shifts s LEFT JOIN users u ON u.id = s.cashier_id';
  const getShift = (id: string) => {
    const row = db.prepare(`${shiftSelect} WHERE s.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'shift not found');
    return row;
  };

  r.post('/shifts/open', allow('cashier'), (req, res) => {
    const deviceId = reqStr(req.body?.deviceId, 'deviceId', 64);
    const openingCash = int(req.body?.openingCash, 'openingCash', { optional: true, min: 0, max: MAX_MONEY }) ?? 0;
    const cashierId = actorId(req) ?? reqStr(req.body?.cashierId, 'cashierId', 64);
    const id = randomUUID();
    tx(db, () => {
      const open = db.prepare("SELECT id FROM shifts WHERE device_id = ? AND status = 'open'").get(deviceId);
      if (open) throw new HttpError(409, 'this device already has an open shift');
      db.prepare("INSERT INTO shifts (id, device_id, cashier_id, status, opened_at, opening_cash) VALUES (?, ?, ?, 'open', ?, ?)").run(
        id, deviceId, cashierId, now(), openingCash,
      );
      audit(db, cashierId, 'shift.open', 'shift', id, { deviceId, openingCash });
    });
    const dto = rowToShift(getShift(id));
    setImmediate(() => publish('shift.updated', dto));
    res.status(201).json(dto);
  });

  r.get('/shifts/current', (req, res) => {
    const deviceId = reqStr(req.query.deviceId, 'deviceId', 64);
    const row = db.prepare(`${shiftSelect} WHERE s.device_id = ? AND s.status = 'open'`).get(deviceId);
    res.json({ shift: row ? rowToShift(row) : null });
  });

  r.get('/shifts', (req, res) => {
    const from = isoDate(req.query.from, 'from', true) ?? '0000';
    const to = isoDate(req.query.to, 'to', true) ?? '9999';
    const rows = db.prepare(`${shiftSelect} WHERE s.opened_at >= ? AND s.opened_at < ? ORDER BY s.opened_at DESC LIMIT 200`).all(from, to);
    res.json({ shifts: rows.map(rowToShift) });
  });

  function shiftReport(id: string) {
    const s = getShift(id);
    const shift = rowToShift(s);
    const summary = summarize(db, { from: shift.openedAt, to: shift.closedAt ?? new Date(Date.now() + 1000).toISOString(), shiftId: id });
    const stocktakes = db.prepare('SELECT id, created_at FROM stocktakes WHERE shift_id = ? ORDER BY created_at').all(id);
    return {
      shift: { ...shift, expectedCash: shift.expectedCash ?? expectedCash(db, id) },
      summary,
      stocktakes: stocktakes.map((t) => ({ id: t.id as string, createdAt: t.created_at as string })),
    };
  }

  r.get('/shifts/:id/report', (req, res) => {
    res.json(shiftReport(req.params.id as string));
  });

  r.post('/shifts/:id/close', allow('cashier'), (req, res) => {
    const id = req.params.id as string;
    const countedCash = reqInt(req.body?.countedCash, 'countedCash', { min: 0, max: MAX_MONEY });
    const note = str(req.body?.note, 'note', { optional: true, max: 500 }) ?? '';
    tx(db, () => {
      const s = getShift(id);
      if (s.status !== 'open') throw new HttpError(409, 'shift is already closed');
      const expected = expectedCash(db, id);
      db.prepare("UPDATE shifts SET status = 'closed', closed_at = ?, closed_by = ?, counted_cash = ?, expected_cash = ?, note = ? WHERE id = ?").run(
        now(), actorId(req), countedCash, expected, note, id,
      );
      audit(db, actorId(req), 'shift.close', 'shift', id, { countedCash, expected });
    });
    const report = shiftReport(id);
    const diff = report.shift.cashDifference ?? 0;
    tx(db, () =>
      createNotification(db, {
        type: 'shift.closed',
        title: `Kết ca ${report.shift.cashierName ?? ''}: ${fmt(report.summary.netRevenue)}`,
        body: `${report.summary.orderCount} đơn · tiền mặt ${diff === 0 ? 'khớp' : `lệch ${diff > 0 ? '+' : ''}${fmt(diff)}`}`,
        data: { shiftId: id, netRevenue: report.summary.netRevenue, cashDifference: diff },
      }),
    );
    setImmediate(() => publish('shift.updated', report.shift));
    res.json(report);
  });

  return r;
}
