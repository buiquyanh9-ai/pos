import type { CashDrawerDriver, HardwareSettings, PrinterDriver, ScannerDriver } from './types';
import { mockDrawer, mockPrinter, mockScanner } from './drivers/mock';

// Driver registry. To add a device: implement the interface in ./drivers/<name>.ts
// and register it here. Unknown or unavailable ids fall back to the mock driver,
// so a wrong setting can never block a sale.

const printers: PrinterDriver[] = [mockPrinter];
const scanners: ScannerDriver[] = [mockScanner];
const drawers: CashDrawerDriver[] = [mockDrawer];

export function registerPrinter(d: PrinterDriver) {
  if (!printers.some((p) => p.id === d.id)) printers.push(d);
}
export function registerScanner(d: ScannerDriver) {
  if (!scanners.some((p) => p.id === d.id)) scanners.push(d);
}
export function registerDrawer(d: CashDrawerDriver) {
  if (!drawers.some((p) => p.id === d.id)) drawers.push(d);
}

export const listPrinters = () => [...printers];
export const listScanners = () => [...scanners];
export const listDrawers = () => [...drawers];

export function getPrinter(s: HardwareSettings): PrinterDriver {
  return printers.find((p) => p.id === s.printer) ?? mockPrinter;
}
export function getScanner(s: HardwareSettings): ScannerDriver {
  return scanners.find((p) => p.id === s.scanner) ?? mockScanner;
}
export function getDrawer(s: HardwareSettings): CashDrawerDriver {
  return drawers.find((p) => p.id === s.drawer) ?? mockDrawer;
}

export const defaultHardwareSettings: HardwareSettings = {
  printer: 'mock',
  scanner: 'none',
  drawer: 'mock',
  paperWidthChars: 32,
};
