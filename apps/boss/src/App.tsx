import { useEffect, useState } from 'react';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Reports } from './screens/Reports';
import { Activity } from './screens/Activity';
import { Stock } from './screens/Stock';
import { More, Notifications } from './screens/More';
import { onServerEvent, startLive, useBoss } from './lib/store';
import { InstallHint } from './components/InstallHint';

export type Tab = 'home' | 'reports' | 'activity' | 'stock' | 'more' | 'notifications';

const TABS: { id: Exclude<Tab, 'notifications'>; label: string; icon: string }[] = [
  { id: 'home', label: 'Tổng quan', icon: 'M4 13h6V4H4zM14 20h6V11h-6zM4 20h6v-3H4zM14 7h6V4h-6z' },
  { id: 'reports', label: 'Báo cáo', icon: 'M5 20V10M12 20V4M19 20v-7' },
  { id: 'activity', label: 'Hoạt động', icon: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4' },
  { id: 'stock', label: 'Kho', icon: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8' },
  { id: 'more', label: 'Thêm', icon: 'M5 12h.01M12 12h.01M19 12h.01' },
];

export function App() {
  const session = useBoss((s) => s.session);
  const unread = useBoss((s) => s.unread);
  const [tab, setTab] = useState<Tab>('home');
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (session) startLive();
  }, [session]);

  // In-app banner for alerts pushed over the live stream.
  useEffect(
    () =>
      onServerEvent((type, data) => {
        if (type !== 'notification') return;
        const n = data as { title: string; body: string };
        setToast(n);
        setTimeout(() => setToast((t) => (t === n ? null : t)), 6000);
      }),
    [],
  );

  if (!session)
    return (
      <>
        <InstallHint />
        <Login />
      </>
    );

  return (
    <div className="app">
      <InstallHint />
      <main className="main">
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'reports' && <Reports />}
        {tab === 'activity' && <Activity />}
        {tab === 'stock' && <Stock />}
        {tab === 'more' && <More openNotifications={() => setTab('notifications')} />}
        {tab === 'notifications' && <Notifications onBack={() => setTab('home')} />}
      </main>
      {toast && (
        <button className="banner" onClick={() => (setTab('notifications'), setToast(null))}>
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}
      <nav className="tabbar" role="tablist">
        {TABS.map((t) => {
          const on = tab === t.id || (t.id === 'more' && tab === 'notifications');
          return (
            <button key={t.id} role="tab" aria-selected={on} className={on ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t.label}</span>
              {t.id === 'more' && unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
