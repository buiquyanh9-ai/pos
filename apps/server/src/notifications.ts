import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Role } from './auth.ts';
import { type DB, now } from './db.ts';
import { publish } from './events.ts';

export type NotificationType =
  | 'shift.closed'
  | 'day.summary'
  | 'order.refunded'
  | 'order.voided';

export const NOTIFICATION_TYPES: { type: NotificationType; label: string }[] = [
  { type: 'shift.closed', label: 'Tổng kết ca' },
  { type: 'day.summary', label: 'Tổng kết cuối ngày' },
  { type: 'order.refunded', label: 'Đơn hoàn tiền' },
  { type: 'order.voided', label: 'Đơn bị huỷ' },
];

export interface NewNotification {
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  roles?: Role[];
}

/** Store a notification, push it to live SSE clients and (if configured) to phones via FCM.
 *  Call inside the business transaction; push delivery happens after commit (setImmediate). */
export function createNotification(db: DB, n: NewNotification) {
  const roles = n.roles ?? ['owner'];
  const r = db
    .prepare('INSERT INTO notifications (type, title, body, data, roles, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(n.type, n.title, n.body ?? '', n.data ? JSON.stringify(n.data) : null, roles.join(','), now());
  const dto = { id: Number(r.lastInsertRowid), type: n.type, title: n.title, body: n.body ?? '', data: n.data ?? null, createdAt: now(), read: false };
  setImmediate(() => {
    publish('notification', dto, roles);
    void pushToPhones(db, dto, roles).catch((err) => console.warn('[push] failed:', err instanceof Error ? err.message : err));
  });
  return dto;
}

export function notificationDto(r: Record<string, unknown>, read: boolean) {
  return {
    id: Number(r.id),
    type: r.type as string,
    title: r.title as string,
    body: r.body as string,
    data: r.data ? JSON.parse(r.data as string) : null,
    createdAt: r.created_at as string,
    read,
  };
}

/** Users who want this type: everyone in the audience roles unless they turned it off. */
function recipients(db: DB, type: string, roles: Role[]) {
  const placeholders = roles.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT u.id FROM users u
       LEFT JOIN notification_prefs p ON p.user_id = u.id AND p.type = ?
       WHERE u.active = 1 AND (u.role = 'owner' OR u.role IN (${placeholders})) AND COALESCE(p.enabled, 1) = 1`,
    )
    .all(type, ...roles)
    .map((r) => r.id as string);
}

// ---------------------------------------------------------------- push providers
// Default: no push (notifications are still stored, streamed over SSE and shown in-app).
// FCM HTTP v1: set FCM_SERVICE_ACCOUNT=path/to/service-account.json (Firebase console ->
// Project settings -> Service accounts). Tokens are registered by the Boss app via
// POST /api/notifications/push-tokens.

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
let accessToken: { value: string; exp: number } | null = null;

function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const path = process.env.FCM_SERVICE_ACCOUNT;
  account = path ? (JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount) : null;
  return account;
}

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.exp > Date.now() + 60_000) return accessToken.value;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function pushToPhones(db: DB, n: { id: number; type: string; title: string; body: string }, roles: Role[]) {
  const sa = loadAccount();
  if (!sa) return;
  const users = recipients(db, n.type, roles);
  if (!users.length) return;
  const tokens = db
    .prepare(`SELECT token FROM push_tokens WHERE user_id IN (${users.map(() => '?').join(',')})`)
    .all(...users)
    .map((r) => r.token as string);
  if (!tokens.length) return;
  const bearerToken = await googleAccessToken(sa);
  for (const token of tokens) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { token, notification: { title: n.title, body: n.body }, data: { type: n.type, id: String(n.id) } },
      }),
    });
    // 404/400 UNREGISTERED: the app was uninstalled or the token rotated.
    if (res.status === 404 || res.status === 400) db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  }
}

export const pushEnabled = () => Boolean(loadAccount());
