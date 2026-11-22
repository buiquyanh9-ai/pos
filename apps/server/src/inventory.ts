import { type DB, type Row, now } from './db.ts';
import { publish } from './events.ts';
import { createNotification } from './notifications.ts';
import { HttpError } from './validate.ts';

export type MoveType = 'sale' | 'void' | 'refund' | 'import' | 'adjust' | 'count' | 'issue' | 'return' | 'waste';

const round = (n: number) => Math.round(n * 1000) / 1000; // stock kept to 3 decimals (kg, l)

export function itemDto(r: Row) {
  const qty = Number(r.qty);
  const minQty = Number(r.min_qty);
  return {
    id: r.id as string,
    name: r.name as string,
    unit: r.unit as string,
    kind: r.kind as 'ingredient' | 'goods',
    /** exact: counted units (meat portions, bottles). estimate: shown as "còn khoảng X" (rice, vegetables, tea, boxes). */
    tracking: ((r.tracking as string) ?? 'exact') as 'exact' | 'estimate',
    defaultIssue: r.default_issue === null || r.default_issue === undefined ? null : Number(r.default_issue),
    qty,
    minQty,
    unitCost: Number(r.unit_cost),
    supplierId: (r.supplier_id as string | null) ?? null,
    active: Number(r.active) === 1,
    low: qty < minQty,
    updatedAt: r.updated_at as string,
  };
}

export function getItem(db: DB, id: string) {
  const r = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, `inventory item ${id} not found`);
  return r;
}

interface MoveRef {
  type: MoveType;
  refType?: string;
  refId?: string;
  userId?: string | null;
  reason?: string;
}

let pendingStockEvent = false;
function stockChanged() {
  if (pendingStockEvent) return;
  pendingStockEvent = true;
  setImmediate(() => {
    pendingStockEvent = false;
    publish('stock.changed', { at: now() });
  });
}

/** Apply a signed quantity change to one item and write the ledger row. Must run inside tx(). */
export function moveStock(db: DB, itemId: string, delta: number, ref: MoveRef) {
  const item = getItem(db, itemId);
  const before = Number(item.qty);
  const after = round(before + delta);
  db.prepare('UPDATE inventory_items SET qty = ?, updated_at = ? WHERE id = ?').run(after, now(), itemId);
  db.prepare(
    `INSERT INTO stock_moves (item_id, type, qty_delta, qty_after, ref_type, ref_id, user_id, reason, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(itemId, ref.type, round(delta), after, ref.refType ?? null, ref.refId ?? null, ref.userId ?? null, ref.reason ?? '', now());
  const min = Number(item.min_qty);
  // Alert only when crossing the threshold downward, not on every sale while already low.
  if (min > 0 && before >= min && after < min) {
    createNotification(db, {
      type: 'stock.low',
      title: `Sắp hết: ${item.name}`,
      body: `Còn ${after} ${item.unit} (tối thiểu ${min} ${item.unit})`,
      data: { itemId, qty: after, minQty: min },
      roles: ['owner', 'stock'],
    });
  }
  stockChanged();
  return after;
}

export interface ConsumeLine {
  productId: string | null;
  qty: number;
  /** Chosen options: their recipe_factor scales the base recipe, their option_recipes add stock. */
  optionIds?: string[];
}

/** Stock used by ONE portion of a product with the given options, per inventory item. */
export function portionUsage(db: DB, productId: string, optionIds: string[] = []) {
  const usage = new Map<string, number>();
  let factor = 1;
  const opts = optionIds.length
    ? db.prepare(`SELECT id, recipe_factor FROM options WHERE id IN (${optionIds.map(() => '?').join(',')})`).all(...optionIds)
    : [];
  for (const o of opts) factor *= Number(o.recipe_factor ?? 1) || 1;
  for (const r of db.prepare('SELECT item_id, qty FROM recipes WHERE product_id = ?').all(productId)) {
    usage.set(r.item_id as string, Number(r.qty) * factor);
  }
  for (const o of opts) {
    for (const r of db.prepare('SELECT item_id, qty FROM option_recipes WHERE option_id = ?').all(o.id as string)) {
      const id = r.item_id as string;
      usage.set(id, (usage.get(id) ?? 0) + Number(r.qty));
    }
  }
  return usage;
}

/** Recipe consumption for a list of sold lines, aggregated per inventory item. */
export function recipeUsage(db: DB, lines: ConsumeLine[]) {
  const usage = new Map<string, number>();
  for (const l of lines) {
    if (!l.productId) continue;
    for (const [id, q] of portionUsage(db, l.productId, l.optionIds)) usage.set(id, round((usage.get(id) ?? 0) + q * l.qty));
  }
  return usage;
}

/** Deduct (sign = -1) or return (sign = +1) the stock used by an order. Must run inside tx(). */
export function applyOrderStock(db: DB, orderId: string, lines: ConsumeLine[], sign: 1 | -1, ref: Omit<MoveRef, 'refType' | 'refId'>) {
  for (const [itemId, qty] of recipeUsage(db, lines)) {
    moveStock(db, itemId, sign * qty, { ...ref, refType: 'order', refId: orderId });
  }
}

/** Unit cost of one portion: recipe (scaled by options, plus option recipes) x ingredient cost,
 *  else the manual products.cost. */
export function productUnitCost(db: DB, productId: string, optionIds: string[] = []): number | null {
  const hasRecipe = Boolean(db.prepare('SELECT 1 FROM recipes WHERE product_id = ?').get(productId));
  if (hasRecipe) {
    const cost = db.prepare('SELECT unit_cost FROM inventory_items WHERE id = ?');
    let total = 0;
    for (const [id, q] of portionUsage(db, productId, optionIds)) total += q * Number(cost.get(id)?.unit_cost ?? 0);
    return Math.round(total);
  }
  const p = db.prepare('SELECT cost FROM products WHERE id = ?').get(productId);
  return p && p.cost !== null && p.cost !== undefined ? Number(p.cost) : null;
}

/** How many more portions of each product can be made from current stock. null = not tracked. */
export function availability(db: DB): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const rows = db
    .prepare('SELECT r.product_id, r.qty AS need, i.qty AS have FROM recipes r JOIN inventory_items i ON i.id = r.item_id')
    .all();
  for (const r of rows) {
    const pid = r.product_id as string;
    const portions = Math.max(0, Math.floor(Number(r.have) / Number(r.need) + 1e-9));
    const prev = out.get(pid);
    out.set(pid, prev === undefined || prev === null ? portions : Math.min(prev, portions));
  }
  return out;
}

export function moveDto(r: Row) {
  return {
    id: Number(r.id),
    itemId: r.item_id as string,
    itemName: (r.item_name as string) ?? undefined,
    unit: (r.unit as string) ?? undefined,
    type: r.type as MoveType,
    qtyDelta: Number(r.qty_delta),
    qtyAfter: Number(r.qty_after),
    refType: (r.ref_type as string | null) ?? null,
    refId: (r.ref_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    userName: (r.user_name as string | null) ?? null,
    reason: r.reason as string,
    at: r.at as string,
  };
}
