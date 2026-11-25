import type { ReceiptData, ReceiptLine } from '../hardware/types';
import { getPrinter } from '../hardware';
import { notify } from './notify';
import type { PosSettings } from './settings';
import { getState } from './store';
import type { LocalOrder } from './types';

// End-of-shift sales slip printed at logout: every item sold in the shift with totals.
// Built from this device's orders (a shift belongs to one device), so it also works offline.

export interface SummaryShift {
  id: string;
  openedAt: string;
  closedAt?: string | null;
  cashierName?: string;
}

const vnd = (n: number) => n.toLocaleString('vi-VN');
const hm = (iso: string) => new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

export function buildShiftSummary(orders: LocalOrder[], shift: SummaryShift, s: PosSettings, closed: boolean, now = new Date()): ReceiptData {
  const who = shift.cashierName || getState().session?.user.name || '';
  const mine = orders.filter((o) => o.shiftId === shift.id);
  const sold = mine.filter((o) => o.status === 'completed');
  const voided = mine.filter((o) => o.status === 'voided');
  const refunded = mine.filter((o) => o.status === 'refunded');

  // Same dish (and same options) on one line, best sellers first.
  const byItem = new Map<string, ReceiptLine>();
  for (const o of sold) {
    for (const i of o.items) {
      const name = i.options ? `${i.name} (${i.options})` : i.name;
      const l = byItem.get(name) ?? { name, qty: 0, price: i.price, lineTotal: 0 };
      l.qty += i.qty;
      l.lineTotal += i.lineTotal;
      l.price = l.qty ? Math.round(l.lineTotal / l.qty) : i.price;
      byItem.set(name, l);
    }
  }
  const lines = [...byItem.values()].sort((a, b) => b.qty - a.qty || b.lineTotal - a.lineTotal);

  const sum = (list: LocalOrder[], f: (o: LocalOrder) => number) => list.reduce((a, o) => a + f(o), 0);
  const subtotal = sum(sold, (o) => o.subtotal);
  const discount = sum(sold, (o) => o.discount);
  const total = sum(sold, (o) => o.total);
  const cash = sum(sold.filter((o) => o.paymentMethod === 'cash'), (o) => o.total);
  const transfer = sum(sold.filter((o) => o.paymentMethod !== 'cash'), (o) => o.total);
  const pending = mine.filter((o) => o.sync === 'pending').length;

  const rows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Số đơn', value: String(sold.length) },
    { label: 'Số món bán ra', value: String(lines.reduce((a, l) => a + l.qty, 0)) },
    { label: 'Tiền hàng', value: vnd(subtotal) },
    ...(discount ? [{ label: 'Giảm giá', value: `-${vnd(discount)}` }] : []),
    ...(voided.length ? [{ label: `Đơn huỷ (${voided.length})`, value: vnd(sum(voided, (o) => o.total)) }] : []),
    ...(refunded.length ? [{ label: `Đơn hoàn tiền (${refunded.length})`, value: vnd(sum(refunded, (o) => o.total)) }] : []),
    { label: 'Tiền mặt', value: vnd(cash) },
    { label: 'Chuyển khoản / QR', value: vnd(transfer) },
    { label: 'TỔNG DOANH THU', value: vnd(total), bold: true },
    ...(pending ? [{ label: 'Đơn chưa gửi máy chủ', value: String(pending) }] : []),
  ];

  return {
    storeName: s.storeName,
    storeAddress: s.storeAddress || undefined,
    orderId: shift.id,
    orderNumber: closed ? 'TỔNG KẾT CA' : 'TỔNG KẾT (CA CHƯA ĐÓNG)',
    createdAt: now.toISOString(),
    cashier: who || undefined,
    deviceName: s.deviceName,
    note: `Ca ${who}: ${hm(shift.openedAt)} → ${closed && shift.closedAt ? hm(shift.closedAt) : hm(now.toISOString())}`,
    lines,
    subtotal,
    discount,
    total,
    paymentMethod: 'cash',
    paid: total,
    change: 0,
    summary: { title: closed ? 'TỔNG KẾT CA' : 'TỔNG KẾT BÁN HÀNG (CA CHƯA ĐÓNG)', rows },
  };
}

/** Print the slip for a shift. Printer problems are reported but never block logging out. */
export async function printShiftSummary(shift: SummaryShift, closed: boolean) {
  const st = getState();
  try {
    await getPrinter(st.settings.hardware).printReceipt(buildShiftSummary(st.orders, shift, st.settings, closed));
  } catch (err) {
    notify(`In phiếu tổng kết lỗi: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
