import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type DB, audit, now } from '../db.ts';
import { ROLES, allow, bearer, createSession, hashSecret, revokeSession, userDto, verifySecret, type Role } from '../auth.ts';
import { HttpError, bad, reqStr, str } from '../validate.ts';

// Brute-force guard: a 4-digit PIN has only 10,000 values. After MAX_FAILS wrong attempts for a
// username (or from one client address) within WINDOW_MS, further attempts are refused until it expires.
const MAX_FAILS = 5;
const WINDOW_MS = 5 * 60_000;
const fails = new Map<string, { n: number; until: number }>();
function locked(key: string) {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() > f.until) {
    fails.delete(key);
    return 0;
  }
  return f.n >= MAX_FAILS ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFail(key: string) {
  const f = fails.get(key);
  const live = f && Date.now() <= f.until;
  fails.set(key, { n: live ? f!.n + 1 : 1, until: live ? f!.until : Date.now() + WINDOW_MS });
}
export const resetLoginGuard = () => fails.clear();

/** Public auth routes (mounted before the auth middleware). */
export function publicAuthRoutes(db: DB) {
  const r = Router();

  // Staff picker for the POS PIN login screen: names only, no secrets.
  r.get('/auth/staff', (_req, res) => {
    const rows = db.prepare("SELECT * FROM users WHERE active = 1 AND pin_hash IS NOT NULL ORDER BY CASE role WHEN 'cashier' THEN 0 ELSE 1 END, name").all();
    res.json({ staff: rows.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role })) });
  });

  r.post('/auth/login', (req, res) => {
    const b = req.body ?? {};
    const username = reqStr(b.username, 'username', 64).toLowerCase();
    const password = str(b.password, 'password', { optional: true, max: 200 });
    const pin = str(b.pin, 'pin', { optional: true, max: 12 });
    if (!password && !pin) throw bad('password or pin is required');
    const keys = [`u:${username}`, `ip:${req.ip ?? ''}`];
    const wait = Math.max(...keys.map(locked));
    if (wait) throw new HttpError(429, `Nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(wait / 60)} phút`);
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    const ok = u && (password ? verifySecret(password, u.password_hash as string) : verifySecret(pin!, u.pin_hash as string));
    if (!u || !ok) {
      audit(db, null, 'login.failed', 'user', username);
      keys.forEach(recordFail);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu/PIN');
    }
    fails.delete(keys[0]);
    const client = str(b.client, 'client', { optional: true, max: 64 }) ?? '';
    const session = createSession(db, u.id as string, client);
    audit(db, u.id as string, 'login', 'user', u.id as string, { client });
    res.json({ ...session, user: userDto(u) });
  });

  return r;
}

export function authRoutes(db: DB) {
  const r = Router();

  r.get('/auth/me', (req, res) => {
    res.json({ user: req.user });
  });

  r.post('/auth/logout', (req, res) => {
    const token = bearer(req);
    if (token) revokeSession(db, token);
    res.json({ ok: true });
  });

  // ---- staff management (owner)
  r.get('/users', allow('owner'), (_req, res) => {
    res.json({ users: db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all().map(userDto) });
  });

  const readRole = (v: unknown, optional: boolean): Role | undefined => {
    const role = str(v, 'role', { optional, max: 16 }) as Role | undefined;
    if (role !== undefined && !ROLES.includes(role)) throw bad('role must be owner or cashier');
    return role;
  };
  const readPin = (v: unknown) => {
    const pin = str(v, 'pin', { optional: true, max: 12 });
    if (pin !== undefined && !/^\d{4,8}$/.test(pin)) throw bad('PIN must be 4-8 digits');
    return pin;
  };
  const readPassword = (v: unknown) => {
    const pw = str(v, 'password', { optional: true, max: 200 });
    if (pw !== undefined && pw.length < 6) throw bad('password must be at least 6 characters');
    return pw;
  };

  r.post('/users', allow('owner'), (req, res) => {
    const b = req.body ?? {};
    const username = reqStr(b.username, 'username', 64).toLowerCase();
    if (!/^[a-z0-9._-]{2,64}$/.test(username)) throw bad('username may only contain a-z, 0-9, . _ -');
    const name = reqStr(b.name, 'name', 64);
    const role = readRole(b.role, false)!;
    const password = readPassword(b.password);
    const pin = readPin(b.pin);
    if (!password && !pin) throw bad('set a password (Boss app) or a PIN (POS)');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'username already exists');
    const id = randomUUID();
    db.prepare(
      'INSERT INTO users (id, username, name, role, password_hash, pin_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    ).run(id, username, name, role, password ? hashSecret(password) : null, pin ? hashSecret(pin) : null, now());
    audit(db, req.user!.id, 'user.create', 'user', id, { username, role });
    res.status(201).json(userDto(db.prepare('SELECT * FROM users WHERE id = ?').get(id)!));
  });

  r.put('/users/:id', allow('owner'), (req, res) => {
    const id = req.params.id as string;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) throw new HttpError(404, 'user not found');
    const b = req.body ?? {};
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const name = str(b.name, 'name', { optional: true, max: 64 });
    const role = readRole(b.role, true);
    const password = readPassword(b.password);
    const pin = readPin(b.pin);
    if (name !== undefined) (sets.push('name = ?'), params.push(name));
    if (role !== undefined) (sets.push('role = ?'), params.push(role));
    if (password !== undefined) (sets.push('password_hash = ?'), params.push(hashSecret(password)));
    if (pin !== undefined) (sets.push('pin_hash = ?'), params.push(hashSecret(pin)));
    if (b.active !== undefined) (sets.push('active = ?'), params.push(b.active ? 1 : 0));
    if (!sets.length) throw bad('no fields to update');
    // Never let the shop lock itself out.
    const demotingLastOwner =
      u.role === 'owner' &&
      (role !== undefined && role !== 'owner' || b.active === false) &&
      Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get()!.n) <= 1;
    if (demotingLastOwner) throw bad('cannot remove the last active owner');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    if (b.active === false || password !== undefined || pin !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, req.user!.id, 'user.update', 'user', id, { name, role, active: b.active, password: password ? '***' : undefined, pin: pin ? '***' : undefined });
    res.json(userDto(db.prepare('SELECT * FROM users WHERE id = ?').get(id)!));
  });

  r.get('/audit', allow('owner'), (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = db
      .prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?')
      .all(limit);
    res.json({
      entries: rows.map((a) => ({
        id: Number(a.id),
        userId: a.user_id,
        userName: a.user_name,
        action: a.action,
        entity: a.entity,
        entityId: a.entity_id,
        data: a.data ? JSON.parse(a.data as string) : null,
        at: a.at,
      })),
    });
  });

  return r;
}
