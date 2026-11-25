import { useEffect, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import type { User } from '@shopflow/shared';
import { api, ApiError, type Conn } from './api';

// Boss app state: server URL + owner session + live event stream (SSE).

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

interface State {
  url: string;
  session: Session | null;
  live: 'off' | 'connecting' | 'on';
  unread: number;
  /** Bumped on every server event, so screens can refetch. */
  tick: number;
  lastEvent: { type: string; data: unknown } | null;
}

const K = { url: 'shopflow.boss.url', session: 'shopflow.boss.session' };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/** Boss served by the backend (http://pc:4000/boss/ on the Wi-Fi, or a public https link from
 *  anywhere): the API is on the same origin, whatever address the phone used to open it. */
const sameOrigin = typeof location !== 'undefined' && location.pathname.startsWith('/boss');

function defaultUrl() {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env;
  if (sameOrigin) return location.origin;
  // Installed APK/IPA: the web view's "localhost" is the phone itself, never the shop's server,
  // so start empty and make the owner type the real address (same as the POS app).
  if (Capacitor.isNativePlatform()) return '';
  if (typeof location !== 'undefined' && location.protocol.startsWith('http') && location.hostname !== 'localhost') {
    return `${location.protocol}//${location.hostname}:4000`;
  }
  return 'http://localhost:4000';
}

const saved = read<Session | null>(K.session, null);
let state: State = {
  url: sameOrigin ? location.origin : read(K.url, defaultUrl()),
  session: saved && saved.expiresAt > new Date().toISOString() ? saved : null,
  live: 'off',
  unread: 0,
  tick: 0,
  lastEvent: null,
};

const listeners = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const getState = () => state;
export function useBoss<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => sel(state),
  );
}

export const conn = (): Conn => ({ url: state.url, token: state.session?.token });

export function normalizeUrl(input: string) {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  let path = u.pathname.replace(/\/+$/, '');
  if (path.endsWith('/api')) path = path.slice(0, -4);
  return `${u.protocol}//${u.host}${path}`;
}

export async function login(url: string, username: string, password: string) {
  const base = normalizeUrl(url);
  const r = await api.login({ url: base }, username.trim().toLowerCase(), password);
  if (r.user.role !== 'owner') throw new Error('Ứng dụng Boss dành cho tài khoản Chủ cửa hàng');
  const session = { token: r.token, expiresAt: r.expiresAt, user: r.user };
  write(K.url, base);
  write(K.session, session);
  set({ url: base, session });
  startLive();
}

export async function logout() {
  const c = conn();
  stopLive();
  write(K.session, null);
  set({ session: null, unread: 0 });
  await api.logout(c).catch(() => undefined);
}

function handleAuthError(err: unknown) {
  if (err instanceof ApiError && err.status === 401 && state.session) {
    stopLive();
    write(K.session, null);
    set({ session: null });
  }
}

/** Fetch helper for screens: refetches when `deps` change or the server pushes an event. */
export function useRemote<T>(fn: (c: Conn) => Promise<T>, deps: unknown[] = [], opts: { live?: boolean } = { live: true }) {
  const tick = useBoss((s) => (opts.live === false ? 0 : s.tick));
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn(conn())
      .then((d) => alive && (setData(d), setError(null)))
      .catch((err) => {
        handleAuthError(err);
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading };
}

export async function call<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  try {
    return await fn(conn());
  } catch (err) {
    handleAuthError(err);
    throw err;
  }
}

// ---------------------------------------------------------------- live updates (SSE)
let es: EventSource | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
const EVENTS = ['order.created', 'order.updated', 'shift.updated', 'catalog.changed', 'open_orders.changed', 'notification'];
type Listener = (type: string, data: unknown) => void;
const eventListeners = new Set<Listener>();
export const onServerEvent = (l: Listener) => (eventListeners.add(l), () => void eventListeners.delete(l));

export async function refreshUnread() {
  try {
    const r = await api.notifications(conn());
    set({ unread: r.unread });
  } catch (err) {
    handleAuthError(err);
  }
}

// Debounced refetch of every live screen: a burst of sales triggers one reload.
function bumpTick() {
  if (tickTimer) clearTimeout(tickTimer);
  tickTimer = setTimeout(() => set({ tick: state.tick + 1 }), 400);
}

// The phone pauses the app in the background and the stream can die without an error, so it
// would show "Trực tiếp" over stale numbers. The server pings every 25s: no message for
// STALE_MS means the stream is dead. Every (re)connect refetches, catching up missed sales.
const STALE_MS = 60_000;
let lastSeen = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

function restartLive() {
  if (!state.session) return;
  es?.close();
  es = null;
  startLive();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session) restartLive();
  });
  window.addEventListener('online', () => state.session && restartLive());
}

export function startLive() {
  if (es || !state.session) return;
  set({ live: 'connecting' });
  lastSeen = Date.now();
  es = new EventSource(`${state.url}/api/events?token=${encodeURIComponent(state.session.token)}`);
  es.onopen = () => {
    lastSeen = Date.now();
    set({ live: 'on' });
    bumpTick();
  };
  es.onerror = () => set({ live: 'connecting' }); // EventSource reconnects by itself
  es.addEventListener('ping', () => (lastSeen = Date.now()));
  watchdog ??= setInterval(() => {
    if (es && Date.now() - lastSeen > STALE_MS) restartLive();
  }, 15_000);
  for (const type of EVENTS) {
    es.addEventListener(type, (ev) => {
      let data: unknown = null;
      try {
        data = JSON.parse((ev as MessageEvent).data);
      } catch {
        /* ignore */
      }
      lastSeen = Date.now();
      set({ lastEvent: { type, data } });
      eventListeners.forEach((l) => l(type, data));
      if (type === 'notification') {
        set({ unread: state.unread + 1 });
        showSystemNotification(data as { title: string; body: string });
      }
      bumpTick();
    });
  }
  void refreshUnread();
}

export function stopLive() {
  es?.close();
  es = null;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  set({ live: 'off' });
}

function showSystemNotification(n: { title: string; body: string }) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(n.title, { body: n.body, icon: './icons/icon-192.png' });
    }
  } catch {
    /* not supported (e.g. Android WebView without a push plugin) */
  }
}

export async function enableSystemNotifications() {
  if (typeof Notification === 'undefined') return 'unsupported' as const;
  return Notification.requestPermission();
}
