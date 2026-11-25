import { useState } from 'react';
import { ORDER_TYPE_LABEL, PAYMENT_LABEL, money, moneyShort, qty, type OrderType, type PaymentMethod } from '@shopflow/shared';
import { api, type ApiOrder } from '../lib/api';
import { OrderSheet } from './Activity';
import { timeLocal, dateTimeLocal } from '../lib/range';
import { PRESETS, customRange, isoDateLocal, presetRange, rangeDays, type Preset, type Range } from '../lib/range';
import { useRemote } from '../lib/store';
import { BarChart, RankBars, paymentSegments } from '../components/Charts';
import { Card, Header, Loading, Sheet, Stat } from '../components/UI';
import { ShiftSheet } from './More';

type Section = 'revenue' | 'hourly' | 'items' | 'payment' | 'staff' | 'discounts' | 'refunds' | 'voids' | 'cash';

const MENU: { group: string; items: { id: Section; label: string; icon: string }[] }[] = [
  {
    group: 'Báo cáo doanh thu',
    items: [
      { id: 'revenue', label: 'Doanh thu tổng quan', icon: '📊' },
      { id: 'hourly', label: 'Doanh thu theo giờ / theo ngày', icon: '🕒' },
      { id: 'payment', label: 'Doanh thu theo PTTT', icon: '💳' },
      { id: 'staff', label: 'Doanh thu theo nhân viên', icon: '👤' },
    ],
  },
  {
    group: 'Báo cáo mặt hàng',
    items: [{ id: 'items', label: 'Doanh thu theo danh mục & mặt hàng bán chạy', icon: '🍱' }],
  },
  { group: 'Báo cáo giảm giá', items: [{ id: 'discounts', label: 'Đơn có giảm giá', icon: '🏷️' }] },
  { group: 'Lịch sử két tiền', items: [{ id: 'cash', label: 'Ca làm việc & đối soát tiền mặt', icon: '💵' }] },
  {
    group: 'Hoạt động đặc biệt',
    items: [
      { id: 'refunds', label: 'Tiền đã hoàn', icon: '↩️' },
      { id: 'voids', label: 'Đơn hàng đã huỷ', icon: '🚫' },
    ],
  },
];
const TITLE = Object.fromEntries(MENU.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<Section, string>;

/** Report list (like the owner app of classic F&B POS systems); each entry opens its own page. */
export function Reports() {
  const [open, setOpen] = useState<Section | null>(null);
  // The time range is shared by every report page, so switching reports keeps the same period.
  const [preset, setPreset] = useState<Preset | 'custom'>('today');
  const [custom, setCustom] = useState<Range | null>(null);
  if (open) return <ReportView section={open} onBack={() => setOpen(null)} preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />;
  return (
    <div className="screen">
      <Header title="Báo cáo" />
      <div className="screen-body report-menu">
        {MENU.map((g) => (
          <section key={g.group}>
            <h3 className="day">{g.group}</h3>
            <ul className="list card flush">
              {g.items.map((i) => (
                <li key={i.id}>
                  <button className="order-row" onClick={() => setOpen(i.id)}>
                    <span className="menu-icon" aria-hidden="true">
                      {i.icon}
                    </span>
                    <span className="grow">{i.label}</span>
                    <span className="chev">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function ReportView({
  section,
  onBack,
  preset,
  setPreset,
  custom,
  setCustom,
}: {
  section: Section;
  onBack: () => void;
  preset: Preset | 'custom';
  setPreset: (p: Preset | 'custom') => void;
  custom: Range | null;
  setCustom: (r: Range) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [payDetail, setPayDetail] = useState<string | null>(null);
  const range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? 'today' : preset);
  const { data: s, error, loading } = useRemote((c) => api.summary(c, range.from, range.to), [range.from, range.to]);
  const days = rangeDays(range);

  return (
    <div className="screen">
      <Header title={TITLE[section]} onBack={onBack} />
      <div className="screen-body">
        <div className="chips scroll-x">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'chip on' : 'chip'} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
          <button className={preset === 'custom' ? 'chip on' : 'chip'} onClick={() => setPicking(true)}>
            Tuỳ chỉnh giờ…
          </button>
        </div>
        <p className="range-label">{range.label}</p>
        <Loading error={error} loading={loading && !s} />
        {s && section === 'hourly' && (
          <Card title={days <= 1.01 ? 'Doanh thu theo giờ' : 'Doanh thu theo ngày'}>
            {days <= 1.01 ? (
              <BarChart
                title="Doanh thu theo giờ"
                labelEvery={3}
                data={s.byHour.map((b) => ({ key: String(b.hour), label: `${b.hour}h`, value: b.revenue, detail: `${b.orders} đơn`, segments: paymentSegments(b.byMethod) }))}
              />
            ) : (
              <BarChart
                title="Doanh thu theo ngày"
                labelEvery={Math.max(1, Math.ceil(s.byDay.length / 7))}
                data={s.byDay.map((d) => ({ key: d.date, label: d.date.slice(8) + '/' + d.date.slice(5, 7), value: d.revenue, detail: `${d.orders} đơn` }))}
              />
            )}
            <ul className="kv">
              {(days <= 1.01 ? s.byHour.filter((b) => b.orders > 0).map((b) => [`${b.hour}:00 – ${b.hour + 1}:00`, b] as const) : s.byDay.map((d) => [d.date.split('-').reverse().join('/'), d] as const)).map(
                ([label, b]) => (
                  <li key={label}>
                    <span>
                      {label} <span className="muted small">· {b.orders} đơn</span>
                    </span>
                    <strong>{money(b.revenue)}</strong>
                  </li>
                ),
              )}
            </ul>
          </Card>
        )}
        {(section === 'discounts' || section === 'refunds' || section === 'voids') && <OrderListReport kind={section} from={range.from} to={range.to} />}
        {section === 'cash' && <CashReport from={range.from} to={range.to} />}
        {s && section === 'revenue' && (
          <>
            <div className="stats">
              <Stat label="Doanh thu thuần" value={moneyShort(s.netRevenue)} change={s.change.netRevenue} hint="so kỳ trước" />
              <Stat label="Số đơn" value={String(s.orderCount)} change={s.change.orderCount} />
              <Stat label="Món bán ra" value={String(s.itemsSold)} change={s.change.itemsSold} />
              <Stat label="TB / đơn" value={moneyShort(s.avgOrderValue)} />
            </div>
            <Card title={days <= 1.01 ? 'Doanh thu theo giờ' : 'Doanh thu theo ngày'}>
              {days <= 1.01 ? (
                <BarChart
                  title="Doanh thu theo giờ"
                  labelEvery={3}
                  data={s.byHour.map((b) => ({ key: String(b.hour), label: `${b.hour}h`, value: b.revenue, detail: `${b.orders} đơn`, segments: paymentSegments(b.byMethod) }))}
                />
              ) : (
                <BarChart
                  title="Doanh thu theo ngày"
                  labelEvery={Math.max(1, Math.ceil(s.byDay.length / 7))}
                  data={s.byDay.map((d) => ({ key: d.date, label: d.date.slice(8) + '/' + d.date.slice(5, 7), value: d.revenue, detail: `${d.orders} đơn` }))}
                />
              )}
            </Card>
            <Card title="Kết quả kinh doanh">
              <ul className="kv">
                <li>
                  <span>Doanh thu gộp (trước giảm giá)</span>
                  <strong>{money(s.grossSales)}</strong>
                </li>
                <li>
                  <span>Giảm giá</span>
                  <strong>−{money(s.discounts)}</strong>
                </li>
                <li>
                  <span>Hoàn tiền ({s.refundCount} đơn)</span>
                  <strong>−{money(s.refunds)}</strong>
                </li>
                <li className="total">
                  <span>Doanh thu thuần</span>
                  <strong>{money(s.netRevenue)}</strong>
                </li>
                <li className="muted">
                  <span>Đơn đã huỷ (không tính doanh thu)</span>
                  <span>
                    {s.voidedCount} · {money(s.voidedAmount)}
                  </span>
                </li>
              </ul>
              <p className="muted small">
                Kỳ trước ({isoDateLocal(s.previous.from)} → {isoDateLocal(new Date(new Date(s.previous.to).getTime() - 1).toISOString())}): {money(s.previous.netRevenue)} ·{' '}
                {s.previous.orderCount} đơn
              </p>
            </Card>
            <Card title="Theo loại đơn">
              <RankBars rows={s.byOrderType.map((x) => ({ key: x.orderType, name: ORDER_TYPE_LABEL[x.orderType as OrderType] ?? x.orderType, value: x.revenue, sub: `${x.orders} đơn` }))} />
            </Card>
          </>
        )}
        {s && section === 'items' && (
          <>
            <Card title="Doanh thu theo danh mục">
              <RankBars rows={s.byCategory.map((x) => ({ key: x.category, name: x.category, value: x.revenue, sub: `${qty(x.qty)} món` }))} />
            </Card>
            <Card title="Mặt hàng bán chạy">
              <ol className="top">
                {s.topProducts.map((p, i) => (
                  <li key={p.productId ?? p.name}>
                    <span className="rank-no">{i + 1}</span>
                    <span className="top-name">
                      {p.name}
                      <span className="muted small">{p.category}</span>
                    </span>
                    <span className="right">
                      <strong>{qty(p.qty)}</strong>
                      <span className="muted small">{moneyShort(p.revenue)}</span>
                    </span>
                  </li>
                ))}
                {!s.topProducts.length && <p className="empty">Chưa có dữ liệu</p>}
              </ol>
            </Card>
          </>
        )}
        {s && section === 'payment' && (
          <div className="pay-tiles">
            {[...new Set(['cash', 'transfer', ...s.byPayment.map((p) => p.method)])].map((m) => {
              const b = s.byPayment.find((p) => p.method === m);
              return (
                <button key={m} className="pay-tile" onClick={() => setPayDetail(m)}>
                  <span className={`pay-dot pay-${m}`} aria-hidden="true" />
                  <span className="pay-tile-label">{PAYMENT_LABEL[m as PaymentMethod] ?? m}</span>
                  <strong>{money(b?.revenue ?? 0)}</strong>
                  <small>{b?.orders ?? 0} đơn · bấm để xem chi tiết ›</small>
                </button>
              );
            })}
          </div>
        )}
        {s && section === 'payment' && (
          <Card title="Doanh thu theo phương thức thanh toán">
            <RankBars rows={s.byPayment.map((x) => ({ key: x.method, name: PAYMENT_LABEL[x.method as PaymentMethod] ?? x.method, value: x.revenue, sub: `${x.orders} đơn` }))} />
            <p className="muted small">Đã trừ hoàn tiền theo phương thức gốc của đơn.</p>
          </Card>
        )}
        {s && section === 'staff' && (
          <Card title="Doanh thu theo nhân viên">
            <RankBars rows={s.byCashier.map((x) => ({ key: x.cashierId ?? x.name, name: x.name, value: x.revenue, sub: `${x.orders} đơn` }))} />
          </Card>
        )}
      </div>
      {payDetail && <PaymentOrdersSheet method={payDetail} from={range.from} to={range.to} label={range.label} onClose={() => setPayDetail(null)} />}
      {picking && (
        <CustomRangeSheet
          onClose={() => setPicking(false)}
          onApply={(r) => {
            setCustom(r);
            setPreset('custom');
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** Orders with a discount / refunded / voided in the range; tap one for the details. */
function OrderListReport({ kind, from, to }: { kind: 'discounts' | 'refunds' | 'voids'; from: string; to: string }) {
  const status = kind === 'refunds' ? 'refunded' : kind === 'voids' ? 'voided' : undefined;
  const { data, error, loading } = useRemote((c) => api.orders(c, { from, to, status }), [from, to, status]);
  const [open, setOpen] = useState<ApiOrder | null>(null);
  const list = (data?.orders ?? []).filter((o) => kind !== 'discounts' || (o.discount > 0 && o.status !== 'voided'));
  const amount = (o: ApiOrder) => (kind === 'discounts' ? o.discount : kind === 'refunds' ? o.refundAmount : o.total);
  const total = list.reduce((s, o) => s + amount(o), 0);
  return (
    <>
      <div className="stats">
        <Stat label={kind === 'discounts' ? 'Tổng giảm giá' : kind === 'refunds' ? 'Tổng tiền đã hoàn' : 'Giá trị đơn đã huỷ'} value={money(total)} />
        <Stat label="Số đơn" value={String(list.length)} />
      </div>
      <Loading error={error} loading={loading && !data} />
      <ul className="list card flush">
        {list.map((o) => (
          <li key={o.id}>
            <button className="order-row" onClick={() => setOpen(o)}>
              <span className="grow">
                <strong>{money(amount(o))}</strong>
                <span className="muted small">
                  {o.number}
                  {o.tableName && ` · Bàn ${o.tableName}`} · {o.cashier} · {dateTimeLocal(o.createdAt)}
                  {kind !== 'discounts' && o.statusReason && ` · ${o.statusReason}`}
                  {kind === 'discounts' && ` · đơn ${money(o.subtotal)}`}
                </span>
              </span>
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      {data && !list.length && <p className="empty">Không có đơn nào trong khoảng này</p>}
      {open && <OrderSheet order={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Cash drawer history: every shift in the range with expected vs counted cash. */
function CashReport({ from, to }: { from: string; to: string }) {
  const { data, error, loading } = useRemote((c) => api.shifts(c, from, to), [from, to]);
  const [open, setOpen] = useState<string | null>(null);
  const shifts = data?.shifts ?? [];
  const diff = shifts.reduce((s, x) => s + (x.cashDifference ?? 0), 0);
  return (
    <>
      <div className="stats">
        <Stat label="Số ca" value={String(shifts.length)} />
        <Stat label="Tổng chênh lệch tiền mặt" value={money(diff)} />
      </div>
      <Loading error={error} loading={loading && !data} />
      <ul className="list card flush">
        {shifts.map((s) => (
          <li key={s.id}>
            <button className="order-row" onClick={() => setOpen(s.id)}>
              <span className="grow">
                <strong>{s.cashierName}</strong>
                <span className="muted small">
                  {dateTimeLocal(s.openedAt)} → {s.closedAt ? dateTimeLocal(s.closedAt) : 'đang mở'}
                </span>
                <span className="muted small">
                  Đầu ca {money(s.openingCash)}
                  {s.expectedCash !== null && ` · dự kiến ${money(s.expectedCash)}`}
                  {s.countedCash !== null && ` · đếm ${money(s.countedCash)}`}
                </span>
              </span>
              {s.status === 'open' ? (
                <span className="tag tag-ok">Đang mở</span>
              ) : (
                <span className={s.cashDifference ? 'tag tag-warn' : 'tag tag-ok'}>{s.cashDifference ? `Lệch ${money(s.cashDifference)}` : 'Khớp'}</span>
              )}
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      {data && !shifts.length && <p className="empty">Không có ca nào trong khoảng này</p>}
      {open && <ShiftSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Every order paid with one method in the selected range; tap an order for its details. */
function PaymentOrdersSheet({ method, from, to, label, onClose }: { method: string; from: string; to: string; label: string; onClose: () => void }) {
  const { data, error, loading } = useRemote((c) => api.orders(c, { from, to, paymentMethod: method }), [method, from, to]);
  const [open, setOpen] = useState<ApiOrder | null>(null);
  const paid = (data?.orders ?? []).filter((o) => o.status !== 'voided');
  const total = paid.reduce((s, o) => s + o.total - o.refundAmount, 0);
  if (open) return <OrderSheet order={open} onClose={() => setOpen(null)} />;
  return (
    <Sheet title={`${PAYMENT_LABEL[method as PaymentMethod] ?? method} · ${label}`} onClose={onClose}>
      <p className="sheet-total">
        {paid.length} đơn <strong>{money(total)}</strong>
      </p>
      <Loading error={error} loading={loading && !data} />
      <ul className="list">
        {data?.orders.map((o) => (
          <li key={o.id}>
            <button className="order-row" onClick={() => setOpen(o)}>
              <span className="grow">
                <strong className={o.status === 'voided' ? 'strike' : ''}>{money(o.total)}</strong>
                <span className="muted small">
                  {o.number}
                  {o.tableName && ` · Bàn ${o.tableName}`} · {o.cashier} · {dateTimeLocal(o.createdAt)}
                </span>
              </span>
              {o.status !== 'completed' && <span className={`tag tag-${o.status}`}>{o.status === 'refunded' ? 'Hoàn tiền' : 'Huỷ'}</span>}
              <span className="muted small">{timeLocal(o.createdAt)}</span>
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      {data && !data.orders.length && <p className="empty">Không có đơn nào</p>}
    </Sheet>
  );
}

function CustomRangeSheet({ onApply, onClose }: { onApply: (r: Range) => void; onClose: () => void }) {
  const today = isoDateLocal(new Date().toISOString());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [fromTime, setFromTime] = useState('08:00');
  const [toTime, setToTime] = useState('11:30');
  const r = fromDate && toDate ? customRange(fromDate, fromTime, toDate, toTime) : null;
  const invalid = !r || r.from >= r.to;
  const quick: [string, string, string][] = [
    ['Ca sáng', '06:00', '11:30'],
    ['Ca trưa', '11:30', '14:00'],
    ['Ca chiều', '14:00', '17:00'],
    ['Ca tối', '17:00', '22:00'],
  ];
  return (
    <Sheet title="Chọn khoảng thời gian" onClose={onClose}>
      <div className="chips">
        {quick.map(([label, a, b]) => (
          <button
            key={label}
            className="chip"
            onClick={() => {
              setFromTime(a);
              setToTime(b);
            }}
          >
            {label} {a}–{b}
          </button>
        ))}
      </div>
      <div className="grid2">
        <label>
          Từ ngày
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          Giờ bắt đầu
          <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label>
          Giờ kết thúc
          <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
        </label>
      </div>
      {invalid && <p className="error-box">Thời gian kết thúc phải sau thời gian bắt đầu</p>}
      <button className="btn primary" disabled={invalid} onClick={() => r && onApply(r)}>
        Xem báo cáo
      </button>
    </Sheet>
  );
}
