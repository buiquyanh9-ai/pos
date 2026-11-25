import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CashDrawerDriver, PrinterDriver, ReceiptData } from '../types';
import { encodeReceipt, openCashDrawerPulse, toBase64 } from '../escpos';
import { getState } from '../../lib/store';

// Receipt printer plugged into the POS terminal's USB port (e.g. RICHTA RI-58A on a SUNMI T1).
// The Android app sends ESC/POS bytes straight to the printer (UsbPrinterPlugin.java), so printing
// and the cash drawer (wired to the printer's DK port) work without the server or a laptop.

export interface UsbDeviceInfo { name: string; vendorId: number; productId: number; printer: boolean; printerClass: boolean; permission: boolean }
interface UsbPrinterPlugin {
  list(): Promise<{ devices: UsbDeviceInfo[] }>;
  write(options: { data: string }): Promise<{ bytes: number }>;
}
const UsbPrinter = registerPlugin<UsbPrinterPlugin>('UsbPrinter');

const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('UsbPrinter');

export async function listUsbDevices(): Promise<UsbDeviceInfo[]> {
  if (!native()) return [];
  return (await UsbPrinter.list()).devices;
}

async function send(data: Uint8Array) {
  if (!native()) throw new Error('Máy in USB chỉ dùng được trong app Android');
  await UsbPrinter.write({ data: toBase64(data) });
}

export const escposUsbPrinter: PrinterDriver = {
  id: 'escpos-usb', name: 'Máy in ESC/POS cắm USB',
  async isAvailable() { return native(); },
  async printReceipt(receipt: ReceiptData) { await send(encodeReceipt(receipt, getState().settings.hardware?.paperWidthChars)); },
};

export const escposUsbDrawer: CashDrawerDriver = {
  id: 'escpos-usb', name: 'Két tiền cắm vào máy in USB',
  async isAvailable() { return native(); },
  async open() { await send(openCashDrawerPulse()); },
};
