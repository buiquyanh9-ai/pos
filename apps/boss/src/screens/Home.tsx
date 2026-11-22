import { money, moneyShort } from '@shopflow/shared';
import { api } from '../lib/api';
import { localParts, timeLocal } from '../lib/range';
import { useBoss, useRemote } from '../lib/store';
import { BarChart } from '../components/Charts';
import { Card, Header, Loading, Stat } from '../components/UI';
import type { Tab } from '../App';

export function Home({ go }: { go: (t: Tab) => void }) {
  const { data, error, loading } = useRemote(api.dashboard);
  const { data: act } = useRemote((c) => api.activity(c));
  const user = useBoss((s) => s.session?.user);
  const live = useBoss((s) => s.live);
  const unread = useBoss((s) => s.unread);
  const t = data?.today;
  const nowHour = localParts().h;

  return (
    <div className="screen">
      <Header
        title="Tổng quan"
        right={
          <button className="icon-btn bell" aria-label="Thông báo" onClick={() => go('notifications')}>
            🔔{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        }
      />
      <div className="screen-body">
        <p className="greeting">
          <span>
            Xin chào, <strong>{user?.name}</strong>
          </span>
          <span className={`live live-${live}`}>{live === 'on' ? '● Trực tiếp' : live === 'connecting' ? '○ Đang kết nối' : '○ Ngoại tuyến'}</span>
        </p>
        <Loading error={error} loading={loading && !data} />
        {t && (
          <>
            <section className="hero">
              <span className="muted">Doanh thu thuần hôm nay</span>
              <strong>{money(t.netRevenue)}</strong>
              <span className={`delta ${t.change.netRevenue === null ? '' : t.change.netRevenue >= 0 ? 'up' : 'down'}`}>
                {t.change.netRevenue === null ? 'Chưa có dữ liệu hôm qua' : `${t.change.netRevenue >= 0 ? '▲' : '▼'} ${Math.abs(t.change.netRevenue)}% so với cùng giờ hôm qua (${moneyShort(t.previous.netRevenue)})`}
              </span>
            </section>
            <div className="stats">
              <Stat label="Số đơn" value={String(t.orderCount)} change={t.change.orderCount} />
              <Stat label="Món đã bán" value={String(t.itemsSold)} change={t.change.itemsSold} />
              <Stat label="TB / đơn" value={moneyShort(t.avgOrderValue)} />
              <Stat
                label="Lợi nhuận gộp"
                value={t.grossProfit === null ? '—' : moneyShort(t.grossProfit)}
                hint={t.grossProfit === null ? 'chưa có giá vốn' : t.costCoverage < 1 ? `ước tính trên ${Math.round(t.costCoverage * 100)}% doanh thu` : undefined}
              />
            </div>
            <Card title="Doanh thu theo giờ">
              <BarChart
                title="Doanh thu theo giờ hôm nay"
                labelEvery={3}
                data={t.byHour.slice(6, Math.max(nowHour + 1, 22)).map((b) => ({ key: String(b.hour), label: `${b.hour}h`, value: b.revenue, detail: `${b.orders} đơn` }))}
              />
            </Card>
            <div className="alerts">
              <button className={data.lowStockCount ? 'alert warn' : 'alert'} onClick={() => go('stock')}>
                <strong>{data.lowStockCount}</strong>
                <span>mặt hàng dưới ngưỡng</span>
              </button>
              <button className={data.pendingPurchases ? 'alert warn' : 'alert'} onClick={() => go('stock')}>
                <strong>{data.pendingPurchases}</strong>
                <span>đề xuất nhập chờ duyệt</span>
              </button>
              <button className="alert" onClick={() => go('activity')}>
                <strong>{data.openShifts}</strong>
                <span>ca đang mở</span>
              </button>
            </div>
            {(t.refunds > 0 || t.voidedCount > 0 || t.discounts > 0) && (
              <Card title="Cần chú ý hôm nay">
                <ul className="kv">
                  <li>
                    <span>Hoàn tiền ({t.refundCount})</span>
                    <strong>{money(t.refunds)}</strong>
                  </li>
                  <li>
                    <span>Đơn huỷ ({t.voidedCount})</span>
                    <strong>{money(t.voidedAmount)}</strong>
                  </li>
                  <li>
                    <span>Giảm giá</span>
                    <strong>{money(t.discounts)}</strong>
                  </li>
                </ul>
              </Card>
            )}
          </>
        )}
        {act && act.orders.length > 0 && (
          <Card title="Đơn gần nhất" action={<button className="link" onClick={() => go('activity')}>Xem tất cả ›</button>}>
            <ul className="list">
              {act.orders.slice(0, 5).map((o) => (
                <li key={o.id} className="row">
                  <span>
                    <strong>{o.number}</strong>
                    <span className="muted small"> · {o.cashier}</span>
                  </span>
                  <span className="right">
                    <strong className={o.status !== 'completed' ? 'strike' : ''}>{money(o.total)}</strong>
                    <span className="muted small">{timeLocal(o.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
