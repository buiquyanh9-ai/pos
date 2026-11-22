import { useMemo, useState, type Dispatch } from 'react';
import { cashSuggestions, optionsLabel, qtyOfProduct, toOrderItems, totalsOf, type Cart, type CartAction } from '../lib/cart';
import { fold, imageSrc, money } from '../lib/format';
import { closeOpenOrder, commitSale, getState, refreshOpenOrders, saveOpenOrder, usePos } from '../lib/store';
import { openDrawer, printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { COUNTER_PAYMENT_METHODS, PAYMENT_LABEL, type LocalOrder, type PaymentMethod, type Product } from '../lib/types';
import { NoteDialog, OptionPicker } from '../components/OptionPicker';
import { Modal, Numpad } from '../components/Modal';
import { TablePicker } from '../components/TablePicker';

interface Props {
  cart: Cart;
  dispatch: Dispatch<CartAction>;
  query: string;
  setQuery: (value: string) => void;
}

const COLS = 5;

/** Lay products out on a 5-column grid using gridRow/gridCol from the menu file; empty slots stay empty. */
function layout(products: Product[]): (Product | null)[][] {
  const rows: (Product | null)[][] = [];
  const free: Product[] = [];
  for (const p of products) {
    if (p.gridRow == null || p.gridCol == null || p.gridCol >= COLS) {
      free.push(p);
      continue;
    }
    while (rows.length <= p.gridRow) rows.push(Array(COLS).fill(null));
    if (rows[p.gridRow][p.gridCol]) free.push(p);
    else rows[p.gridRow][p.gridCol] = p;
  }
  for (const p of free) {
    let placed = false;
    for (const r of rows) {
      const i = r.indexOf(null);
      if (i >= 0 && rows.indexOf(r) === rows.length - 1) {
        r[i] = p;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const r: (Product | null)[] = Array(COLS).fill(null);
      r[0] = p;
      rows.push(r);
    }
  }
  return rows;
}

function ProductTile({ p, qty, onTap }: { p: Product; qty: number; onTap: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = imageSrc(p.imageUrl);
  const out = p.stock !== null && p.stock <= 0;
  return (
    <button className={`pos-tile${qty ? ' in-bill' : ''}${out ? ' out' : ''}`} onClick={onTap} title={p.name}>
      <span className="pos-photo">
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className="pos-letter">{p.name.replace(/^(Cơm (trắng|đảo)|Nước)\s+/i, '').slice(0, 1).toUpperCase()}</span>
        )}
        {qty > 0 && <span className="pos-qty">{qty}</span>}
        {out && <span className="pos-out">Hết</span>}
        {p.stock !== null && p.stock > 0 && p.stock <= 5 && <span className="pos-low">Còn {p.stock}</span>}
      </span>
      <span className="pos-name">{p.name}</span>
      <span className="pos-price">{money(p.price)}</span>
    </button>
  );
}

export function SaleScreen({ cart, dispatch, query, setQuery }: Props) {
  const products = usePos((s) => s.products);
  const categories = usePos((s) => s.categories);
  const tables = usePos((s) => s.tables);
  const openOrders = usePos((s) => s.openOrders);
  const catNames = useMemo(() => {
    const fromCats = categories.map((c) => c.name).filter((n) => products.some((p) => p.category === n));
    return fromCats.length ? fromCats : [...new Set(products.map((p) => p.category).filter(Boolean))];
  }, [categories, products]);
  const [category, setCategory] = useState<string>('');
  const activeCat = catNames.includes(category) ? category : catNames[0] ?? '';
  const [tablePicker, setTablePicker] = useState(false);
  const [showBill, setShowBill] = useState(false); // narrow screens: bill as a sheet
  const [paying, setPaying] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [done, setDone] = useState<LocalOrder | null>(null);
  const [picking, setPicking] = useState<Product | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [saving, setSaving] = useState(false);

  const q = fold(query.trim());
  const searching = q.length > 0;
  const rows = useMemo(() => {
    if (searching) {
      const hits = products.filter((p) => fold(p.name).includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q));
      const out: (Product | null)[][] = [];
      for (let i = 0; i < hits.length; i += COLS) out.push([...hits.slice(i, i + COLS), ...Array(Math.max(0, COLS - hits.slice(i, i + COLS).length)).fill(null)]);
      return out;
    }
    return layout(products.filter((p) => p.category === activeCat));
  }, [products, activeCat, searching, q]);

  const t = totalsOf(cart);
  const add = (p: Product) => {
    if (p.optionGroups.length) return setPicking(p);
    if (p.stock !== null && p.stock <= 0) notify(`${p.name}: kho đã hết theo sổ sách`, 'error');
    dispatch({ type: 'add', product: p });
  };

  const resume = (id: string) => {
    const o = getState().openOrders.find((x) => x.id === id);
    if (!o) return;
    if (cart.lines.length && cart.openId !== id) return notify('Lưu hoặc thanh toán đơn đang làm trước khi mở đơn khác', 'error');
    dispatch({ type: 'load', cart: { ...o.cart, openId: o.id, openVersion: o.version } });
    setTablePicker(false);
  };

  const park = async () => {
    setSaving(true);
    try {
      const saved = await saveOpenOrder(cart);
      notify(saved.tableName ? `Đã lưu đơn bàn ${saved.tableName}` : 'Đã lưu đơn mang đi', 'success');
      dispatch({ type: 'clear' });
      setShowBill(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
      if (String(err).includes('máy khác')) void refreshOpenOrders();
    } finally {
      setSaving(false);
    }
  };

  const tableLabel = cart.tableName ? `Bàn ${cart.tableName}` : cart.orderType === 'dine_in' ? 'Chọn bàn' : 'Mang đi';

  return (
    <div className="pos-sale">
      <section className="pos-menu">
        {searching && (
          <div className="pos-search-note">
            Kết quả tìm “{query}” ·{' '}
            <button className="link" onClick={() => setQuery('')}>
              Xoá tìm kiếm
            </button>
          </div>
        )}
        <div className="pos-grid">
          {rows.map((r, i) =>
            r.map((p, j) => (p ? <ProductTile key={p.id} p={p} qty={qtyOfProduct(cart, p.id)} onTap={() => add(p)} /> : <div key={`e-${i}-${j}`} className="pos-tile empty" />)),
          )}
          {!products.length && <p className="empty pos-empty">Chưa có món. Kiểm tra kết nối máy chủ.</p>}
        </div>
        <nav className="pos-cats" role="tablist">
          {catNames.map((c) => (
            <button key={c} role="tab" aria-selected={!searching && c === activeCat} className={!searching && c === activeCat ? 'pos-cat active' : 'pos-cat'} onClick={() => (setCategory(c), setQuery(''))}>
              {c}
            </button>
          ))}
          <button className="pos-cat tables" onClick={() => setTablePicker(true)}>
            Sơ đồ bàn
            {openOrders.length > 0 && <span className="pos-count">{openOrders.length}</span>}
          </button>
        </nav>
      </section>

      <aside className={showBill ? 'pos-bill open' : 'pos-bill'}>
        <div className="pos-bill-head">
          <button className="pos-table-btn" onClick={() => setTablePicker(true)}>
            <span>{tableLabel}</span>
            <span aria-hidden="true">›</span>
          </button>
          <button className="icon-btn only-narrow" aria-label="Đóng hoá đơn" onClick={() => setShowBill(false)}>
            ✕
          </button>
        </div>
        {cart.openId && <div className="pos-bill-badge">Đơn đang mở · sửa xong bấm “Lưu đơn” hoặc thanh toán</div>}

        <ul className="pos-lines">
          {cart.lines.length === 0 && <li className="pos-lines-empty">Chạm vào món để thêm vào hoá đơn</li>}
          {cart.lines.map((l) => (
            <li key={l.key} className="pos-line">
              <button className="pos-line-main" onClick={() => setNoteFor(l.key)} title="Chạm để ghi chú">
                <span className="pos-line-name">{l.name}</span>
                {(l.options.length > 0 || l.note) && <span className="pos-line-note">{[optionsLabel(l.options), l.note].filter(Boolean).join(' · ')}</span>}
                <span className="pos-line-unit">{money(l.price)}</span>
              </button>
              <div className="pos-stepper">
                <button aria-label="Giảm" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty - 1 })}>
                  −
                </button>
                <span>{l.qty}</span>
                <button aria-label="Tăng" onClick={() => dispatch({ type: 'setQty', key: l.key, qty: l.qty + 1 })}>
                  +
                </button>
              </div>
              <strong className="pos-line-total">{money(l.price * l.qty)}</strong>
            </li>
          ))}
        </ul>

        <div className="pos-bill-foot">
          <div className="pos-foot-row">
            <label className="pos-switch">
              <input
                type="checkbox"
                checked={cart.orderType !== 'dine_in'}
                onChange={(e) => dispatch({ type: 'orderType', orderType: e.target.checked ? 'takeaway' : 'dine_in' })}
              />
              <span className="pos-switch-ui" aria-hidden="true" />
              Mang đi
            </label>
            <button className="link" disabled={!cart.lines.length} onClick={() => setDiscounting(true)}>
              Giảm giá{t.discount ? `: −${money(t.discount)}` : ''}
            </button>
          </div>
          <input className="pos-note" value={cart.note} onChange={(e) => dispatch({ type: 'orderNote', note: e.target.value })} placeholder="Ghi chú hoá đơn…" />
          <div className="pos-total">
            <span>Tổng ({t.count} món)</span>
            <strong>{money(t.total)}</strong>
          </div>
          <div className="pos-actions">
            <button className="pos-act" disabled={!cart.lines.length && !cart.openId} onClick={() => (cart.openId ? setCancelling(true) : dispatch({ type: 'clear' }))}>
              {cart.openId ? 'Huỷ đơn' : 'Xoá'}
            </button>
            <button className="pos-act" disabled={!cart.lines.length || saving} onClick={() => void park()}>
              {cart.openId ? 'Cập nhật' : 'Lưu đơn'}
            </button>
            <button className="pos-pay" disabled={!cart.lines.length} onClick={() => setPaying(true)}>
              THANH TOÁN
            </button>
          </div>
        </div>
      </aside>

      <button className="pos-bill-bar only-narrow" onClick={() => setShowBill(true)}>
        <span>
          {tableLabel} · {t.count} món
        </span>
        <strong>{money(t.total)}</strong>
      </button>

      {tablePicker && (
        <TablePicker
          tables={tables}
          openOrders={openOrders}
          current={cart.tableName}
          currentOpenId={cart.openId}
          onClose={() => setTablePicker(false)}
          onOpenBill={resume}
          onPick={(name) => {
            dispatch({ type: 'orderType', orderType: 'dine_in' });
            dispatch({ type: 'table', tableName: name });
            setTablePicker(false);
          }}
          onTakeaway={() => {
            dispatch({ type: 'orderType', orderType: 'takeaway' });
            setTablePicker(false);
          }}
        />
      )}
      {discounting && (
        <DiscountDialog
          subtotal={t.subtotal}
          initial={cart.discount}
          onClose={() => setDiscounting(false)}
          onApply={(amount) => {
            dispatch({ type: 'discount', amount });
            setDiscounting(false);
          }}
        />
      )}
      {paying && (
        <PaymentDialog
          total={t.total}
          items={cart.lines}
          onClose={() => setPaying(false)}
          onPay={(method, paid) => {
            try {
              const order = commitSale({ items: toOrderItems(cart), discount: t.discount, paymentMethod: method, paid, orderType: cart.orderType, tableName: cart.tableName, note: cart.note });
              if (cart.openId) void closeOpenOrder(cart.openId);
              dispatch({ type: 'clear' });
              setPaying(false);
              setShowBill(false);
              setDone(order);
              const s = getState().settings;
              void printReceipt(order, s);
              if (method === 'cash') void openDrawer(s);
            } catch (err) {
              notify(err instanceof Error ? err.message : String(err), 'error');
            }
          }}
        />
      )}
      {done && <DoneDialog order={done} onClose={() => setDone(null)} />}
      {cancelling && cart.openId && (
        <CancelOpenDialog
          onClose={() => setCancelling(false)}
          onConfirm={(reason) => {
            void closeOpenOrder(cart.openId!, reason);
            dispatch({ type: 'clear' });
            setCancelling(false);
            notify('Đã huỷ đơn đang mở', 'success');
          }}
        />
      )}
      {picking && (
        <OptionPicker
          product={picking}
          onClose={() => setPicking(null)}
          onAdd={(options, note, qty) => {
            dispatch({ type: 'add', product: picking, options, note, qty });
            setPicking(null);
          }}
        />
      )}
      {noteFor &&
        (() => {
          const line = cart.lines.find((l) => l.key === noteFor);
          if (!line) return null;
          return (
            <NoteDialog
              title={line.name}
              initial={line.note}
              onClose={() => setNoteFor(null)}
              onSave={(note) => {
                dispatch({ type: 'setNote', key: line.key, note });
                setNoteFor(null);
              }}
            />
          );
        })()}
    </div>
  );
}

function CancelOpenDialog({ onConfirm, onClose }: { onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Huỷ đơn đang mở" onClose={onClose}>
      <p className="muted">Đơn chưa thanh toán sẽ bị xoá. Lý do được ghi vào lịch sử thao tác.</p>
      <div className="opt-row">
        {['Khách huỷ', 'Gọi nhầm', 'Khách đi không ăn', 'Gộp vào đơn khác'].map((r) => (
          <button key={r} className={reason === r ? 'opt on' : 'opt'} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input className="opt-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc)" />
      <button className="btn primary big full" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
        Xác nhận huỷ
      </button>
    </Modal>
  );
}

function DiscountDialog({ subtotal, initial, onApply, onClose }: { subtotal: number; initial: number; onApply: (v: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title="Giảm giá" onClose={onClose}>
      <div className="amount">{money(value)}</div>
      <div className="quick">
        {[5, 10, 20].map((pct) => (
          <button key={pct} className="chip" onClick={() => setValue(Math.round((subtotal * pct) / 100))}>
            {pct}%
          </button>
        ))}
      </div>
      <Numpad value={value} onChange={setValue} max={subtotal} />
      <button className="btn primary big full" onClick={() => onApply(value)}>
        Áp dụng
      </button>
    </Modal>
  );
}

function PaymentDialog({ total, items, onPay, onClose }: { total: number; items: Cart['lines']; onPay: (m: PaymentMethod, paid: number) => void; onClose: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paid, setPaid] = useState(total);
  const [typed, setTyped] = useState(false);
  const effectivePaid = method === 'cash' ? paid : total;
  const short = effectivePaid < total;
  return (
    <Modal title={`Thanh toán ${money(total)}`} onClose={onClose} wide>
      <div className="payment-modal"><div className="payment-summary"><span className="eyebrow">TÓM TẮT ĐƠN</span>{items.map((item) => <div className="summary-line" key={item.key}><span>{item.qty} × {item.name}{item.options.length ? ` (${optionsLabel(item.options)})` : ''}</span><strong>{money(item.qty * item.price)}</strong></div>)}<div className="summary-total"><span>Tổng thanh toán</span><strong>{money(total)}</strong></div></div><div className="payment-controls"><div className="segmented">
        {COUNTER_PAYMENT_METHODS.map((m) => (
          <button key={m} className={m === method ? 'seg active' : 'seg'} onClick={() => setMethod(m)}>
            {PAYMENT_LABEL[m]}
          </button>
        ))}
      </div>
      {method === 'cash' ? (
        <div className="pay-cash">
          <div>
            <label className="muted">Khách đưa</label>
            <div className="amount">{money(paid)}</div>
            <div className="quick">
              {cashSuggestions(total).map((v) => (
                <button
                  key={v}
                  className={v === paid ? 'chip active' : 'chip'}
                  onClick={() => {
                    setPaid(v);
                    setTyped(false);
                  }}
                >
                  {money(v)}
                </button>
              ))}
            </div>
            <div className={short ? 'change short' : 'change'}>
              {short ? `Còn thiếu ${money(total - paid)}` : `Tiền thối: ${money(paid - total)}`}
            </div>
          </div>
          {/* Until the cashier types, keypad input starts a fresh amount instead of appending to the default. */}
          <Numpad
            value={typed ? paid : 0}
            onChange={(v) => {
              setTyped(true);
              setPaid(v);
            }}
          />
        </div>
      ) : (
        <p className="pay-note">
          {method === 'card'
            ? 'Quẹt/chạm thẻ trên máy POS hoặc máy cà thẻ, sau đó xác nhận.'
            : `Khách chuyển khoản (hoặc quét mã QR ngân hàng) đúng ${money(total)}. Kiểm tra đã nhận tiền rồi xác nhận.`}
        </p>
      )}
      <button className="btn primary big full" disabled={short} onClick={() => onPay(method, effectivePaid)}>
        Hoàn tất
      </button>
      </div></div>
    </Modal>
  );
}

function DoneDialog({ order, onClose }: { order: LocalOrder; onClose: () => void }) {
  return (
    <Modal title="Đã thanh toán" onClose={onClose}>
      <div className="done">
        <div className="done-number">Đơn {order.number}</div>
        <div className="amount">{money(order.total)}</div>
        {order.change > 0 && <div className="change">Tiền thối: {money(order.change)}</div>}
      </div>
      <div className="cart-actions">
        <button className="btn secondary" onClick={() => void printReceipt(order, getState().settings)}>
          In lại
        </button>
        <button className="btn primary big" onClick={onClose} autoFocus>
          Đơn mới
        </button>
      </div>
    </Modal>
  );
}
