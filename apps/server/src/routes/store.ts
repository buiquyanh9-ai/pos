import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, audit, getSetting, now, setSetting, tx } from '../db.ts';
import { actorId, allow } from '../auth.ts';
import { publish } from '../events.ts';
import { HttpError, MAX_MONEY, bad, isoDate, reqInt, reqStr, str } from '../validate.ts';

// Store-wide settings shared by every terminal (receipt header, bank account for transfers),
// and cash in/out during a shift.

export const STORE_KEYS = ['store_name', 'store_address', 'store_phone', 'receipt_footer', 'bank_bin', 'bank_name', 'bank_account', 'bank_holder'] as const;
type StoreKey = (typeof STORE_KEYS)[number];

export function storeSettings(db: DB) {
  return Object.fromEntries(STORE_KEYS.map((k) => [k, getSetting(db, k) ?? ''])) as Record<StoreKey, string>;
}

export function storeRoutes(db: DB) {
  const r = Router();

  r.get('/store', (_req, res) => {
    res.json(storeSettings(db));
  });

  r.put('/store', allow('owner'), (req, res) => {
    const b = req.body ?? {};
    tx(db, () => {
      for (const k of STORE_KEYS) {
        if (b[k] === undefined) continue;
        const v = str(b[k], k, { optional: true, max: k === 'receipt_footer' || k === 'store_address' ? 300 : 100 }) ?? '';
        if (k === 'bank_bin' && v && !/^\d{6}$/.test(v)) throw bad('bank_bin must be the 6-digit NAPAS bank code');
        if (k === 'bank_account' && v && !/^[0-9A-Za-z]{4,19}$/.test(v)) throw bad('bank_account: 4-19 letters/digits');
        setSetting(db, k, v);
      }
      audit(db, actorId(req), 'store.update', 'store', null, { keys: Object.keys(b) });
    });
    setImmediate(() => publish('catalog.changed', { at: now() }));
    res.json(storeSettings(db));
  });

  // ---------------------------------------------------------------- cash in / out (thu chi két)
  const moveDto = (m: Record<string, unknown>) => ({
    id: m.id as string,
    shiftId: m.shift_id as string,
    type: m.type as 'in' | 'out',
    amount: Number(m.amount),
    reason: m.reason as string,
    userName: (m.user_name as string | null) ?? null,
    at: m.at as string,
  });

  r.get('/shifts/:id/cash', (req, res) => {
    const rows = db
      .prepare('SELECT c.*, u.name AS user_name FROM cash_moves c LEFT JOIN users u ON u.id = c.user_id WHERE c.shift_id = ? ORDER BY c.at')
      .all(req.params.id as string);
    res.json({ moves: rows.map(moveDto) });
  });

  r.post('/shifts/:id/cash', allow('cashier'), (req, res) => {
    const shiftId = req.params.id as string;
    const type = reqStr(req.body?.type, 'type', 8);
    if (type !== 'in' && type !== 'out') throw bad('type must be in or out');
    const amount = reqInt(req.body?.amount, 'amount', { min: 1, max: MAX_MONEY });
    const reason = reqStr(req.body?.reason, 'reason', 200);
    const id = randomUUID();
    tx(db, () => {
      const s = db.prepare('SELECT status FROM shifts WHERE id = ?').get(shiftId);
      if (!s) throw new HttpError(404, 'shift not found');
      if (s.status !== 'open') throw new HttpError(409, 'shift is closed');
      db.prepare('INSERT INTO cash_moves (id, shift_id, type, amount, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, shiftId, type, amount, reason, actorId(req), now(),
      );
      audit(db, actorId(req), `cash.${type}`, 'shift', shiftId, { amount, reason });
    });
    setImmediate(() => publish('shift.updated', { id: shiftId }));
    res.status(201).json(moveDto(db.prepare('SELECT c.*, u.name AS user_name FROM cash_moves c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(id)!));
  });

  return r;
}
