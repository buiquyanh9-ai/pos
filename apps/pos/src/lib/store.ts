import { useSyncExternalStore } from 'react';
import { api, ApiError, type ApiConfig } from './api';
import { load, save } from './storage';
import { loadSettings, saveSettings, type PosSettings } from './settings';
import { uuid } from './ids';
import { notify } from './notify';
import type { Category, DiningTable, LocalOrder, OpenOrder, OptionGroup, OrderItem, OrderType, PaymentMethod, Product, Shift, ShiftReport, User } from './types';
import { totalsOf, type Cart } from './cart';

// Central app state outside React so the sync loop, drivers and screens share it.
// Offline-first: a sale is committed locally first, then uploaded by the sync loop.

export const APP_VERSION = '0.2.0';
const SYNC_INTERVAL_MS = 15_000;
const KEEP_SYNCED_ORDERS = 500;

export type Connection = 'unconfigured' | 'checking' | 'online' | 'offline' | 'unauthorized';

export const CONNECTION_LABEL: Record<Connection, string> = {
  unconfigured: 'Chưa cấu hình máy chủ',
  checking: 'Đang kết nối…',
  online: 'Trực tuyến',
  offline: 'Ngoại tuyến',
  unauthorized: 'Cần đăng nhập lại',
};

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

export interface PosState {
  settings: PosSettings;
  session: Session | null;
  /** Open shift of this device (null = no shift open). */
  shift: Shift | null;
  products: Product[];
  categories: Category[];
  optionGroups: OptionGroup[];
  tables: DiningTable[];
  /** Unpaid table bills from the server (all terminals). */
  openOrders: OpenOrder<Cart>[];
  catalogAt: string | null;
  orders: LocalOrder[]; // newest first
  connection: Connection;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
}

const K = {
  catalog: 'shopflow.catalog',
  orders: 'shopflow.orders',
  counter: 'shopflow.counter',
  session: 'shopflow.session',
  shift: 'shopflow.shift',
  openDeletes: 'shopflow.openDeletes',
};

interface CachedCatalog {
  products: Product[];
  categories: Category[];
  optionGroups: OptionGroup[];
  tables: DiningTable[];
  at: string | null;
}

function loadCatalog(): CachedCatalog {
  const c = load<CachedCatalog | Product[] | null>(K.catalog, null);
  // v0.1 cached a bare product array without the v2 fields.
  if (!c || Array.isArray(c)) return { products: [], categories: [], optionGroups: [], tables: [], at: null };
  return c;
}

const cached = loadCatalog();
const savedSession = load<Session | null>(K.session, null);

let state: PosState = {
  settings: loadSettings(),
  session: savedSession && savedSession.expiresAt > new Date().toISOString() ? savedSession : null,
  shift: load<Shift | null>(K.shift, null),
  products: cached.products,
  categories: cached.categories,
  optionGroups: cached.optionGroups,
  tables: cached.tables,
  openOrders: [],
  catalogAt: cached.at,
  orders: load<LocalOrder[]>(K.orders, []).map((o) => ({
    ...o,
    orderType: o.orderType ?? 'dine_in',
    tableName: o.tableName ?? '',
    note: o.note ?? '',
    shiftId: o.shiftId ?? null,
    cashierId: o.cashierId ?? null,
    paymentMethod: (o.paymentMethod as string) === 'qr' ? 'transfer' : o.paymentMethod,
  })),
  connection: 'checking',
  syncing: false,
  lastError: null,
  lastSyncAt: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<PosState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
/** Select from the store. The selector must return a stable value (a state field or a primitive). */
export function usePos<T>(selector: (s: PosState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export const cfg = (): ApiConfig => ({ backendUrl: state.settings.backendUrl, token: state.session?.token, apiKey: state.settings.apiKey });

/** Call any API function with the current server + session, e.g. `remote(api.inventory)`. */
export function remote<A extends unknown[], R>(fn: (c: ApiConfig, ...args: A) => Promise<R>, ...args: A): Promise<R> {
  return fn(cfg(), ...args).catch((err) => {
    if (err instanceof ApiError && err.status === 401) set({ connection: 'unauthorized' });
    throw err;
  });
}

function persistOrders(orders: LocalOrder[]) {
  // Never drop unsynced orders; trim only old synced/rejected ones.
  let kept = 0;
  const trimmed = orders.filter((o) => o.sync === 'pending' || kept++ < KEEP_SYNCED_ORDERS);
  if (!save(K.orders, trimmed)) notify('Bộ nhớ máy đầy: không lưu được đơn hàng!', 'error');
  set({ orders: trimmed });
}

// ---- Settings
export function updateSettings(next: PosSettings) {
  const changedServer = next.backendUrl !== state.settings.backendUrl || next.apiKey !== state.settings.apiKey;
  saveSettings(next);
  set({ settings: next });
  if (changedServer) void syncNow();
}

// ---- Session (PIN login)
export const isLoggedIn = (s: PosState) => Boolean(s.session);

export async function login(username: string, pin: string) {
  const r = await api.login(cfg(), { username, pin, client: `pos:${state.settings.deviceId}` });
  const session: Session = { token: r.token, expiresAt: r.expiresAt, user: r.user };
  save(K.session, session);
  set({ session, connection: 'checking' });
  await syncNow();
  return r.user;
}

/** Log out the cashier. Pending orders stay queued and upload after the next login. */
export async function logout() {
  const token = state.session?.token;
  save(K.session, null);
  set({ session: null });
  if (token) await api.logout({ ...cfg(), token }).catch(() => undefined);
}

// ---- Shift
function setShift(shift: Shift | null) {
  save(K.shift, shift);
  set({ shift });
}

export async function openShift(openingCash: number) {
  const shift = await remote(api.openShift, state.settings.deviceId, openingCash);
  setShift(shift);
  return shift;
}

/** Close the shift: pending orders are uploaded first so the report is complete. */
export async function closeShift(countedCash: number, note = ''): Promise<ShiftReport> {
  if (!state.shift) throw new Error('Chưa mở ca');
  await syncNow();
  if (state.orders.some((o) => o.sync === 'pending' && o.shiftId === state.shift!.id)) {
    throw new Error('Còn đơn chưa gửi lên máy chủ. Kiểm tra kết nối rồi thử lại.');
  }
  const report = await remote(api.closeShift, state.shift.id, countedCash, note);
  setShift(null);
  return report;
}

// ---- Orders
function nextOrderNumber(): string {
  const d = new Date();
  const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const c = load<{ day: string; n: number }>(K.counter, { day, n: 0 });
  const n = c.day === day ? c.n + 1 : 1;
  save(K.counter, { day, n });
  const device = state.settings.deviceId.replace(/^pos-/, '').slice(0, 4).toUpperCase();
  return `${device}-${day}-${String(n).padStart(3, '0')}`;
}

export interface NewSale {
  items: OrderItem[];
  discount: number;
  paymentMethod: PaymentMethod;
  paid: number;
  orderType: OrderType;
  tableName: string;
  note: string;
}

export function commitSale(sale: NewSale): LocalOrder {
  const subtotal = sale.items.reduce((s, i) => s + i.lineTotal, 0);
  const discount = Math.min(sale.discount, subtotal);
  const total = subtotal - discount;
  if (sale.paid < total) throw new Error('Số tiền khách đưa chưa đủ');
  if (sale.paymentMethod !== 'cash' && sale.paid !== total) throw new Error('Chỉ thanh toán tiền mặt mới có tiền thối');
  const user = state.session?.user;
  const order: LocalOrder = {
    id: uuid(),
    number: nextOrderNumber(),
    deviceId: state.settings.deviceId,
    shiftId: state.shift?.id ?? null,
    cashierId: user?.id ?? null,
    cashier: user?.name ?? state.settings.cashier,
    orderType: sale.orderType,
    tableName: sale.orderType === 'dine_in' ? sale.tableName : '',
    note: sale.note.trim(),
    items: sale.items,
    subtotal,
    discount,
    total,
    paymentMethod: sale.paymentMethod,
    paid: sale.paid,
    change: sale.paid - total,
    createdAt: new Date().toISOString(),
    status: 'completed',
    sync: 'pending',
  };
  persistOrders([order, ...state.orders]);
  // Optimistic local availability so the grid reflects the sale while offline (server recomputes from BOM).
  const sold = new Map<string, number>();
  for (const i of sale.items) if (i.productId) sold.set(i.productId, (sold.get(i.productId) ?? 0) + i.qty);
  if (sold.size) {
    const products = state.products.map((p) => (sold.has(p.id) && p.stock !== null ? { ...p, stock: Math.max(0, p.stock - sold.get(p.id)!) } : p));
    saveCatalog({ products });
  }
  void syncNow();
  return order;
}

async function changeOrderStatus(id: string, kind: 'void' | 'refund', reason: string, restock = false) {
  // Orders from other terminals are not in local storage; they are on the server by definition.
  const o = state.orders.find((x) => x.id === id);
  if (o && o.sync !== 'synced') throw new Error('Đơn chưa đồng bộ lên máy chủ, chưa thể huỷ/hoàn tiền');
  if (!reason.trim()) throw new Error('Vui lòng nhập lý do');
  if (kind === 'void') await remote(api.voidOrder, id, reason.trim());
  else await remote(api.refundOrder, id, { reason: reason.trim(), restock, shiftId: state.shift?.id });
  persistOrders(state.orders.map((x) => (x.id === id ? { ...x, status: kind === 'void' ? 'voided' : 'refunded', statusReason: reason.trim() } : x)));
  void refreshCatalog().catch(() => undefined);
}

/** Cancel a mistaken order (stock goes back). */
export const voidOrder = (id: string, reason: string) => changeOrderStatus(id, 'void', reason);
/** Give the money back. restock=true only if the goods can be resold (e.g. unopened bottle). */
export const refundOrder = (id: string, reason: string, restock = false) => changeOrderStatus(id, 'refund', reason, restock);

/** Put a rejected order back in the queue (e.g. after fixing data on the server). */
export function retryOrder(id: string) {
  persistOrders(state.orders.map((x) => (x.id === id ? { ...x, sync: 'pending', syncError: undefined } : x)));
  void syncNow();
}

export const pendingCount = (s: PosState) => s.orders.filter((o) => o.sync === 'pending').length;

// ---- Open bills (table orders paid later). Needs the server so every terminal sees the same bill.
export async function refreshOpenOrders() {
  const r = await api.openOrders(cfg());
  set({ openOrders: r.openOrders as OpenOrder<Cart>[] });
}

/** Save the cart as an open bill. Returns the stored bill (with new version). */
export async function saveOpenOrder(cart: Cart): Promise<OpenOrder<Cart>> {
  if (!cart.lines.length) throw new Error('Đơn chưa có món');
  if (cart.orderType === 'dine_in' && !cart.tableName) throw new Error('Chọn bàn trước khi lưu đơn tại quán');
  const id = cart.openId ?? uuid();
  const t = totalsOf(cart);
  const stored: Cart = { ...cart, openId: id };
  const saved = (await remote(api.saveOpenOrder, id, {
    deviceId: state.settings.deviceId,
    tableName: cart.tableName,
    orderType: cart.orderType,
    note: cart.note,
    itemCount: t.count,
    total: t.total,
    cart: { ...stored, openVersion: undefined },
    version: cart.openVersion,
  })) as OpenOrder<Cart>;
  void refreshOpenOrders().catch(() => undefined);
  return saved;
}

/** Remove a bill after it was paid (or cancelled with a reason). Offline: retried by the sync loop. */
export async function closeOpenOrder(id: string, reason?: string) {
  try {
    await api.deleteOpenOrder(cfg(), id, reason);
  } catch {
    const q = load<string[]>(K.openDeletes, []);
    save(K.openDeletes, [...new Set([...q, id])]);
  }
  set({ openOrders: state.openOrders.filter((o) => o.id !== id) });
}

async function flushOpenDeletes() {
  const q = load<string[]>(K.openDeletes, []);
  for (const id of q) await api.deleteOpenOrder(cfg(), id);
  if (q.length) save(K.openDeletes, []);
}

// ---- Sync
function saveCatalog(patch: Partial<CachedCatalog>) {
  const next: CachedCatalog = {
    products: patch.products ?? state.products,
    categories: patch.categories ?? state.categories,
    optionGroups: patch.optionGroups ?? state.optionGroups,
    tables: patch.tables ?? state.tables,
    at: patch.at ?? state.catalogAt,
  };
  save(K.catalog, next);
  set({ products: next.products, categories: next.categories, optionGroups: next.optionGroups, tables: next.tables, catalogAt: next.at });
}

async function refreshCatalog() {
  const [cat, tables] = await Promise.all([api.catalog(cfg()), api.tables(cfg())]);
  saveCatalog({ products: cat.products, categories: cat.categories, optionGroups: cat.optionGroups, tables: tables.tables, at: cat.serverTime });
}

let inFlight: Promise<void> | null = null;
let rerun = false;

/** Coalesces concurrent calls; a call made during a running sync schedules one more pass,
 *  so an order committed mid-sync is uploaded right away instead of on the next interval. */
export function syncNow(): Promise<void> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      rerun = false;
      await doSync();
    } while (rerun);
  })().finally(() => (inFlight = null));
  return inFlight;
}

async function doSync() {
  if (!state.settings.backendUrl) {
    set({ connection: 'unconfigured' });
    return;
  }
  if (!state.session && !state.settings.apiKey) {
    // Not logged in: only check that the server answers, so the login screen can show status.
    try {
      await api.health(cfg());
      set({ connection: 'online', lastError: null }); // server reachable; the login screen handles the rest
    } catch (err) {
      set({ connection: 'offline', lastError: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  set({ syncing: true });
  try {
    // Upload oldest pending orders first.
    const pending = state.orders.filter((o) => o.sync === 'pending').reverse();
    for (const o of pending) {
      try {
        await api.uploadOrder(cfg(), o);
        persistOrders(state.orders.map((x) => (x.id === o.id ? { ...x, sync: 'synced', syncError: undefined } : x)));
      } catch (err) {
        if (err instanceof ApiError && err.permanent) {
          persistOrders(state.orders.map((x) => (x.id === o.id ? { ...x, sync: 'rejected', syncError: err.message } : x)));
          notify(`Máy chủ từ chối đơn ${o.number}: ${err.message}`, 'error');
          continue;
        }
        throw err;
      }
    }
    await refreshCatalog();
    await flushOpenDeletes();
    await refreshOpenOrders();
    const { shift } = await api.currentShift(cfg(), state.settings.deviceId);
    if (JSON.stringify(shift) !== JSON.stringify(state.shift)) setShift(shift);
    await api.heartbeat(cfg(), { id: state.settings.deviceId, name: state.settings.deviceName, appVersion: APP_VERSION });
    set({ connection: 'online', lastError: null, lastSyncAt: new Date().toISOString() });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 401 && state.session) {
      save(K.session, null);
      set({ session: null });
    }
    set({
      connection: status === 401 ? 'unauthorized' : 'offline',
      lastError: err instanceof Error ? err.message : String(err),
    });
  } finally {
    set({ syncing: false });
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  void syncNow();
  setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
}
