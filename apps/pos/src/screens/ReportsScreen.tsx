import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { notify } from '../lib/notify';
import { remote, usePos } from '../lib/store';
import { PAYMENT_LABEL, type LocalOrder, type PaymentMethod, type Summary } from '../lib/types';
import { Modal } from '../components/Modal';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

const pad = (n: number) => String(n).padStart(2, '0');
/** Bar stacking order, top to bottom. */
const STACK = ['card', 'transfer', 'cash'] as const;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const toInputDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function rangeFor(p: Preset, c: { date: string; fromH: number; toH: number }) {
  const today = dayStart(new Date());
  const add = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  switch (p) {
    case 'today':
      return { from: today, to: add(today, 1), label: 'Hôm nay' };
    case 'yesterday':
      return { from: add(today, -1), to: today, label: 'Hôm qua' };
    case 'week':
      return { from: add(today, -6), to: add(today, 1), label: '7 ngày qua' };
    case 'month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: add(today, 1), label: `Tháng ${today.getMonth() + 1}` };
    case 'custom': {
      const [y, m, d] = c.date.split('-').map(Number);
      return { from: new Date(y, m - 1, d, c.fromH), to: new Date(y, m - 1, d, c.toH), label: `${pad(d)}/${pad(m)} từ ${pad(c.fromH)}:00 đến ${pad(c.toH)}:00` };
    }
  }
}

/** Revenue report on the POS: owner sees any period (with an hour filter); a cashier sees the current shift. */
export function ReportsScreen() {
  const role = usePos((s) => s.session?.user.role);
  const shift = usePos((s) => s.shift);
  const orders = usePos((s) => s.orders);
  const owner = role === 'owner';
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ date: toInputDate(new Date()), fromH: 6, toH: 14 });
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ title: string; method?: PaymentMethod; hour?: number } | null>(null);

  const r = useMemo(() => {
    if (!owner && shift) return { from: new Date(shift.openedAt), to: new Date(Date.now() + 60_000), label: `Ca hiện tại (từ ${dateTime(shift.openedAt)})` };
    return rangeFor(preset, custom);
  }, [owner, shift, preset, custom]);

  useEffect(() => {
    if (!owner && !shift) return setError('Chưa mở ca: thu ngân xem báo cáo của ca đang mở.');
    setError(null);
    remote(api.summary, { from: r.from.toISOString(), to: r.to.toISOString(), shiftId: owner ? undefined : shift!.id })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [r, owner, shift, orders]);

  const methods: PaymentMethod[] = ['cash', 'transfer'];
  const pay = (m: PaymentMethod) => data?.byPayment.find((p) => p.method === m) ?? { revenue: 0, orders: 0 };
  const maxHour = Math.max(1, ...(data?.byHour.map((h) => h.revenue) ?? [0]));
  const openHour = (hour: number) => setDrill({ title: `${pad(hour)}:00 – ${pad(hour + 1)}:00 · ${r.label}`, hour });
  // Usual opening hours 5h-23h, widened to include any hour that has sales (e.g. after midnight).
  const sold = (data?.byHour ?? []).filter((h) => h.revenue > 0 || h.orders > 0).map((h) => h.hour);
  const firstHour = Math.min(5, ...sold);
  const lastHour = Math.max(23, ...sold);
  const hours = (data?.byHour ?? []).filter((h) => h.hour >= firstHour && h.hour <= lastHour);

  return (
    <div className="report-screen">
      <div className="report-filters">
        {owner ? (
          <>
            {(['today', 'yesterday', 'week', 'month', 'custom'] as Preset[]).map((p) => (
              <button key={p} className={preset === p ? 'chip active' : 'chip'} onClick={() => setPreset(p)}>
                {{ today: 'Hôm nay', yesterday: 'Hôm qua', week: '7 ngày', month: 'Tháng này', custom: 'Theo giờ…' }[p]}
              </button>
            ))}
            {preset === 'custom' && (
              <span className="report-custom">
                <input type="date" value={custom.date} onChange={(e) => setCustom({ ...custom, date: e.target.value })} />
                <select value={custom.fromH} onChange={(e) => setCustom({ ...custom, fromH: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      từ {pad(h)}:00
                    </option>
                  ))}
                </select>
                <select value={custom.toH} onChange={(e) => setCustom({ ...custom, toH: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h}>
                      đến {pad(h % 24)}:00{h === 24 ? ' (hết ngày)' : ''}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </>
        ) : null}
        <span className="report-range">{r.label}</span>
      </div>

      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="report-kpis">
            <div className="kpi main">
              <span>Doanh thu thuần</span>
              <strong>{money(data.netRevenue)}</strong>
              <small>
                Gộp {money(data.grossSales)} · giảm giá {money(data.discounts)} · hoàn {money(data.refunds)}
              </small>
            </div>
            <div className="kpi">
              <span>Số đơn</span>
              <strong>{data.orderCount}</strong>
              <small>TB {money(data.avgOrderValue)}/đơn</small>
            </div>
            <div className="kpi">
              <span>Món bán ra</span>
              <strong>{data.itemsSold}</strong>
              <small>Huỷ {data.voidedCount} đơn</small>
            </div>
          </div>

          <div className="pay-tiles">
            {methods.map((m) => (
              <button key={m} className="pay-tile" onClick={() => setDrill({ title: `${PAYMENT_LABEL[m]} · ${r.label}`, method: m })}>
                <span className={`pay-dot pay-${m}`} aria-hidden="true" />
                <span className="pay-tile-label">{PAYMENT_LABEL[m]}</span>
                <strong>{money(pay(m).revenue)}</strong>
                <small>{pay(m).orders} đơn · bấm để xem chi tiết</small>
              </button>
            ))}
          </div>

          <section className="report-card">
            <h3>Doanh thu theo giờ</h3>
            <div className="hour-bars">
              {hours.map((h) => (
                // A div, not a <button>: old Android WebViews (Chrome < 83) ignore flex layout on buttons,
                // which collapses the bar to 0 height.
                <div
                  key={h.hour}
                  className={h.orders ? 'hour-bar' : 'hour-bar disabled'}
                  role="button"
                  tabIndex={h.orders ? 0 : -1}
                  aria-disabled={!h.orders}
                  title={`${pad(h.hour)}:00 – ${pad(h.hour + 1)}:00: ${money(h.revenue)} (${h.orders} đơn)`}
                  onClick={() => h.orders && openHour(h.hour)}
                  onKeyDown={(e) => h.orders && (e.key === 'Enter' || e.key === ' ') && openHour(h.hour)}
                >
                  <span className="hour-fill" style={{ height: `${(Math.max(0, h.revenue) / maxHour) * 100}%` }}>
                    {/* Stacked by payment method; block children so old WebViews (Chrome 69) render them too. */}
                    {STACK.map((m) => {
                      const v = Math.max(0, h.byMethod?.[m] ?? 0);
                      return v > 0 && h.revenue > 0 ? <span key={m} className={`hour-seg pay-${m}`} style={{ height: `${Math.min(100, (v / h.revenue) * 100)}%` }} /> : null;
                    })}
                  </span>
                  <small>{h.hour}h</small>
                </div>
              ))}
            </div>
            <p className="muted small hour-legend">
              <span><i className="pay-dot pay-cash" /> Tiền mặt</span>
              <span><i className="pay-dot pay-transfer" /> Chuyển khoản</span>
              <span>· Bấm vào cột giờ để xem các đơn trong giờ đó.</span>
            </p>
          </section>

          <div className="report-two">
            <section className="report-card">
              <h3>Món bán chạy</h3>
              <ol className="report-list">
                {data.topProducts.slice(0, 10).map((p, i) => (
                  <li key={p.productId ?? p.name}>
                    <span className="rank">{i + 1}</span>
                    <span className="grow">{p.name}</span>
                    <strong>{p.qty}</strong>
                    <span className="muted">{money(p.revenue)}</span>
                  </li>
                ))}
                {!data.topProducts.length && <li className="muted">Chưa có dữ liệu</li>}
              </ol>
            </section>
            <section className="report-card">
              <h3>Theo danh mục</h3>
              <ul className="report-list">
                {data.byCategory.map((c) => (
                  <li key={c.category}>
                    <span className="grow">{c.category}</span>
                    <strong>{c.qty}</strong>
                    <span className="muted">{money(c.revenue)}</span>
                  </li>
                ))}
              </ul>
              {owner && (
                <>
                  <h3>Theo nhân viên</h3>
                  <ul className="report-list">
                    {data.byCashier.map((c) => (
                      <li key={c.cashierId ?? c.name}>
                        <span className="grow">{c.name}</span>
                        <strong>{c.orders} đơn</strong>
                        <span className="muted">{money(c.revenue)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
      {drill && <DrillOrders title={drill.title} from={r.from} to={r.to} method={drill.method} hour={drill.hour} onClose={() => setDrill(null)} />}
    </div>
  );
}

/** Orders behind a tile or an hour bar. */
function DrillOrders({ title, from, to, method, hour, onClose }: { title: string; from: Date; to: Date; method?: PaymentMethod; hour?: number; onClose: () => void }) {
  const [list, setList] = useState<(Omit<LocalOrder, 'sync'> & { statusReason: string })[] | null>(null);
  useEffect(() => {
    remote(api.orders, { from: from.toISOString(), to: to.toISOString(), paymentMethod: method })
      .then((r) => setList(r.orders.filter((o) => hour === undefined || new Date(o.createdAt).getHours() === hour)))
      .catch((e) => notify(e instanceof Error ? e.message : String(e), 'error'));
  }, [from, to, method, hour]);
  const paid = (list ?? []).filter((o) => o.status !== 'voided');
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="report-drill-sum">
        {paid.length} đơn · <strong>{money(paid.reduce((s, o) => s + o.total, 0))}</strong>
      </p>
      <ul className="detail-lines report-drill">
        {list?.map((o) => (
          <li key={o.id} className="drill-row">
            <div className="drill-main">
              <div className="drill-head">
                <strong>{o.number}</strong>
                <span className="muted">
                  {' · '}{new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  {o.tableName ? ` · Bàn ${o.tableName}` : ''} · {o.cashier}
                </span>{' '}
                <span className={`pay-badge pay-${o.paymentMethod}`}>{PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}</span>
                {o.status !== 'completed' && <span className="error-text"> ({o.status === 'voided' ? 'đã huỷ' : 'đã hoàn tiền'})</span>}
              </div>
              <div className="drill-items">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div>
            </div>
            <strong className="drill-total">{money(o.total)}</strong>
          </li>
        ))}
        {list && !list.length && <li className="muted">Không có đơn</li>}
      </ul>
    </Modal>
  );
}
