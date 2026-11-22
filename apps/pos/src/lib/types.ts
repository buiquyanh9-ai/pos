// Shapes returned by the ShopFlow API v2 (see docs/SYNC.md) plus POS-local types.

export type Role = 'owner' | 'cashier' | 'stock';
export const ROLE_LABEL: Record<Role, string> = { owner: 'Chủ cửa hàng', cashier: 'Thu ngân', stock: 'Nhân viên kho' };

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
  cost: number | null;
  /** Portions that can still be made from stock (from the recipe). null = stock not tracked. */
  stock: number | null;
  active: boolean;
  optionGroups: OptionGroup[];
  updatedAt: string;
}

export interface DiningTable {
  id: string;
  name: string;
  area: string;
  sort: number;
}

export type PaymentMethod = 'cash' | 'transfer' | 'qr' | 'card';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  qr: 'QR',
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

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  kind: 'ingredient' | 'goods';
  qty: number;
  minQty: number;
  unitCost: number;
  supplierId: string | null;
  active: boolean;
  low: boolean;
  updatedAt: string;
}

export type MoveType = 'sale' | 'void' | 'refund' | 'import' | 'adjust' | 'count';
export const MOVE_TYPE_LABEL: Record<MoveType, string> = {
  sale: 'Bán hàng',
  void: 'Huỷ đơn',
  refund: 'Hoàn tiền',
  import: 'Nhập hàng',
  adjust: 'Điều chỉnh',
  count: 'Kiểm kê',
};

export interface StockMove {
  id: number;
  itemId: string;
  itemName?: string;
  unit?: string;
  type: MoveType;
  qtyDelta: number;
  qtyAfter: number;
  refType: string | null;
  refId: string | null;
  userName: string | null;
  reason: string;
  at: string;
}

export interface StocktakeLine {
  itemId: string;
  name: string;
  unit: string;
  expected: number;
  counted: number;
  diff: number;
  diffValue: number;
  reason: string;
}

export interface Stocktake {
  id: string;
  shiftId: string | null;
  userName: string | null;
  note: string;
  createdAt: string;
  lines: StocktakeLine[];
  varianceCount: number;
  varianceValue: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  note: string;
}

export type PurchaseStatus = 'pending' | 'approved' | 'rejected' | 'received';
export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  received: 'Đã nhập kho',
};

export interface PurchaseLine {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  receivedQty: number | null;
  currentStock: number;
  minQty: number;
}

export interface Purchase {
  id: string;
  status: PurchaseStatus;
  supplierId: string | null;
  supplierName: string | null;
  note: string;
  decisionNote: string;
  createdBy: string | null;
  decidedBy: string | null;
  receivedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  lines: PurchaseLine[];
  totalCost: number;
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
  costOfGoods: number | null;
  grossProfit: number | null;
  byHour: (Bucket & { hour: number })[];
  byDay: (Bucket & { date: string })[];
  byPayment: (Bucket & { method: string })[];
  byOrderType: (Bucket & { orderType: string })[];
  byCashier: (Bucket & { cashierId: string | null; name: string })[];
  byCategory: { category: string; revenue: number; qty: number }[];
  topProducts: { productId: string | null; name: string; category: string; qty: number; revenue: number }[];
}

export interface ShiftReport {
  shift: Shift;
  summary: Summary;
  stocktakes: { id: string; createdAt: string }[];
}
