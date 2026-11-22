import type { OrderItem, OrderType, Product } from './types';

export interface CartLine {
  /** Line identity. Same product with a different note is a separate line. */
  key: string;
  productId: string;
  name: string;
  price: number;
  qty: number;
  note: string;
  /** Chosen options (size, đá, topping...). price already includes their surcharges. */
  options: SelectedOption[];
}

export interface SelectedOption {
  groupId: string;
  optionId: string;
  name: string;
  priceDelta: number;
}

/** "L, Ít đá, Thêm trân châu" */
export const optionsLabel = (opts: SelectedOption[]) => opts.map((o) => o.name).join(', ');

export interface Cart {
  lines: CartLine[];
  discount: number;
  orderType: OrderType;
  tableName: string;
  note: string;
}

export const emptyCart: Cart = { lines: [], discount: 0, orderType: 'dine_in', tableName: '', note: '' };

export type CartAction =
  | { type: 'add'; product: Product; qty?: number; note?: string; options?: SelectedOption[] }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'setNote'; key: string; note: string }
  | { type: 'remove'; key: string }
  | { type: 'discount'; amount: number }
  | { type: 'orderType'; orderType: OrderType }
  | { type: 'table'; tableName: string }
  | { type: 'orderNote'; note: string }
  | { type: 'clear' };

const lineKey = (productId: string, note: string, options: SelectedOption[] = []) =>
  `${productId}:${options.map((o) => o.optionId).sort().join('+')}:${note.trim()}`;

export function subtotalOf(c: Cart) {
  return c.lines.reduce((s, l) => s + l.price * l.qty, 0);
}

export function totalsOf(c: Cart) {
  const subtotal = subtotalOf(c);
  const discount = Math.min(c.discount, subtotal);
  return { subtotal, discount, total: subtotal - discount, count: c.lines.reduce((s, l) => s + l.qty, 0) };
}

/** Total quantity of a product across all its lines (for badges on product tiles). */
export function qtyOfProduct(c: Cart, productId: string) {
  return c.lines.reduce((s, l) => (l.productId === productId ? s + l.qty : s), 0);
}

/** Keep discount <= subtotal after any change to the lines. */
function clampDiscount(c: Cart): Cart {
  return { ...c, discount: Math.min(c.discount, subtotalOf(c)) };
}

export function cartReducer(c: Cart, a: CartAction): Cart {
  switch (a.type) {
    case 'add': {
      const qty = a.qty ?? 1;
      const note = (a.note ?? '').trim();
      const options = a.options ?? [];
      const key = lineKey(a.product.id, note, options);
      const price = a.product.price + options.reduce((s, o) => s + o.priceDelta, 0);
      const existing = c.lines.find((l) => l.key === key);
      const lines = existing
        ? c.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + qty } : l))
        : [...c.lines, { key, productId: a.product.id, name: a.product.name, price, qty, note, options }];
      return { ...c, lines };
    }
    case 'setQty': {
      const qty = Math.floor(a.qty);
      if (qty <= 0) return cartReducer(c, { type: 'remove', key: a.key });
      return clampDiscount({ ...c, lines: c.lines.map((l) => (l.key === a.key ? { ...l, qty } : l)) });
    }
    case 'setNote': {
      const line = c.lines.find((l) => l.key === a.key);
      if (!line) return c;
      const note = a.note.trim();
      const key = lineKey(line.productId, note, line.options);
      if (key === line.key) return c;
      // Merge into an existing line that already has this note.
      const target = c.lines.find((l) => l.key === key);
      const lines = target
        ? c.lines.filter((l) => l.key !== line.key).map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l))
        : c.lines.map((l) => (l.key === line.key ? { ...l, key, note } : l));
      return { ...c, lines };
    }
    case 'remove':
      return clampDiscount({ ...c, lines: c.lines.filter((l) => l.key !== a.key) });
    case 'discount':
      return { ...c, discount: Math.max(0, Math.min(Math.round(a.amount), subtotalOf(c))) };
    case 'orderType':
      return { ...c, orderType: a.orderType, tableName: a.orderType === 'dine_in' ? c.tableName : '' };
    case 'table':
      return { ...c, tableName: a.tableName.trim() };
    case 'orderNote':
      return { ...c, note: a.note };
    case 'clear':
      return emptyCart;
  }
}

export function toOrderItems(c: Cart): OrderItem[] {
  return c.lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    price: l.price,
    qty: l.qty,
    lineTotal: l.price * l.qty,
    ...(l.note ? { note: l.note } : {}),
    ...(l.options.length ? { options: optionsLabel(l.options) } : {}),
  }));
}

/** Suggested cash amounts for quick tender buttons (VND notes). */
export function cashSuggestions(total: number): number[] {
  if (total <= 0) return [0];
  const notes = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
  const set = new Set<number>([total]);
  for (const n of notes) set.add(Math.ceil(total / n) * n);
  return [...set].sort((a, b) => a - b).slice(0, 5);
}
