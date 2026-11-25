import { networkInterfaces } from 'node:os';
import { getSetting, openDb, setSetting, tx } from './db.ts';
import { createApp } from './app.ts';
import { seedDemoSales, seedIfEmpty } from './seed.ts';
import { createNotification, pushEnabled } from './notifications.ts';
import { summarize } from './reports.ts';
import { watchMenu } from './menuWatch.ts';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? './data/shopflow.db';
const apiKey = process.env.SHOPFLOW_API_KEY || undefined;
const tz = Number(process.env.TZ_OFFSET_MIN ?? 420); // Vietnam UTC+7
const summaryHour = Number(process.env.DAY_SUMMARY_HOUR ?? 22);

const db = openDb(dbPath);
if (process.env.SEED !== '0') seedIfEmpty(db);
// The shop's menu file (product/z.product) is the source of truth for products and tables.
if (process.env.MENU_SYNC !== '0') watchMenu(db, { sampleStock: process.env.SEED !== '0' });
// Demo sales sell the imported menu, so they run after it.
if (process.env.SEED !== '0' && process.env.SEED_DEMO_SALES === '1') seedDemoSales(db);

// End-of-day summary notification, once per local day after DAY_SUMMARY_HOUR.
function daySummaryTick() {
  const local = new Date(Date.now() + tz * 60_000);
  const day = local.toISOString().slice(0, 10);
  if (local.getUTCHours() < summaryHour || getSetting(db, 'day_summary_sent') === day) return;
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tz * 60_000;
  const s = summarize(db, { from: new Date(start).toISOString(), to: new Date(start + 86400_000).toISOString(), tzOffsetMin: tz });
  const fmt = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
  tx(db, () => {
    createNotification(db, {
      type: 'day.summary',
      title: `Tổng kết ngày ${day.split('-').reverse().join('/')}: ${fmt(s.netRevenue)}`,
      body: `${s.orderCount} đơn · ${s.itemsSold} món · hoàn ${fmt(s.refunds)} · giảm giá ${fmt(s.discounts)}`,
      data: { day, netRevenue: s.netRevenue },
    });
    setSetting(db, 'day_summary_sent', day);
  });
}
setInterval(daySummaryTick, 60_000).unref();

createApp({ db, apiKey }).listen(port, host, () => {
  console.log(`ShopFlow server listening on http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${port}`);
  }
  console.log(apiKey ? '  Service API key: enabled' : '  Service API key: disabled');
  console.log(`  Push (FCM): ${pushEnabled() ? 'enabled' : 'disabled (set FCM_SERVICE_ACCOUNT to enable)'}`);
});
