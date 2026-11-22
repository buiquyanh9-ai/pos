import { Router } from 'express';
import { type DB, type Row, now } from '../db.ts';
import { allow } from '../auth.ts';
import { clientCount, subscribe } from '../events.ts';
import { NOTIFICATION_TYPES, notificationDto, pushEnabled } from '../notifications.ts';
import { summarize, summarizeWithCompare } from '../reports.ts';
import { bad, isoDate, reqStr, str } from '../validate.ts';
import { orderDto } from './sales.ts';

export function miscRoutes(db: DB) {
  const r = Router();

  // ---------------------------------------------------------------- realtime
  r.get('/events', (req, res) => subscribe(req, res));

  // ---------------------------------------------------------------- reports
  r.get('/reports/summary', (req, res) => {
    const from = isoDate(req.query.from, 'from')!;
    const to = isoDate(req.query.to, 'to')!;
    if (from >= to) throw bad('from must be before to');
    if (new Date(to).getTime() - new Date(from).getTime() > 400 * 86400_000) throw bad('range is limited to 400 days');
    // Cashiers may only see the report of a shift (their end-of-shift screen).
    const shiftId = str(req.query.shiftId, 'shiftId', { optional: true, max: 64 });
    if (req.user!.role !== 'owner' && !shiftId) throw bad('only the owner can view store-wide reports; pass shiftId');
    const q = {
      from,
      to,
      tzOffsetMin: req.query.tz === undefined ? 420 : Number(req.query.tz),
      shiftId,
      cashierId: str(req.query.cashierId, 'cashierId', { optional: true, max: 64 }),
      deviceId: str(req.query.deviceId, 'deviceId', { optional: true, max: 64 }),
    };
    if (!Number.isInteger(q.tzOffsetMin) || Math.abs(q.tzOffsetMin) > 14 * 60) throw bad('tz must be an offset in minutes');
    res.json(req.query.compare === '1' ? summarizeWithCompare(db, q) : summarize(db, q));
  });

  // Live activity for Boss "Hoạt động": latest orders + open shifts.
  r.get('/activity', allow('owner'), (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = isoDate(req.query.before, 'before', true);
    const rows = before
      ? db.prepare('SELECT * FROM orders WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
    const open = db
      .prepare("SELECT s.*, u.name AS cashier_name FROM shifts s LEFT JOIN users u ON u.id = s.cashier_id WHERE s.status = 'open'")
      .all();
    res.json({
      orders: rows.map((o) => orderDto(db, o)),
      openShifts: open.map((s) => ({ id: s.id, deviceId: s.device_id, cashierName: s.cashier_name, openedAt: s.opened_at })),
      liveClients: clientCount(),
    });
  });

  r.get('/dashboard', allow('owner'), (req, res) => {
    // Today (local) at a glance, for the Boss home screen.
    const tz = req.query.tz === undefined ? 420 : Number(req.query.tz);
    const localNow = new Date(Date.now() + tz * 60_000);
    const startLocal = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
    const from = new Date(startLocal - tz * 60_000).toISOString();
    const to = new Date(startLocal - tz * 60_000 + 86400_000).toISOString();
    // Compare "today so far" with yesterday up to the same time of day, not with all of yesterday.
    const nowIso = new Date().toISOString();
    const today = summarize(db, { from, to, tzOffsetMin: tz });
    const yFrom = new Date(new Date(from).getTime() - 86400_000).toISOString();
    const yTo = new Date(Date.now() - 86400_000).toISOString();
    const yest = summarize(db, { from: yFrom, to: yTo, tzOffsetMin: tz });
    const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);
    const todayWithCompare = {
      ...today,
      previous: { from: yFrom, to: yTo, netRevenue: yest.netRevenue, orderCount: yest.orderCount, itemsSold: yest.itemsSold },
      change: { netRevenue: pct(today.netRevenue, yest.netRevenue), orderCount: pct(today.orderCount, yest.orderCount), itemsSold: pct(today.itemsSold, yest.itemsSold) },
      asOf: nowIso,
    };
    const low = db.prepare('SELECT COUNT(*) AS n FROM inventory_items WHERE active = 1 AND qty < min_qty').get()!;
    const pending = db.prepare("SELECT COUNT(*) AS n FROM purchase_requests WHERE status = 'pending'").get()!;
    const openShifts = db.prepare("SELECT COUNT(*) AS n FROM shifts WHERE status = 'open'").get()!;
    const openOrders = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM open_orders').get()!;
    res.json({ today: todayWithCompare, lowStockCount: Number(low.n), pendingPurchases: Number(pending.n), openShifts: Number(openShifts.n), openOrders: { count: Number(openOrders.n), total: Number(openOrders.total) }, serverTime: now() });
  });

  // ---------------------------------------------------------------- notifications
  const audience = (role: string) => `(',' || roles || ',') LIKE '%,${role},%' OR '${role}' = 'owner'`;

  r.get('/notifications', (req, res) => {
    const u = req.user!;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const role = ['owner', 'cashier'].includes(u.role) ? u.role : 'owner';
    const rows = db
      .prepare(
        `SELECT n.*, (r.user_id IS NOT NULL) AS is_read FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
         LEFT JOIN notification_prefs p ON p.user_id = ? AND p.type = n.type
         WHERE (${audience(role)}) AND COALESCE(p.enabled, 1) = 1
         ORDER BY n.id DESC LIMIT ?`,
      )
      .all(u.id, u.id, limit);
    const unread = rows.filter((x) => !Number(x.is_read)).length;
    res.json({ notifications: rows.map((x) => notificationDto(x, Boolean(Number(x.is_read)))), unread });
  });

  r.post('/notifications/read', (req, res) => {
    const u = req.user!;
    const ids: unknown = req.body?.ids;
    if (ids === 'all') {
      db.prepare(`INSERT OR IGNORE INTO notification_reads (user_id, notification_id) SELECT ?, id FROM notifications`).run(u.id);
    } else if (Array.isArray(ids)) {
      const ins = db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?, ?)');
      for (const id of ids) if (Number.isInteger(id)) ins.run(u.id, id as number);
    } else throw bad('ids must be an array of notification ids or "all"');
    res.json({ ok: true });
  });

  r.get('/notifications/prefs', (req, res) => {
    const rows = db.prepare('SELECT type, enabled FROM notification_prefs WHERE user_id = ?').all(req.user!.id);
    const map = new Map(rows.map((x) => [x.type as string, Number(x.enabled) === 1]));
    res.json({ prefs: NOTIFICATION_TYPES.map((t) => ({ ...t, enabled: map.get(t.type) ?? true })), pushEnabled: pushEnabled() });
  });

  r.put('/notifications/prefs', (req, res) => {
    const prefs = req.body?.prefs;
    if (!Array.isArray(prefs)) throw bad('prefs must be an array');
    const valid = new Set(NOTIFICATION_TYPES.map((t) => t.type as string));
    const up = db.prepare(
      'INSERT INTO notification_prefs (user_id, type, enabled) VALUES (?, ?, ?) ON CONFLICT(user_id, type) DO UPDATE SET enabled = excluded.enabled',
    );
    for (const p of prefs as Row[]) {
      const type = reqStr(p.type, 'type', 32);
      if (!valid.has(type)) throw bad(`unknown notification type ${type}`);
      up.run(req.user!.id, type, p.enabled ? 1 : 0);
    }
    res.json({ ok: true });
  });

  r.post('/notifications/push-tokens', (req, res) => {
    const token = reqStr(req.body?.token, 'token', 4096);
    const platform = str(req.body?.platform, 'platform', { optional: true, max: 16 }) ?? '';
    db.prepare(
      'INSERT INTO push_tokens (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at',
    ).run(token, req.user!.id, platform, now());
    res.json({ ok: true, pushEnabled: pushEnabled() });
  });

  // ---------------------------------------------------------------- devices & sync feed
  r.post('/devices/heartbeat', (req, res) => {
    const b = (req.body ?? {}) as Row;
    const id = reqStr(b.id, 'id', 64);
    db.prepare(
      `INSERT INTO devices (id, name, kind, app_version, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, app_version = excluded.app_version, last_seen = excluded.last_seen`,
    ).run(
      id,
      str(b.name, 'name', { optional: true, max: 64 }) ?? id,
      str(b.kind, 'kind', { optional: true, max: 16 }) ?? 'pos',
      str(b.appVersion, 'appVersion', { optional: true, max: 32 }) ?? null,
      now(),
    );
    res.json({ ok: true, serverTime: now() });
  });

  r.get('/devices', allow('owner'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all();
    res.json({ devices: rows.map((x) => ({ id: x.id, name: x.name, kind: x.kind, appVersion: x.app_version, lastSeen: x.last_seen })) });
  });

  r.get('/sync/changes', allow('owner'), (req, res) => {
    const since = Math.max(Number(req.query.since) || 0, 0);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const rows = db.prepare('SELECT * FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?').all(since, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
    const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
    const changes = page.map((c) => {
      const entityId = c.entity_id as string;
      let data: unknown = null;
      if (c.entity === 'order') {
        const o = getOrder.get(entityId);
        data = o ? orderDto(db, o) : null;
      } else if (c.entity === 'product') {
        const p = getProduct.get(entityId);
        data = p ? { id: p.id, name: p.name, price: Number(p.price), active: Number(p.active) === 1, categoryId: p.category_id } : null;
      }
      return { seq: Number(c.seq), entity: c.entity as string, id: entityId, op: c.op as string, at: c.at as string, data };
    });
    res.json({ changes, cursor: page.length ? Number(page[page.length - 1].seq) : since, hasMore });
  });

  return r;
}
