import type {
  Category,
  DiningTable,
  InventoryItem,
  KitchenSession,
  LocalOrder,
  OpenOrder,
  OptionGroup,
  Product,
  Purchase,
  Shift,
  ShiftReport,
  StockMove,
  Stocktake,
  Summary,
  Supplier,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  /** 4xx (except 401/408/429) means the request itself is wrong; retrying will not help.
   *  401 is excluded because logging in again makes the retry succeed. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && ![401, 408, 429].includes(this.status);
  }
}

export interface ApiConfig {
  backendUrl: string;
  /** Session token from /auth/login. */
  token?: string;
  /** Optional service key (legacy / kiosk setups). */
  apiKey?: string;
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
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
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

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

export interface StoreInfo {
  store_name: string;
  store_address: string;
  store_phone: string;
  receipt_footer: string;
  bank_bin: string;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
}

export interface CashMove {
  id: string;
  shiftId: string;
  type: 'in' | 'out';
  amount: number;
  reason: string;
  userName: string | null;
  at: string;
}

export interface ProductInput {
  name?: string;
  price?: number;
  cost?: number | null;
  categoryId?: string;
  sku?: string;
  barcode?: string;
  imageUrl?: string | null;
  active?: boolean;
  optionGroupIds?: string[];
  recipe?: { itemId: string; qty: number }[];
}

export interface Health {
  ok: boolean;
  apiVersion: string;
  time: string;
  auth: 'disabled' | 'missing' | 'invalid' | 'ok';
}

export interface Catalog {
  products: Product[];
  categories: Category[];
  optionGroups: OptionGroup[];
  serverTime: string;
}

export const api = {
  // ---- auth
  health: (c: ApiConfig) => request<Health>(c, 'GET', '/health', undefined, 4000),
  staff: (c: ApiConfig) => request<{ staff: User[] }>(c, 'GET', '/auth/staff'),
  login: (c: ApiConfig, body: { username: string; pin?: string; password?: string; client?: string }) =>
    request<{ token: string; expiresAt: string; user: User }>(c, 'POST', '/auth/login', body),
  logout: (c: ApiConfig) => request<{ ok: boolean }>(c, 'POST', '/auth/logout'),
  me: (c: ApiConfig) => request<{ user: User }>(c, 'GET', '/auth/me'),

  // ---- catalog
  catalog: (c: ApiConfig) => request<Catalog>(c, 'GET', '/products'),
  tables: (c: ApiConfig) => request<{ tables: DiningTable[] }>(c, 'GET', '/tables'),

  // ---- orders
  uploadOrder: (c: ApiConfig, o: LocalOrder) =>
    request<{ id: string; duplicate?: boolean }>(c, 'POST', '/orders', {
      id: o.id,
      number: o.number,
      deviceId: o.deviceId,
      shiftId: o.shiftId ?? undefined,
      cashier: o.cashier,
      orderType: o.orderType,
      tableName: o.tableName,
      note: o.note,
      items: o.items.map(({ productId, name, price, qty, note, options, optionIds }) => ({ productId, name, price, qty, note, options, optionIds })),
      discount: o.discount,
      paymentMethod: o.paymentMethod,
      paid: o.paid,
      createdAt: o.createdAt,
    }),
  /** Orders stored on the server (all terminals). */
  orders: (c: ApiConfig, p: { from?: string; to?: string; paymentMethod?: string; limit?: number }) =>
    request<{ orders: (Omit<LocalOrder, 'sync'> & { statusReason: string })[] }>(c, 'GET', `/orders${q({ ...p, limit: p.limit ?? 500 })}`),
  voidOrder: (c: ApiConfig, id: string, reason: string) =>
    request<{ status: string }>(c, 'POST', `/orders/${encodeURIComponent(id)}/void`, { reason }),
  refundOrder: (c: ApiConfig, id: string, body: { reason: string; restock?: boolean; shiftId?: string }) =>
    request<{ status: string }>(c, 'POST', `/orders/${encodeURIComponent(id)}/refund`, body),

  // ---- open (unpaid) bills
  openOrders: (c: ApiConfig) => request<{ openOrders: OpenOrder[] }>(c, 'GET', '/open-orders'),
  saveOpenOrder: (
    c: ApiConfig,
    id: string,
    body: { deviceId: string; tableName: string; orderType: string; note: string; itemCount: number; total: number; cart: unknown; version?: number },
  ) => request<OpenOrder>(c, 'PUT', `/open-orders/${encodeURIComponent(id)}`, body),
  deleteOpenOrder: (c: ApiConfig, id: string, reason?: string) =>
    request<null>(c, 'DELETE', `/open-orders/${encodeURIComponent(id)}`, reason ? { reason } : {}),

  // ---- shifts
  currentShift: (c: ApiConfig, deviceId: string) => request<{ shift: Shift | null }>(c, 'GET', `/shifts/current${q({ deviceId })}`),
  openShift: (c: ApiConfig, deviceId: string, openingCash: number) => request<Shift>(c, 'POST', '/shifts/open', { deviceId, openingCash }),
  closeShift: (c: ApiConfig, id: string, countedCash: number, note: string) =>
    request<ShiftReport>(c, 'POST', `/shifts/${encodeURIComponent(id)}/close`, { countedCash, note }),
  shiftReport: (c: ApiConfig, id: string) => request<ShiftReport>(c, 'GET', `/shifts/${encodeURIComponent(id)}/report`),
  shifts: (c: ApiConfig, from?: string, to?: string) => request<{ shifts: Shift[] }>(c, 'GET', `/shifts${q({ from, to })}`),

  // ---- reports (store-wide needs owner; cashiers pass shiftId)
  summary: (c: ApiConfig, p: { from: string; to: string; shiftId?: string; compare?: boolean }) =>
    request<Summary>(c, 'GET', `/reports/summary${q({ from: p.from, to: p.to, shiftId: p.shiftId, compare: p.compare ? 1 : undefined })}`),

  // ---- inventory
  inventory: (c: ApiConfig, p: { low?: boolean } = {}) =>
    request<{ items: InventoryItem[] }>(c, 'GET', `/inventory/items${q({ low: p.low ? 1 : undefined })}`),
  adjustStock: (c: ApiConfig, itemId: string, body: { delta?: number; qty?: number; reason: string }) =>
    request<InventoryItem>(c, 'POST', `/inventory/items/${encodeURIComponent(itemId)}/adjust`, body),
  stockMoves: (c: ApiConfig, p: { itemId?: string; type?: string; from?: string; to?: string; limit?: number } = {}) =>
    request<{ moves: StockMove[] }>(c, 'GET', `/inventory/moves${q(p)}`),
  createStocktake: (c: ApiConfig, body: { shiftId?: string; note?: string; lines: { itemId: string; counted: number; reason?: string }[] }) =>
    request<Stocktake>(c, 'POST', '/inventory/stocktakes', body),
  stocktakes: (c: ApiConfig) => request<{ stocktakes: Stocktake[] }>(c, 'GET', '/inventory/stocktakes'),

  wasteStock: (c: ApiConfig, itemId: string, qty: number, reason: string) =>
    request<{ ok: boolean }>(c, 'POST', `/inventory/items/${encodeURIComponent(itemId)}/waste`, { qty, reason }),

  // ---- kitchen (estimate stock: rice, vegetables, tea)
  kitchenCurrent: (c: ApiConfig) =>
    request<{ session: KitchenSession | null; items: { itemId: string; name: string; unit: string; stock: number; defaultIssue: number | null }[] }>(c, 'GET', '/kitchen/current'),
  kitchenOpen: (c: ApiConfig, body: { shiftId?: string; lines: { itemId: string; qty: number }[] }) => request<KitchenSession>(c, 'POST', '/kitchen/open', body),
  kitchenAdd: (c: ApiConfig, id: string, lines: { itemId: string; qty: number }[]) =>
    request<KitchenSession>(c, 'POST', `/kitchen/${encodeURIComponent(id)}/add`, { lines }),
  kitchenClose: (c: ApiConfig, id: string, lines: { itemId: string; remaining: number; waste?: number; reason?: string }[]) =>
    request<KitchenSession>(c, 'POST', `/kitchen/${encodeURIComponent(id)}/close`, { lines }),
  kitchenSessions: (c: ApiConfig) => request<{ sessions: KitchenSession[] }>(c, 'GET', '/kitchen/sessions'),

  importStock: (c: ApiConfig, body: { supplierId?: string; note?: string; lines: { itemId: string; qty: number; unitCost?: number }[] }) =>
    request<{ id: string; total: number }>(c, 'POST', '/inventory/import', body),

  // ---- purchasing
  suppliers: (c: ApiConfig) => request<{ suppliers: Supplier[] }>(c, 'GET', '/suppliers'),
  purchases: (c: ApiConfig, status?: string) => request<{ purchases: Purchase[] }>(c, 'GET', `/purchases${q({ status })}`),
  purchaseSuggestions: (c: ApiConfig) =>
    request<{ lines: { itemId: string; name: string; unit: string; currentStock: number; minQty: number; qty: number; unitCost: number; supplierId: string | null }[] }>(
      c,
      'GET',
      '/purchases/suggestions',
    ),
  createPurchase: (c: ApiConfig, body: { supplierId?: string; note?: string; lines: { itemId: string; qty: number; unitCost?: number }[] }) =>
    request<Purchase>(c, 'POST', '/purchases', body),
  receivePurchase: (c: ApiConfig, id: string, lines?: { itemId: string; receivedQty?: number; unitCost?: number }[]) =>
    request<Purchase>(c, 'POST', `/purchases/${encodeURIComponent(id)}/receive`, lines ? { lines } : {}),

  // ---- owner: menu, tables, staff, inventory items
  saveProduct: (c: ApiConfig, id: string | null, body: ProductInput) =>
    id ? request<Product>(c, 'PUT', `/products/${encodeURIComponent(id)}`, body) : request<Product>(c, 'POST', '/products', body),
  deleteProduct: (c: ApiConfig, id: string) => request<null>(c, 'DELETE', `/products/${encodeURIComponent(id)}`),
  productsAll: (c: ApiConfig) => request<Catalog & { products: (Product & { recipe: { itemId: string; itemName: string; unit: string; qty: number }[] })[] }>(c, 'GET', '/products?includeInactive=1'),
  saveCategory: (c: ApiConfig, id: string | null, body: { name?: string; sort?: number; active?: boolean }) =>
    request<{ ok?: boolean; id?: string }>(c, id ? 'PUT' : 'POST', id ? `/categories/${encodeURIComponent(id)}` : '/categories', body),
  saveOptionGroup: (
    c: ApiConfig,
    id: string | null,
    body: { name?: string; multi?: boolean; required?: boolean; options?: { id?: string; name: string; priceDelta: number; recipeFactor?: number; recipe?: { itemId: string; qty: number }[] }[] },
  ) =>
    id ? request<OptionGroup>(c, 'PUT', `/option-groups/${encodeURIComponent(id)}`, body) : request<OptionGroup>(c, 'POST', '/option-groups', body),
  saveTable: (c: ApiConfig, id: string | null, body: { name?: string; area?: string; sort?: number; active?: boolean }) =>
    id ? request<DiningTable>(c, 'PUT', `/tables/${encodeURIComponent(id)}`, body) : request<DiningTable>(c, 'POST', '/tables', body),
  users: (c: ApiConfig) => request<{ users: (User & { active: boolean; hasPin: boolean; hasPassword: boolean })[] }>(c, 'GET', '/users'),
  saveUser: (c: ApiConfig, id: string | null, body: { username?: string; name?: string; role?: string; pin?: string; password?: string; active?: boolean }) =>
    id ? request<User>(c, 'PUT', `/users/${encodeURIComponent(id)}`, body) : request<User>(c, 'POST', '/users', body),
  saveInventoryItem: (
    c: ApiConfig,
    id: string | null,
    body: { name?: string; unit?: string; kind?: 'ingredient' | 'goods'; minQty?: number; unitCost?: number; qty?: number; supplierId?: string | null; active?: boolean },
  ) => (id ? request<InventoryItem>(c, 'PUT', `/inventory/items/${encodeURIComponent(id)}`, body) : request<InventoryItem>(c, 'POST', '/inventory/items', body)),

  saveSupplier: (c: ApiConfig, id: string | null, body: { name?: string; phone?: string; note?: string; active?: boolean }) =>
    id ? request<Supplier>(c, 'PUT', `/suppliers/${encodeURIComponent(id)}`, body) : request<Supplier>(c, 'POST', '/suppliers', body),

  // ---- store-wide settings (receipt header, bank account for transfers)
  store: (c: ApiConfig) => request<StoreInfo>(c, 'GET', '/store'),
  saveStore: (c: ApiConfig, body: Partial<StoreInfo>) => request<StoreInfo>(c, 'PUT', '/store', body),

  // ---- cash in / out during a shift
  cashMoves: (c: ApiConfig, shiftId: string) => request<{ moves: CashMove[] }>(c, 'GET', `/shifts/${encodeURIComponent(shiftId)}/cash`),
  addCash: (c: ApiConfig, shiftId: string, body: { type: 'in' | 'out'; amount: number; reason: string }) =>
    request<CashMove>(c, 'POST', `/shifts/${encodeURIComponent(shiftId)}/cash`, body),

  // ---- stock movement totals per item and type over a period
  usage: (c: ApiConfig, from: string, to: string) =>
    request<{ usage: Record<string, Partial<Record<string, number>>> }>(c, 'GET', `/inventory/usage${q({ from, to })}`),

  // ---- devices
  heartbeat: (c: ApiConfig, d: { id: string; name: string; appVersion: string }) =>
    request<{ ok: boolean }>(c, 'POST', '/devices/heartbeat', { ...d, kind: 'pos' }, 4000),
};
