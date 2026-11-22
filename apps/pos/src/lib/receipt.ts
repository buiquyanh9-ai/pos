import type { ReceiptData } from '../hardware/types';
import { getDrawer, getPrinter } from '../hardware';
import type { PosSettings } from './settings';
import type { LocalOrder } from './types';
import { notify } from './notify';

export function buildReceipt(o: LocalOrder, s: PosSettings): ReceiptData {
  return {
    storeName: s.storeName,
    storeAddress: s.storeAddress || undefined,
    orderId: o.id,
    orderNumber: o.number,
    createdAt: o.createdAt,
    cashier: o.cashier || undefined,
    deviceName: s.deviceName,
    lines: o.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, lineTotal: i.lineTotal })),
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    paymentMethod: o.paymentMethod,
    paid: o.paid,
    change: o.change,
    footer: s.receiptFooter || undefined,
  };
}

/** Hardware failures never undo a sale: they are reported and the cashier can reprint. */
export async function printReceipt(o: LocalOrder, s: PosSettings) {
  try {
    await getPrinter(s.hardware).printReceipt(buildReceipt(o, s));
  } catch (err) {
    notify(`In hoá đơn lỗi: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

export async function openDrawer(s: PosSettings) {
  try {
    await getDrawer(s.hardware).open();
  } catch (err) {
    notify(`Mở két lỗi: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
