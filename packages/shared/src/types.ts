// Shapes returned by the ShopFlow API v2 (see docs/SYNC.md) plus POS-local types.

export type Role = 'owner' | 'cashier';
export const ROLE_LABEL: Record<Role, string> = { owner: 'Chủ cửa hàng', cashier: 'Thu ngân' };

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
}

export interface Option {
  id: string;
  name: string;
  priceDelta: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  multi: boolean;
  required: boolean;
  options: Option[];
}

export interface Category {
  id: string;
  name: string;
  sort: number;
  color: string;
}

export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  category: string;
  imageUrl: string | null;
  price: number;
  /** Optional manual unit cost entered by the owner (null = unknown). */
  cost: number | null;
  active: boolean;
  optionGroups: OptionGroup[];
  /** Menu grid position inside its category: 5 columns per row (null = auto-place). */
  gridRow?: number | null;
  gridCol?: number | null;
  updatedAt: string;
}

export interface DiningTable {
  id: string;
  name: string;
  area: string;
  sort: number;
}

export type PaymentMethod = 'cash' | 'transfer' | 'card';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

/** Methods offered at the counter (a QR payment is a bank transfer). Card stays valid for old orders. */
export const COUNTER_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'transfer'];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  card: 'Thẻ',
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in: 'Tại quán',
  takeaway: 'Mang về',
  delivery: 'Giao hàng',
};

export interface OrderItem {
  productId: string | null;
  name: string;
  /** Unit price including option surcharges. */
  price: number;
  qty: number;
  lineTotal: number;
  note?: string;
  /** Human-readable chosen options, e.g. "L, Ít đá". */
  options?: string;
  /** Chosen option ids (kept on the order line). */
  optionIds?: string[];
}

export type OrderStatus = 'completed' | 'voided' | 'refunded';
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { completed: 'Hoàn tất', voided: 'Đã huỷ', refunded: 'Đã hoàn tiền' };

export interface LocalOrder {
  id: string;
  number: string;
  deviceId: string;
  shiftId: string | null;
  cashierId: string | null;
  cashier: string;
  orderType: OrderType;
  tableName: string;
  note: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paid: number;
  change: number;
  createdAt: string;
  status: OrderStatus;
  statusReason?: string;
  /** Upload state of this order to the backend. */
  sync: 'pending' | 'synced' | 'rejected';
  syncError?: string;
}

export interface Shift {
  id: string;
  deviceId: string;
  cashierId: string;
  cashierName?: string;
  status: 'open' | 'closed';
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  note: string;
}

export interface Bucket {
  revenue: number;
  orders: number;
}

export interface Summary {
  from: string;
  to: string;
  orderCount: number;
  itemsSold: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  refundCount: number;
  netRevenue: number;
  avgOrderValue: number;
  voidedCount: number;
  voidedAmount: number;
  hasCostData: boolean;
  /** Share of sales (0..1) with a known cost; profit is an estimate when < 1. */
  costCoverage: number;
  costOfGoods: number | null;
  grossProfit: number | null;
  /** byMethod: net revenue of the hour per payment method (cash, transfer, card). */
  byHour: (Bucket & { hour: number; byMethod?: Record<string, number> })[];
  byDay: (Bucket & { date: string })[];
  byPayment: (Bucket & { method: string })[];
  byOrderType: (Bucket & { orderType: string })[];
  byCashier: (Bucket & { cashierId: string | null; name: string })[];
  byCategory: { category: string; revenue: number; qty: number }[];
  topProducts: { productId: string | null; name: string; category: string; qty: number; revenue: number }[];
}

/** A table's running (unpaid) bill, shared by all terminals and shown in Boss. */
export interface OpenOrder<C = unknown> {
  id: string;
  deviceId: string;
  tableName: string;
  orderType: string;
  note: string;
  itemCount: number;
  total: number;
  cart: C;
  cashierId: string | null;
  cashierName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftReport {
  shift: Shift;
  summary: Summary;
}
