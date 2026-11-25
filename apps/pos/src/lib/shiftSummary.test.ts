import { describe, expect, it } from 'vitest';
import { buildShiftSummary } from './shiftSummary';
import { defaultSettings } from './settings';
import type { LocalOrder } from './types';

const order = (o: Partial<LocalOrder>): LocalOrder => ({
  id: Math.random().toString(36), number: '1', deviceId: 'd', shiftId: 'sh1', cashierId: 'u', cashier: 'Kim', orderType: 'dine_in', tableName: '', note: '',
  items: [], subtotal: 0, discount: 0, total: 0, paymentMethod: 'cash', paid: 0, change: 0, createdAt: '2026-11-23T03:00:00Z', status: 'completed', sync: 'synced', ...o,
});

describe('buildShiftSummary', () => {
  const orders = [
    order({ items: [{ productId: 'a', name: 'Cơm trắng sườn', price: 50000, qty: 2, lineTotal: 100000 }, { productId: 'b', name: 'Trà đá', price: 5000, qty: 1, lineTotal: 5000 }], subtotal: 105000, discount: 5000, total: 100000 }),
    order({ items: [{ productId: 'a', name: 'Cơm trắng sườn', price: 50000, qty: 1, lineTotal: 50000 }], subtotal: 50000, total: 50000, paymentMethod: 'transfer' }),
    order({ items: [{ productId: 'b', name: 'Trà đá', price: 5000, qty: 9, lineTotal: 45000 }], subtotal: 45000, total: 45000, status: 'voided' }),
    order({ items: [{ productId: 'a', name: 'Cơm trắng sườn', price: 50000, qty: 1, lineTotal: 50000 }], subtotal: 50000, total: 50000, status: 'refunded' }),
    order({ shiftId: 'other', items: [{ productId: 'a', name: 'Cơm trắng sườn', price: 50000, qty: 5, lineTotal: 250000 }], subtotal: 250000, total: 250000 }),
  ];
  const r = buildShiftSummary(orders, { id: 'sh1', openedAt: '2026-11-23T01:00:00Z', cashierName: 'Kim' }, { ...defaultSettings(), storeName: 'Quán' }, true);
  const row = (label: string) => r.summary!.rows.find((x) => x.label.startsWith(label))?.value;

  it('lists every sold item once, only from completed orders of this shift', () => {
    expect(r.lines.map((l) => [l.name, l.qty, l.lineTotal])).toEqual([
      ['Cơm trắng sườn', 3, 150000],
      ['Trà đá', 1, 5000],
    ]);
  });

  it('totals revenue after discounts, excluding voided and refunded orders', () => {
    expect(r.total).toBe(150000);
    expect(row('TỔNG DOANH THU')).toBe((150000).toLocaleString('vi-VN'));
    expect(row('Tiền mặt')).toBe((100000).toLocaleString('vi-VN'));
    expect(row('Chuyển khoản')).toBe((50000).toLocaleString('vi-VN'));
    expect(row('Giảm giá')).toBe(`-${(5000).toLocaleString('vi-VN')}`);
    expect(row('Đơn huỷ (1)')).toBeDefined();
    expect(row('Đơn hoàn tiền (1)')).toBeDefined();
    expect(row('Số đơn')).toBe('2');
  });
});
