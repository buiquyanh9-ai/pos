import { useEffect, useReducer, useState } from 'react';
import { SaleScreen } from './screens/SaleScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { ShiftScreen } from './screens/ShiftScreen';
import { AdminScreen } from './screens/AdminScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { Toasts } from './components/Toasts';
import { Modal } from './components/Modal';
import { printShiftSummary } from './lib/shiftSummary';
import { money } from './lib/format';
import { ICON, MoreMenu, type MoreItem } from './components/MoreMenu';
import { cartReducer, emptyCart, type Cart } from './lib/cart';
import { CONNECTION_LABEL, getState, logout, pendingCount, syncNow, usePos } from './lib/store';
import { load, save } from './lib/storage';
import { getScanner } from './hardware';
import { notify } from './lib/notify';
import type { LocalOrder, Role } from './lib/types';

type Tab = 'sale' | 'orders' | 'reports' | 'shift' | 'admin' | 'settings';

// The "•••" launcher (classic F&B POS): every page except selling opens from here.
const MENU: (MoreItem & { id: Tab | 'logout'; roles: Role[]; title: string })[] = [
  { id: 'orders', label: 'Hoạt động', title: 'Hoạt động: đơn hàng gần đây', icon: ICON.activity, color: '#22c55e', roles: ['owner', 'cashier'] },
  { id: 'reports', label: 'Báo cáo', title: 'Báo cáo doanh thu', icon: ICON.report, color: '#3b82f6', roles: ['owner', 'cashier'] },
  { id: 'admin', label: 'Nhân viên & thực đơn', title: 'Quản lý', icon: ICON.staff, color: '#a855f7', roles: ['owner'] },
  { id: 'shift', label: 'Két tiền', title: 'Két tiền (ca làm việc)', icon: ICON.cash, color: '#0ea5e9', roles: ['owner', 'cashier'] },
  { id: 'settings', label: 'Cài đặt', title: 'Cài đặt', icon: ICON.settings, color: '#6366f1', roles: ['owner', 'cashier'] },
  { id: 'logout', label: 'Đăng xuất', title: '', icon: ICON.logout, color: '#64748b', roles: ['owner', 'cashier'] },
];

/** Turn a paid order back into an editable cart ("Sửa đơn"). Options become part of the note. */
function orderToCart(o: LocalOrder): Cart {
  return {
    lines: o.items.map((i, k) => {
      const note = [i.options, i.note].filter(Boolean).join(' · ');
      return { key: `${i.productId ?? `x${k}`}::${note}`, productId: i.productId ?? `x${k}`, name: i.name, price: i.price, qty: i.qty, note, options: [] };
    }),
    discount: o.discount,
    orderType: o.orderType,
    tableName: o.tableName,
    note: o.note,
  };
}

export function App() {
  const session = usePos((s) => s.session);
  const shift = usePos((s) => s.shift);
  const role = session?.user.role;
  const canSell = role === 'owner' || role === 'cashier';
  const [tab, setTab] = useState<Tab>('sale');
  const [more, setMore] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  // Set when the cashier chose "close the shift" at logout: after closing, print the slip and log out.
  const [closeThenLogout, setCloseThenLogout] = useState(false);
  const [serverSettings, setServerSettings] = useState(() => !getState().settings.backendUrl);
  const [query, setQuery] = useState('');
  const [clock, setClock] = useState(() => new Date());
  // Cart lives here so it survives switching pages.
  // The cart is saved on every change, so a reload, crash or power cut never loses the order being taken.
  const [cart, dispatch] = useReducer(cartReducer, emptyCart, () => ({ ...emptyCart, ...load<Partial<Cart>>('shopflow.cart', {}) }));
  useEffect(() => void save('shopflow.cart', cart), [cart]);
  const connection = usePos((s) => s.connection);
  const pending = usePos(pendingCount);
  const syncing = usePos((s) => s.syncing);
  const hardware = usePos((s) => s.settings.hardware);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // Every login starts on the sale screen: the previous user's page (e.g. Két tiền after
  // "close shift then log out") must not carry over to the next cashier.
  const userId = session?.user.id;
  useEffect(() => {
    setTab('sale');
    setCloseThenLogout(false);
    setAskLogout(false);
    setMore(false);
  }, [userId]);

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
              <SettingsScreen beforeLogin />
            </main>
          </section>
        ) : (
          <LoginScreen onServerSettings={() => setServerSettings(true)} />
        )}
        <Toasts />
      </div>
    );
  }

  const items = MENU.filter((m) => role && m.roles.includes(role));
  const pick = (id: string) => {
    setMore(false);
    if (id === 'logout') {
      if (cart.lines.length && !cart.openId) return notify('Hoá đơn đang có món chưa lưu: bấm “Lưu đơn” hoặc “Xoá” trước khi đăng xuất', 'error');
      // With a shift open, ask whether to close it; either way a sales summary is printed.
      return shift ? setAskLogout(true) : void logout();
    }
    setTab(id as Tab);
  };
  const needsShift = tab === 'sale' && !shift;
  const page = MENU.find((m) => m.id === tab);

  const status = (
    <>
      <span className="clock">{clock.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
      <button className={`conn conn-${connection}`} onClick={() => void syncNow()} title="Đồng bộ ngay">
        <span className="dot" />
        <span className="conn-label">{syncing ? 'Đang đồng bộ…' : CONNECTION_LABEL[connection]}</span>
        {pending > 0 && <span className="badge">{pending} chờ gửi</span>}
      </button>
    </>
  );

  return (
    <div className="app no-sidebar">
      <section className="app-main">
        {tab === 'sale' ? (
          <header className="strip">
            <img className="strip-logo" src="./logo.svg" alt="ShopFlow" />
            <div className="strip-who">
              <strong>ShopFlow POS</strong>
              <span>
                {session.user.name}
                {shift ? ` · ca từ ${new Date(shift.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : ' · chưa mở ca'}
              </span>
            </div>
            {!needsShift && (
              <label className="strip-search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm món…" />
              </label>
            )}
            <div className="strip-right">
              {status}
              {/* Before a shift is open the bottom bar is not shown: keep the launcher reachable (reports, settings…). */}
              {needsShift && (
                <button className="strip-more" aria-label="Menu" onClick={() => setMore(true)}>
                  •••
                </button>
              )}
            </div>
          </header>
        ) : (
          <header className="strip page">
            <img className="strip-logo" src="./logo.svg" alt="ShopFlow" />
            {canSell ? (
              <button className="strip-back" onClick={() => setTab('sale')}>
                ‹ Bán hàng
              </button>
            ) : (
              <span />
            )}
            <h1>{page?.title}</h1>
            <div className="strip-right">{status}</div>
          </header>
        )}
        {(connection === 'offline' || connection === 'unauthorized') && (
          <div className={`net-banner ${connection}`} role="status">
            {connection === 'offline'
              ? `Mất kết nối máy chủ: vẫn bán bình thường, ${pending ? `${pending} đơn đang chờ và ` : ''}sẽ tự gửi khi có mạng lại.`
              : 'Phiên đăng nhập đã hết hạn: đăng nhập lại để tiếp tục gửi đơn. Đơn đã bán vẫn được giữ trên máy.'}
            <button onClick={() => void syncNow()}>Thử lại</button>
          </div>
        )}
        <main className="content">
          {needsShift ? (
            <ShiftScreen onOpened={() => setTab('sale')} />
          ) : (
            <>
              {tab === 'sale' && <SaleScreen cart={cart} dispatch={dispatch} query={query} setQuery={setQuery} onMore={() => setMore(true)} />}
              {tab === 'orders' && (
                <OrdersScreen
                  onEdit={(o) => {
                    dispatch({ type: 'load', cart: orderToCart(o) });
                    setTab('sale');
                    notify(`Đơn ${o.number} đã huỷ để sửa: chỉnh món rồi thanh toán lại`, 'success');
                  }}
                />
              )}
              {tab === 'reports' && <ReportsScreen />}
              {tab === 'shift' && (
                <ShiftScreen
                  closeThenLogout={closeThenLogout}
                  onOpened={() => setTab('sale')}
                  onClosed={async (report) => {
                    if (!closeThenLogout) return;
                    setCloseThenLogout(false);
                    await printShiftSummary(report.shift, true);
                    await logout();
                  }}
                />
              )}
              {tab === 'admin' && <AdminScreen />}
              {tab === 'settings' && <SettingsScreen />}
            </>
          )}
        </main>
        {more && <MoreMenu items={items} onPick={pick} onClose={() => setMore(false)} />}
        {askLogout && shift && (
          <LogoutDialog
            onCancel={() => setAskLogout(false)}
            onKeepShift={async () => {
              setAskLogout(false);
              await printShiftSummary(shift, false);
              await logout();
            }}
            onCloseShift={() => {
              setAskLogout(false);
              setCloseThenLogout(true);
              setTab('shift');
            }}
          />
        )}
        <Toasts />
      </section>
    </div>
  );
}

function LogoutDialog({ onCancel, onKeepShift, onCloseShift }: { onCancel: () => void; onKeepShift: () => void; onCloseShift: () => void }) {
  const shift = usePos((s) => s.shift)!;
  const orders = usePos((s) => s.orders);
  const sold = orders.filter((o) => o.shiftId === shift.id && o.status === 'completed');
  const revenue = sold.reduce((a, o) => a + o.total, 0);
  const opened = new Date(shift.openedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return (
    <Modal title="Đăng xuất" onClose={onCancel}>
      <div className="logout-ask">
        <p>
          Ca của <strong>{shift.cashierName}</strong> đang mở từ {opened}: <strong>{sold.length} đơn</strong>, doanh thu <strong>{money(revenue)}</strong>.
        </p>
        <p className="muted">Bạn có muốn đóng ca không? Khi đăng xuất, máy sẽ in phiếu tổng kết gồm tất cả món đã bán và tổng doanh thu.</p>
        <div className="logout-actions">
          <button className="btn primary big" onClick={onCloseShift}>
            Đóng ca rồi đăng xuất
            <small>Đếm tiền két, đóng ca, in phiếu tổng kết</small>
          </button>
          <button className="btn secondary big" onClick={onKeepShift}>
            Đăng xuất, không đóng ca
            <small>Giữ ca cho lần đăng nhập sau, in phiếu tạm tính</small>
          </button>
          <button className="btn ghost" onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </div>
    </Modal>
  );
}
