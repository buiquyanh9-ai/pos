import { useSyncExternalStore } from 'react';
import { api, ApiError, type ApiConfig } from './api';
import { load, save } from './storage';
import { loadSettings, saveSettings, type PosSettings } from './settings';
import { uuid } from './ids';
import { notify } from './notify';
import type { LocalOrder, OrderItem, OrderType, PaymentMethod, Product } from './types';

// Central app state outside React so the sync loop, drivers and screens share it.
// Offline-first: a sale is committed locally first, then uploaded by the sync loop.

export const APP_VERSION = '0.1.0';
const SYNC_INTERVAL_MS = 15_000;
const KEEP_SYNCED_ORDERS = 500;

export type Connection = 'unconfigured' | 'checking' | 'online' | 'offline' | 'unauthorized';

export const CONNECTION_LABEL: Record<Connection, string> = {
  unconfigured: 'Chưa cấu hình máy chủ',
  checking: 'Đang kết nối…',
  online: 'Trực tuyến',
  offline: 'Ngoại tuyến',
  unauthorized: 'Sai API key',
};

export interface PosState {
  settings: PosSettings;
  products: Product[];
  catalogAt: string | null;
  orders: LocalOrder[]; // newest first
  connection: Connection;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: string | null;
}

const K = { catalog: 'shopflow.catalog', orders: 'shopflow.orders', counter: 'shopflow.counter' };

let state: PosState = {
  settings: loadSettings(),
  products: load<Product[]>(K.catalog, []),
  catalogAt: load<string | null>(`${K.catalog}.at`, null),
  orders: load<LocalOrder[]>(K.orders, []).map((o) => ({ ...o, orderType: o.orderType ?? 'dine_in', tableName: o.tableName ?? '', note: o.note ?? '' })),
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
export function usePos<T>(selector: (s: PosState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

const cfg = (): ApiConfig => ({ backendUrl: state.settings.backendUrl, apiKey: state.settings.apiKey });

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
  const order: LocalOrder = {
    id: uuid(),
    number: nextOrderNumber(),
    deviceId: state.settings.deviceId,
    cashier: state.settings.cashier,
    orderType: sale.orderType,
    tableName: sale.tableName,
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
  // Optimistic local stock so the grid reflects the sale while offline.
  const sold = new Map(sale.items.filter((i) => i.productId).map((i) => [i.productId!, i.qty]));
  if (sold.size) {
    const products = state.products.map((p) => (sold.has(p.id) ? { ...p, stock: p.stock - sold.get(p.id)! } : p));
    save(K.catalog, products);
    set({ products });
  }
  void syncNow();
  return order;
}

export async function voidOrder(id: string) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  if (o.sync !== 'synced') throw new Error('Đơn chưa đồng bộ lên máy chủ, chưa thể huỷ');
  await api.voidOrder(cfg(), id);
  persistOrders(state.orders.map((x) => (x.id === id ? { ...x, status: 'voided' } : x)));
  void refreshCatalog();
}

/** Put a rejected order back in the queue (e.g. after fixing data on the server). */
export function retryOrder(id: string) {
  persistOrders(state.orders.map((x) => (x.id === id ? { ...x, sync: 'pending', syncError: undefined } : x)));
  void syncNow();
}

export const pendingCount = (s: PosState) => s.orders.filter((o) => o.sync === 'pending').length;

// ---- Sync
async function refreshCatalog() {
  const { products, serverTime } = await api.products(cfg());
  save(K.catalog, products);
  save(`${K.catalog}.at`, serverTime);
  set({ products, catalogAt: serverTime });
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
    await api.heartbeat(cfg(), { id: state.settings.deviceId, name: state.settings.deviceName, appVersion: APP_VERSION });
    set({ connection: 'online', lastError: null, lastSyncAt: new Date().toISOString() });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
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
