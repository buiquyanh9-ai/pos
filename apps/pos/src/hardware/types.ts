// Hardware contract for ShopFlow POS.
// Every device integration (printer, scanner, cash drawer) implements one of these
// interfaces. Core POS code only talks to these interfaces, never to a vendor SDK,
// so the app works with no hardware at all (mock drivers) and new devices can be
// added as separate drivers without touching the sale flow.

export interface ReceiptLine {
  name: string;
  qty: number;
  price: number; // unit price, integer VND
  lineTotal: number; // integer VND
  note?: string; // e.g. "Ít đá"
}

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  orderId: string;
  orderNumber: string; // short human-readable number
  createdAt: string; // ISO timestamp
  cashier?: string;
  deviceName?: string;
  /** Already localized, e.g. "Tại quán" / "Mang về". */
  orderTypeLabel?: string;
  tableName?: string;
  note?: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  paid: number;
  change: number;
  footer?: string;
}

export interface PrinterDriver {
  readonly id: string;
  readonly name: string;
  /** Resolves true if this driver can be used on the current device/runtime. */
  isAvailable(): Promise<boolean>;
  printReceipt(receipt: ReceiptData): Promise<void>;
}

export type ScanHandler = (code: string) => void;

export interface ScannerDriver {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  /** Begin delivering scanned codes to the handler. Must be safe to call twice. */
  start(onScan: ScanHandler): void;
  stop(): void;
}

export interface CashDrawerDriver {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  open(): Promise<void>;
}

/** Settings a driver may need. Stored in POS settings, editable on the Settings screen. */
export interface HardwareSettings {
  printer: string; // driver id
  scanner: string; // driver id
  drawer: string; // driver id
  /** Network ESC/POS printer address, e.g. "192.168.1.50:9100" (used by escpos-network). */
  printerAddress?: string;
  /** Characters per line on the receipt (58mm ≈ 32, 80mm ≈ 48). */
  paperWidthChars?: number;
}
