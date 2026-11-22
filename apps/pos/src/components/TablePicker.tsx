import { money } from '../lib/format';
import type { Cart } from '../lib/cart';
import type { DiningTable, OpenOrder } from '../lib/types';

interface Props {
  tables: DiningTable[];
  openOrders: OpenOrder<Cart>[];
  /** Table of the bill being edited (highlighted). */
  current: string;
  currentOpenId?: string;
  onPick: (tableName: string) => void;
  onOpenBill: (openOrderId: string) => void;
  onTakeaway: () => void;
  onClose: () => void;
}

/** Full-screen table map: free tables in green, tables with an unpaid bill in red. */
export function TablePicker({ tables, openOrders, current, currentOpenId, onPick, onOpenBill, onTakeaway, onClose }: Props) {
  const billOf = (name: string) => openOrders.find((o) => o.orderType === 'dine_in' && o.tableName === name);
  const busyCount = tables.filter((t) => billOf(t.name)).length;
  // Takeaway bills, plus bills on a table that no longer exists (so they can still be paid).
  const takeawayBills = openOrders.filter((o) => o.orderType !== 'dine_in' || !o.tableName || !tables.some((t) => t.name === o.tableName));
  return (
    <div className="tp" role="dialog" aria-modal="true" aria-label="Chọn bàn">
      <header className="tp-head">
        <div className="tp-title">
          <strong>Chọn bàn</strong>
          <span className="tp-legend">
            <i className="free" /> Trống {tables.length - busyCount}
            <i className="busy" /> Có khách {busyCount}
          </span>
        </div>
        <div className="tp-actions">
          <button className="tp-btn" onClick={onTakeaway}>
            Mang đi (không bàn)
          </button>
          <button className="tp-btn primary" onClick={onClose}>
            Hoàn tất
          </button>
        </div>
      </header>
      <div className="tp-body">
        <div className="tp-grid">
          {tables.map((t) => {
            const bill = billOf(t.name);
            const mine = (bill && bill.id === currentOpenId) || (!bill && current === t.name);
            return (
              <button
                key={t.id}
                className={`tp-table ${bill ? 'busy' : 'free'}${mine ? ' current' : ''}`}
                onClick={() => (bill && bill.id !== currentOpenId ? onOpenBill(bill.id) : onPick(t.name))}
                aria-label={bill ? `Bàn ${t.name}, đang có khách ${money(bill.total)}` : `Bàn ${t.name}, trống`}
              >
                <span className="chair top" />
                <span className="chair bottom" />
                <span className="chair left" />
                <span className="chair right" />
                <span className="tp-name">{t.name}</span>
                {bill && <span className="tp-total">{money(bill.total)}</span>}
                {bill && <span className="tp-items">{bill.itemCount} món</span>}
              </button>
            );
          })}
        </div>
        {takeawayBills.length > 0 && (
          <section className="tp-takeaway">
            <h3>Đơn mang đi / khác đang chờ</h3>
            <div className="tp-takeaway-list">
              {takeawayBills.map((o) => (
                <button key={o.id} className={o.id === currentOpenId ? 'tp-bill current' : 'tp-bill'} onClick={() => onOpenBill(o.id)}>
                  <strong>{o.orderType === 'dine_in' && o.tableName ? `Bàn ${o.tableName}` : o.note || 'Mang đi'}</strong>
                  <span>
                    {o.itemCount} món · {money(o.total)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!tables.length && <p className="empty">Chưa có bàn. Chủ cửa hàng thêm bàn trong mục Quản lý.</p>}
      </div>
    </div>
  );
}
