import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, localDayRange, money, time } from '../lib/format';
import { getState, refundOrder, remote, retryOrder, usePos, voidOrder } from '../lib/store';
import { printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, type LocalOrder, type OrderType, type Summary } from '../lib/types';
import { Modal } from '../components/Modal';

const SYNC_LABEL: Record<LocalOrder['sync'], string> = { pending: 'Chờ gửi', synced: 'Đã đồng bộ', rejected: 'Bị từ chối' };

export function OrdersScreen() {
  const orders = usePos((s) => s.orders);
  const connection = usePos((s) => s.connection);
  const shift = usePos((s) => s.shift);
  const [selected, setSelected] = useState<LocalOrder | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState<'all' | OrderType>('all');

  const { from, to } = localDayRange();
  const today = useMemo(() => orders.filter((o) => o.createdAt >= from && o.createdAt < to), [orders, from, to]);
  const localRevenue = today.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);
  const visibleOrders = useMemo(() => orders.filter((o) => (scope === 'all' || (o.createdAt >= from && o.createdAt < to)) && (status === 'all' || (o.status !== 'completed' ? o.status : o.sync) === status) && (type === 'all' || o.orderType === type)), [orders, scope, status, type, from, to]);

  // Server figures for the current shift (cashiers may only see their shift's report).
  useEffect(() => {
    if (connection !== 'online' || !shift) return setSummary(null);
    remote(api.summary, { from: shift.openedAt, to: new Date(Date.now() + 60_000).toISOString(), shiftId: shift.id })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [connection, orders, shift]);

  return (
    <div className="orders">
      <div className="page-title"><div><span className="eyebrow">QUẢN LÝ</span><h1>Đơn hàng</h1></div><span className="soft-count">{visibleOrders.length} đơn</span></div>
      <div className="stats">
        <div className="stat">
          <span className="muted">Đơn hôm nay (máy này)</span>
          <strong>{today.length}</strong>
        </div>
        <div className="stat">
          <span className="muted">Doanh thu (máy này)</span>
          <strong>{money(localRevenue)}</strong>
        </div>
        <div className="stat">
          <span className="muted">Doanh thu thuần ca này (máy chủ)</span>
          <strong>{summary ? money(summary.netRevenue) : '—'}</strong>
        </div>
      </div>
      <div className="orders-toolbar"><div className="filter-segment"><button className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>Hôm nay</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Tất cả</button></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Mọi trạng thái</option><option value="synced">Đã đồng bộ</option><option value="pending">Chờ gửi</option><option value="voided">Đã huỷ</option><option value="refunded">Đã hoàn tiền</option></select><select value={type} onChange={(e) => setType(e.target.value as 'all' | OrderType)}><option value="all">Mọi loại đơn</option>{(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((key) => <option key={key} value={key}>{ORDER_TYPE_LABEL[key]}</option>)}</select></div>

      {visibleOrders.length === 0 ? (
        <div className="empty">Chưa có đơn hàng nào.</div>
      ) : (
        <ul className="order-list">
          {visibleOrders.map((o) => (
            <li key={o.id}>
              <button className="order-row" onClick={() => setSelected(o)}>
                <span className="order-num">{o.number}</span>
                <span className="muted">{time(o.createdAt)}</span>
                <span className={`pill pill-${o.status !== 'completed' ? 'voided' : o.sync}`}>{o.status !== 'completed' ? ORDER_STATUS_LABEL[o.status] : SYNC_LABEL[o.sync]}</span>
                <strong className="order-total">{money(o.total)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <OrderDetail order={orders.find((o) => o.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const VOID_REASONS = ['Nhập nhầm món', 'Khách huỷ trước khi làm', 'Trùng đơn', 'Sai phương thức thanh toán'];
const REFUND_REASONS = ['Món lỗi / không đạt', 'Khách đổi ý', 'Làm sai món', 'Giao hàng thất bại'];

function OrderDetail({ order: o, onClose }: { order: LocalOrder; onClose: () => void }) {
  const [action, setAction] = useState<'void' | 'refund' | null>(null);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (action === 'void') await voidOrder(o.id, reason);
      else await refundOrder(o.id, reason, restock);
      notify(action === 'void' ? `Đã huỷ đơn ${o.number}` : `Đã hoàn ${money(o.total)} cho đơn ${o.number}`, 'success');
      setAction(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Đơn ${o.number}`} onClose={onClose}>
      <p className="muted">
        {dateTime(o.createdAt)} · {PAYMENT_LABEL[o.paymentMethod]} · {ORDER_TYPE_LABEL[o.orderType]} {o.tableName && `· Bàn ${o.tableName}`}
        {o.cashier && ` · ${o.cashier}`}
      </p>
      <ul className="detail-lines">
        {o.items.map((i, idx) => (
          <li key={idx}>
            <span>
              {i.qty} × {i.name}
              {i.options && <small className="muted"> ({i.options})</small>}
              {i.note && <small className="line-note">* {i.note}</small>}
            </span>
            <span>{money(i.lineTotal)}</span>
          </li>
        ))}
      </ul>
      {o.note && <div className="detail-note"><strong>Ghi chú</strong><span>{o.note}</span></div>}
      <div className="row">
        <span>Tạm tính</span>
        <span>{money(o.subtotal)}</span>
      </div>
      {o.discount > 0 && (
        <div className="row">
          <span>Giảm giá</span>
          <span>−{money(o.discount)}</span>
        </div>
      )}
      <div className="row total">
        <span>Tổng</span>
        <span>{money(o.total)}</span>
      </div>
      {o.paymentMethod === 'cash' && (
        <div className="row muted">
          <span>Khách đưa / thối</span>
          <span>
            {money(o.paid)} / {money(o.change)}
          </span>
        </div>
      )}
      {o.syncError && <p className="error-text">Lỗi đồng bộ: {o.syncError}</p>}
      {o.status !== 'completed' && (
        <p className="error-text">
          {ORDER_STATUS_LABEL[o.status]}
          {o.statusReason && `: ${o.statusReason}`}
        </p>
      )}
      {action && (
        <div className="reason-box">
          <strong>{action === 'void' ? 'Huỷ đơn (nhập nhầm / chưa làm món): kho được hoàn lại' : `Hoàn tiền ${money(o.total)} cho khách`}</strong>
          <div className="opt-row">
            {(action === 'void' ? VOID_REASONS : REFUND_REASONS).map((r) => (
              <button key={r} className={reason === r ? 'opt on' : 'opt'} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <input className="opt-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc)" />
          {action === 'refund' && (
            <label className="check">
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Nhập lại kho (hàng chưa dùng, vd chai nước chưa mở)
            </label>
          )}
          <div className="cart-actions">
            <button className="btn secondary" onClick={() => (setAction(null), setReason(''))}>
              Thôi
            </button>
            <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => void run()}>
              {action === 'void' ? 'Xác nhận huỷ đơn' : 'Xác nhận hoàn tiền'}
            </button>
          </div>
        </div>
      )}
      <div className="cart-actions">
        <button className="btn secondary" onClick={() => void printReceipt(o, getState().settings)}>
          In lại
        </button>
        {o.sync === 'rejected' && (
          <button className="btn secondary" onClick={() => retryOrder(o.id)}>
            Gửi lại
          </button>
        )}
        {o.status === 'completed' && o.sync === 'synced' && !action && (
          <>
            <button className="btn danger" onClick={() => (setAction('void'), setReason(''))}>
              Huỷ đơn
            </button>
            <button className="btn danger" onClick={() => (setAction('refund'), setReason(''), setRestock(false))}>
              Hoàn tiền
            </button>
          </>
        )}
        {o.status === 'completed' && o.sync === 'pending' && <span className="muted small">Đơn chưa gửi lên máy chủ: chưa thể huỷ / hoàn tiền</span>}
      </div>
    </Modal>
  );
}
