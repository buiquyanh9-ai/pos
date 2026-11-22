import type { LocalOrder, Product } from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  /** 4xx (except 401/408/429) means the order itself is wrong; retrying will not help.
   *  401 is excluded because fixing the API key in Settings makes the retry succeed. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && ![401, 408, 429].includes(this.status);
  }
}

export interface ApiConfig {
  backendUrl: string;
  apiKey: string;
}

async function request<T>(cfg: ApiConfig, method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  if (!cfg.backendUrl) throw new ApiError(0, 'Chưa cấu hình địa chỉ máy chủ');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${cfg.backendUrl}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, ctrl.signal.aborted ? 'Hết thời gian chờ máy chủ' : 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface Health {
  ok: boolean;
  apiVersion: string;
  time: string;
  auth: 'disabled' | 'missing' | 'invalid' | 'ok';
}

export interface Summary {
  orderCount: number;
  revenue: number;
  discount: number;
  byPayment: { method: string; count: number; amount: number }[];
  topProducts: { productId: string | null; name: string; qty: number; amount: number }[];
}

export const api = {
  health: (c: ApiConfig) => request<Health>(c, 'GET', '/health', undefined, 4000),
  products: (c: ApiConfig) => request<{ products: Product[]; serverTime: string }>(c, 'GET', '/products'),
  uploadOrder: (c: ApiConfig, o: LocalOrder) =>
    request<{ id: string; duplicate?: boolean }>(c, 'POST', '/orders', {
      id: o.id,
      number: o.number,
      deviceId: o.deviceId,
      cashier: o.cashier,
      items: o.items.map(({ productId, name, price, qty }) => ({ productId, name, price, qty })),
      discount: o.discount,
      paymentMethod: o.paymentMethod,
      paid: o.paid,
      createdAt: o.createdAt,
    }),
  voidOrder: (c: ApiConfig, id: string) => request<{ status: string }>(c, 'POST', `/orders/${encodeURIComponent(id)}/void`),
  summary: (c: ApiConfig, from: string, to: string) =>
    request<Summary>(c, 'GET', `/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  heartbeat: (c: ApiConfig, d: { id: string; name: string; appVersion: string }) =>
    request<{ ok: boolean }>(c, 'POST', '/devices/heartbeat', { ...d, kind: 'pos' }, 4000),
};
