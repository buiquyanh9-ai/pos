import type { OrderItem, Product } from './types';

export interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export interface Cart {
  lines: CartLine[];
  discount: number;
}

export const emptyCart: Cart = { lines: [], discount: 0 };

export type CartAction =
  | { type: 'add'; product: Product; qty?: number }
  | { type: 'setQty'; productId: string; qty: number }
  | { type: 'remove'; productId: string }
  | { type: 'discount'; amount: number }
  | { type: 'clear' };

export function subtotalOf(c: Cart) {
  return c.lines.reduce((s, l) => s + l.price * l.qty, 0);
}

export function totalsOf(c: Cart) {
  const subtotal = subtotalOf(c);
  const discount = Math.min(c.discount, subtotal);
  return { subtotal, discount, total: subtotal - discount, count: c.lines.reduce((s, l) => s + l.qty, 0) };
}

/** Keep discount <= subtotal after any change to the lines. */
function clampDiscount(c: Cart): Cart {
  return { ...c, discount: Math.min(c.discount, subtotalOf(c)) };
}

export function cartReducer(c: Cart, a: CartAction): Cart {
  switch (a.type) {
    case 'add': {
      const qty = a.qty ?? 1;
      const existing = c.lines.find((l) => l.productId === a.product.id);
      const lines = existing
        ? c.lines.map((l) => (l.productId === a.product.id ? { ...l, qty: l.qty + qty } : l))
        : [...c.lines, { productId: a.product.id, name: a.product.name, price: a.product.price, qty }];
      return { ...c, lines };
    }
    case 'setQty': {
      const qty = Math.floor(a.qty);
      if (qty <= 0) return cartReducer(c, { type: 'remove', productId: a.productId });
      return clampDiscount({ ...c, lines: c.lines.map((l) => (l.productId === a.productId ? { ...l, qty } : l)) });
    }
    case 'remove':
      return clampDiscount({ ...c, lines: c.lines.filter((l) => l.productId !== a.productId) });
    case 'discount':
      return { ...c, discount: Math.max(0, Math.min(Math.round(a.amount), subtotalOf(c))) };
    case 'clear':
      return emptyCart;
  }
}

export function toOrderItems(c: Cart): OrderItem[] {
  return c.lines.map((l) => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty, lineTotal: l.price * l.qty }));
}

/** Suggested cash amounts for quick tender buttons (VND notes). */
export function cashSuggestions(total: number): number[] {
  if (total <= 0) return [0];
  const notes = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
  const set = new Set<number>([total]);
  for (const n of notes) set.add(Math.ceil(total / n) * n);
  return [...set].sort((a, b) => a - b).slice(0, 5);
}
