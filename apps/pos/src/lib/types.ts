export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  category: string;
  price: number;
  stock: number;
  active: boolean;
  updatedAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export interface OrderItem {
  productId: string | null;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
}

export interface LocalOrder {
  id: string;
  number: string;
  deviceId: string;
  cashier: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paid: number;
  change: number;
  createdAt: string;
  status: 'completed' | 'voided';
  /** Upload state of this order to the backend. */
  sync: 'pending' | 'synced' | 'rejected';
  syncError?: string;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  card: 'Thẻ',
  transfer: 'Chuyển khoản',
};
