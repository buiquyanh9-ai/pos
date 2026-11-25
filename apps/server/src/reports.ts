import type { DB, Row } from './db.ts';

// Revenue rules (see docs/SYNC.md):
// - Sales are counted at sale time (orders.created_at) for orders that are completed or refunded.
// - Voided orders (cancelled before money changed hands) are excluded from revenue, reported separately.
// - Refunds are counted at refund time (orders.status_at), so a refund today of yesterday's sale
//   lowers today's net revenue, matching the cash drawer.
// - Net revenue = sales total (after discount) - refunds. Profit = net - cost of goods, only when
//   every sold line has a known unit cost (hasCostData).

export interface ReportQuery {
  from: string; // ISO, inclusive
  to: string; // ISO, exclusive
  tzOffsetMin?: number; // local offset for hour/day buckets, default +420 (Vietnam)
  shiftId?: string;
  cashierId?: string;
  deviceId?: string;
}

interface Bucket {
  revenue: number;
  orders: number;
}

function filters(q: ReportQuery, timeCol: string) {
  const where = [`o.${timeCol} >= ?`, `o.${timeCol} < ?`];
  const params: string[] = [q.from, q.to];
  if (q.shiftId) (where.push('o.shift_id = ?'), params.push(q.shiftId));
  if (q.cashierId) (where.push('o.cashier_id = ?'), params.push(q.cashierId));
  if (q.deviceId) (where.push('o.device_id = ?'), params.push(q.deviceId));
  return { where: where.join(' AND '), params };
}

const localDate = (iso: string, tz: number) => new Date(new Date(iso).getTime() + tz * 60_000);

export function summarize(db: DB, q: ReportQuery) {
  const tz = q.tzOffsetMin ?? 420;
  const sales = filters(q, 'created_at');
  const sold = db
    .prepare(`SELECT o.* FROM orders o WHERE ${sales.where} AND o.status IN ('completed','refunded')`)
    .all(...sales.params);
  const voided = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.total),0) AS amount FROM orders o WHERE ${sales.where} AND o.status = 'voided'`)
    .get(...sales.params)!;
  const ref = filters(q, 'status_at');
  const refunded = db.prepare(`SELECT o.* FROM orders o WHERE ${ref.where} AND o.status = 'refunded'`).all(...ref.params);

  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const cashierNames = new Map(
    db.prepare('SELECT id, name FROM users').all().map((r) => [r.id as string, r.name as string] as [string, string]),
  );

  let gross = 0;
  let discounts = 0;
  let salesTotal = 0;
  let itemsSold = 0;
  let cogs = 0;
  let hasCostData = true;
  let costedSales = 0; // sales total of orders whose cost is known
  const byHour: (Bucket & { byMethod: Record<string, number> })[] = Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0, byMethod: {} }));
  const addMethod = (hour: number, method: string, amount: number) => {
    byHour[hour].byMethod[method] = (byHour[hour].byMethod[method] ?? 0) + amount;
  };
  const byDay = new Map<string, Bucket>();
  const byPayment = new Map<string, Bucket>();
  const byOrderType = new Map<string, Bucket>();
  const byCashier = new Map<string, Bucket & { name: string }>();
  const byCategory = new Map<string, { revenue: number; qty: number }>();
  const byProduct = new Map<string, { productId: string | null; name: string; category: string; qty: number; revenue: number }>();

  const add = <K>(m: Map<K, Bucket>, k: K, revenue: number, orders: number) => {
    const b = m.get(k) ?? { revenue: 0, orders: 0 };
    b.revenue += revenue;
    b.orders += orders;
    m.set(k, b);
  };

  for (const o of sold) {
    const total = Number(o.total);
    gross += Number(o.subtotal);
    discounts += Number(o.discount);
    salesTotal += total;
    if (o.cost_total === null || o.cost_total === undefined) hasCostData = false;
    else {
      cogs += Number(o.cost_total);
      costedSales += total;
    }
    const local = localDate(o.created_at as string, tz);
    byHour[local.getUTCHours()].revenue += total;
    byHour[local.getUTCHours()].orders += 1;
    addMethod(local.getUTCHours(), o.payment_method as string, total);
    add(byDay, local.toISOString().slice(0, 10), total, 1);
    add(byPayment, o.payment_method as string, total, 1);
    add(byOrderType, o.order_type as string, total, 1);
    const cid = (o.cashier_id as string | null) ?? '';
    const c = byCashier.get(cid) ?? { revenue: 0, orders: 0, name: cashierNames.get(cid) ?? ((o.cashier as string) || 'Không rõ') };
    c.revenue += total;
    c.orders += 1;
    byCashier.set(cid, c);

    // Spread the order discount over its lines proportionally so category/product revenue sums to net sales.
    const sub = Number(o.subtotal);
    const factor = sub > 0 ? total / sub : 0;
    for (const it of itemsStmt.all(o.id as string)) {
      const qty = Number(it.qty);
      const rev = Math.round(Number(it.line_total) * factor);
      itemsSold += qty;
      const cat = (it.category as string) || 'Khác';
      const cb = byCategory.get(cat) ?? { revenue: 0, qty: 0 };
      cb.revenue += rev;
      cb.qty += qty;
      byCategory.set(cat, cb);
      const key = (it.product_id as string | null) ?? `name:${it.name}`;
      const pb = byProduct.get(key) ?? { productId: (it.product_id as string | null) ?? null, name: it.name as string, category: cat, qty: 0, revenue: 0 };
      pb.qty += qty;
      pb.revenue += rev;
      byProduct.set(key, pb);
    }
  }

  let refunds = 0;
  let refundedCost = 0;
  for (const o of refunded) {
    const amount = Number(o.refund_amount);
    refunds += amount;
    if (o.cost_total !== null && o.cost_total !== undefined && amount >= Number(o.total)) refundedCost += Number(o.cost_total);
    const local = localDate(o.status_at as string, tz);
    byHour[local.getUTCHours()].revenue -= amount;
    addMethod(local.getUTCHours(), o.payment_method as string, -amount);
    add(byDay, local.toISOString().slice(0, 10), -amount, 0);
    add(byPayment, o.payment_method as string, -amount, 0);
  }

  const net = salesTotal - refunds;
  const orderCount = sold.length;
  const cogsNet = cogs - refundedCost;
  const sortDesc = <T extends { revenue: number }>(a: T, b: T) => b.revenue - a.revenue;

  return {
    from: q.from,
    to: q.to,
    tzOffsetMin: tz,
    orderCount,
    itemsSold,
    grossSales: gross,
    discounts,
    refunds,
    refundCount: refunded.length,
    netRevenue: net,
    avgOrderValue: orderCount ? Math.round(salesTotal / orderCount) : 0,
    voidedCount: Number(voided.n),
    voidedAmount: Number(voided.amount),
    hasCostData: hasCostData && orderCount > 0,
    /** Share of sales (0..1) whose cost is known. Profit below 1 is an estimate over that share. */
    costCoverage: salesTotal > 0 ? Math.round((costedSales / salesTotal) * 1000) / 1000 : 0,
    costOfGoods: costedSales > 0 ? cogsNet : null,
    grossProfit: costedSales > 0 ? (hasCostData ? net - cogsNet : costedSales - cogs) : null,
    byHour: byHour.map((b, hour) => ({ hour, ...b })),
    byDay: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
    byPayment: [...byPayment].map(([method, b]) => ({ method, ...b })).sort(sortDesc),
    byOrderType: [...byOrderType].map(([orderType, b]) => ({ orderType, ...b })).sort(sortDesc),
    byCashier: [...byCashier].map(([cashierId, b]) => ({ cashierId: cashierId || null, ...b })).sort(sortDesc),
    byCategory: [...byCategory].map(([category, b]) => ({ category, ...b })).sort(sortDesc),
    topProducts: [...byProduct.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 20),
  };
}

export type Summary = ReturnType<typeof summarize>;

/** Summary plus the same-length period right before it, with percentage changes. */
export function summarizeWithCompare(db: DB, q: ReportQuery) {
  const current = summarize(db, q);
  const len = new Date(q.to).getTime() - new Date(q.from).getTime();
  const prevQ = { ...q, from: new Date(new Date(q.from).getTime() - len).toISOString(), to: q.from };
  const prev = summarize(db, prevQ);
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);
  return {
    ...current,
    previous: { from: prevQ.from, to: prevQ.to, netRevenue: prev.netRevenue, orderCount: prev.orderCount, itemsSold: prev.itemsSold },
    change: {
      netRevenue: pct(current.netRevenue, prev.netRevenue),
      orderCount: pct(current.orderCount, prev.orderCount),
      itemsSold: pct(current.itemsSold, prev.itemsSold),
    },
  };
}

export function rowToShift(r: Row) {
  return {
    id: r.id as string,
    deviceId: r.device_id as string,
    cashierId: r.cashier_id as string,
    cashierName: (r.cashier_name as string) ?? undefined,
    status: r.status as 'open' | 'closed',
    openedAt: r.opened_at as string,
    openingCash: Number(r.opening_cash),
    closedAt: (r.closed_at as string | null) ?? null,
    countedCash: r.counted_cash === null ? null : Number(r.counted_cash),
    expectedCash: r.expected_cash === null ? null : Number(r.expected_cash),
    cashDifference: r.counted_cash === null || r.expected_cash === null ? null : Number(r.counted_cash) - Number(r.expected_cash),
    note: r.note as string,
  };
}

/** Cash that should be in the drawer: opening + cash sales - change already given is in `total`,
 *  minus cash refunds made during the shift. */
export function expectedCash(db: DB, shiftId: string) {
  const s = db.prepare('SELECT opening_cash FROM shifts WHERE id = ?').get(shiftId)!;
  const sales = db
    .prepare("SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE shift_id = ? AND payment_method = 'cash' AND status IN ('completed','refunded')")
    .get(shiftId)!;
  const refunds = db
    .prepare("SELECT COALESCE(SUM(refund_amount),0) AS v FROM orders WHERE status = 'refunded' AND payment_method = 'cash' AND refund_shift_id = ?")
    .get(shiftId);
  const moves = db
    .prepare("SELECT COALESCE(SUM(CASE type WHEN 'in' THEN amount ELSE -amount END),0) AS v FROM cash_moves WHERE shift_id = ?")
    .get(shiftId);
  return Number(s.opening_cash) + Number(sales.v) - Number(refunds?.v ?? 0) + Number(moves?.v ?? 0);
}
