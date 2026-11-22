import { useEffect, useReducer, useState } from 'react';
import { SaleScreen } from './screens/SaleScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Toasts } from './components/Toasts';
import { cartReducer, emptyCart } from './lib/cart';
import { CONNECTION_LABEL, getState, pendingCount, syncNow, usePos } from './lib/store';
import { getScanner } from './hardware';
import { notify } from './lib/notify';

type Tab = 'sale' | 'orders' | 'settings';

function Icon({ name }: { name: 'cart' | 'orders' | 'settings' | 'search' | 'sync' }) {
  const paths = { cart: 'M3 4h2l2 11h10l2-8H6M9 20a1 1 0 1 0 0 0M17 20a1 1 0 1 0 0 0', orders: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M3 12h2m14 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', search: 'm21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0', sync: 'M20 7v5h-5M4 17v-5h5M6.4 9A6 6 0 0 1 17 7l3 5M18 15A6 6 0 0 1 7 17l-3-5' };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => (getState().settings.backendUrl ? 'sale' : 'settings'));
  const [query, setQuery] = useState('');
  const [clock, setClock] = useState(() => new Date());
  // Cart lives here so it survives switching tabs.
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const connection = usePos((s) => s.connection);
  const pending = usePos(pendingCount);
  const syncing = usePos((s) => s.syncing);
  const hardware = usePos((s) => s.settings.hardware);
  const storeName = usePos((s) => s.settings.storeName);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);

  // Barcode scanner: a scan adds the matching product on the sale screen.
  useEffect(() => {
    const scanner = getScanner(hardware);
    scanner.start((code) => {
      const c = code.trim();
      const p = getState().products.find((x) => x.barcode === c || x.sku === c);
      if (!p) return notify(`Không tìm thấy mã ${c}`, 'error');
      dispatch({ type: 'add', product: p });
      setTab('sale');
    });
    return () => scanner.stop();
  }, [hardware]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>ShopFlow</span></div>
        <nav className="side-nav" role="tablist">
          {(
            [
              ['sale', 'Bán hàng'],
              ['orders', 'Đơn hàng'],
              ['settings', 'Cài đặt'],
            ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'side-link active' : 'side-link'} onClick={() => setTab(id)}>
                <Icon name={id === 'sale' ? 'cart' : id === 'orders' ? 'orders' : 'settings'} />
                <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="user-avatar">Q</span><span><strong>Quản lý</strong><small>Ca đang mở</small></span></div>
      </aside>
      <section className="app-main">
      <header className="topbar">
        <div className="topbar-store"><strong>{storeName || 'ShopFlow Store'}</strong><span>● Cửa hàng chính</span></div>
        {tab === 'sale' ? <label className="global-search"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm món, mã SKU hoặc mã vạch..." /></label> : <div />}
        <div className="topbar-right"><span className="clock">{clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span><button className={`conn conn-${connection}`} onClick={() => void syncNow()} title="Đồng bộ ngay">
          <span className="dot" />
          <span className="conn-label">{syncing ? 'Đang đồng bộ…' : CONNECTION_LABEL[connection]}</span>
          {pending > 0 && <span className="badge">{pending} chờ gửi</span>}
        </button></div>
      </header>
      <main className="content">
        {tab === 'sale' && <SaleScreen cart={cart} dispatch={dispatch} query={query} setQuery={setQuery} />}
        {tab === 'orders' && <OrdersScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <Toasts />
      </section>
    </div>
  );
}
