import { describe, expect, it } from 'vitest';
import { cartReducer, cashSuggestions, emptyCart, totalsOf } from './cart';
import { fold } from './format';
import type { Product } from './types';

const p = (id: string, price: number): Product => ({
  id, sku: id, barcode: null, name: id, category: '', price, stock: 10, active: true, updatedAt: '',
});

describe('cart', () => {
  it('adds, merges and removes lines', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('b', 500), qty: 3 });
    expect(c.lines).toHaveLength(2);
    expect(totalsOf(c)).toMatchObject({ subtotal: 3500, total: 3500, count: 5 });
    c = cartReducer(c, { type: 'setQty', productId: 'a', qty: 0 });
    expect(c.lines.map((l) => l.productId)).toEqual(['b']);
  });

  it('clamps discount to subtotal, also after removing lines', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('b', 9000) });
    c = cartReducer(c, { type: 'discount', amount: 99999 });
    expect(c.discount).toBe(10000);
    c = cartReducer(c, { type: 'remove', productId: 'b' });
    expect(c.discount).toBe(1000);
    c = cartReducer(c, { type: 'discount', amount: -5 });
    expect(c.discount).toBe(0);
  });

  it('suggests cash amounts >= total, ascending, exact first', () => {
    const s = cashSuggestions(37000);
    expect(s[0]).toBe(37000);
    expect(s).toContain(40000);
    expect(s).toContain(50000);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
    expect(s.every((v) => v >= 37000)).toBe(true);
  });
});

describe('fold', () => {
  it('strips Vietnamese diacritics for search', () => {
    expect(fold('Cà phê Đen')).toBe('ca phe den');
  });
});
