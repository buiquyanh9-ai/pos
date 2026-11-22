import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, type Row, audit, now, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { getItem, moveStock } from '../inventory.ts';
import { createNotification } from '../notifications.ts';
import { HttpError, bad, reqStr, str } from '../validate.ts';
import { num } from './catalog.ts';

// Estimate stock (rice, vegetables, tea) is not derived from sales. The kitchen declares what it
// takes from storage at the start of the day/shift, may top up, and at closing reports what is
// left (returned to storage) and what was wasted. Usage = issued + added - remaining - waste.

const round = (n: number) => Math.round(n * 1000) / 1000;

export function kitchenRoutes(db: DB) {
  const r = Router();

  const sessionDto = (id: string) => {
    const s = db
      .prepare(
        `SELECT k.*, ou.name AS opened_name, cu.name AS closed_name FROM kitchen_sessions k
         LEFT JOIN users ou ON ou.id = k.opened_by LEFT JOIN users cu ON cu.id = k.closed_by WHERE k.id = ?`,
      )
      .get(id);
    if (!s) throw new HttpError(404, 'kitchen session not found');
    const lines = db
      .prepare('SELECT l.*, i.name, i.unit, i.unit_cost FROM kitchen_lines l JOIN inventory_items i ON i.id = l.item_id WHERE l.session_id = ? ORDER BY i.name')
      .all(id)
      .map((l) => {
        const issued = Number(l.issued);
        const added = Number(l.added);
        const remaining = l.remaining === null ? null : Number(l.remaining);
        const waste = l.waste === null ? null : Number(l.waste);
        return {
          itemId: l.item_id as string,
          name: l.name as string,
          unit: l.unit as string,
          issued,
          added,
          remaining,
          waste,
          used: remaining === null ? null : round(issued + added - remaining - (waste ?? 0)),
          reason: l.reason as string,
        };
      });
    return {
      id,
      status: s.status as 'open' | 'closed',
      shiftId: (s.shift_id as string | null) ?? null,
      openedAt: s.opened_at as string,
      openedBy: (s.opened_name as string | null) ?? null,
      closedAt: (s.closed_at as string | null) ?? null,
      closedBy: (s.closed_name as string | null) ?? null,
      note: s.note as string,
      lines,
    };
  };

  /** Current open session + the estimate items with their usual opening amounts. */
  r.get('/kitchen/current', (_req, res) => {
    const open = db.prepare("SELECT id FROM kitchen_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1").get();
    const items = db
      .prepare("SELECT id, name, unit, qty, default_issue FROM inventory_items WHERE active = 1 AND tracking = 'estimate' ORDER BY name")
      .all()
      .map((i) => ({ itemId: i.id as string, name: i.name as string, unit: i.unit as string, stock: Number(i.qty), defaultIssue: i.default_issue === null ? null : Number(i.default_issue) }));
    res.json({ session: open ? sessionDto(open.id as string) : null, items });
  });

  r.get('/kitchen/sessions', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const ids = db.prepare('SELECT id FROM kitchen_sessions ORDER BY opened_at DESC LIMIT ?').all(limit);
    res.json({ sessions: ids.map((x) => sessionDto(x.id as string)) });
  });

  function readQtyLines(raw: unknown, field: string) {
    if (!Array.isArray(raw) || !raw.length) throw bad(`${field} must be a non-empty array`);
    const seen = new Set<string>();
    return (raw as unknown[]).map((x, i) => {
      const l = (x ?? {}) as Row;
      const itemId = reqStr(l.itemId, `${field}[${i}].itemId`, 64);
      if (seen.has(itemId)) throw bad(`${field}: item ${itemId} listed twice`);
      seen.add(itemId);
      getItem(db, itemId);
      return { itemId, qty: round(num(l.qty, `${field}[${i}].qty`, { min: 0 })!) };
    });
  }

  // Start of day/shift: issue rice / vegetables / tea from storage to the kitchen.
  r.post('/kitchen/open', allow('cashier'), (req, res) => {
    const lines = readQtyLines(req.body?.lines, 'lines');
    const shiftId = str(req.body?.shiftId, 'shiftId', { optional: true, max: 64 }) ?? null;
    const userId = actorId(req);
    const id = randomUUID();
    tx(db, () => {
      if (db.prepare("SELECT 1 FROM kitchen_sessions WHERE status = 'open'").get()) throw new HttpError(409, 'Đã có phiên xuất bếp đang mở. Hãy chốt cuối ca trước.');
      db.prepare("INSERT INTO kitchen_sessions (id, status, shift_id, opened_at, opened_by, note) VALUES (?, 'open', ?, ?, ?, ?)").run(
        id, shiftId, now(), userId, str(req.body?.note, 'note', { optional: true, max: 500 }) ?? '',
      );
      for (const l of lines) {
        db.prepare('INSERT INTO kitchen_lines (session_id, item_id, issued) VALUES (?, ?, ?)').run(id, l.itemId, l.qty);
        if (l.qty > 0) moveStock(db, l.itemId, -l.qty, { type: 'issue', refType: 'kitchen', refId: id, userId, reason: 'Xuất bếp đầu ca' });
      }
      audit(db, userId, 'kitchen.open', 'kitchen', id, { lines });
    });
    res.status(201).json(sessionDto(id));
  });

  // Top-up during the shift (e.g. cook another 5 kg of rice).
  r.post('/kitchen/:id/add', allow('cashier'), (req, res) => {
    const id = req.params.id as string;
    const lines = readQtyLines(req.body?.lines, 'lines');
    const userId = actorId(req);
    tx(db, () => {
      if (sessionDto(id).status !== 'open') throw new HttpError(409, 'session is closed');
      for (const l of lines) {
        if (!l.qty) continue;
        db.prepare(
          'INSERT INTO kitchen_lines (session_id, item_id, added) VALUES (?, ?, ?) ON CONFLICT(session_id, item_id) DO UPDATE SET added = added + excluded.added',
        ).run(id, l.itemId, l.qty);
        moveStock(db, l.itemId, -l.qty, { type: 'issue', refType: 'kitchen', refId: id, userId, reason: 'Xuất bếp bổ sung' });
      }
      audit(db, userId, 'kitchen.add', 'kitchen', id, { lines });
    });
    res.json(sessionDto(id));
  });

  // End of shift: what is left goes back to storage; waste is recorded (already out of storage).
  r.post('/kitchen/:id/close', allow('cashier'), (req, res) => {
    const id = req.params.id as string;
    const raw = req.body?.lines;
    if (!Array.isArray(raw)) throw bad('lines must be an array');
    const userId = actorId(req);
    tx(db, () => {
      const s = sessionDto(id);
      if (s.status !== 'open') throw new HttpError(409, 'session is already closed');
      const given = new Map<string, { remaining: number; waste: number; reason: string }>();
      (raw as unknown[]).forEach((x, i) => {
        const l = (x ?? {}) as Row;
        given.set(reqStr(l.itemId, `lines[${i}].itemId`, 64), {
          remaining: round(num(l.remaining, `lines[${i}].remaining`, { min: 0 })!),
          waste: round(num(l.waste, `lines[${i}].waste`, { optional: true, min: 0 }) ?? 0),
          reason: str(l.reason, `lines[${i}].reason`, { optional: true, max: 200 }) ?? '',
        });
      });
      for (const l of s.lines) {
        const g = given.get(l.itemId);
        if (!g) throw bad(`thiếu số liệu cuối ca cho ${l.name}`);
        if (g.remaining + g.waste > l.issued + l.added + 1e-9) throw bad(`${l.name}: còn lại + hao hụt lớn hơn lượng đã xuất`);
        if (g.waste > 0 && !g.reason) throw bad(`${l.name}: cần ghi lý do hao hụt`);
        db.prepare('UPDATE kitchen_lines SET remaining = ?, waste = ?, reason = ? WHERE session_id = ? AND item_id = ?').run(g.remaining, g.waste, g.reason, id, l.itemId);
        if (g.remaining > 0) moveStock(db, l.itemId, g.remaining, { type: 'return', refType: 'kitchen', refId: id, userId, reason: 'Bếp trả lại cuối ca' });
      }
      db.prepare("UPDATE kitchen_sessions SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?").run(now(), userId, id);
      audit(db, userId, 'kitchen.close', 'kitchen', id, { lines: [...given] });
      const done = sessionDto(id);
      const fmt = (n: number | null, u: string) => `${n === null ? '?' : new Intl.NumberFormat('vi-VN').format(n)} ${u}`;
      createNotification(db, {
        type: 'kitchen.closed',
        title: 'Tổng kết bếp cuối ca',
        body: done.lines.map((l) => `${l.name}: dùng ${fmt(l.used, l.unit)}${l.waste ? `, hao hụt ${fmt(l.waste, l.unit)}` : ''}`).join(' · '),
        data: { sessionId: id },
      });
    });
    res.json(sessionDto(id));
  });

  // Damaged / lost goods straight from storage (e.g. torn takeaway boxes).
  r.post('/inventory/items/:id/waste', allow('cashier'), (req, res) => {
    const id = req.params.id as string;
    const qty = round(num(req.body?.qty, 'qty', { min: 0.001 })!);
    const reason = reqStr(req.body?.reason, 'reason', 200);
    tx(db, () => {
      getItem(db, id);
      moveStock(db, id, -qty, { type: 'waste', userId: actorId(req), reason });
      audit(db, actorId(req), 'inventory.waste', 'inventory_item', id, { qty, reason });
    });
    res.json({ ok: true });
  });

  return r;
}
