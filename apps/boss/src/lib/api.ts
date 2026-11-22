import type { InventoryItem, KitchenSession, OpenOrder, Purchase, Shift, ShiftReport, StockMove, Stocktake, Summary, User } from '@shopflow/shared';

/** Cart as stored by the POS inside an open bill (only the fields Boss shows). */
export interface OpenCart {
  lines: { key: string; name: string; price: number; qty: number; note: string; options: { name: string }[] }[];
  discount: number;
  note: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Conn {
  url: string;
  token?: string;
}

export async function request<T>(c: Conn, method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${c.url}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, ctrl.signal.aborted ? 'Máy chủ không phản hồi' : 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

const q = (p: Record<string, string | number | undefined>) => {
  const s = Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

export interface Compare {
  previous: { from: string; to: string; netRevenue: number; orderCount: number; itemsSold: number };
  change: { netRevenue: number | null; orderCount: number | null; itemsSold: number | null };
}

export interface ApiOrder {
  id: string;
  number: string;
  deviceId: string;
  cashier: string;
  orderType: string;
  tableName: string;
  note: string;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paid: number;
  change: number;
  status: 'completed' | 'voided' | 'refunded';
  statusReason: string;
  statusAt: string | null;
  refundAmount: number;
  createdAt: string;
  items: { productId: string | null; name: string; price: number; qty: number; lineTotal: number; note: string; options: string }[];
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  read: boolean;
}

export interface Dashboard {
  today: Summary & Compare;
  lowStockCount: number;
  pendingPurchases: number;
  openShifts: number;
  openOrders: { count: number; total: number };
  serverTime: string;
}

export const api = {
  login: (c: Conn, username: string, password: string) =>
    request<{ token: string; expiresAt: string; user: User }>(c, 'POST', '/auth/login', { username, password, client: 'boss' }),
  logout: (c: Conn) => request(c, 'POST', '/auth/logout'),
  me: (c: Conn) => request<{ user: User }>(c, 'GET', '/auth/me'),
  dashboard: (c: Conn) => request<Dashboard>(c, 'GET', '/dashboard'),
  summary: (c: Conn, from: string, to: string) => request<Summary & Compare>(c, 'GET', `/reports/summary${q({ from, to, compare: 1 })}`),
  activity: (c: Conn, before?: string) =>
    request<{ orders: ApiOrder[]; openShifts: { id: string; deviceId: string; cashierName: string; openedAt: string }[] }>(
      c,
      'GET',
      `/activity${q({ limit: 50, before })}`,
    ),
  openOrders: (c: Conn) => request<{ openOrders: OpenOrder<OpenCart>[] }>(c, 'GET', '/open-orders'),
  order: (c: Conn, id: string) => request<ApiOrder>(c, 'GET', `/orders/${encodeURIComponent(id)}`),
  inventory: (c: Conn) => request<{ items: InventoryItem[] }>(c, 'GET', '/inventory/items'),
  moves: (c: Conn, p: { itemId?: string; type?: string; limit?: number }) => request<{ moves: StockMove[] }>(c, 'GET', `/inventory/moves${q(p)}`),
  kitchenSessions: (c: Conn) => request<{ sessions: KitchenSession[] }>(c, 'GET', '/kitchen/sessions'),
  stocktakes: (c: Conn) => request<{ stocktakes: Stocktake[] }>(c, 'GET', '/inventory/stocktakes'),
  purchases: (c: Conn, status?: string) => request<{ purchases: Purchase[] }>(c, 'GET', `/purchases${q({ status })}`),
  approve: (c: Conn, id: string, note: string) => request<Purchase>(c, 'POST', `/purchases/${encodeURIComponent(id)}/approve`, { note }),
  reject: (c: Conn, id: string, note: string) => request<Purchase>(c, 'POST', `/purchases/${encodeURIComponent(id)}/reject`, { note }),
  shifts: (c: Conn, from?: string, to?: string) => request<{ shifts: Shift[] }>(c, 'GET', `/shifts${q({ from, to })}`),
  shiftReport: (c: Conn, id: string) => request<ShiftReport>(c, 'GET', `/shifts/${encodeURIComponent(id)}/report`),
  audit: (c: Conn) =>
    request<{ entries: { id: number; userName: string | null; action: string; entity: string; entityId: string | null; data: Record<string, unknown> | null; at: string }[] }>(
      c,
      'GET',
      '/audit?limit=200',
    ),
  notifications: (c: Conn) => request<{ notifications: Notification[]; unread: number }>(c, 'GET', '/notifications?limit=100'),
  markRead: (c: Conn, ids: number[] | 'all') => request(c, 'POST', '/notifications/read', { ids }),
  prefs: (c: Conn) => request<{ prefs: { type: string; label: string; enabled: boolean }[]; pushEnabled: boolean }>(c, 'GET', '/notifications/prefs'),
  setPrefs: (c: Conn, prefs: { type: string; enabled: boolean }[]) => request(c, 'PUT', '/notifications/prefs', { prefs }),
};
