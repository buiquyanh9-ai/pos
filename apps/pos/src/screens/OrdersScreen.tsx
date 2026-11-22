import { useEffect, useMemo, useState } from 'react';
import { api, type Summary } from '../lib/api';
import { dateTime, localDayRange, money, time } from '../lib/format';
import { getState, retryOrder, usePos, voidOrder } from '../lib/store';
import { printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { PAYMENT_LABEL, type LocalOrder } from '../lib/types';
import { Modal } from '../components/Modal';

const SYNC_LABEL: Record<LocalOrder['sync'], string> = { pending: 'Chờ gửi', synced: 'Đã đồng bộ', rejected: 'Bị từ chối' };

export function OrdersScreen() {
  const orders = usePos((s) => s.orders);
  const connection = usePos((s) => s.connection);
  const [selected, setSelected] = useState<LocalOrder | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const { from, to } = localDayRange();
  const today = useMemo(() => orders.filter((o) => o.createdAt >= from && o.createdAt < to), [orders, from, to]);
  const localRevenue = today.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);

  useEffect(() => {
    if (connection !== 'online') return;
    const { settings } = getState();
    api
      .summary(settings, from, to)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [connection, orders, from, to]);

  return (
    <div className="orders">
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
          <span className="muted">Doanh thu toàn cửa hàng</span>
          <strong>{summary ? money(summary.revenue) : '—'}</strong>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="empty">Chưa có đơn hàng nào.</div>
      ) : (
        <ul className="order-list">
          {orders.map((o) => (
            <li key={o.id}>
              <button className="order-row" onClick={() => setSelected(o)}>
                <span className="order-num">{o.number}</span>
                <span className="muted">{time(o.createdAt)}</span>
                <span className={`pill pill-${o.status === 'voided' ? 'voided' : o.sync}`}>{o.status === 'voided' ? 'Đã huỷ' : SYNC_LABEL[o.sync]}</span>
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

function OrderDetail({ order: o, onClose }: { order: LocalOrder; onClose: () => void }) {
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Đơn ${o.number}`} onClose={onClose}>
      <p className="muted">
        {dateTime(o.createdAt)} · {PAYMENT_LABEL[o.paymentMethod]}
        {o.cashier && ` · ${o.cashier}`}
      </p>
      <ul className="detail-lines">
        {o.items.map((i, idx) => (
          <li key={idx}>
            <span>
              {i.qty} × {i.name}
            </span>
            <span>{money(i.lineTotal)}</span>
          </li>
        ))}
      </ul>
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
      <div className="cart-actions">
        <button className="btn secondary" onClick={() => void printReceipt(o, getState().settings)}>
          In lại
        </button>
        {o.sync === 'rejected' && (
          <button className="btn secondary" onClick={() => retryOrder(o.id)}>
            Gửi lại
          </button>
        )}
        {o.status === 'completed' && o.sync === 'synced' && !confirmVoid && (
          <button className="btn danger" onClick={() => setConfirmVoid(true)}>
            Huỷ đơn
          </button>
        )}
        {confirmVoid && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await voidOrder(o.id);
                notify(`Đã huỷ đơn ${o.number}`, 'success');
                setConfirmVoid(false);
              } catch (err) {
                notify(err instanceof Error ? err.message : String(err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Xác nhận huỷ
          </button>
        )}
      </div>
    </Modal>
  );
}
