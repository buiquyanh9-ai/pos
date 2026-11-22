import { useState } from 'react';
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, money, type OrderType, type PaymentMethod } from '@shopflow/shared';
import { api, type ApiOrder } from '../lib/api';
import { dateTimeLocal, isoDateLocal, timeLocal } from '../lib/range';
import { useRemote } from '../lib/store';
import { Header, Loading, Sheet } from '../components/UI';

type Filter = 'all' | OrderType;

export function Activity() {
  const { data, error, loading } = useRemote((c) => api.activity(c));
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<ApiOrder | null>(null);
  const orders = (data?.orders ?? []).filter((o) => filter === 'all' || o.orderType === filter);
  const completed = orders.filter((o) => o.status !== 'voided');
  const total = completed.reduce((s, o) => s + o.total - o.refundAmount, 0);

  // Group by local day like a bank statement.
  const groups: [string, ApiOrder[]][] = [];
  for (const o of orders) {
    const day = isoDateLocal(o.createdAt);
    const g = groups.find(([d]) => d === day);
    if (g) g[1].push(o);
    else groups.push([day, [o]]);
  }

  return (
    <div className="screen">
      <Header title="Hoạt động" />
      <div className="screen-body with-footer">
        {data && data.openShifts.length > 0 && (
          <div className="shift-strip">
            {data.openShifts.map((s) => (
              <span key={s.id} className="pill">
                ● {s.cashierName} · từ {timeLocal(s.openedAt)}
              </span>
            ))}
          </div>
        )}
        <div className="chips scroll-x">
          {(['all', 'dine_in', 'takeaway', 'delivery'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Tất cả' : ORDER_TYPE_LABEL[f]}
            </button>
          ))}
        </div>
        <Loading error={error} loading={loading && !data} />
        {groups.map(([day, list]) => (
          <section key={day}>
            <h3 className="day">{day.split('-').reverse().join('/')}</h3>
            <ul className="list card flush">
              {list.map((o) => (
                <li key={o.id}>
                  <button className="order-row" onClick={() => setOpen(o)}>
                    <span className={`dot type-${o.orderType}`} aria-hidden="true" />
                    <span className="grow">
                      <strong className={o.status === 'voided' ? 'strike' : ''}>{money(o.total)}</strong>
                      <span className="muted small">
                        {o.number}
                        {o.tableName && ` · ${o.tableName}`} · {PAYMENT_LABEL[o.paymentMethod as PaymentMethod] ?? o.paymentMethod}
                      </span>
                    </span>
                    {o.status !== 'completed' && <span className={`tag tag-${o.status}`}>{ORDER_STATUS_LABEL[o.status]}</span>}
                    <span className="muted small">{timeLocal(o.createdAt)}</span>
                    <span className="chev">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {data && !orders.length && <p className="empty">Chưa có đơn hàng</p>}
      </div>
      <footer className="sum-footer">
        <span>
          Tổng <strong>{completed.length} đơn</strong>
        </span>
        <span>
          Thực thu <strong>{money(total)}</strong>
        </span>
      </footer>
      {open && <OrderSheet order={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OrderSheet({ order: o, onClose }: { order: ApiOrder; onClose: () => void }) {
  return (
    <Sheet title={`Đơn ${o.number}`} onClose={onClose}>
      <p className="muted">
        {dateTimeLocal(o.createdAt)} · {ORDER_TYPE_LABEL[o.orderType as OrderType] ?? o.orderType}
        {o.tableName && ` · ${o.tableName}`} · {o.cashier}
      </p>
      {o.status !== 'completed' && (
        <p className={`tag tag-${o.status}`}>
          {ORDER_STATUS_LABEL[o.status]}: {o.statusReason}
          {o.statusAt && ` (${dateTimeLocal(o.statusAt)})`}
        </p>
      )}
      <ul className="kv">
        {o.items.map((i, k) => (
          <li key={k}>
            <span>
              {i.qty} × {i.name}
              {(i.options || i.note) && <span className="muted small"> {[i.options, i.note].filter(Boolean).join(' · ')}</span>}
            </span>
            <strong>{money(i.lineTotal)}</strong>
          </li>
        ))}
        {o.discount > 0 && (
          <li>
            <span>Giảm giá</span>
            <strong>−{money(o.discount)}</strong>
          </li>
        )}
        <li className="total">
          <span>Tổng</span>
          <strong>{money(o.total)}</strong>
        </li>
        <li>
          <span>{PAYMENT_LABEL[o.paymentMethod as PaymentMethod] ?? o.paymentMethod}</span>
          <span>
            {money(o.paid)}
            {o.change > 0 && ` · thối ${money(o.change)}`}
          </span>
        </li>
      </ul>
      {o.note && <p className="muted">Ghi chú: {o.note}</p>}
    </Sheet>
  );
}
