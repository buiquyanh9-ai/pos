import type { CashDrawerDriver, PrinterDriver, ReceiptData } from '../types';
import { printableText } from '../escpos';

type SunmiBridge = { printText?: (text: string) => void | Promise<void>; lineWrap?: (count: number) => void | Promise<void>; openDrawer?: () => void | Promise<void> };
function bridge(): SunmiBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as Window & { SunmiPrinterService?: SunmiBridge; sunmiPrinter?: SunmiBridge }).SunmiPrinterService ?? (window as Window & { sunmiPrinter?: SunmiBridge }).sunmiPrinter;
  return candidate?.printText ? candidate : undefined;
}
function receiptText(r: ReceiptData): string {
  return [r.storeName, r.storeAddress, `Order ${r.orderNumber}`, '------------------------------', ...r.lines.flatMap((i) => [`${i.qty} x ${printableText(i.name)}`, `             ${i.lineTotal.toLocaleString('en-US')}`]), '------------------------------', `TOTAL       ${r.total.toLocaleString('en-US')}`, `Payment: ${r.paymentMethod}`, r.footer, ''].filter(Boolean).join('\n');
}

export const sunmiPrinter: PrinterDriver = {
  id: 'sunmi', name: 'SUNMI printer (tuỳ chọn)',
  async isAvailable() { return Boolean(bridge()); },
  async printReceipt(receipt: ReceiptData) { const b = bridge(); if (!b?.printText) throw new Error('Không tìm thấy SUNMI printer bridge'); await b.printText(receiptText(receipt)); await b.lineWrap?.(3); },
};
export const sunmiDrawer: CashDrawerDriver = {
  id: 'sunmi', name: 'SUNMI cash drawer (tuỳ chọn)',
  async isAvailable() { return Boolean(bridge()?.openDrawer); },
  async open() { const b = bridge(); if (!b?.openDrawer) throw new Error('Không tìm thấy SUNMI cash drawer bridge'); await b.openDrawer(); },
};
