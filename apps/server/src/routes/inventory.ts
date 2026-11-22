import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, type Row, audit, now, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { publish } from '../events.ts';
import { getItem, itemDto, moveDto, moveStock } from '../inventory.ts';
import { createNotification } from '../notifications.ts';
import { HttpError, MAX_MONEY, bad, int, isoDate, reqStr, str } from '../validate.ts';
import { num } from './catalog.ts';

const round = (n: number) => Math.round(n * 1000) / 1000;

export function inventoryRoutes(db: DB) {
  const r = Router();

  // ---------------------------------------------------------------- items
  r.get('/inventory/items', (req, res) => {
    const where = ['1=1'];
    if (req.query.includeInactive !== '1') where.push('active = 1');
    if (req.query.low === '1') where.push('qty < min_qty');
    if (req.query.kind === 'ingredient' || req.query.kind === 'goods') where.push(`kind = '${req.query.kind}'`);
    const rows = db.prepare(`SELECT * FROM inventory_items WHERE ${where.join(' AND ')} ORDER BY (qty < min_qty) DESC, name`).all();
    res.json({ items: rows.map(itemDto) });
  });

  r.get('/inventory/items/:id', (req, res) => {
    res.json(itemDto(getItem(db, req.params.id as string)));
  });

  function readItem(b: Row, create: boolean) {
    const kind = str(b.kind, 'kind', { optional: true, max: 16 });
    if (kind !== undefined && kind !== 'ingredient' && kind !== 'goods') throw bad('kind must be ingredient or goods');
    return {
      name: create ? reqStr(b.name, 'name', 100) : str(b.name, 'name', { optional: true, max: 100 }),
      unit: create ? reqStr(b.unit, 'unit', 16) : str(b.unit, 'unit', { optional: true, max: 16 }),
      kind,
      min_qty: num(b.minQty, 'minQty', { optional: true, min: 0 }),
      unit_cost: int(b.unitCost, 'unitCost', { optional: true, min: 0, max: MAX_MONEY }),
      supplier_id: b.supplierId === null ? null : str(b.supplierId, 'supplierId', { optional: true, max: 64 }),
      active: b.active === undefined ? undefined : b.active ? 1 : 0,
    };
  }

  r.post('/inventory/items', allow('stock'), (req, res) => {
    const b = (req.body ?? {}) as Row;
    const f = readItem(b, true);
    const id = str(b.id, 'id', { optional: true, max: 64 }) ?? randomUUID();
    const initial = num(b.qty, 'qty', { optional: true, min: 0 }) ?? 0;
    tx(db, () => {
      if (db.prepare('SELECT 1 FROM inventory_items WHERE id = ?').get(id)) throw new HttpError(409, 'item id already exists');
      db.prepare(
        'INSERT INTO inventory_items (id, name, unit, kind, qty, min_qty, unit_cost, supplier_id, active, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 1, ?)',
      ).run(id, f.name!, f.unit!, f.kind ?? 'ingredient', f.min_qty ?? 0, f.unit_cost ?? 0, f.supplier_id ?? null, now());
      if (initial) moveStock(db, id, initial, { type: 'adjust', userId: actorId(req), reason: 'Tồn đầu kỳ' });
      audit(db, actorId(req), 'inventory.create', 'inventory_item', id, b);
    });
    res.status(201).json(itemDto(getItem(db, id)));
  });

  r.put('/inventory/items/:id', allow('stock'), (req, res) => {
    const id = req.params.id as string;
    getItem(db, id);
    const f = readItem((req.body ?? {}) as Row, false);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(f)) if (v !== undefined) (sets.push(`${k} = ?`), params.push(v));
    if (!sets.length) throw bad('no fields to update');
    db.prepare(`UPDATE inventory_items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, now(), id);
    audit(db, actorId(req), 'inventory.update', 'inventory_item', id, req.body);
    setImmediate(() => publish('stock.changed', { at: now() }));
    res.json(itemDto(getItem(db, id)));
  });

  // Manual correction (spoilage, breakage, found stock). Either a signed delta or the new absolute qty.
  r.post('/inventory/items/:id/adjust', allow('stock'), (req, res) => {
    const id = req.params.id as string;
    const reason = reqStr(req.body?.reason, 'reason', 200);
    const delta = num(req.body?.delta, 'delta', { optional: true });
    const qty = num(req.body?.qty, 'qty', { optional: true, min: 0 });
    if ((delta === undefined) === (qty === undefined)) throw bad('send exactly one of delta or qty');
    tx(db, () => {
      const item = getItem(db, id);
      const d = delta ?? round(qty! - Number(item.qty));
      if (d === 0) return;
      moveStock(db, id, d, { type: 'adjust', userId: actorId(req), reason });
      audit(db, actorId(req), 'inventory.adjust', 'inventory_item', id, { delta: d, reason });
    });
    res.json(itemDto(getItem(db, id)));
  });

  r.get('/inventory/moves', (req, res) => {
    const where = ['1=1'];
    const params: (string | number)[] = [];
    const itemId = str(req.query.itemId, 'itemId', { optional: true, max: 64 });
    const type = str(req.query.type, 'type', { optional: true, max: 16 });
    const from = isoDate(req.query.from, 'from', true);
    const to = isoDate(req.query.to, 'to', true);
    if (itemId) (where.push('m.item_id = ?'), params.push(itemId));
    if (type) (where.push('m.type = ?'), params.push(type));
    if (from) (where.push('m.at >= ?'), params.push(from));
    if (to) (where.push('m.at < ?'), params.push(to));
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
    params.push(limit);
    const rows = db
      .prepare(
        `SELECT m.*, i.name AS item_name, i.unit, u.name AS user_name FROM stock_moves m
         JOIN inventory_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id
         WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT ?`,
      )
      .all(...params);
    res.json({ moves: rows.map(moveDto) });
  });

  // ---------------------------------------------------------------- stocktakes (end-of-shift counts)
  const stocktakeDto = (id: string) => {
    const t = db.prepare('SELECT t.*, u.name AS user_name FROM stocktakes t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(id);
    if (!t) throw new HttpError(404, 'stocktake not found');
    const lines = db
      .prepare('SELECT l.*, i.name, i.unit, i.unit_cost FROM stocktake_lines l JOIN inventory_items i ON i.id = l.item_id WHERE l.stocktake_id = ? ORDER BY ABS(l.diff) DESC, i.name')
      .all(id)
      .map((l) => ({
        itemId: l.item_id as string,
        name: l.name as string,
        unit: l.unit as string,
        expected: Number(l.expected),
        counted: Number(l.counted),
        diff: Number(l.diff),
        diffValue: Math.round(Number(l.diff) * Number(l.unit_cost)),
        reason: l.reason as string,
      }));
    return {
      id,
      shiftId: (t.shift_id as string | null) ?? null,
      userId: (t.user_id as string | null) ?? null,
      userName: (t.user_name as string | null) ?? null,
      note: t.note as string,
      createdAt: t.created_at as string,
      lines,
      varianceCount: lines.filter((l) => l.diff !== 0).length,
      varianceValue: lines.reduce((s, l) => s + l.diffValue, 0),
    };
  };

  r.post('/inventory/stocktakes', allow('stock', 'cashier'), (req, res) => {
    const b = (req.body ?? {}) as Row;
    if (!Array.isArray(b.lines) || !b.lines.length) throw bad('lines must be a non-empty array');
    const shiftId = str(b.shiftId, 'shiftId', { optional: true, max: 64 }) ?? null;
    const note = str(b.note, 'note', { optional: true, max: 500 }) ?? '';
    const id = randomUUID();
    const userId = actorId(req);
    tx(db, () => {
      db.prepare('INSERT INTO stocktakes (id, shift_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)').run(id, shiftId, userId, note, now());
      const ins = db.prepare('INSERT INTO stocktake_lines (stocktake_id, item_id, expected, counted, diff, reason) VALUES (?, ?, ?, ?, ?, ?)');
      const seen = new Set<string>();
      (b.lines as unknown[]).forEach((raw: unknown, i: number) => {
        const l = (raw ?? {}) as Row;
        const itemId = reqStr(l.itemId, `lines[${i}].itemId`, 64);
        if (seen.has(itemId)) throw bad(`item ${itemId} counted twice`);
        seen.add(itemId);
        const item = getItem(db, itemId);
        const counted = round(num(l.counted, `lines[${i}].counted`, { min: 0 })!);
        const expected = Number(item.qty);
        const diff = round(counted - expected);
        const reason = str(l.reason, `lines[${i}].reason`, { optional: true, max: 200 }) ?? '';
        if (diff !== 0 && !reason) throw bad(`lines[${i}]: reason is required when counted differs from expected (${item.name})`);
        ins.run(id, itemId, expected, counted, diff, reason);
        if (diff !== 0) moveStock(db, itemId, diff, { type: 'count', refType: 'stocktake', refId: id, userId, reason });
      });
      const dto = stocktakeDto(id);
      audit(db, userId, 'stocktake.create', 'stocktake', id, { varianceCount: dto.varianceCount });
      if (dto.varianceCount) {
        const top = dto.lines.filter((l) => l.diff !== 0).slice(0, 3).map((l) => `${l.name} ${l.diff > 0 ? '+' : ''}${l.diff} ${l.unit}`);
        createNotification(db, {
          type: 'stock.variance',
          title: `Chênh lệch kho: ${dto.varianceCount} mặt hàng`,
          body: `${top.join(', ')}${dto.varianceCount > 3 ? '…' : ''} (${dto.userName ?? ''})`,
          data: { stocktakeId: id, varianceValue: dto.varianceValue },
        });
      }
    });
    res.status(201).json(stocktakeDto(id));
  });

  r.get('/inventory/stocktakes', (req, res) => {
    const from = isoDate(req.query.from, 'from', true) ?? '0000';
    const to = isoDate(req.query.to, 'to', true) ?? '9999';
    const ids = db.prepare('SELECT id FROM stocktakes WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 100').all(from, to);
    res.json({ stocktakes: ids.map((x) => stocktakeDto(x.id as string)) });
  });

  r.get('/inventory/stocktakes/:id', (req, res) => {
    res.json(stocktakeDto(req.params.id as string));
  });

  // ---------------------------------------------------------------- suppliers
  const supplierDto = (s: Row) => ({ id: s.id as string, name: s.name as string, phone: s.phone as string, note: s.note as string, active: Number(s.active) === 1 });
  r.get('/suppliers', (_req, res) => {
    res.json({ suppliers: db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all().map(supplierDto) });
  });
  r.post('/suppliers', allow('stock'), (req, res) => {
    const id = randomUUID();
    db.prepare('INSERT INTO suppliers (id, name, phone, note) VALUES (?, ?, ?, ?)').run(
      id,
      reqStr(req.body?.name, 'name', 100),
      str(req.body?.phone, 'phone', { optional: true, max: 32 }) ?? '',
      str(req.body?.note, 'note', { optional: true, max: 500 }) ?? '',
    );
    audit(db, actorId(req), 'supplier.create', 'supplier', id, req.body);
    res.status(201).json(supplierDto(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id)!));
  });
  r.put('/suppliers/:id', allow('stock'), (req, res) => {
    const id = req.params.id as string;
    const x = db
      .prepare('UPDATE suppliers SET name = COALESCE(?, name), phone = COALESCE(?, phone), note = COALESCE(?, note), active = COALESCE(?, active) WHERE id = ?')
      .run(
        str(req.body?.name, 'name', { optional: true, max: 100 }) ?? null,
        str(req.body?.phone, 'phone', { optional: true, max: 32 }) ?? null,
        str(req.body?.note, 'note', { optional: true, max: 500 }) ?? null,
        req.body?.active === undefined ? null : req.body.active ? 1 : 0,
        id,
      );
    if (!x.changes) throw new HttpError(404, 'supplier not found');
    res.json(supplierDto(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id)!));
  });

  // ---------------------------------------------------------------- purchase requests (đề xuất nhập hàng)
  const purchaseDto = (id: string) => {
    const p = db
      .prepare(
        `SELECT p.*, s.name AS supplier_name, cu.name AS created_name, du.name AS decided_name, ru.name AS received_name
         FROM purchase_requests p LEFT JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users du ON du.id = p.decided_by LEFT JOIN users ru ON ru.id = p.received_by
         WHERE p.id = ?`,
      )
      .get(id);
    if (!p) throw new HttpError(404, 'purchase request not found');
    const lines = db
      .prepare('SELECT l.*, i.name, i.unit, i.qty AS stock, i.min_qty FROM purchase_lines l JOIN inventory_items i ON i.id = l.item_id WHERE l.request_id = ? ORDER BY i.name')
      .all(id)
      .map((l) => ({
        itemId: l.item_id as string,
        name: l.name as string,
        unit: l.unit as string,
        qty: Number(l.qty),
        unitCost: Number(l.unit_cost),
        receivedQty: l.received_qty === null ? null : Number(l.received_qty),
        currentStock: Number(l.stock),
        minQty: Number(l.min_qty),
      }));
    return {
      id,
      status: p.status as 'pending' | 'approved' | 'rejected' | 'received',
      supplierId: (p.supplier_id as string | null) ?? null,
      supplierName: (p.supplier_name as string | null) ?? null,
      note: p.note as string,
      decisionNote: p.decision_note as string,
      createdBy: (p.created_name as string | null) ?? null,
      decidedBy: (p.decided_name as string | null) ?? null,
      receivedBy: (p.received_name as string | null) ?? null,
      createdAt: p.created_at as string,
      decidedAt: (p.decided_at as string | null) ?? null,
      receivedAt: (p.received_at as string | null) ?? null,
      lines,
      totalCost: Math.round(lines.reduce((s, l) => s + (l.receivedQty ?? l.qty) * l.unitCost, 0)),
    };
  };
  const purchasePublish = (id: string) => setImmediate(() => publish('purchase.updated', purchaseDto(id)));

  /** Suggested order: items below minimum, topped up to 2x minimum. */
  r.get('/purchases/suggestions', (_req, res) => {
    const rows = db.prepare('SELECT * FROM inventory_items WHERE active = 1 AND min_qty > 0 AND qty < min_qty ORDER BY name').all();
    res.json({
      lines: rows.map((i) => ({
        itemId: i.id as string,
        name: i.name as string,
        unit: i.unit as string,
        currentStock: Number(i.qty),
        minQty: Number(i.min_qty),
        qty: round(Math.max(Number(i.min_qty) * 2 - Number(i.qty), 0)),
        unitCost: Number(i.unit_cost),
        supplierId: (i.supplier_id as string | null) ?? null,
      })),
    });
  });

  r.get('/purchases', (req, res) => {
    const status = str(req.query.status, 'status', { optional: true, max: 16 });
    const rows = status
      ? db.prepare('SELECT id FROM purchase_requests WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
      : db.prepare('SELECT id FROM purchase_requests ORDER BY created_at DESC LIMIT 200').all();
    res.json({ purchases: rows.map((x) => purchaseDto(x.id as string)) });
  });

  r.get('/purchases/:id', (req, res) => {
    res.json(purchaseDto(req.params.id as string));
  });

  r.post('/purchases', allow('stock'), (req, res) => {
    const b = (req.body ?? {}) as Row;
    if (!Array.isArray(b.lines) || !b.lines.length) throw bad('lines must be a non-empty array');
    const supplierId = str(b.supplierId, 'supplierId', { optional: true, max: 64 }) ?? null;
    if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('supplierId not found');
    const id = randomUUID();
    const userId = actorId(req);
    // Owner-created requests are approved straight away.
    const status = req.user?.role === 'owner' ? 'approved' : 'pending';
    tx(db, () => {
      db.prepare(
        'INSERT INTO purchase_requests (id, supplier_id, status, note, created_by, created_at, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, supplierId, status, str(b.note, 'note', { optional: true, max: 500 }) ?? '', userId, now(), status === 'approved' ? userId : null, status === 'approved' ? now() : null);
      const ins = db.prepare('INSERT INTO purchase_lines (request_id, item_id, qty, unit_cost) VALUES (?, ?, ?, ?)');
      const seen = new Set<string>();
      (b.lines as unknown[]).forEach((raw: unknown, i: number) => {
        const l = (raw ?? {}) as Row;
        const itemId = reqStr(l.itemId, `lines[${i}].itemId`, 64);
        if (seen.has(itemId)) throw bad(`item ${itemId} listed twice`);
        seen.add(itemId);
        const item = getItem(db, itemId);
        ins.run(id, itemId, num(l.qty, `lines[${i}].qty`, { min: 0.001 })!, int(l.unitCost, `lines[${i}].unitCost`, { optional: true, min: 0, max: MAX_MONEY }) ?? Number(item.unit_cost));
      });
      audit(db, userId, 'purchase.create', 'purchase', id, { status });
      if (status === 'pending') {
        const dto = purchaseDto(id);
        createNotification(db, {
          type: 'purchase.pending',
          title: `Đề xuất nhập hàng chờ duyệt (${dto.lines.length} mặt hàng)`,
          body: `${dto.createdBy ?? ''}${dto.supplierName ? ` · ${dto.supplierName}` : ''} · dự kiến ${new Intl.NumberFormat('vi-VN').format(dto.totalCost)}đ`,
          data: { purchaseId: id },
        });
      }
    });
    purchasePublish(id);
    res.status(201).json(purchaseDto(id));
  });

  function decide(req: import('express').Request, approve: boolean) {
    const id = req.params.id as string;
    tx(db, () => {
      const p = purchaseDto(id);
      if (p.status !== 'pending') throw new HttpError(409, `request is already ${p.status}`);
      db.prepare('UPDATE purchase_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?').run(
        approve ? 'approved' : 'rejected',
        actorId(req),
        now(),
        str(req.body?.note, 'note', { optional: true, max: 500 }) ?? '',
        id,
      );
      audit(db, actorId(req), approve ? 'purchase.approve' : 'purchase.reject', 'purchase', id, req.body);
      createNotification(db, {
        type: 'purchase.decided',
        title: `Đề xuất nhập hàng đã được ${approve ? 'duyệt' : 'từ chối'}`,
        body: str(req.body?.note, 'note', { optional: true, max: 500 }) ?? '',
        data: { purchaseId: id },
        roles: ['stock'],
      });
    });
    purchasePublish(id);
    return purchaseDto(id);
  }

  r.post('/purchases/:id/approve', allow('owner'), (req, res) => {
    res.json(decide(req, true));
  });
  r.post('/purchases/:id/reject', allow('owner'), (req, res) => {
    res.json(decide(req, false));
  });

  // Goods arrived: add to stock (actual quantities may differ from the request) and update unit cost.
  r.post('/purchases/:id/receive', allow('stock'), (req, res) => {
    const id = req.params.id as string;
    const userId = actorId(req);
    const overrides = new Map<string, { qty?: number; unitCost?: number }>();
    if (req.body?.lines !== undefined) {
      if (!Array.isArray(req.body.lines)) throw bad('lines must be an array');
      req.body.lines.forEach((raw: unknown, i: number) => {
        const l = (raw ?? {}) as Row;
        overrides.set(reqStr(l.itemId, `lines[${i}].itemId`, 64), {
          qty: num(l.receivedQty, `lines[${i}].receivedQty`, { optional: true, min: 0 }),
          unitCost: int(l.unitCost, `lines[${i}].unitCost`, { optional: true, min: 0, max: MAX_MONEY }),
        });
      });
    }
    tx(db, () => {
      const p = purchaseDto(id);
      if (p.status !== 'approved') throw new HttpError(409, p.status === 'pending' ? 'request must be approved by the owner first' : `request is ${p.status}`);
      for (const l of p.lines) {
        const o = overrides.get(l.itemId) ?? {};
        const qty = o.qty ?? l.qty;
        const unitCost = o.unitCost ?? l.unitCost;
        db.prepare('UPDATE purchase_lines SET received_qty = ?, unit_cost = ? WHERE request_id = ? AND item_id = ?').run(qty, unitCost, id, l.itemId);
        if (qty > 0) {
          moveStock(db, l.itemId, qty, { type: 'import', refType: 'purchase', refId: id, userId, reason: p.supplierName ? `Nhập từ ${p.supplierName}` : 'Nhập hàng' });
          if (unitCost > 0) db.prepare('UPDATE inventory_items SET unit_cost = ? WHERE id = ?').run(unitCost, l.itemId);
        }
      }
      db.prepare("UPDATE purchase_requests SET status = 'received', received_by = ?, received_at = ? WHERE id = ?").run(userId, now(), id);
      audit(db, userId, 'purchase.receive', 'purchase', id, req.body);
    });
    purchasePublish(id);
    res.json(purchaseDto(id));
  });

  return r;
}
