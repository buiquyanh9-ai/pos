import { useState } from 'react';
import { ORDER_TYPE_LABEL, PAYMENT_LABEL, money, moneyShort, qty, type OrderType, type PaymentMethod } from '@shopflow/shared';
import { api, type ApiOrder } from '../lib/api';
import { OrderSheet } from './Activity';
import { timeLocal, dateTimeLocal } from '../lib/range';
import { PRESETS, customRange, isoDateLocal, presetRange, rangeDays, type Preset, type Range } from '../lib/range';
import { useRemote } from '../lib/store';
import { BarChart, RankBars } from '../components/Charts';
import { Card, Header, Loading, Segmented, Sheet, Stat } from '../components/UI';

type Section = 'revenue' | 'items' | 'payment' | 'staff';

export function Reports() {
  const [preset, setPreset] = useState<Preset | 'custom'>('today');
  const [custom, setCustom] = useState<Range | null>(null);
  const [picking, setPicking] = useState(false);
  const [payDetail, setPayDetail] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('revenue');
  const range = preset === 'custom' && custom ? custom : presetRange(preset === 'custom' ? 'today' : preset);
  const { data: s, error, loading } = useRemote((c) => api.summary(c, range.from, range.to), [range.from, range.to]);
  const days = rangeDays(range);

  return (
    <div className="screen">
      <Header title="Báo cáo" />
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
        <Segmented<Section>
          value={section}
          onChange={setSection}
          options={[
            { id: 'revenue', label: 'Doanh thu' },
            { id: 'items', label: 'Mặt hàng' },
            { id: 'payment', label: 'Thanh toán' },
            { id: 'staff', label: 'Nhân viên' },
          ]}
        />
        <Loading error={error} loading={loading && !s} />
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
                  data={s.byHour.map((b) => ({ key: String(b.hour), label: `${b.hour}h`, value: b.revenue, detail: `${b.orders} đơn` }))}
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
                <li>
                  <span>Giá vốn hàng bán</span>
                  <strong>{s.costOfGoods === null ? '—' : `−${money(s.costOfGoods)}`}</strong>
                </li>
                <li className="total">
                  <span>Lợi nhuận gộp</span>
                  <strong>{s.grossProfit === null ? 'Thiếu dữ liệu giá vốn' : money(s.grossProfit)}</strong>
                </li>
                {s.grossProfit !== null && s.costCoverage < 1 && (
                  <li className="muted small">
                    <span>Lợi nhuận ước tính trên {Math.round(s.costCoverage * 100)}% doanh thu có giá vốn</span>
                    <span />
                  </li>
                )}
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
