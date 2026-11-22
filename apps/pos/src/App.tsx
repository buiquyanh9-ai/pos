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

export function App() {
  const [tab, setTab] = useState<Tab>(() => (getState().settings.backendUrl ? 'sale' : 'settings'));
  // Cart lives here so it survives switching tabs.
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const connection = usePos((s) => s.connection);
  const pending = usePos(pendingCount);
  const syncing = usePos((s) => s.syncing);
  const hardware = usePos((s) => s.settings.hardware);

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
      <header className="topbar">
        <div className="brand">ShopFlow POS</div>
        <nav className="tabs" role="tablist">
          {(
            [
              ['sale', 'Bán hàng'],
              ['orders', 'Đơn hàng'],
              ['settings', 'Cài đặt'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button className={`conn conn-${connection}`} onClick={() => void syncNow()} title="Đồng bộ ngay">
          <span className="dot" />
          <span className="conn-label">{syncing ? 'Đang đồng bộ…' : CONNECTION_LABEL[connection]}</span>
          {pending > 0 && <span className="badge">{pending} chờ gửi</span>}
        </button>
      </header>
      <main className="content">
        {tab === 'sale' && <SaleScreen cart={cart} dispatch={dispatch} />}
        {tab === 'orders' && <OrdersScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <Toasts />
    </div>
  );
}
