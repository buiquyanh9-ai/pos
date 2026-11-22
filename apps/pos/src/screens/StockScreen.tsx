import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { notify } from '../lib/notify';
import { remote, usePos } from '../lib/store';
import { MOVE_TYPE_LABEL, PURCHASE_STATUS_LABEL, type InventoryItem, type Purchase, type StockMove, type Supplier } from '../lib/types';
import { Modal } from '../components/Modal';

type Section = 'list' | 'low' | 'count' | 'purchase' | 'history';
const qty = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const err = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error');

/** Inventory for POS staff: stock list, low stock, end-of-shift count, purchasing/receiving, history. */
export function StockScreen() {
  const role = usePos((s) => s.session?.user.role);
  const [section, setSection] = useState<Section>('list');
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const reload = useCallback(() => remote(api.inventory).then((r) => setItems(r.items)).catch(err), []);
  useEffect(() => void reload(), [reload]);
  const canManage = role === 'owner' || role === 'stock';
  const lowCount = items?.filter((i) => i.low).length ?? 0;

  const menu: { id: Section; label: string; show: boolean }[] = [
    { id: 'list', label: 'Danh sách hàng tồn', show: true },
    { id: 'low', label: `Hàng sắp hết${lowCount ? ` (${lowCount})` : ''}`, show: true },
    { id: 'count', label: 'Kiểm kê cuối ca', show: true },
    { id: 'purchase', label: 'Nhập hàng', show: canManage },
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
        {items && section === 'count' && <Stocktake items={items} onDone={() => (reload(), setSection('history'))} />}
        {items && section === 'purchase' && canManage && <Purchasing items={items} onChanged={reload} />}
        {section === 'history' && <History />}
      </section>
    </div>
  );
}

function StockTable({ items, canAdjust, onChanged }: { items: InventoryItem[]; canAdjust: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState<'ingredient' | 'goods'>('ingredient');
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const rows = items.filter((i) => i.kind === kind);
  return (
    <>
      <div className="segmented">
        <button className={kind === 'ingredient' ? 'seg active' : 'seg'} onClick={() => setKind('ingredient')}>
          Nguyên liệu
        </button>
        <button className={kind === 'goods' ? 'seg active' : 'seg'} onClick={() => setKind('goods')}>
          Hàng hoá
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Tên hàng tồn</th>
            <th>Đơn vị</th>
            <th className="num">Tối thiểu</th>
            <th className="num">Số lượng</th>
            {canAdjust && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className={i.low ? 'low' : ''}>
              <td>{i.name}</td>
              <td className="muted">{i.unit}</td>
              <td className="num muted">{qty(i.minQty)}</td>
              <td className={`num ${i.qty < 0 ? 'neg' : ''}`}>
                <strong>{qty(i.qty)}</strong>
                {i.low && <span className="pill pill-rejected">Sắp hết</span>}
              </td>
              {canAdjust && (
                <td className="num">
                  <button className="chip" onClick={() => setAdjusting(i)}>
                    Điều chỉnh
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">Không có mặt hàng</p>}
      {adjusting && <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} onDone={() => (setAdjusting(null), onChanged())} />}
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
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const reload = useCallback(() => remote(api.purchases).then((r) => setPurchases(r.purchases)).catch(err), []);
  useEffect(() => {
    void reload();
    remote(api.suppliers).then((r) => setSuppliers(r.suppliers)).catch(() => undefined);
  }, [reload]);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setCreating(true)}>
          ＋ Tạo đề xuất nhập hàng
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
              <strong>{money(p.totalCost)}</strong>
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
  const total = chosen.reduce((s, l) => s + l.qty * l.item.unitCost, 0);
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
              <th className="num">Thành tiền</th>
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
                <td className="num">{Number(lines[i.id]) > 0 ? money(Math.round(Number(lines[i.id]) * i.unitCost)) : ''}</td>
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
          Gửi đề xuất · {chosen.length} mặt hàng · {money(Math.round(total))}
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
