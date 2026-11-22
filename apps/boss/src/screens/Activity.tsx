import { useState } from 'react';
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, money, type OrderType, type PaymentMethod } from '@shopflow/shared';
import type { OpenOrder } from '@shopflow/shared';
import { api, type ApiOrder, type OpenCart } from '../lib/api';
import { dateTimeLocal, isoDateLocal, timeLocal } from '../lib/range';
import { useRemote } from '../lib/store';
import { Header, Loading, Segmented, Sheet } from '../components/UI';

type Filter = 'all' | OrderType;

export function Activity() {
  const [view, setView] = useState<'paid' | 'open'>('paid');
  const { data: openData } = useRemote(api.openOrders);
  const openCount = openData?.openOrders.length ?? 0;
  return view === 'open' ? (
    <OpenBills bills={openData?.openOrders ?? null} onSwitch={() => setView('paid')} />
  ) : (
    <PaidOrders openCount={openCount} onSwitch={() => setView('open')} />
  );
}

function ViewSwitch({ view, openCount, onSwitch }: { view: 'paid' | 'open'; openCount: number; onSwitch: () => void }) {
  return (
    <Segmented<'paid' | 'open'>
      value={view}
      onChange={(v) => v !== view && onSwitch()}
      options={[
        { id: 'paid', label: 'Đã thanh toán' },
        { id: 'open', label: `Hoá đơn hiện tại${openCount ? ` (${openCount})` : ''}` },
      ]}
    />
  );
}

/** Unpaid table bills right now in the shop ("Hoá đơn hiện tại"). */
function OpenBills({ bills, onSwitch }: { bills: OpenOrder<OpenCart>[] | null; onSwitch: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<OpenOrder<OpenCart> | null>(null);
  const list = (bills ?? []).filter((b) => filter === 'all' || b.orderType === filter);
  const total = list.reduce((s, b) => s + b.total, 0);
  return (
    <div className="screen">
      <Header title="Hoạt động" />
      <div className="screen-body with-footer">
        <ViewSwitch view="open" openCount={bills?.length ?? 0} onSwitch={onSwitch} />
        <div className="chips scroll-x">
          {(['all', 'dine_in', 'takeaway', 'delivery'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Tất cả' : ORDER_TYPE_LABEL[f]}
            </button>
          ))}
        </div>
        {!bills && <p className="empty">Đang tải…</p>}
        <ul className="list card flush">
          {list.map((b) => (
            <li key={b.id}>
              <button className="order-row" onClick={() => setOpen(b)}>
                <span className={`dot type-${b.orderType}`} aria-hidden="true" />
                <span className="grow">
                  <strong>{b.tableName || ORDER_TYPE_LABEL[b.orderType as OrderType] || 'Đơn'}</strong>
                  <span className="muted small">
                    {b.itemCount} món · {b.cashierName ?? ''} · mở {timeLocal(b.createdAt)}
                  </span>
                </span>
                <strong>{money(b.total)}</strong>
                <span className="chev">›</span>
              </button>
            </li>
          ))}
        </ul>
        {bills && !list.length && <p className="empty">Không có hoá đơn đang mở</p>}
      </div>
      <footer className="sum-footer">
        <span>
          Tổng <strong>{list.length} đơn</strong>
        </span>
        <span>
          Tổng phải thu <strong>{money(total)}</strong>
        </span>
      </footer>
      {open && (
        <Sheet title={open.tableName || 'Hoá đơn đang mở'} onClose={() => setOpen(null)}>
          <p className="muted">
            {ORDER_TYPE_LABEL[open.orderType as OrderType] ?? open.orderType} · {open.cashierName ?? ''} · cập nhật {dateTimeLocal(open.updatedAt)}
          </p>
          <ul className="kv">
            {open.cart.lines.map((l) => (
              <li key={l.key}>
                <span>
                  {l.qty} × {l.name}
                  {(l.options.length > 0 || l.note) && (
                    <span className="muted small"> {[l.options.map((o) => o.name).join(', '), l.note].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <strong>{money(l.price * l.qty)}</strong>
              </li>
            ))}
            {open.cart.discount > 0 && (
              <li>
                <span>Giảm giá</span>
                <strong>−{money(open.cart.discount)}</strong>
              </li>
            )}
            <li className="total">
              <span>Phải thu</span>
              <strong>{money(open.total)}</strong>
            </li>
          </ul>
          {open.note && <p className="muted">Ghi chú: {open.note}</p>}
        </Sheet>
      )}
    </div>
  );
}

function PaidOrders({ openCount, onSwitch }: { openCount: number; onSwitch: () => void }) {
  const [pay, setPay] = useState<string>('all');
  const { data, error, loading } = useRemote((c) => api.activity(c));
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<ApiOrder | null>(null);
  const orders = (data?.orders ?? []).filter((o) => (filter === 'all' || o.orderType === filter) && (pay === 'all' || o.paymentMethod === pay));
  const methods = [...new Set(['cash', 'transfer', ...(data?.orders ?? []).map((o) => o.paymentMethod)])];
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
        <ViewSwitch view="paid" openCount={openCount} onSwitch={onSwitch} />
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
        <div className="chips scroll-x">
          {['all', ...methods].map((m) => (
            <button key={m} className={pay === m ? 'chip on' : 'chip'} onClick={() => setPay(m)}>
              {m === 'all' ? 'Mọi thanh toán' : PAYMENT_LABEL[m as PaymentMethod] ?? m}
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

export function OrderSheet({ order: o, onClose }: { order: ApiOrder; onClose: () => void }) {
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
