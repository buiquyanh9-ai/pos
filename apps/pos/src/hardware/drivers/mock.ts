import type { CashDrawerDriver, PrinterDriver, ReceiptData, ScannerDriver, ScanHandler } from '../types';
import { notify } from '../../lib/notify';

// Mock drivers: always available, used for development without any POS hardware.

export const mockPrinter: PrinterDriver = {
  id: 'mock',
  name: 'Mock printer (console)',
  async isAvailable() {
    return true;
  },
  async printReceipt(receipt: ReceiptData) {
    console.info('[mock-printer] receipt', receipt);
    notify(receipt.summary ? `Đã "in" ${receipt.summary.title.toLowerCase()} (mock)` : `Đã "in" hoá đơn ${receipt.orderNumber} (mock)`);
  },
};

export const mockScanner: ScannerDriver = {
  id: 'none',
  name: 'Không dùng máy quét',
  async isAvailable() {
    return true;
  },
  start(_onScan: ScanHandler) {},
  stop() {},
};

export const mockDrawer: CashDrawerDriver = {
  id: 'mock',
  name: 'Mock cash drawer (console)',
  async isAvailable() {
    return true;
  },
  async open() {
    console.info('[mock-drawer] open');
    notify('Mở két tiền (mock)');
  },
};
