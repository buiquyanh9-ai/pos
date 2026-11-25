import { describe, expect, it } from 'vitest';
import { cartReducer, cashSuggestions, emptyCart, totalsOf } from './cart';
import { fold } from './format';
import type { Product } from './types';

const p = (id: string, price: number): Product => ({
  id, sku: id, barcode: null, name: id, categoryId: null, category: '', imageUrl: null, price, cost: null, active: true, optionGroups: [], updatedAt: '',
});

describe('cart', () => {
  it('adds, merges and removes lines', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('b', 500), qty: 3 });
    expect(c.lines).toHaveLength(2);
    expect(totalsOf(c)).toMatchObject({ subtotal: 3500, total: 3500, count: 5 });
    c = cartReducer(c, { type: 'setQty', key: 'a::', qty: 0 });
    expect(c.lines.map((l) => l.productId)).toEqual(['b']);
  });

  it('clamps discount to subtotal, also after removing lines', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('b', 9000) });
    c = cartReducer(c, { type: 'discount', amount: 99999 });
    expect(c.discount).toBe(10000);
    c = cartReducer(c, { type: 'remove', key: 'b::' });
    expect(c.discount).toBe(1000);
    c = cartReducer(c, { type: 'discount', amount: -5 });
    expect(c.discount).toBe(0);
  });

  it('keeps same product with different notes as separate lines and merges on equal note', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 1000) });
    c = cartReducer(c, { type: 'add', product: p('a', 1000), note: 'Ít đá' });
    expect(c.lines).toHaveLength(2);
    c = cartReducer(c, { type: 'setNote', key: 'a::', note: 'Ít đá' });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ qty: 2, note: 'Ít đá' });
  });

  it('options change the unit price and split lines', () => {
    const L = { groupId: 'g-size', optionId: 'L', name: 'L', priceDelta: 6000 };
    let c = cartReducer(emptyCart, { type: 'add', product: p('a', 20000), options: [L] });
    c = cartReducer(c, { type: 'add', product: p('a', 20000) });
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0].price).toBe(26000);
    expect(totalsOf(c).subtotal).toBe(46000);
  });

  it('clears table when switching away from dine-in', () => {
    let c = cartReducer(emptyCart, { type: 'table', tableName: ' B5 ' });
    expect(c.tableName).toBe('B5');
    c = cartReducer(c, { type: 'orderType', orderType: 'takeaway' });
    expect(c.tableName).toBe('');
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
