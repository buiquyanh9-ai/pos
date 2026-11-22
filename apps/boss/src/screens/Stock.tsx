import { useState } from 'react';
import { MOVE_TYPE_LABEL, PURCHASE_STATUS_LABEL, money, qty, type InventoryItem, type Purchase } from '@shopflow/shared';
import { api } from '../lib/api';
import { dateTimeLocal } from '../lib/range';
import { call, useRemote } from '../lib/store';
import { Card, Header, Loading, Segmented, Sheet } from '../components/UI';

type Tab = 'stock' | 'purchases' | 'counts' | 'history';

export function Stock() {
  const [tab, setTab] = useState<Tab>('stock');
  return (
    <div className="screen">
      <Header title="Kho hàng" />
      <div className="screen-body">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { id: 'stock', label: 'Tồn kho' },
            { id: 'purchases', label: 'Nhập hàng' },
            { id: 'counts', label: 'Kiểm kê' },
            { id: 'history', label: 'Lịch sử' },
          ]}
        />
        {tab === 'stock' && <StockList />}
        {tab === 'purchases' && <Purchases />}
        {tab === 'counts' && <Stocktakes />}
        {tab === 'history' && <History />}
      </div>
    </div>
  );
}

function StockList() {
  const { data, error, loading } = useRemote(api.inventory);
  const [onlyLow, setOnlyLow] = useState(false);
  const [kind, setKind] = useState<'all' | 'ingredient' | 'goods'>('all');
  const [open, setOpen] = useState<InventoryItem | null>(null);
  const items = (data?.items ?? []).filter((i) => (!onlyLow || i.low) && (kind === 'all' || i.kind === kind));
  const lowCount = (data?.items ?? []).filter((i) => i.low).length;
  return (
    <>
      <div className="chips scroll-x">
        <button className={kind === 'all' ? 'chip on' : 'chip'} onClick={() => setKind('all')}>
          Tất cả
        </button>
        <button className={kind === 'ingredient' ? 'chip on' : 'chip'} onClick={() => setKind('ingredient')}>
          Nguyên liệu
        </button>
        <button className={kind === 'goods' ? 'chip on' : 'chip'} onClick={() => setKind('goods')}>
          Hàng hoá
        </button>
        <button className={onlyLow ? 'chip on warn' : 'chip'} onClick={() => setOnlyLow(!onlyLow)}>
          ⚠ Sắp hết ({lowCount})
        </button>
      </div>
      <Loading error={error} loading={loading && !data} />
      <div className="card flush">
        <table className="table">
          <thead>
            <tr>
              <th>Tên hàng</th>
              <th className="num">Tối thiểu</th>
              <th className="num">Tồn</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} onClick={() => setOpen(i)} className={i.low ? 'low' : ''}>
                <td>
                  {i.name}
                  <span className="muted small"> {i.unit}</span>
                </td>
                <td className="num muted">{qty(i.minQty)}</td>
                <td className="num">
                  <strong>{qty(i.qty)}</strong>
                  {i.low && <span className="tag tag-warn">Thấp</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !items.length && <p className="empty">Không có mặt hàng</p>}
      </div>
      {open && <ItemSheet item={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ItemSheet({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { data } = useRemote((c) => api.moves(c, { itemId: item.id, limit: 50 }), [item.id]);
  return (
    <Sheet title={item.name} onClose={onClose}>
      <ul className="kv">
        <li>
          <span>Tồn hiện tại</span>
          <strong>
            {qty(item.qty)} {item.unit}
          </strong>
        </li>
        <li>
          <span>Ngưỡng tối thiểu</span>
          <span>
            {qty(item.minQty)} {item.unit}
          </span>
        </li>
        <li>
          <span>Giá vốn / {item.unit}</span>
          <span>{money(item.unitCost)}</span>
        </li>
        <li>
          <span>Giá trị tồn</span>
          <span>{money(Math.round(item.qty * item.unitCost))}</span>
        </li>
      </ul>
      <h3>Lịch sử nhập / xuất</h3>
      <MoveList moves={data?.moves ?? []} showItem={false} />
    </Sheet>
  );
}

function MoveList({ moves, showItem }: { moves: import('@shopflow/shared').StockMove[]; showItem: boolean }) {
  if (!moves.length) return <p className="empty">Chưa có giao dịch</p>;
  return (
    <ul className="list">
      {moves.map((m) => (
        <li key={m.id} className="row">
          <span className="grow">
            <strong>{showItem ? m.itemName : MOVE_TYPE_LABEL[m.type]}</strong>
            <span className="muted small">
              {showItem && `${MOVE_TYPE_LABEL[m.type]} · `}
              {dateTimeLocal(m.at)}
              {m.userName && ` · ${m.userName}`}
              {m.reason && ` · ${m.reason}`}
            </span>
          </span>
          <span className="right">
            <strong className={m.qtyDelta < 0 ? 'neg' : 'pos'}>
              {m.qtyDelta > 0 ? '+' : ''}
              {qty(m.qtyDelta)}
            </strong>
            <span className="muted small">còn {qty(m.qtyAfter)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function History() {
  const [type, setType] = useState<string>('');
  const { data, error, loading } = useRemote((c) => api.moves(c, { type: type || undefined, limit: 200 }), [type]);
  return (
    <>
      <div className="chips scroll-x">
        {['', 'import', 'sale', 'count', 'adjust', 'void', 'refund'].map((t) => (
          <button key={t} className={type === t ? 'chip on' : 'chip'} onClick={() => setType(t)}>
            {t ? MOVE_TYPE_LABEL[t as keyof typeof MOVE_TYPE_LABEL] : 'Tất cả'}
          </button>
        ))}
      </div>
      <Loading error={error} loading={loading && !data} />
      <div className="card">
        <MoveList moves={data?.moves ?? []} showItem />
      </div>
    </>
  );
}

function Stocktakes() {
  const { data, error, loading } = useRemote(api.stocktakes);
  return (
    <>
      <Loading error={error} loading={loading && !data} />
      {data?.stocktakes.map((t) => (
        <Card key={t.id} title={`Kiểm kê ${dateTimeLocal(t.createdAt)}`} action={<span className={t.varianceCount ? 'tag tag-warn' : 'tag tag-ok'}>{t.varianceCount ? `${t.varianceCount} lệch` : 'Khớp'}</span>}>
          <p className="muted small">
            {t.userName ?? ''} · {t.lines.length} mặt hàng · giá trị chênh lệch {money(t.varianceValue)}
          </p>
          <ul className="kv">
            {t.lines
              .filter((l) => l.diff !== 0)
              .map((l) => (
                <li key={l.itemId}>
                  <span>
                    {l.name}
                    <span className="muted small">
                      {' '}
                      sổ {qty(l.expected)} → thực {qty(l.counted)} {l.unit} · {l.reason}
                    </span>
                  </span>
                  <strong className={l.diff < 0 ? 'neg' : 'pos'}>
                    {l.diff > 0 ? '+' : ''}
                    {qty(l.diff)}
                  </strong>
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {data && !data.stocktakes.length && <p className="empty">Chưa có phiếu kiểm kê</p>}
    </>
  );
}

function Purchases() {
  const [status, setStatus] = useState<string>('pending');
  const { data, error, loading } = useRemote((c) => api.purchases(c, status || undefined), [status]);
  const [open, setOpen] = useState<Purchase | null>(null);
  return (
    <>
      <div className="chips scroll-x">
        {['pending', 'approved', 'received', 'rejected', ''].map((s) => (
          <button key={s} className={status === s ? 'chip on' : 'chip'} onClick={() => setStatus(s)}>
            {s ? PURCHASE_STATUS_LABEL[s as keyof typeof PURCHASE_STATUS_LABEL] : 'Tất cả'}
          </button>
        ))}
      </div>
      <Loading error={error} loading={loading && !data} />
      <ul className="list card flush">
        {data?.purchases.map((p) => (
          <li key={p.id}>
            <button className="order-row" onClick={() => setOpen(p)}>
              <span className="grow">
                <strong>{p.supplierName ?? 'Chưa chọn NCC'}</strong>
                <span className="muted small">
                  {p.lines.length} mặt hàng · {p.createdBy} · {dateTimeLocal(p.createdAt)}
                </span>
              </span>
              <span className="right">
                <strong>{money(p.totalCost)}</strong>
                <span className={`tag tag-${p.status}`}>{PURCHASE_STATUS_LABEL[p.status]}</span>
              </span>
              <span className="chev">›</span>
            </button>
          </li>
        ))}
      </ul>
      {data && !data.purchases.length && <p className="empty">Không có đề xuất</p>}
      {open && <PurchaseSheet p={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PurchaseSheet({ p, onClose }: { p: Purchase; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await call((c) => (approve ? api.approve(c, p.id, note) : api.reject(c, p.id, note)));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Đề xuất nhập hàng" onClose={onClose}>
      <p className="muted">
        {p.supplierName ?? 'Chưa chọn nhà cung cấp'} · {p.createdBy} · {dateTimeLocal(p.createdAt)}
      </p>
      {p.note && <p>Ghi chú: {p.note}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Mặt hàng</th>
            <th className="num">Tồn / tối thiểu</th>
            <th className="num">SL nhập</th>
            <th className="num">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.name}</td>
              <td className={`num ${l.currentStock < l.minQty ? 'neg' : 'muted'}`}>
                {qty(l.currentStock)} / {qty(l.minQty)}
              </td>
              <td className="num">
                {qty(l.receivedQty ?? l.qty)} {l.unit}
              </td>
              <td className="num">{money(Math.round((l.receivedQty ?? l.qty) * l.unitCost))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sheet-total">
        Tổng dự kiến <strong>{money(p.totalCost)}</strong>
      </p>
      {p.status === 'pending' ? (
        <>
          <label>
            Ghi chú cho nhân viên kho
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" />
          </label>
          {error && <p className="error-box">{error}</p>}
          <div className="btn-row">
            <button className="btn danger" disabled={busy} onClick={() => decide(false)}>
              Từ chối
            </button>
            <button className="btn primary" disabled={busy} onClick={() => decide(true)}>
              Duyệt nhập hàng
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          {PURCHASE_STATUS_LABEL[p.status]}
          {p.decidedBy && ` bởi ${p.decidedBy}`}
          {p.decisionNote && `: ${p.decisionNote}`}
          {p.receivedAt && ` · nhập kho ${dateTimeLocal(p.receivedAt)} (${p.receivedBy})`}
        </p>
      )}
    </Sheet>
  );
}
