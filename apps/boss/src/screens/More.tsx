import { useEffect, useState } from 'react';
import { money } from '@shopflow/shared';
import { api } from '../lib/api';
import { dateTimeLocal, presetRange } from '../lib/range';
import { call, enableSystemNotifications, logout, refreshUnread, useBoss, useRemote } from '../lib/store';
import { Card, Header, Loading, Sheet } from '../components/UI';

export function Notifications({ onBack }: { onBack?: () => void }) {
  const { data, error, loading } = useRemote(api.notifications);
  const [showPrefs, setShowPrefs] = useState(false);
  useEffect(() => {
    // Opening the list marks everything as seen.
    if (data?.unread) void call((c) => api.markRead(c, 'all')).then(refreshUnread);
  }, [data]);
  return (
    <div className="screen">
      <Header
        title="Thông báo"
        onBack={onBack}
        right={
          <button className="icon-btn" aria-label="Cài đặt thông báo" onClick={() => setShowPrefs(true)}>
            ⚙
          </button>
        }
      />
      <div className="screen-body">
        <Loading error={error} loading={loading && !data} />
        <ul className="list card flush">
          {data?.notifications.map((n) => (
            <li key={n.id} className={n.read ? 'notif' : 'notif unread'}>
              <span className={`notif-icon t-${n.type.replace('.', '-')}`} aria-hidden="true">
                {n.type.startsWith('stock') ? '📦' : n.type.startsWith('purchase') ? '🧾' : n.type.startsWith('order') ? '↩' : '📊'}
              </span>
              <span className="grow">
                <strong>{n.title}</strong>
                {n.body && <span className="muted small">{n.body}</span>}
                <span className="muted small">{dateTimeLocal(n.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
        {data && !data.notifications.length && <p className="empty">Chưa có thông báo</p>}
      </div>
      {showPrefs && <PrefsSheet onClose={() => setShowPrefs(false)} />}
    </div>
  );
}

function PrefsSheet({ onClose }: { onClose: () => void }) {
  const { data } = useRemote(api.prefs, [], { live: false });
  const [prefs, setPrefs] = useState<{ type: string; label: string; enabled: boolean }[] | null>(null);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  useEffect(() => {
    if (data) setPrefs(data.prefs);
  }, [data]);
  const toggle = async (type: string) => {
    if (!prefs) return;
    const next = prefs.map((p) => (p.type === type ? { ...p, enabled: !p.enabled } : p));
    setPrefs(next);
    await call((c) => api.setPrefs(c, next.map(({ type, enabled }) => ({ type, enabled }))));
  };
  return (
    <Sheet title="Loại thông báo nhận" onClose={onClose}>
      <ul className="list">
        {prefs?.map((p) => (
          <li key={p.type} className="row">
            <span>{p.label}</span>
            <button role="switch" aria-checked={p.enabled} className={p.enabled ? 'switch on' : 'switch'} onClick={() => toggle(p.type)}>
              <span />
            </button>
          </li>
        ))}
      </ul>
      <Card title="Thông báo trên máy">
        <p className="muted small">
          Khi ứng dụng đang mở hoặc chạy nền, cảnh báo được đẩy tức thì qua kết nối trực tiếp.
          {data?.pushEnabled ? ' Máy chủ đã bật đẩy thông báo qua Firebase.' : ' Đẩy thông báo khi tắt app cần cấu hình Firebase trên máy chủ (xem README).'}
        </p>
        {perm !== 'granted' && perm !== 'unsupported' && (
          <button className="btn" onClick={async () => setPerm(await enableSystemNotifications())}>
            Cho phép hiện thông báo hệ thống
          </button>
        )}
        {perm === 'granted' && <p className="muted small">✓ Đã cho phép thông báo hệ thống</p>}
      </Card>
    </Sheet>
  );
}

const ACTION_LABEL: Record<string, string> = {
  login: 'Đăng nhập',
  'login.failed': 'Đăng nhập sai',
  'order.void': 'Huỷ đơn',
  'order.refund': 'Hoàn tiền',
  'open_order.cancel': 'Huỷ đơn chưa thanh toán',
  'shift.open': 'Mở ca',
  'shift.close': 'Đóng ca',
  'inventory.adjust': 'Điều chỉnh kho',
  'inventory.create': 'Thêm mặt hàng kho',
  'inventory.update': 'Sửa mặt hàng kho',
  'stocktake.create': 'Kiểm kê',
  'purchase.create': 'Tạo đề xuất nhập',
  'purchase.approve': 'Duyệt nhập hàng',
  'purchase.reject': 'Từ chối nhập hàng',
  'purchase.receive': 'Nhận hàng',
  'product.create': 'Thêm món',
  'product.update': 'Sửa món',
  'product.delete': 'Ngừng bán món',
  'user.create': 'Thêm nhân viên',
  'user.update': 'Sửa nhân viên',
};

function AuditSheet({ onClose }: { onClose: () => void }) {
  const [onlyImportant, setOnlyImportant] = useState(true);
  const { data, error, loading } = useRemote(api.audit, [], { live: false });
  const important = (a: string) => !a.startsWith('login') || a === 'login.failed';
  const rows = (data?.entries ?? []).filter((e) => !onlyImportant || important(e.action));
  return (
    <Sheet title="Lịch sử thao tác" onClose={onClose}>
      <div className="row">
        <span>Ẩn đăng nhập thành công</span>
        <button role="switch" aria-checked={onlyImportant} className={onlyImportant ? 'switch on' : 'switch'} onClick={() => setOnlyImportant(!onlyImportant)}>
          <span />
        </button>
      </div>
      <Loading error={error} loading={loading && !data} />
      <ul className="list">
        {rows.map((e) => {
          const d = e.data ?? {};
          const detail = [d.reason, d.total !== undefined ? money(Number(d.total)) : null, d.tableName, d.delta !== undefined ? `${Number(d.delta) > 0 ? '+' : ''}${d.delta}` : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={e.id} className="row">
              <span className="grow">
                <strong>{ACTION_LABEL[e.action] ?? e.action}</strong>
                <span className="muted small">
                  {e.userName ?? (e.action === 'login.failed' ? `tài khoản ${e.entityId}` : 'Hệ thống')} · {dateTimeLocal(e.at)}
                  {detail && ` · ${detail}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

export function More({ openNotifications }: { openNotifications: () => void }) {
  const user = useBoss((s) => s.session?.user);
  const url = useBoss((s) => s.url);
  const unread = useBoss((s) => s.unread);
  const week = presetRange('last7');
  const { data, error, loading } = useRemote((c) => api.shifts(c, week.from, week.to), []);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  return (
    <div className="screen">
      <Header title="Thêm" />
      <div className="screen-body">
        <button className="menu-row" onClick={openNotifications}>
          <span>🔔 Thông báo</span>
          {unread > 0 && <span className="badge inline">{unread}</span>}
          <span className="chev">›</span>
        </button>
        <button className="menu-row" onClick={() => setShowAudit(true)}>
          <span>🕘 Lịch sử thao tác (huỷ đơn, hoàn tiền, điều chỉnh kho…)</span>
          <span className="chev">›</span>
        </button>
        <Card title="Ca làm việc 7 ngày qua">
          <Loading error={error} loading={loading && !data} />
          <ul className="list">
            {data?.shifts.map((s) => (
              <li key={s.id}>
                <button className="order-row" onClick={() => setShiftId(s.id)}>
                  <span className="grow">
                    <strong>{s.cashierName}</strong>
                    <span className="muted small">
                      {dateTimeLocal(s.openedAt)} → {s.closedAt ? dateTimeLocal(s.closedAt) : 'đang mở'}
                    </span>
                  </span>
                  {s.cashDifference !== null && s.cashDifference !== 0 && <span className="tag tag-warn">Lệch {money(s.cashDifference)}</span>}
                  {s.status === 'open' && <span className="tag tag-ok">Đang mở</span>}
                  <span className="chev">›</span>
                </button>
              </li>
            ))}
          </ul>
          {data && !data.shifts.length && <p className="empty">Chưa có ca nào</p>}
        </Card>
        <Card title="Tài khoản">
          <ul className="kv">
            <li>
              <span>Người dùng</span>
              <strong>{user?.name}</strong>
            </li>
            <li>
              <span>Máy chủ</span>
              <span className="small">{url}</span>
            </li>
          </ul>
          <button className="btn danger" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </Card>
      </div>
      {shiftId && <ShiftSheet id={shiftId} onClose={() => setShiftId(null)} />}
      {showAudit && <AuditSheet onClose={() => setShowAudit(false)} />}
    </div>
  );
}

export function ShiftSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useRemote((c) => api.shiftReport(c, id), [id]);
  const s = data?.shift;
  const r = data?.summary;
  return (
    <Sheet title="Báo cáo ca" onClose={onClose}>
      <Loading error={error} loading={loading && !data} />
      {s && r && (
        <ul className="kv">
          <li>
            <span>Thu ngân</span>
            <strong>{s.cashierName}</strong>
          </li>
          <li>
            <span>Thời gian</span>
            <span>
              {dateTimeLocal(s.openedAt)} → {s.closedAt ? dateTimeLocal(s.closedAt) : 'đang mở'}
            </span>
          </li>
          <li>
            <span>Số đơn</span>
            <strong>{r.orderCount}</strong>
          </li>
          <li className="total">
            <span>Doanh thu thuần</span>
            <strong>{money(r.netRevenue)}</strong>
          </li>
          {r.byPayment.map((p) => (
            <li key={p.method}>
              <span>· {p.method === 'cash' ? 'Tiền mặt' : p.method === 'transfer' ? 'Chuyển khoản' : p.method === 'qr' ? 'QR' : 'Thẻ'}</span>
              <span>{money(p.revenue)}</span>
            </li>
          ))}
          <li>
            <span>Tiền đầu ca</span>
            <span>{money(s.openingCash)}</span>
          </li>
          <li>
            <span>Tiền mặt dự kiến</span>
            <span>{s.expectedCash === null ? '—' : money(s.expectedCash)}</span>
          </li>
          <li>
            <span>Tiền mặt thực đếm</span>
            <span>{s.countedCash === null ? '—' : money(s.countedCash)}</span>
          </li>
          <li className={s.cashDifference ? 'total neg' : 'total'}>
            <span>Chênh lệch</span>
            <strong>{s.cashDifference === null ? '—' : money(s.cashDifference)}</strong>
          </li>
          <li>
            <span>Hoàn tiền / huỷ</span>
            <span>
              {money(r.refunds)} / {r.voidedCount} đơn
            </span>
          </li>
        </ul>
      )}
    </Sheet>
  );
}
