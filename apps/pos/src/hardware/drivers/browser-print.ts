import type { PrinterDriver, ReceiptData } from '../types';
import { Capacitor } from '@capacitor/core';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export const browserPrinter: PrinterDriver = {
  id: 'browser-print',
  name: 'In qua trình duyệt',
  async isAvailable() {
    return !Capacitor.isNativePlatform() && typeof window !== 'undefined' && typeof window.print === 'function';
  },
  async printReceipt(receipt: ReceiptData) {
    if (!(await this.isAvailable())) throw new Error('Trình duyệt không hỗ trợ in');
    const settings = (() => { try { return JSON.parse(localStorage.getItem('shopflow.settings') ?? '{}') as { hardware?: { paperWidthChars?: number } }; } catch { return {}; } })();
    const wide = (settings.hardware?.paperWidthChars ?? 32) >= 40;
    const width = wide ? '80mm' : '58mm';
    const lines = receipt.lines.map((item) => `<div class="row"><span>${item.qty} x ${escapeHtml(item.name)}</span><span>${item.lineTotal.toLocaleString('en-US')}</span></div>`).join('');
    const popup = window.open('', '_blank', 'popup,width=420,height=700');
    if (!popup) throw new Error('Trình duyệt đã chặn cửa sổ in');
    const payment = { cash: 'Tiền mặt', card: 'Thẻ', transfer: 'Chuyển khoản' }[receipt.paymentMethod];
    popup.document.write(`<!doctype html><html><head><title>Receipt ${escapeHtml(receipt.orderNumber)}</title><style>@page{size:${width} auto;margin:3mm}*{box-sizing:border-box}body{font:12px monospace;width:${width};margin:auto;color:#000}.center{text-align:center}.bold{font-weight:700}.row{display:flex;justify-content:space-between;gap:8px;margin:5px 0}.rule{border-top:1px dashed #000;margin:8px 0}.total{font-size:16px}</style></head><body><div class="center bold">${escapeHtml(receipt.storeName)}</div>${receipt.storeAddress ? `<div class="center">${escapeHtml(receipt.storeAddress)}</div>` : ''}<div class="center">Đơn ${escapeHtml(receipt.orderNumber)}</div><div class="rule"></div>${lines}<div class="rule"></div><div class="row"><span>Tạm tính</span><span>${receipt.subtotal.toLocaleString('en-US')}</span></div>${receipt.discount ? `<div class="row"><span>Giảm giá</span><span>-${receipt.discount.toLocaleString('en-US')}</span></div>` : ''}<div class="row bold total"><span>TỔNG</span><span>${receipt.total.toLocaleString('en-US')}</span></div><div class="row"><span>Thanh toán</span><span>${payment}</span></div>${receipt.paymentMethod === 'cash' ? `<div class="row"><span>Khách đưa</span><span>${receipt.paid.toLocaleString('en-US')}</span></div><div class="row"><span>Tiền thối</span><span>${receipt.change.toLocaleString('en-US')}</span></div>` : ''}<div class="center">${escapeHtml(receipt.footer ?? '')}</div></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
    popup.close();
  },
};
