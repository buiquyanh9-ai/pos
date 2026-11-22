import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { type DB, now } from './db.ts';
import { HttpError } from './validate.ts';

// Two roles: the owner (mostly remote, Boss app) and cashiers (POS: selling and all stock work).
export type Role = 'owner' | 'cashier';
export const ROLES: Role[] = ['owner', 'cashier'];

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const SESSION_DAYS = 30; // POS terminals stay logged in through offline periods

// ---- secrets
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- users
export function userDto(r: Record<string, unknown>): AuthUser & { active: boolean; hasPin: boolean; hasPassword: boolean } {
  return {
    id: r.id as string,
    username: r.username as string,
    name: r.name as string,
    role: r.role as Role,
    active: Number(r.active) === 1,
    hasPin: Boolean(r.pin_hash),
    hasPassword: Boolean(r.password_hash),
  };
}

export function createUser(
  db: DB,
  u: { username: string; name: string; role: Role; password?: string; pin?: string; id?: string },
) {
  const id = u.id ?? randomUUID();
  db.prepare(
    'INSERT INTO users (id, username, name, role, password_hash, pin_hash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  ).run(id, u.username, u.name, u.role, u.password ? hashSecret(u.password) : null, u.pin ? hashSecret(u.pin) : null, now());
  return id;
}

// ---- sessions
export function createSession(db: DB, userId: string, client: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    client,
    now(),
    expires,
  );
  return { token, expiresAt: expires };
}

export function revokeSession(db: DB, token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userForToken(db: DB, token: string): AuthUser | null {
  const r = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    )
    .get(sha256(token), now());
  return r ? { id: r.id as string, username: r.username as string, name: r.name as string, role: r.role as Role } : null;
}

/** Service principal used when a request authenticates with the server API key (integrations, scripts). */
export const SERVICE_USER: AuthUser = { id: 'service', username: 'service', name: 'API key', role: 'owner' };

export function bearer(req: Request): string | undefined {
  const h = req.header('authorization');
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  // EventSource cannot send headers, so /api/events accepts ?token=
  if (typeof req.query.token === 'string') return req.query.token;
  return undefined;
}

export function authenticate(db: DB, apiKey?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (token) {
      const user = userForToken(db, token);
      if (!user) throw new HttpError(401, 'session expired or invalid');
      req.user = user;
      return next();
    }
    const key = req.header('x-api-key');
    if (apiKey && key && safeEqual(key, apiKey)) {
      req.user = SERVICE_USER;
      return next();
    }
    throw new HttpError(401, 'login required');
  };
}

/** Route guard: only the listed roles may continue. Owners can always pass. */
export function allow(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) throw new HttpError(401, 'login required');
    if (role !== 'owner' && !roles.includes(role)) throw new HttpError(403, 'not allowed for your role');
    next();
  };
}

export const actorId = (req: Request) => (req.user && req.user.id !== 'service' ? req.user.id : null);
