import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { notify } from '../lib/notify';
import { remote, usePos } from '../lib/store';
import { MOVE_TYPE_LABEL, PURCHASE_STATUS_LABEL, type InventoryItem, type KitchenSession, type Purchase, type StockMove, type Supplier } from '../lib/types';
import { stockText } from '@shopflow/shared';
import { Modal } from '../components/Modal';

type Section = 'list' | 'low' | 'kitchen' | 'count' | 'purchase' | 'history';
const qty = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const err = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error');

/** Inventory for POS staff: stock list, low stock, end-of-shift count, purchasing/receiving, history. */
export function StockScreen() {
  const role = usePos((s) => s.session?.user.role);
  const [section, setSection] = useState<Section>('list');
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const reload = useCallback(() => remote(api.inventory).then((r) => setItems(r.items)).catch(err), []);
  useEffect(() => void reload(), [reload]);
  // Cashiers do all stock work at the counter (adjust, receive goods, purchase requests).
  const canManage = role === 'owner' || role === 'cashier';
  const lowCount = items?.filter((i) => i.low).length ?? 0;

  const menu: { id: Section; label: string; show: boolean }[] = [
    { id: 'list', label: 'Danh sách hàng tồn', show: true },
    { id: 'low', label: `Hàng sắp hết${lowCount ? ` (${lowCount})` : ''}`, show: true },
    { id: 'kitchen', label: 'Bếp: đầu ca / cuối ca', show: true },
    { id: 'count', label: 'Kiểm kê cuối ca', show: true },
    { id: 'purchase', label: 'Nhập kho / đề xuất nhập', show: canManage },
    { id: 'history', label: 'Lịch sử nhập / xuất', show: true },
  ];

  return (
    <div className="stock-layout">
      <nav className="stock-menu">
        <span className="eyebrow">HÀNG TỒN</span>
        {menu
          .filter((m) => m.show)
          .map((m) => (
            <button key={m.id} className={section === m.id ? 'stock-menu-item active' : 'stock-menu-item'} onClick={() => setSection(m.id)}>
              {m.label}
            </button>
          ))}
      </nav>
      <section className="stock-body">
        {!items && <p className="empty">Đang tải…</p>}
        {items && (section === 'list' || section === 'low') && (
          <StockTable items={section === 'low' ? items.filter((i) => i.low) : items} canAdjust={canManage} onChanged={reload} />
        )}
        {items && section === 'kitchen' && <Kitchen onChanged={reload} />}
        {items && section === 'count' && <Stocktake items={items} onDone={() => (reload(), setSection('history'))} />}
        {items && section === 'purchase' && canManage && <Purchasing items={items} onChanged={reload} />}
        {section === 'history' && <History />}
      </section>
    </div>
  );
}

function StockTable({ items, canAdjust, onChanged }: { items: InventoryItem[]; canAdjust: boolean; onChanged: () => void }) {
  const [tracking, setTracking] = useState<'exact' | 'estimate'>('exact');
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [wasting, setWasting] = useState<InventoryItem | null>(null);
  const rows = items.filter((i) => (i.tracking ?? 'exact') === tracking);
  // Today's movements per item (sold, received, wasted / issued to the kitchen).
  const [usage, setUsage] = useState<Record<string, Partial<Record<string, number>>>>({});
  useEffect(() => {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    remote(api.usage, from, new Date(Date.now() + 60_000).toISOString())
      .then((r) => setUsage(r.usage))
      .catch(() => undefined);
  }, [items]);
  const u = (id: string, t: string) => usage[id]?.[t] ?? 0;
  return (
    <>
      <div className="segmented">
        <button className={tracking === 'exact' ? 'seg active' : 'seg'} onClick={() => setTracking('exact')}>
          Kho đếm chính xác
        </button>
        <button className={tracking === 'estimate' ? 'seg active' : 'seg'} onClick={() => setTracking('estimate')}>
          Kho ước lượng
        </button>
      </div>
      <p className="muted small">
        {tracking === 'exact'
          ? 'Thịt, cá và đồ uống: tự trừ theo số phần bán ra, hoàn lại khi huỷ đơn.'
          : 'Gạo, rau, trà: quản lý theo lượng xuất bếp đầu ca / còn lại cuối ca (mục Bếp). Hộp mang về tự trừ 1 hộp mỗi suất mang về.'}
      </p>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Tên hàng tồn</th>
            <th>Đơn vị</th>
            <th className="num">Tối thiểu</th>
            <th className="num">Số lượng</th>
            <th>Mức tồn</th>
            <th className="num">Bán hôm nay</th>
            <th className="num">Nhập hôm nay</th>
            <th className="num">{tracking === 'estimate' ? 'Xuất bếp / hao hụt' : 'Hao hụt'}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className={i.low ? 'low' : ''}>
              <td>{i.name}</td>
              <td className="muted">{i.unit}</td>
              <td className="num muted">{qty(i.minQty)}</td>
              <td className={`num ${i.qty < 0 ? 'neg' : ''}`}>
                <strong>{i.tracking === 'estimate' ? stockText(i) : qty(i.qty)}</strong>
                {i.low && <span className="pill pill-rejected">Sắp hết</span>}
              </td>
              <td>
                <span className="level" title={`${qty(i.qty)} / tối thiểu ${qty(i.minQty)}`}>
                  <span className={`level-fill ${i.low ? 'low' : ''}`} style={{ width: `${Math.min(100, (Math.max(0, i.qty) / Math.max(1e-9, i.minQty * 3)) * 100)}%` }} />
                </span>
              </td>
              <td className="num">{u(i.id, 'sale') ? qty(-u(i.id, 'sale')) : '—'}</td>
              <td className="num pos">{u(i.id, 'import') ? `+${qty(u(i.id, 'import'))}` : '—'}</td>
              <td className="num neg">{u(i.id, 'waste') + u(i.id, 'issue') ? qty(-(u(i.id, 'waste') + u(i.id, 'issue'))) : '—'}</td>
              <td className="num row-actions">
                <button className="chip" onClick={() => setWasting(i)}>
                  Ghi hao hụt
                </button>
                {canAdjust && (
                  <button className="chip" onClick={() => setAdjusting(i)}>
                    Điều chỉnh
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">Không có mặt hàng</p>}
      <div className="stock-foot">
        <span>
          {rows.length} mặt hàng · {rows.filter((i) => i.low).length} sắp hết
        </span>
      </div>
      {adjusting && <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} onDone={() => (setAdjusting(null), onChanged())} />}
      {wasting && <WasteDialog item={wasting} onClose={() => setWasting(null)} onDone={() => (setWasting(null), onChanged())} />}
    </>
  );
}

function WasteDialog({ item, onClose, onDone }: { item: InventoryItem; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState('1');
  const [reason, setReason] = useState('');
  const n = Number(value.replace(',', '.'));
  const valid = n > 0 && reason.trim().length > 0;
  const presets = /hộp/i.test(item.name) ? ['Hộp hỏng', 'Hộp thủng', 'Rơi vỡ'] : ['Hư hỏng', 'Hết hạn', 'Đổ vỡ', 'Rơi vãi'];
  return (
    <Modal title={`Ghi hao hụt: ${item.name}`} onClose={onClose}>
      <p className="muted">Hiện có: {stockText(item)}</p>
      <label className="field">
        Số lượng hao hụt ({item.unit})
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="opt-row">
        {presets.map((r) => (
          <button key={r} className={reason === r ? 'opt on' : 'opt'} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="opt-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc)" />
      <button
        className="btn primary big full"
        disabled={!valid}
        onClick={() =>
          remote(api.wasteStock, item.id, n, reason.trim())
            .then(() => (notify('Đã ghi hao hụt', 'success'), onDone()))
            .catch(err)
        }
      >
        Ghi hao hụt {valid ? `−${qty(n)} ${item.unit}` : ''}
      </button>
    </Modal>
  );
}

/** Rice / vegetables / tea: issue to the kitchen at the start, report leftovers and waste at the end. */
function Kitchen({ onChanged }: { onChanged: () => void }) {
  const shiftId = usePos((s) => s.shift?.id);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.kitchenCurrent>> | null>(null);
  const [history, setHistory] = useState<KitchenSession[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<Record<string, { remaining: string; waste: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [cur, hist] = await Promise.all([remote(api.kitchenCurrent), remote(api.kitchenSessions)]);
      setData(cur);
      setHistory(hist.sessions.filter((s) => s.status === 'closed').slice(0, 10));
      // Pre-fill the usual amounts (rice 15 kg, vegetables 4 kg, tea 100 g); editable.
      setAmounts(Object.fromEntries(cur.items.filter((i) => i.defaultIssue !== null).map((i) => [i.itemId, String(i.defaultIssue)])));
      setClosing({});
    } catch (e) {
      err(e);
    }
  }, []);
  useEffect(() => void load(), [load]);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(msg, 'success');
      await load();
      onChanged();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const num = (s: string | undefined) => Number((s ?? '').replace(',', '.'));
  if (!data) return <p className="empty">Đang tải…</p>;
  const issuable = data.items.filter((i) => i.defaultIssue !== null);
  const s = data.session;

  return (
    <>
      {!s ? (
        <section className="kitchen-card">
          <h3>Xuất bếp đầu ca</h3>
          <p className="muted small">Khai báo lượng đem nấu / chuẩn bị hôm nay. Số mặc định có thể sửa. Bán cơm không tự trừ gạo.</p>
          <table className="stock-table">
            <thead>
              <tr>
                <th>Nguyên liệu</th>
                <th className="num">Tồn kho</th>
                <th className="num">Xuất bếp</th>
              </tr>
            </thead>
            <tbody>
              {issuable.map((i) => (
                <tr key={i.itemId}>
                  <td>{i.name}</td>
                  <td className="num muted">{stockText({ qty: i.stock, unit: i.unit, tracking: 'estimate' })}</td>
                  <td className="num">
                    <input className="count-input" inputMode="decimal" value={amounts[i.itemId] ?? ''} onChange={(e) => setAmounts({ ...amounts, [i.itemId]: e.target.value })} />{' '}
                    {i.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn primary big"
            disabled={busy || !issuable.some((i) => num(amounts[i.itemId]) > 0)}
            onClick={() =>
              run(
                () =>
                  remote(api.kitchenOpen, {
                    shiftId,
                    lines: issuable.map((i) => ({ itemId: i.itemId, qty: Math.max(0, num(amounts[i.itemId]) || 0) })),
                  }),
                'Đã ghi xuất bếp đầu ca',
              )
            }
          >
            Xác nhận xuất bếp
          </button>
        </section>
      ) : (
        <section className="kitchen-card">
          <h3>
            Bếp đang mở <span className="muted small">từ {dateTime(s.openedAt)} · {s.openedBy}</span>
          </h3>
          <table className="stock-table">
            <thead>
              <tr>
                <th>Nguyên liệu</th>
                <th className="num">Đã xuất</th>
                <th className="num">Bổ sung thêm</th>
                <th className="num">Còn lại cuối ca</th>
                <th className="num">Hao hụt</th>
                <th>Lý do hao hụt</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => {
                const c = closing[l.itemId] ?? { remaining: '', waste: '', reason: '' };
                const setC = (patch: Partial<typeof c>) => setClosing({ ...closing, [l.itemId]: { ...c, ...patch } });
                return (
                  <tr key={l.itemId}>
                    <td>
                      {l.name} <span className="muted small">{l.unit}</span>
                    </td>
                    <td className="num">
                      {qty(l.issued)}
                      {l.added > 0 && <span className="muted small"> +{qty(l.added)}</span>}
                    </td>
                    <td className="num">
                      <input className="count-input" inputMode="decimal" value={amounts[`add:${l.itemId}`] ?? ''} onChange={(e) => setAmounts({ ...amounts, [`add:${l.itemId}`]: e.target.value })} placeholder="0" />
                    </td>
                    <td className="num">
                      <input className="count-input" inputMode="decimal" value={c.remaining} onChange={(e) => setC({ remaining: e.target.value })} placeholder="?" />
                    </td>
                    <td className="num">
                      <input className="count-input" inputMode="decimal" value={c.waste} onChange={(e) => setC({ waste: e.target.value })} placeholder="0" />
                    </td>
                    <td>
                      {num(c.waste) > 0 && (
                        <input className={c.reason.trim() ? 'count-reason' : 'count-reason need'} value={c.reason} onChange={(e) => setC({ reason: e.target.value })} placeholder="vd: cơm khê, rau dập" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="cart-actions">
            <button
              className="btn secondary"
              disabled={busy || !s.lines.some((l) => num(amounts[`add:${l.itemId}`]) > 0)}
              onClick={() =>
                run(
                  () => remote(api.kitchenAdd, s.id, s.lines.filter((l) => num(amounts[`add:${l.itemId}`]) > 0).map((l) => ({ itemId: l.itemId, qty: num(amounts[`add:${l.itemId}`]) }))),
                  'Đã ghi xuất bổ sung',
                )
              }
            >
              Ghi bổ sung
            </button>
            <button
              className="btn primary big"
              disabled={
                busy ||
                s.lines.some((l) => (closing[l.itemId]?.remaining ?? '') === '' || (num(closing[l.itemId]?.waste) > 0 && !closing[l.itemId]?.reason.trim()))
              }
              onClick={() =>
                run(
                  () =>
                    remote(
                      api.kitchenClose,
                      s.id,
                      s.lines.map((l) => ({
                        itemId: l.itemId,
                        remaining: num(closing[l.itemId].remaining) || 0,
                        waste: num(closing[l.itemId].waste) || 0,
                        reason: closing[l.itemId].reason.trim() || undefined,
                      })),
                    ),
                  'Đã chốt bếp cuối ca, đã gửi tổng kết cho chủ cửa hàng',
                )
              }
            >
              Chốt cuối ca
            </button>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="kitchen-card">
          <h3>Các ca trước</h3>
          <table className="stock-table">
            <thead>
              <tr>
                <th>Ca</th>
                <th>Nguyên liệu</th>
                <th className="num">Xuất</th>
                <th className="num">Còn lại</th>
                <th className="num">Hao hụt</th>
                <th className="num">Đã dùng</th>
              </tr>
            </thead>
            <tbody>
              {history.flatMap((h) =>
                h.lines.map((l, k) => (
                  <tr key={`${h.id}-${l.itemId}`}>
                    <td className="muted small">{k === 0 ? `${dateTime(h.openedAt)} · ${h.openedBy ?? ''}` : ''}</td>
                    <td>{l.name}</td>
                    <td className="num">
                      {qty(l.issued + l.added)} {l.unit}
                    </td>
                    <td className="num">{l.remaining === null ? '—' : qty(l.remaining)}</td>
                    <td className={`num ${l.waste ? 'neg' : ''}`} title={l.reason}>
                      {l.waste ? qty(l.waste) : '—'}
                    </td>
                    <td className="num">
                      <strong>{l.used === null ? '—' : `${qty(l.used)} ${l.unit}`}</strong>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function AdjustDialog({ item, onClose, onDone }: { item: InventoryItem; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(String(item.qty));
  const [reason, setReason] = useState('');
  const n = Number(value.replace(',', '.'));
  const valid = Number.isFinite(n) && n >= 0 && reason.trim().length > 0 && n !== item.qty;
  return (
    <Modal title={`Điều chỉnh: ${item.name}`} onClose={onClose}>
      <p className="muted">
        Tồn trên hệ thống: {qty(item.qty)} {item.unit}
      </p>
      <label className="field">
        Số lượng mới ({item.unit})
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="opt-row">
        {['Hư hỏng', 'Hết hạn', 'Đổ vỡ', 'Dùng nội bộ', 'Sai số liệu'].map((r) => (
          <button key={r} className={reason === r ? 'opt on' : 'opt'} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="opt-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do điều chỉnh (bắt buộc)" />
      <button
        className="btn primary big full"
        disabled={!valid}
        onClick={() =>
          remote(api.adjustStock, item.id, { qty: n, reason: reason.trim() })
            .then(() => (notify('Đã điều chỉnh tồn kho', 'success'), onDone()))
            .catch(err)
        }
      >
        Lưu điều chỉnh {valid ? `(${n - item.qty > 0 ? '+' : ''}${qty(n - item.qty)})` : ''}
      </button>
    </Modal>
  );
}

function Stocktake({ items, onDone }: { items: InventoryItem[]; onDone: () => void }) {
  const shiftId = usePos((s) => s.shift?.id);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lines = items.map((i) => {
    const raw = counted[i.id];
    const n = raw === undefined || raw === '' ? null : Number(raw.replace(',', '.'));
    const diff = n === null || !Number.isFinite(n) ? 0 : Math.round((n - i.qty) * 1000) / 1000;
    return { item: i, n, diff, reason: reasons[i.id] ?? '' };
  });
  const entered = lines.filter((l) => l.n !== null && Number.isFinite(l.n));
  const missingReason = entered.filter((l) => l.diff !== 0 && !l.reason.trim());
  const submit = async () => {
    setBusy(true);
    try {
      const r = await remote(api.createStocktake, {
        shiftId,
        lines: entered.map((l) => ({ itemId: l.item.id, counted: l.n!, reason: l.reason.trim() || undefined })),
      });
      notify(r.varianceCount ? `Đã lưu kiểm kê: ${r.varianceCount} mặt hàng lệch, đã báo chủ cửa hàng` : 'Đã lưu kiểm kê: khớp số liệu', 'success');
      onDone();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="muted">
        Nhập số lượng thực tế đếm được. Ô để trống = không kiểm mặt hàng đó. Mặt hàng lệch so với sổ phải ghi lý do.
        {shiftId ? ' Phiếu sẽ gắn với ca hiện tại.' : ''}
      </p>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Mặt hàng</th>
            <th className="num">Sổ sách</th>
            <th className="num">Thực tế</th>
            <th className="num">Lệch</th>
            <th>Lý do</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ item: i, diff, reason }) => (
            <tr key={i.id}>
              <td>
                {i.name} <span className="muted small">{i.unit}</span>
              </td>
              <td className="num muted">{qty(i.qty)}</td>
              <td className="num">
                <input className="count-input" inputMode="decimal" value={counted[i.id] ?? ''} onChange={(e) => setCounted({ ...counted, [i.id]: e.target.value })} placeholder="—" />
              </td>
              <td className={`num ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : 'muted'}`}>{diff ? `${diff > 0 ? '+' : ''}${qty(diff)}` : ''}</td>
              <td>
                {diff !== 0 && (
                  <input className={reason.trim() ? 'count-reason' : 'count-reason need'} value={reason} onChange={(e) => setReasons({ ...reasons, [i.id]: e.target.value })} placeholder="Lý do lệch" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cart-actions">
        <button className="btn primary big" disabled={busy || !entered.length || missingReason.length > 0} onClick={submit}>
          {missingReason.length ? `Thiếu lý do cho ${missingReason.length} mặt hàng` : `Lưu phiếu kiểm kê (${entered.length} mặt hàng)`}
        </button>
      </div>
    </>
  );
}

function Purchasing({ items, onChanged }: { items: InventoryItem[]; onChanged: () => void }) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const reload = useCallback(() => remote(api.purchases).then((r) => setPurchases(r.purchases)).catch(err), []);
  useEffect(() => {
    void reload();
    remote(api.suppliers).then((r) => setSuppliers(r.suppliers)).catch(() => undefined);
  }, [reload]);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setImporting(true)}>
          ＋ Nhập kho ngay (hàng đã về)
        </button>
        <button className="btn secondary" onClick={() => setCreating(true)}>
          Đề xuất nhập hàng (chờ chủ duyệt)
        </button>
      </div>
      <ul className="order-list">
        {purchases?.map((p) => (
          <li key={p.id} className="purchase-row">
            <div>
              <strong>{p.supplierName ?? 'Chưa chọn nhà cung cấp'}</strong>
              <span className="muted small">
                {' '}
                · {p.lines.length} mặt hàng · {p.createdBy} · {dateTime(p.createdAt)}
              </span>
              <div className="muted small">{p.lines.map((l) => `${l.name} ${qty(l.receivedQty ?? l.qty)}${l.unit}`).join(', ')}</div>
              {p.decisionNote && <div className="small">Ghi chú duyệt: {p.decisionNote}</div>}
            </div>
            <div className="purchase-side">
              <span className={`pill pill-${p.status === 'received' ? 'synced' : p.status === 'rejected' ? 'rejected' : 'pending'}`}>{PURCHASE_STATUS_LABEL[p.status]}</span>
              {p.status === 'approved' && (
                <button className="btn primary" onClick={() => setReceiving(p)}>
                  Nhận hàng
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {purchases && !purchases.length && <p className="empty">Chưa có phiếu nhập hàng</p>}
      {creating && (
        <CreatePurchase
          items={items}
          suppliers={suppliers}
          onClose={() => setCreating(false)}
          onDone={() => (setCreating(false), reload())}
        />
      )}
      {importing && <DirectImport items={items} suppliers={suppliers} onClose={() => setImporting(false)} onDone={() => (setImporting(false), onChanged())} />}
      {receiving && <ReceiveDialog p={receiving} onClose={() => setReceiving(null)} onDone={() => (setReceiving(null), reload(), onChanged())} />}
    </>
  );
}

function CreatePurchase({ items, suppliers, onClose, onDone }: { items: InventoryItem[]; suppliers: Supplier[]; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    // Pre-fill with the "below minimum" suggestions.
    remote(api.purchaseSuggestions)
      .then((r) => {
        setLines(Object.fromEntries(r.lines.map((l) => [l.itemId, String(l.qty)])));
        const s = r.lines.find((l) => l.supplierId)?.supplierId;
        if (s) setSupplierId(s);
      })
      .catch(() => undefined);
  }, []);
  const chosen = useMemo(
    () => items.filter((i) => Number((lines[i.id] ?? '').replace(',', '.')) > 0).map((i) => ({ item: i, qty: Number(lines[i.id].replace(',', '.')) })),
    [items, lines],
  );
  return (
    <Modal title="Đề xuất nhập hàng" onClose={onClose} wide>
      <div className="purchase-form">
        <label className="field">
          Nhà cung cấp
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chưa chọn —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <table className="stock-table">
          <thead>
            <tr>
              <th>Mặt hàng</th>
              <th className="num">Tồn / tối thiểu</th>
              <th className="num">SL nhập</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className={i.low ? 'low' : ''}>
                <td>
                  {i.name} <span className="muted small">{i.unit}</span>
                </td>
                <td className="num muted">
                  {qty(i.qty)} / {qty(i.minQty)}
                </td>
                <td className="num">
                  <input className="count-input" inputMode="decimal" value={lines[i.id] ?? ''} onChange={(e) => setLines({ ...lines, [i.id]: e.target.value })} placeholder="0" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <input className="opt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho chủ cửa hàng…" />
        <button
          className="btn primary big full"
          disabled={!chosen.length}
          onClick={() =>
            remote(api.createPurchase, {
              supplierId: supplierId || undefined,
              note,
              lines: chosen.map((l) => ({ itemId: l.item.id, qty: l.qty })),
            })
              .then((p) => (notify(p.status === 'pending' ? 'Đã gửi đề xuất, chờ chủ cửa hàng duyệt' : 'Đã tạo phiếu nhập (đã duyệt)', 'success'), onDone()))
              .catch(err)
          }
        >
          Gửi đề xuất · {chosen.length} mặt hàng
        </button>
      </div>
    </Modal>
  );
}

/** Goods arrived without a request (market run, regular supplier): add them to stock right away. */
function DirectImport({ items, suppliers, onClose, onDone }: { items: InventoryItem[]; suppliers: Supplier[]; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = (s: string | undefined) => Number((s ?? '').replace(/\./g, '').replace(',', '.')) || 0;
  const chosen = items.filter((i) => n(lines[i.id]) > 0);
  return (
    <Modal title="Nhập kho (hàng đã về)" onClose={onClose} wide>
      <div className="purchase-form">
        <div className="admin-grid">
          <label className="field">
            Nhà cung cấp
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— Không chọn / mua lẻ —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Ghi chú (số hoá đơn, người giao…)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <table className="stock-table">
          <thead>
            <tr>
              <th>Mặt hàng</th>
              <th className="num">Đang có</th>
              <th className="num">Số lượng nhập</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className={i.low ? 'low' : ''}>
                <td>
                  {i.name} <span className="muted small">{i.unit}</span>
                </td>
                <td className="num muted">{i.tracking === 'estimate' ? stockText(i) : qty(i.qty)}</td>
                <td className="num">
                  <input className="count-input" inputMode="decimal" value={lines[i.id] ?? ''} onChange={(e) => setLines({ ...lines, [i.id]: e.target.value })} placeholder="0" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn primary big full"
          disabled={!chosen.length || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await remote(api.importStock, {
                supplierId: supplierId || undefined,
                note,
                lines: chosen.map((i) => ({ itemId: i.id, qty: n(lines[i.id]) })),
              });
              notify(`Đã nhập kho ${chosen.length} mặt hàng`, 'success');
              onDone();
            } catch (e) {
              err(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Xác nhận nhập kho · {chosen.length} mặt hàng
        </button>
      </div>
    </Modal>
  );
}

function ReceiveDialog({ p, onClose, onDone }: { p: Purchase; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState<Record<string, string>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, String(l.qty)])));
  return (
    <Modal title="Nhận hàng vào kho" onClose={onClose} wide>
      <p className="muted">Nhập số lượng thực nhận (có thể khác số đề xuất).</p>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Mặt hàng</th>
            <th className="num">Đề xuất</th>
            <th className="num">Thực nhận</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.name}</td>
              <td className="num muted">
                {qty(l.qty)} {l.unit}
              </td>
              <td className="num">
                <input className="count-input" inputMode="decimal" value={received[l.itemId] ?? ''} onChange={(e) => setReceived({ ...received, [l.itemId]: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn primary big full"
        onClick={() =>
          remote(
            api.receivePurchase,
            p.id,
            p.lines.map((l) => ({ itemId: l.itemId, receivedQty: Math.max(0, Number((received[l.itemId] ?? '0').replace(',', '.')) || 0) })),
          )
            .then(() => (notify('Đã nhập kho', 'success'), onDone()))
            .catch(err)
        }
      >
        Xác nhận nhập kho
      </button>
    </Modal>
  );
}

function History() {
  const [type, setType] = useState('');
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  useEffect(() => {
    remote(api.stockMoves, { type: type || undefined, limit: 200 })
      .then((r) => setMoves(r.moves))
      .catch(err);
  }, [type]);
  return (
    <>
      <div className="chips">
        {['', 'sale', 'import', 'count', 'adjust', 'void', 'refund'].map((t) => (
          <button key={t} className={type === t ? 'chip active' : 'chip'} onClick={() => setType(t)}>
            {t ? MOVE_TYPE_LABEL[t as keyof typeof MOVE_TYPE_LABEL] : 'Tất cả'}
          </button>
        ))}
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Mặt hàng</th>
            <th>Loại</th>
            <th className="num">Thay đổi</th>
            <th className="num">Còn lại</th>
            <th>Người / lý do</th>
          </tr>
        </thead>
        <tbody>
          {moves?.map((m) => (
            <tr key={m.id}>
              <td className="muted small">{dateTime(m.at)}</td>
              <td>{m.itemName}</td>
              <td>{MOVE_TYPE_LABEL[m.type]}</td>
              <td className={`num ${m.qtyDelta < 0 ? 'neg' : 'pos'}`}>
                {m.qtyDelta > 0 ? '+' : ''}
                {qty(m.qtyDelta)} {m.unit}
              </td>
              <td className="num">{qty(m.qtyAfter)}</td>
              <td className="muted small">{[m.userName, m.reason].filter(Boolean).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {moves && !moves.length && <p className="empty">Chưa có giao dịch</p>}
    </>
  );
}
