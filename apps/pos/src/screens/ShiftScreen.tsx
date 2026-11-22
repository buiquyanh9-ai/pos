import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { notify } from '../lib/notify';
import { closeShift, logout, openShift, remote, usePos } from '../lib/store';
import { PAYMENT_LABEL, type PaymentMethod, type ShiftReport, type Summary } from '../lib/types';
import { Modal, Numpad } from '../components/Modal';

/** Open shift (opening cash), live shift figures, close shift with counted cash -> shift report. */
export function ShiftScreen({ onOpened }: { onOpened?: () => void }) {
  const shift = usePos((s) => s.shift);
  const user = usePos((s) => s.session?.user);
  const orders = usePos((s) => s.orders);
  const [cash, setCash] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<ShiftReport | null>(null);

  useEffect(() => {
    if (!shift) return setSummary(null);
    remote(api.summary, { from: shift.openedAt, to: new Date(Date.now() + 60_000).toISOString(), shiftId: shift.id })
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [shift, orders]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (report) return <ShiftReportView report={report} onDone={() => setReport(null)} />;

  if (!shift) {
    return (
      <div className="shift-screen">
        <div className="shift-card">
          <span className="eyebrow">CA LÀM VIỆC</span>
          <h1>Mở ca mới</h1>
          <p className="muted">
            {user?.name} · nhập số tiền mặt có trong két khi bắt đầu ca. Cần mở ca trước khi bán hàng.
          </p>
          <div className="amount">{money(cash)}</div>
          <div className="quick">
            {[0, 500_000, 1_000_000, 2_000_000].map((v) => (
              <button key={v} className={cash === v ? 'chip active' : 'chip'} onClick={() => setCash(v)}>
                {money(v)}
              </button>
            ))}
          </div>
          <Numpad value={cash} onChange={setCash} />
          <button
            className="btn primary big full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await openShift(cash);
                notify('Đã mở ca', 'success');
                onOpened?.();
              })
            }
          >
            Mở ca
          </button>
        </div>
      </div>
    );
  }

  const cashSales = summary?.byPayment.find((p) => p.method === 'cash')?.revenue ?? 0;
  const pendingHere = orders.filter((o) => o.shiftId === shift.id && o.sync === 'pending').length;

  return (
    <div className="shift-screen">
      <div className="shift-grid">
        <section className="shift-card">
          <span className="eyebrow">CA ĐANG MỞ</span>
          <h1>{shift.cashierName ?? user?.name}</h1>
          <p className="muted">Bắt đầu {dateTime(shift.openedAt)}</p>
          <div className="stats">
            <div className="stat">
              <span className="muted">Doanh thu thuần</span>
              <strong>{summary ? money(summary.netRevenue) : '…'}</strong>
            </div>
            <div className="stat">
              <span className="muted">Số đơn</span>
              <strong>{summary?.orderCount ?? '…'}</strong>
            </div>
            <div className="stat">
              <span className="muted">Tiền đầu ca</span>
              <strong>{money(shift.openingCash)}</strong>
            </div>
            <div className="stat">
              <span className="muted">Tiền mặt dự kiến</span>
              <strong>{money(shift.openingCash + cashSales)}</strong>
            </div>
          </div>
          {summary && (
            <ul className="detail-lines">
              {summary.byPayment.map((p) => (
                <li key={p.method}>
                  <span>{PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method} ({p.orders})</span>
                  <span>{money(p.revenue)}</span>
                </li>
              ))}
              {summary.refunds > 0 && (
                <li>
                  <span>Hoàn tiền ({summary.refundCount})</span>
                  <span>−{money(summary.refunds)}</span>
                </li>
              )}
            </ul>
          )}
          {pendingHere > 0 && <p className="error-text">{pendingHere} đơn của ca chưa gửi lên máy chủ. Cần có mạng để đóng ca.</p>}
          <div className="cart-actions">
            <button className="btn secondary" onClick={() => void logout()}>
              Đăng xuất (giữ ca)
            </button>
            <button className="btn primary big" onClick={() => setClosing(true)}>
              Đóng ca
            </button>
          </div>
        </section>
      </div>

      {closing && (
        <Modal title="Đóng ca: đếm tiền mặt trong két" onClose={() => setClosing(false)}>
          <p className="muted">Dự kiến: {money(shift.openingCash + cashSales)} (chưa trừ hoàn tiền mặt). Nhập số tiền thực tế đếm được.</p>
          <div className="amount">{money(cash)}</div>
          <Numpad value={cash} onChange={setCash} />
          <input className="opt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (nếu lệch tiền)…" maxLength={500} />
          <button
            className="btn primary big full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await closeShift(cash, note);
                setClosing(false);
                setCash(0);
                setNote('');
                setReport(r);
              })
            }
          >
            Xác nhận đóng ca
          </button>
        </Modal>
      )}
    </div>
  );
}

function ShiftReportView({ report, onDone }: { report: ShiftReport; onDone: () => void }) {
  const { shift: s, summary: r } = report;
  const diff = s.cashDifference ?? 0;
  return (
    <div className="shift-screen">
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
          <li>
            <span>Tiền đầu ca</span>
            <span>{money(s.openingCash)}</span>
          </li>
          <li>
            <span>Tiền mặt dự kiến</span>
            <strong>{money(s.expectedCash ?? 0)}</strong>
          </li>
          <li>
            <span>Tiền mặt thực đếm</span>
            <strong>{money(s.countedCash ?? 0)}</strong>
          </li>
          <li className={diff === 0 ? '' : 'error-text'}>
            <span>Chênh lệch</span>
            <strong>
              {diff > 0 ? '+' : ''}
              {money(diff)}
            </strong>
          </li>
        </ul>
        {report.stocktakes.length === 0 && <p className="muted">Ca này chưa có phiếu kiểm kê kho. Có thể kiểm kê trong mục Kho.</p>}
        <div className="cart-actions">
          <button className="btn secondary" onClick={() => void logout()}>
            Đăng xuất
          </button>
          <button className="btn primary big" onClick={onDone}>
            Mở ca mới
          </button>
        </div>
      </section>
    </div>
  );
}
