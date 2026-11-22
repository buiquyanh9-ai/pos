import { useEffect, useReducer, useState } from 'react';
import { SaleScreen } from './screens/SaleScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import { StockScreen } from './screens/StockScreen';
import { AdminScreen } from './screens/AdminScreen';
import { Toasts } from './components/Toasts';
import { cartReducer, emptyCart } from './lib/cart';
import { CONNECTION_LABEL, getState, logout, pendingCount, syncNow, usePos } from './lib/store';
import { getScanner } from './hardware';
import { notify } from './lib/notify';
import { ROLE_LABEL, type Role } from './lib/types';

type Tab = 'sale' | 'orders' | 'shift' | 'stock' | 'admin' | 'settings';
type IconName = 'cart' | 'orders' | 'shift' | 'stock' | 'admin' | 'settings' | 'search';

const ICONS: Record<IconName, string> = {
  cart: 'M3 4h2l2 11h10l2-8H6M9 20a1 1 0 1 0 0 0M17 20a1 1 0 1 0 0 0',
  orders: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  shift: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  stock: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  admin: 'M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  search: 'm21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV: { id: Tab; label: string; icon: IconName; roles: Role[] }[] = [
  { id: 'sale', label: 'Bán hàng', icon: 'cart', roles: ['owner', 'cashier'] },
  { id: 'orders', label: 'Đơn hàng', icon: 'orders', roles: ['owner', 'cashier'] },
  { id: 'shift', label: 'Ca', icon: 'shift', roles: ['owner', 'cashier'] },
  { id: 'stock', label: 'Kho', icon: 'stock', roles: ['owner', 'cashier', 'stock'] },
  { id: 'admin', label: 'Quản lý', icon: 'admin', roles: ['owner'] },
  { id: 'settings', label: 'Cài đặt', icon: 'settings', roles: ['owner', 'cashier', 'stock'] },
];

export function App() {
  const session = usePos((s) => s.session);
  const shift = usePos((s) => s.shift);
  const role = session?.user.role;
  const [tab, setTab] = useState<Tab>('sale');
  const [serverSettings, setServerSettings] = useState(() => !getState().settings.backendUrl);
  const [query, setQuery] = useState('');
  const [clock, setClock] = useState(() => new Date());
  // Cart lives here so it survives switching tabs.
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const connection = usePos((s) => s.connection);
  const pending = usePos(pendingCount);
  const syncing = usePos((s) => s.syncing);
  const hardware = usePos((s) => s.settings.hardware);
  const storeName = usePos((s) => s.settings.storeName);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const nav = NAV.filter((n) => role && n.roles.includes(role));
  // Land on the first page this role may use (stock staff go straight to Kho).
  useEffect(() => {
    if (role && !nav.some((n) => n.id === tab)) setTab(nav[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // Barcode scanner: a scan adds the matching product on the sale screen.
  useEffect(() => {
    const scanner = getScanner(hardware);
    scanner.start((code) => {
      if (!getState().session || !getState().shift) return;
      const c = code.trim();
      const p = getState().products.find((x) => x.barcode === c || x.sku === c);
      if (!p) return notify(`Không tìm thấy mã ${c}`, 'error');
      dispatch({ type: 'add', product: p });
      setTab('sale');
    });
    return () => scanner.stop();
  }, [hardware]);

  if (!session) {
    return (
      <div className="app app-login">
        {serverSettings ? (
          <section className="app-main">
            <header className="topbar">
              <button className="link" onClick={() => setServerSettings(false)}>
                ‹ Về màn đăng nhập
              </button>
            </header>
            <main className="content">
              <SettingsScreen />
            </main>
          </section>
        ) : (
          <LoginScreen onServerSettings={() => setServerSettings(true)} />
        )}
        <Toasts />
      </div>
    );
  }

  // Selling needs an open shift; the shift screen doubles as the "open shift" gate.
  const needsShift = tab === 'sale' && !shift;

  return (
    <div className={tab === 'sale' && !needsShift ? 'app sale-mode' : 'app'}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>ShopFlow</span>
        </div>
        <nav className="side-nav" role="tablist">
          {nav.map((n) => (
            <button key={n.id} role="tab" aria-selected={tab === n.id} className={tab === n.id ? 'side-link active' : 'side-link'} onClick={() => setTab(n.id)}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-footer" onClick={() => void logout()} title="Đăng xuất">
          <span className="user-avatar">{session.user.name.slice(0, 1)}</span>
          <span>
            <strong>{session.user.name}</strong>
            <small>{shift ? 'Ca đang mở' : ROLE_LABEL[session.user.role]} · Đăng xuất</small>
          </span>
        </button>
      </aside>
      <section className="app-main">
        <header className="topbar">
          <div className="topbar-store">
            <strong>{storeName || 'ShopFlow Store'}</strong>
            <span>
              {session.user.name}
              {shift ? ` · ca từ ${new Date(shift.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ' · chưa mở ca'}
            </span>
          </div>
          {tab === 'sale' && !needsShift ? (
            <label className="global-search">
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm món, mã SKU hoặc mã vạch..." />
            </label>
          ) : (
            <div />
          )}
          <div className="topbar-right">
            <span className="clock">{clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
            <button className={`conn conn-${connection}`} onClick={() => void syncNow()} title="Đồng bộ ngay">
              <span className="dot" />
              <span className="conn-label">{syncing ? 'Đang đồng bộ…' : CONNECTION_LABEL[connection]}</span>
              {pending > 0 && <span className="badge">{pending} chờ gửi</span>}
            </button>
          </div>
        </header>
        <main className="content">
          {needsShift ? (
            <ShiftScreen onOpened={() => setTab('sale')} />
          ) : (
            <>
              {tab === 'sale' && <SaleScreen cart={cart} dispatch={dispatch} query={query} setQuery={setQuery} />}
              {tab === 'orders' && <OrdersScreen />}
              {tab === 'shift' && <ShiftScreen />}
              {tab === 'stock' && <StockScreen />}
              {tab === 'admin' && <AdminScreen />}
              {tab === 'settings' && <SettingsScreen />}
            </>
          )}
        </main>
        <Toasts />
      </section>
    </div>
  );
}
