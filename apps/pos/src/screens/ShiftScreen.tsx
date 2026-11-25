import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CashMove } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { notify } from '../lib/notify';
import { closeShift, logout, openShift, remote, usePos } from '../lib/store';
import { PAYMENT_LABEL, type PaymentMethod, type Shift, type ShiftReport, type Summary } from '../lib/types';
import { Numpad } from '../components/Modal';
import { printShiftSummary } from '../lib/shiftSummary';

// Két tiền: open a shift, follow cash during the shift (sales, pay-ins/outs), count the drawer by
// denomination at closing, and look back at previous shifts.

const NOTES = [500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000];
const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const fail = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error');

export function ShiftScreen({ onOpened, onClosed, closeThenLogout }: { onOpened?: () => void; onClosed?: (r: ShiftReport) => void; closeThenLogout?: boolean }) {
  const shift = usePos((s) => s.shift);
  const user = usePos((s) => s.session?.user);
  const orders = usePos((s) => s.orders);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const loadHistory = useCallback(() => {
    remote(api.shifts, new Date(Date.now() - 7 * 86400_000).toISOString(), new Date(Date.now() + 60_000).toISOString())
      .then((r) => setHistory(r.shifts))
      .catch(() => undefined);
  }, []);
  useEffect(() => loadHistory(), [loadHistory, shift, orders]);

  return (
    <div className="shift-wide">
      {report ? (
        <ShiftReportView report={report} onDone={() => setReport(null)} />
      ) : shift ? (
        <>
          {closeThenLogout && <p className="logout-banner">Đếm tiền trong két rồi bấm “Đóng ca”: máy sẽ in phiếu tổng kết ca và đăng xuất.</p>}
          <OpenShift shift={shift} onClosed={(r) => (setReport(r), loadHistory(), onClosed?.(r))} />
        </>
      ) : (
        <OpenForm userName={user?.name ?? ''} onOpened={() => (loadHistory(), onOpened?.())} />
      )}
      <History shifts={history} />
    </div>
  );
}

function OpenForm({ userName, onOpened }: { userName: string; onOpened: () => void }) {
  const [cash, setCash] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <div className="shift-grid2">
      <section className="shift-card">
        <span className="eyebrow">KÉT TIỀN</span>
        <h1>Mở ca mới</h1>
        <p className="muted">{userName} · nhập số tiền mặt đang có trong két. Cần mở ca trước khi bán hàng.</p>
        <div className="amount">{money(cash)}</div>
        <div className="quick">
          {[0, 300_000, 500_000, 1_000_000, 2_000_000].map((v) => (
            <button key={v} className={cash === v ? 'chip active' : 'chip'} onClick={() => setCash(v)}>
              {money(v)}
            </button>
          ))}
        </div>
        <button
          className="btn primary big full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await openShift(cash);
              notify('Đã mở ca', 'success');
              onOpened();
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Mở ca với {money(cash)}
        </button>
      </section>
      <section className="shift-card">
        <h3>Nhập số tiền</h3>
        <Numpad value={cash} onChange={setCash} />
        <p className="muted small">Mẹo: đếm tiền đầu ca theo mệnh giá ở mục Đóng ca của ca trước để khớp số.</p>
      </section>
    </div>
  );
}

function OpenShift({ shift, onClosed }: { shift: Shift; onClosed: (r: ShiftReport) => void }) {
  const orders = usePos((s) => s.orders);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [moves, setMoves] = useState<CashMove[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    remote(api.summary, { from: shift.openedAt, to: new Date(Date.now() + 60_000).toISOString(), shiftId: shift.id })
      .then(setSummary)
      .catch(() => setSummary(null));
    remote(api.cashMoves, shift.id)
      .then((r) => setMoves(r.moves))
      .catch(() => undefined);
  }, [shift, orders, tick]);

  const cashSales = summary?.byPayment.find((p) => p.method === 'cash')?.revenue ?? 0;
  const movesNet = moves.reduce((s, m) => s + (m.type === 'in' ? m.amount : -m.amount), 0);
  const expected = shift.openingCash + cashSales + movesNet;
  const pending = orders.filter((o) => o.shiftId === shift.id && o.sync === 'pending').length;

  return (
    <div className="shift-grid2">
      <section className="shift-card">
        <span className="eyebrow">CA ĐANG MỞ</span>
        <h1>
          {shift.cashierName} <span className="muted small">· từ {dateTime(shift.openedAt)}</span>
        </h1>
        <div className="shift-kpis">
          <div>
            <span>Doanh thu thuần</span>
            <strong>{summary ? money(summary.netRevenue) : '…'}</strong>
          </div>
          <div>
            <span>Số đơn</span>
            <strong>{summary?.orderCount ?? '…'}</strong>
          </div>
          <div>
            <span>Tiền đầu ca</span>
            <strong>{money(shift.openingCash)}</strong>
          </div>
          <div className="hl">
            <span>Tiền mặt phải có trong két</span>
            <strong>{money(expected)}</strong>
          </div>
        </div>
        <ul className="detail-lines">
          {(['cash', 'transfer'] as PaymentMethod[]).map((m) => {
            const p = summary?.byPayment.find((x) => x.method === m);
            return (
              <li key={m}>
                <span>
                  <i className={`pay-dot pay-${m}`} /> {PAYMENT_LABEL[m]} ({p?.orders ?? 0} đơn)
                </span>
                <strong>{money(p?.revenue ?? 0)}</strong>
              </li>
            );
          })}
          <li>
            <span>Thu / chi tiền mặt trong ca</span>
            <strong className={movesNet < 0 ? 'neg' : ''}>
              {movesNet > 0 ? '+' : ''}
              {money(movesNet)}
            </strong>
          </li>
          {summary && summary.refunds > 0 && (
            <li>
              <span>Hoàn tiền ({summary.refundCount})</span>
              <strong>−{money(summary.refunds)}</strong>
            </li>
          )}
        </ul>
        <CashMoves shiftId={shift.id} moves={moves} onAdded={() => setTick((t) => t + 1)} />
        {pending > 0 && <p className="error-text">{pending} đơn của ca chưa gửi lên máy chủ. Cần có mạng để đóng ca.</p>}
      </section>
      <CloseShift shift={shift} expected={expected} onClosed={onClosed} />
    </div>
  );
}

function CashMoves({ shiftId, moves, onAdded }: { shiftId: string; moves: CashMove[]; onAdded: () => void }) {
  const [type, setType] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(amount.replace(/\D/g, '')) || 0;
  const presets = type === 'out' ? ['Trả tiền nhà cung cấp', 'Mua đá / rau', 'Chủ rút tiền', 'Chi lặt vặt'] : ['Bổ sung tiền lẻ', 'Thu nợ', 'Khác'];
  return (
    <div className="cash-moves">
      <h3>Thu / chi tiền mặt</h3>
      <div className="cash-form">
        <div className="segmented">
          <button className={type === 'out' ? 'seg active' : 'seg'} onClick={() => setType('out')}>
            Chi ra
          </button>
          <button className={type === 'in' ? 'seg active' : 'seg'} onClick={() => setType('in')}>
            Thu vào
          </button>
        </div>
        <input inputMode="numeric" value={amount ? new Intl.NumberFormat('vi-VN').format(n) : ''} onChange={(e) => setAmount(e.target.value)} placeholder="Số tiền" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do" list="cash-reasons" />
        <datalist id="cash-reasons">
          {presets.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          className="btn primary"
          disabled={!n || !reason.trim()}
          onClick={() =>
            remote(api.addCash, shiftId, { type, amount: n, reason: reason.trim() })
              .then(() => (notify(type === 'out' ? 'Đã ghi chi tiền' : 'Đã ghi thu tiền', 'success'), setAmount(''), setReason(''), onAdded()))
              .catch(fail)
          }
        >
          Ghi
        </button>
      </div>
      <ul className="detail-lines">
        {moves.map((m) => (
          <li key={m.id}>
            <span>
              {time(m.at)} · {m.reason} <span className="muted small">· {m.userName}</span>
            </span>
            <strong className={m.type === 'out' ? 'neg' : 'pos'}>
              {m.type === 'out' ? '−' : '+'}
              {money(m.amount)}
            </strong>
          </li>
        ))}
        {!moves.length && <li className="muted">Chưa có khoản thu / chi nào trong ca</li>}
      </ul>
    </div>
  );
}

function CloseShift({ shift, expected, onClosed }: { shift: Shift; expected: number; onClosed: (r: ShiftReport) => void }) {
  const openBills = usePos((s) => s.openOrders);
  const [confirmOpenBills, setConfirmOpenBills] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const total = useMemo(() => NOTES.reduce((s, v) => s + v * (counts[v] ?? 0), 0), [counts]);
  const diff = total - expected;
  const set = (v: number, n: number) => setCounts({ ...counts, [v]: Math.max(0, n) });
  return (
    <section className="shift-card">
      <span className="eyebrow">ĐÓNG CA</span>
      <h2>Đếm tiền trong két theo mệnh giá</h2>
      <table className="denoms">
        <tbody>
          {NOTES.map((v) => (
            <tr key={v}>
              <td className="denom">{money(v)}</td>
              <td>
                <div className="pos-stepper">
                  <button aria-label="Bớt" onClick={() => set(v, (counts[v] ?? 0) - 1)}>
                    −
                  </button>
                  <input
                    className="denom-input"
                    inputMode="numeric"
                    value={counts[v] ?? ''}
                    placeholder="0"
                    onChange={(e) => set(v, Number(e.target.value.replace(/\D/g, '')) || 0)}
                  />
                  <button aria-label="Thêm" onClick={() => set(v, (counts[v] ?? 0) + 1)}>
                    +
                  </button>
                </div>
              </td>
              <td className="num">{counts[v] ? money(v * counts[v]) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="close-sum">
        <div>
          <span>Đếm được</span>
          <strong>{money(total)}</strong>
        </div>
        <div>
          <span>Phải có</span>
          <strong>{money(expected)}</strong>
        </div>
        <div className={diff === 0 ? 'ok' : 'bad'}>
          <span>Chênh lệch</span>
          <strong>
            {diff > 0 ? '+' : ''}
            {money(diff)}
          </strong>
        </div>
      </div>
      <input className="opt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={diff ? 'Ghi chú lý do lệch tiền (nên ghi)' : 'Ghi chú (không bắt buộc)'} />
      {openBills.length > 0 && (
        <p className={confirmOpenBills ? 'error-text strong' : 'error-text'}>
          Còn {openBills.length} hoá đơn chưa thanh toán ({openBills.map((b) => b.tableName || 'mang đi').join(', ')}).
          {confirmOpenBills ? ' Bấm “Đóng ca” lần nữa nếu vẫn muốn đóng (hoá đơn được giữ cho ca sau).' : ' Nên thanh toán hoặc huỷ trước khi đóng ca.'}
        </p>
      )}
      <div className="cart-actions">
        <button className="btn secondary" onClick={async () => (await printShiftSummary(shift, false), await logout())}>
          Đăng xuất (giữ ca)
        </button>
        <button
          className="btn primary big"
          disabled={busy}
          onClick={async () => {
            if (openBills.length && !confirmOpenBills) {
              setConfirmOpenBills(true);
              return;
            }
            setBusy(true);
            try {
              onClosed(await closeShift(total, note));
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Đóng ca với {money(total)}
        </button>
      </div>
    </section>
  );
}

function History({ shifts }: { shifts: Shift[] }) {
  if (!shifts.length) return null;
  return (
    <section className="shift-card shift-history">
      <h3>Các ca 7 ngày gần đây</h3>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Thu ngân</th>
            <th>Mở ca</th>
            <th>Đóng ca</th>
            <th className="num">Đầu ca</th>
            <th className="num">Phải có</th>
            <th className="num">Đếm được</th>
            <th className="num">Chênh lệch</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.cashierName}</strong>
              </td>
              <td>{dateTime(s.openedAt)}</td>
              <td>{s.closedAt ? dateTime(s.closedAt) : <span className="pill pill-synced">Đang mở</span>}</td>
              <td className="num">{money(s.openingCash)}</td>
              <td className="num">{s.expectedCash === null ? '—' : money(s.expectedCash)}</td>
              <td className="num">{s.countedCash === null ? '—' : money(s.countedCash)}</td>
              <td className={`num ${s.cashDifference ? 'neg' : ''}`}>{s.cashDifference === null ? '—' : money(s.cashDifference)}</td>
              <td className="muted">{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ShiftReportView({ report, onDone }: { report: ShiftReport; onDone: () => void }) {
  const { shift: s, summary: r } = report;
  const diff = s.cashDifference ?? 0;
  return (
    <div className="shift-grid2">
      <section className="shift-card">
        <span className="eyebrow">BÁO CÁO CA</span>
        <h1>{s.cashierName}</h1>
        <p className="muted">
          {dateTime(s.openedAt)} → {s.closedAt ? dateTime(s.closedAt) : ''}
        </p>
        <ul className="detail-lines">
          <li>
            <span>Số đơn</span>
            <strong>{r.orderCount}</strong>
          </li>
          <li>
            <span>Doanh thu thuần</span>
            <strong>{money(r.netRevenue)}</strong>
          </li>
          {r.byPayment.map((p) => (
            <li key={p.method}>
              <span>· {PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method}</span>
              <span>{money(p.revenue)}</span>
            </li>
          ))}
          <li>
            <span>Giảm giá / Hoàn tiền / Huỷ</span>
            <span>
              {money(r.discounts)} / {money(r.refunds)} / {r.voidedCount} đơn
            </span>
          </li>
        </ul>
        <div className="cart-actions">
          <button className="btn secondary" onClick={async () => (await printShiftSummary(s, true), await logout())}>
            In tổng kết &amp; đăng xuất
          </button>
          <button className="btn primary big" onClick={onDone}>
            Mở ca mới
          </button>
        </div>
      </section>
      <section className="shift-card">
        <h2>Đối soát tiền mặt</h2>
        <div className="close-sum">
          <div>
            <span>Đầu ca</span>
            <strong>{money(s.openingCash)}</strong>
          </div>
          <div>
            <span>Phải có</span>
            <strong>{money(s.expectedCash ?? 0)}</strong>
          </div>
          <div>
            <span>Đếm được</span>
            <strong>{money(s.countedCash ?? 0)}</strong>
          </div>
          <div className={diff === 0 ? 'ok' : 'bad'}>
            <span>Chênh lệch</span>
            <strong>
              {diff > 0 ? '+' : ''}
              {money(diff)}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
}
