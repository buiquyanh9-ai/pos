import { registerDrawer, registerPrinter, registerScanner } from './registry';
import { browserPrinter } from './drivers/browser-print';
import { escposNetworkDrawer, escposNetworkPrinter } from './drivers/escpos-network';
import { escposUsbDrawer, escposUsbPrinter } from './drivers/escpos-usb';
import { keyboardWedgeScanner } from './drivers/keyboard-wedge';
import { sunmiDrawer, sunmiPrinter } from './drivers/sunmi';

registerPrinter(browserPrinter);
registerPrinter(escposUsbPrinter);
registerPrinter(escposNetworkPrinter);
registerPrinter(sunmiPrinter);
registerScanner(keyboardWedgeScanner);
registerDrawer(escposUsbDrawer);
registerDrawer(escposNetworkDrawer);
registerDrawer(sunmiDrawer);

export * from './registry';
export type * from './types';
