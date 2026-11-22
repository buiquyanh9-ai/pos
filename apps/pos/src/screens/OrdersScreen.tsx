import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, localDayRange, money, time } from '../lib/format';
import { getState, refundOrder, remote, retryOrder, usePos, voidOrder } from '../lib/store';
import { printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { COUNTER_PAYMENT_METHODS, ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, type LocalOrder, type OrderType, type PaymentMethod, type Summary } from '../lib/types';
import { Modal } from '../components/Modal';

const SYNC_LABEL: Record<LocalOrder['sync'], string> = { pending: 'Chờ gửi', synced: 'Đã đồng bộ', rejected: 'Bị từ chối' };

export function OrdersScreen({ onEdit }: { onEdit?: (order: LocalOrder) => void } = {}) {
  const localOrders = usePos((s) => s.orders);
  const [serverOrders, setServerOrders] = useState<LocalOrder[] | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const connection = usePos((s) => s.connection);
  const shift = usePos((s) => s.shift);
  const [selected, setSelected] = useState<LocalOrder | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState<'all' | OrderType>('all');
  const [pay, setPay] = useState<'all' | PaymentMethod>('all');

  const { from, to } = localDayRange();
  // Server orders (every terminal) + this terminal's orders not yet uploaded.
  useEffect(() => {
    if (connection !== 'online') return;
    const range = scope === 'today' ? { from, to } : { from: new Date(Date.now() - 30 * 86400_000).toISOString() };
    remote(api.orders, range)
      .then((r) => setServerOrders(r.orders.map((o) => ({ ...o, sync: 'synced' as const }))))
      .catch(() => setServerOrders(null));
  }, [connection, scope, from, to, localOrders, reloadTick]);
  const orders = useMemo(() => {
    if (!serverOrders) return localOrders;
    const ids = new Set(serverOrders.map((o) => o.id));
    const unsent = localOrders.filter((o) => o.sync !== 'synced' && !ids.has(o.id));
    return [...unsent, ...serverOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [serverOrders, localOrders]);
  const today = useMemo(() => orders.filter((o) => o.createdAt >= from && o.createdAt < to), [orders, from, to]);
  const localRevenue = today.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);
  const visibleOrders = useMemo(() => orders.filter((o) => (scope === 'all' || (o.createdAt >= from && o.createdAt < to)) && (status === 'all' || (o.status !== 'completed' ? o.status : o.sync) === status) && (type === 'all' || o.orderType === type) && (pay === 'all' || o.paymentMethod === pay)), [orders, scope, status, type, pay, from, to]);
  // Totals per payment method for the current scope (paid orders only; refunds subtracted).
  const scoped = orders.filter((o) => scope === 'all' || (o.createdAt >= from && o.createdAt < to));
  const methods: PaymentMethod[] = [...new Set<PaymentMethod>([...COUNTER_PAYMENT_METHODS, ...scoped.map((o) => o.paymentMethod)])];
  const byMethod = methods.map((m) => {
    const list = scoped.filter((o) => o.paymentMethod === m && o.status === 'completed');
    return { method: m, count: list.length, total: list.reduce((s, o) => s + o.total, 0) };
  });

  // Server figures for the current shift (cashiers may only see their shift's report).
  useEffect(() => {
    if (connection !== 'online' || !shift) return setSummary(null);
    remote(api.summary, { from: shift.openedAt, to: new Date(Date.now() + 60_000).toISOString(), shiftId: shift.id })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [connection, orders, shift]);

  const sel = selected ? orders.find((o) => o.id === selected.id) ?? selected : null;
  const tableOf = (o: LocalOrder) => (o.tableName ? `Bàn ${o.tableName}` : ORDER_TYPE_LABEL[o.orderType]);
  const itemsText = (o: LocalOrder) => o.items.map((i) => `${i.qty}× ${i.name}`).join(', ');

  return (
    <div className="orders-wide">
      <section className="orders-main">
        <div className="orders-kpis">
          <div className="okpi">
            <span>Đơn hôm nay</span>
            <strong>{today.length}</strong>
          </div>
          <div className="okpi">
            <span>Doanh thu hôm nay</span>
            <strong>{money(localRevenue)}</strong>
          </div>
          <div className="okpi">
            <span>Ca này (máy chủ)</span>
            <strong>{summary ? money(summary.netRevenue) : '—'}</strong>
          </div>
          {byMethod.map((b) => (
            <button key={b.method} className={pay === b.method ? 'okpi pay active' : 'okpi pay'} onClick={() => setPay(pay === b.method ? 'all' : b.method)} title="Bấm để lọc">
              <span>
                <i className={`pay-dot pay-${b.method}`} /> {PAYMENT_LABEL[b.method]} · {b.count} đơn
              </span>
              <strong>{money(b.total)}</strong>
            </button>
          ))}
        </div>
        <div className="orders-toolbar">
          <div className="filter-segment">
            <button className={scope === 'today' ? 'active' : ''} onClick={() => setScope('today')}>
              Hôm nay
            </button>
            <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
              30 ngày
            </button>
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Mọi trạng thái</option>
            <option value="synced">Đã đồng bộ</option>
            <option value="pending">Chờ gửi</option>
            <option value="voided">Đã huỷ</option>
            <option value="refunded">Đã hoàn tiền</option>
          </select>
          <select value={pay} onChange={(e) => setPay(e.target.value as 'all' | PaymentMethod)}>
            <option value="all">Mọi phương thức</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABEL[m]}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as 'all' | OrderType)}>
            <option value="all">Mọi loại đơn</option>
            {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((key) => (
              <option key={key} value={key}>
                {ORDER_TYPE_LABEL[key]}
              </option>
            ))}
          </select>
          <span className="orders-count">
            {visibleOrders.length} đơn · {money(visibleOrders.filter((o) => o.status === 'completed').reduce((s2, o) => s2 + o.total, 0))}
          </span>
        </div>
        <div className="orders-table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>Giờ</th>
                <th>Số đơn</th>
                <th>Bàn / loại</th>
                <th>Món</th>
                <th>Thu ngân</th>
                <th>Thanh toán</th>
                <th>Trạng thái</th>
                <th className="num">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => (
                <tr key={o.id} className={`${sel?.id === o.id ? 'selected' : ''} ${o.status !== 'completed' ? 'dim' : ''}`} onClick={() => setSelected(o)}>
                  <td className="muted">{time(o.createdAt)}</td>
                  <td>
                    <strong>{o.number}</strong>
                  </td>
                  <td>{tableOf(o)}</td>
                  <td className="items-cell" title={itemsText(o)}>
                    <span className="clamp2">{itemsText(o)}</span>
                  </td>
                  <td className="muted">{o.cashier}</td>
                  <td>
                    <span className={`pay-badge pay-${o.paymentMethod}`}>{PAYMENT_LABEL[o.paymentMethod]}</span>
                  </td>
                  <td>
                    <span className={`pill pill-${o.status !== 'completed' ? 'voided' : o.sync}`}>{o.status !== 'completed' ? ORDER_STATUS_LABEL[o.status] : SYNC_LABEL[o.sync]}</span>
                  </td>
                  <td className="num">
                    <strong>{money(o.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleOrders.length === 0 && <div className="empty">Không có đơn hàng nào phù hợp bộ lọc.</div>}
        </div>
      </section>
      <aside className="orders-side">
        {sel ? (
          <OrderDetail inline order={sel} onClose={() => setSelected(null)} onChanged={() => setReloadTick((n) => n + 1)} onEdit={onEdit} />
        ) : (
          <div className="orders-side-empty">
            <h3>Chọn một đơn để xem chi tiết</h3>
            <p className="muted">Từ đây có thể in lại, sửa đơn, huỷ đơn hoặc hoàn tiền.</p>
            {summary && (
              <>
                <h3>Món bán chạy trong ca</h3>
                <ol className="report-list">
                  {summary.topProducts.slice(0, 8).map((p2, i) => (
                    <li key={p2.productId ?? p2.name}>
                      <span className="rank">{i + 1}</span>
                      <span className="grow">{p2.name}</span>
                      <strong>{p2.qty}</strong>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

const VOID_REASONS = ['Nhập nhầm món', 'Khách huỷ trước khi làm', 'Trùng đơn', 'Sai phương thức thanh toán'];
const EDIT_REASONS = ['Thêm món', 'Bớt món', 'Sai món', 'Sai bàn', 'Sai phương thức thanh toán'];
const REFUND_REASONS = ['Món lỗi / không đạt', 'Khách đổi ý', 'Làm sai món', 'Giao hàng thất bại'];

function OrderDetail({ order: o, onClose, onChanged, onEdit, inline }: { order: LocalOrder; onClose: () => void; onChanged: () => void; onEdit?: (o: LocalOrder) => void; inline?: boolean }) {
  const [action, setAction] = useState<'void' | 'refund' | 'edit' | null>(null);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (action === 'void' || action === 'edit') await voidOrder(o.id, action === 'edit' ? `Sửa đơn: ${reason}` : reason);
      else await refundOrder(o.id, reason, restock);
      if (action === 'edit') {
        setAction(null);
        onChanged();
        onClose();
        onEdit?.(o);
        return;
      }
      notify(action === 'void' ? `Đã huỷ đơn ${o.number}` : `Đã hoàn ${money(o.total)} cho đơn ${o.number}`, 'success');
      setAction(null);
      onChanged();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <>
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
          <strong>
            {action === 'void'
              ? 'Huỷ đơn (nhập nhầm / chưa làm món): kho được hoàn lại'
              : action === 'edit'
                ? 'Sửa đơn: đơn này sẽ được huỷ (kho hoàn lại) và nạp lại vào giỏ để chỉnh rồi thanh toán lại'
                : `Hoàn tiền ${money(o.total)} cho khách`}
          </strong>
          <div className="opt-row">
            {(action === 'refund' ? REFUND_REASONS : action === 'edit' ? EDIT_REASONS : VOID_REASONS).map((r) => (
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
              {action === 'void' ? 'Xác nhận huỷ đơn' : action === 'edit' ? 'Huỷ & sửa lại đơn' : 'Xác nhận hoàn tiền'}
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
            {onEdit && (
              <button className="btn secondary" onClick={() => (setAction('edit'), setReason(''))}>
                Sửa đơn
              </button>
            )}
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
    </>
  );
  if (!inline)
    return (
      <Modal title={`Đơn ${o.number}`} onClose={onClose}>
        {body}
      </Modal>
    );
  return (
    <div className="order-pane">
      <div className="order-pane-head">
        <h2>Đơn {o.number}</h2>
        <button className="icon-btn" aria-label="Đóng" onClick={onClose}>
          ✕
        </button>
      </div>
      {body}
    </div>
  );
}
