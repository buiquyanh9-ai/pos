import { useMemo, useState, type Dispatch } from 'react';
import { cashSuggestions, toOrderItems, totalsOf, type Cart, type CartAction } from '../lib/cart';
import { fold, money } from '../lib/format';
import { commitSale, getState, usePos } from '../lib/store';
import { openDrawer, printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { PAYMENT_LABEL, type LocalOrder, type PaymentMethod } from '../lib/types';
import { Modal, Numpad } from '../components/Modal';

interface Props {
  cart: Cart;
  dispatch: Dispatch<CartAction>;
}

export function SaleScreen({ cart, dispatch }: Props) {
  const products = usePos((s) => s.products);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');
  const [showCart, setShowCart] = useState(false); // narrow screens: cart as a sheet
  const [paying, setPaying] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [done, setDone] = useState<LocalOrder | null>(null);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products]);
  const visible = useMemo(() => {
    const q = fold(query.trim());
    return products.filter(
      (p) =>
        (!category || p.category === category) &&
        (!q || fold(p.name).includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q)),
    );
  }, [products, query, category]);

  const t = totalsOf(cart);
  const qtyOf = (id: string) => cart.lines.find((l) => l.productId === id)?.qty ?? 0;

  // Enter in search: exact barcode/SKU adds directly (works with scanners that type into the field).
  const onSearchEnter = () => {
    const q = query.trim();
    const exact = products.find((p) => p.barcode === q || p.sku?.toLowerCase() === q.toLowerCase());
    const pick = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (pick) {
      dispatch({ type: 'add', product: pick });
      setQuery('');
    } else if (q) notify(`Không tìm thấy "${q}"`, 'error');
  };

  return (
    <div className="sale">
      <section className="catalog">
        <div className="catalog-tools">
          <input
            className="search"
            type="search"
            inputMode="search"
            placeholder="Tìm tên, SKU hoặc mã vạch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
          />
        </div>
        <div className="chips">
          <button className={!category ? 'chip active' : 'chip'} onClick={() => setCategory('')}>
            Tất cả
          </button>
          {categories.map((c) => (
            <button key={c} className={category === c ? 'chip active' : 'chip'} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        {products.length === 0 ? (
          <div className="empty">Chưa có sản phẩm. Kiểm tra kết nối máy chủ trong Cài đặt.</div>
        ) : (
          <div className="grid">
            {visible.map((p) => {
              const q = qtyOf(p.id);
              return (
                <button key={p.id} className={q ? 'product in-cart' : 'product'} onClick={() => dispatch({ type: 'add', product: p })}>
                  {q > 0 && <span className="product-qty">{q}</span>}
                  <span className="product-name">{p.name}</span>
                  <span className="product-price">{money(p.price)}</span>
                  <span className={p.stock <= 0 ? 'product-stock out' : 'product-stock'}>Tồn: {p.stock}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className={showCart ? 'cart open' : 'cart'}>
        <div className="cart-head">
          <h2>Giỏ hàng ({t.count})</h2>
          <button className="icon-btn only-narrow" aria-label="Đóng giỏ hàng" onClick={() => setShowCart(false)}>
            ✕
          </button>
        </div>
        <ul className="cart-lines">
          {cart.lines.length === 0 && <li className="empty">Chạm vào sản phẩm để thêm</li>}
          {cart.lines.map((l) => (
            <li key={l.productId} className="cart-line">
              <div className="cart-line-info">
                <span className="cart-line-name">{l.name}</span>
                <span className="muted">{money(l.price)}</span>
              </div>
              <div className="stepper">
                <button aria-label="Giảm" onClick={() => dispatch({ type: 'setQty', productId: l.productId, qty: l.qty - 1 })}>
                  −
                </button>
                <span>{l.qty}</span>
                <button aria-label="Tăng" onClick={() => dispatch({ type: 'setQty', productId: l.productId, qty: l.qty + 1 })}>
                  +
                </button>
              </div>
              <span className="cart-line-total">{money(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="cart-foot">
          <div className="row">
            <span>Tạm tính</span>
            <span>{money(t.subtotal)}</span>
          </div>
          <div className="row">
            <button className="link" disabled={!cart.lines.length} onClick={() => setDiscounting(true)}>
              Giảm giá
            </button>
            <span>{t.discount ? `−${money(t.discount)}` : '0đ'}</span>
          </div>
          <div className="row total">
            <span>Tổng</span>
            <span>{money(t.total)}</span>
          </div>
          <div className="cart-actions">
            <button className="btn secondary" disabled={!cart.lines.length} onClick={() => dispatch({ type: 'clear' })}>
              Xoá
            </button>
            <button className="btn primary big" disabled={!cart.lines.length} onClick={() => setPaying(true)}>
              Thanh toán
            </button>
          </div>
        </div>
      </aside>

      <button className="cart-bar only-narrow" onClick={() => setShowCart(true)}>
        <span>Giỏ hàng ({t.count})</span>
        <strong>{money(t.total)}</strong>
      </button>

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
          onClose={() => setPaying(false)}
          onPay={(method, paid) => {
            try {
              const order = commitSale({ items: toOrderItems(cart), discount: t.discount, paymentMethod: method, paid });
              dispatch({ type: 'clear' });
              setPaying(false);
              setShowCart(false);
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
    </div>
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

function PaymentDialog({ total, onPay, onClose }: { total: number; onPay: (m: PaymentMethod, paid: number) => void; onClose: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paid, setPaid] = useState(total);
  const [typed, setTyped] = useState(false);
  const effectivePaid = method === 'cash' ? paid : total;
  const short = effectivePaid < total;
  return (
    <Modal title={`Thanh toán ${money(total)}`} onClose={onClose} wide>
      <div className="segmented">
        {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
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
          {method === 'card' ? 'Quẹt/chạm thẻ trên máy POS hoặc máy cà thẻ, sau đó xác nhận.' : 'Khách chuyển khoản đúng số tiền, kiểm tra đã nhận rồi xác nhận.'}
        </p>
      )}
      <button className="btn primary big full" disabled={short} onClick={() => onPay(method, effectivePaid)}>
        Hoàn tất
      </button>
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
