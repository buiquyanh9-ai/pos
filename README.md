# ShopFlow

ShopFlow is a sales and inventory system for food & beverage shops. It has two independent apps that share one backend and one database:

| App | Who uses it | Where it runs |
|---|---|---|
| **ShopFlow POS** (`apps/pos`) | Cashiers and stock staff | Browser on Windows; APK for Android POS terminals (Capacitor) |
| **ShopFlow Boss** (`apps/boss`) | The shop owner | Phone (Android/iOS via Capacitor, or installable web app) |
| **Backend** (`apps/server`) | Both apps | Any PC or server with Node.js 24 |

```
apps/server     Node 24 + Express + SQLite (node:sqlite) · auth & roles · orders · inventory (BOM) · shifts
                · stocktakes · purchasing · reports · notifications · realtime (SSE)
apps/pos        React + Vite + TS · touch POS · offline-first order queue · hardware drivers (printer, scanner, drawer)
apps/boss       React + Vite + TS · owner dashboard · reports by exact time range · live activity · stock & approvals
packages/shared Types and formatting shared by POS and Boss
docs/           SYNC.md (API & business rules) · ANDROID.md (APK) · DEPLOY.md (production) · SUNMI.md · PLAN.md
```

## Quick start (Windows)

Requires **Node.js 24+**.

```powershell
cd shopflow-pos
npm install
npm run seed:demo -w apps/server   # optional: 14 days of SAMPLE sales so reports have data
npm run dev                         # backend :4000, POS :5173, Boss :5174
```

- POS: http://localhost:5173. Log in by choosing a staff member and entering their PIN.
- Boss: http://localhost:5174. Log in with the owner's username and password. It is laid out for a phone screen; use the browser's device toolbar on a PC.
- On first start the backend creates **sample data**: the store "Cửa hàng mẫu", a café menu with recipes, inventory, tables and suppliers. Every sample record is marked "mẫu" (sample).

### Demo accounts (sample data only)

| Role | Username | Password (Boss) | PIN (POS) |
|---|---|---|---|
| Owner (Chủ cửa hàng) | `chu` | `chu123456` | `9999` |
| Cashier (Thu ngân) | `thungan` | `thungan123` | `1111` |
| Stock staff (Nhân viên kho) | `kho` | `kho123456` | `2222` |

For a real shop:
1. Start the backend once with `SEED=0` and an empty database.
2. Create the owner with `npm run create-owner -w apps/server -- <username> <password> [PIN]`.
3. Add staff, menu and stock from the apps or the API.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Backend, POS and Boss with hot reload |
| `npm test` | Server API and business-flow tests, plus POS and Boss unit tests |
| `npm run typecheck` | TypeScript check of all apps |
| `npm run build` | Production builds of POS (`apps/pos/dist`) and Boss (`apps/boss/dist`) |
| `npm start -w apps/server` | Backend without file watching |
| `npm run seed:demo -w apps/server` | Add SAMPLE sales for the last 14 days (runs once per database) |
| `npm run create-owner -w apps/server -- user pass [pin]` | Create or reset an owner account |

### Backend configuration (`apps/server/.env`, optional)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Listens on the LAN so POS terminals and phones can connect |
| `DB_PATH` | `./data/shopflow.db` | SQLite file. Back it up daily, see `docs/DEPLOY.md` |
| `SEED` | `1` | `0` turns off the sample data |
| `SEED_DEMO_SALES` | `0` | `1` adds the 14 days of sample sales at startup |
| `SHOPFLOW_API_KEY` | *(empty)* | Optional service key for integrations. A request with this key acts as the owner |
| `TZ_OFFSET_MIN` | `420` | Shop time zone in minutes (UTC+7) |
| `DAY_SUMMARY_HOUR` | `22` | Local hour at which the daily summary notification is sent |
| `FCM_SERVICE_ACCOUNT` | *(empty)* | Path to a Firebase service-account JSON file. Turns on push to phones when the app is closed |

## How the system works

1. **Sale on the POS.** The cashier logs in with a PIN and opens a shift with the opening cash.
   - An order is saved on the device first, then uploaded.
   - Each order has an id generated on the device, so a retry never creates a duplicate.
   - Selling continues while offline; the header shows how many orders are waiting to upload.
2. **Backend.** In one transaction, the backend stores the order and deducts every ingredient according to the recipe (BOM), writing a stock ledger entry for each.
   - Concurrent or repeated uploads of the same order deduct stock once.
   - Totals are recomputed on the server.
3. **Boss sees it live.** The backend pushes events over SSE (`/api/events`), so the dashboard, activity feed and reports refresh within about a second.
4. **Alerts.** When an item drops below its minimum, a `stock.low` notification is created. It appears in Boss immediately, and on the phone as a push notification when FCM is configured.
5. **End of shift.**
   - Staff count stock. A difference requires a reason; it adjusts stock and notifies the owner.
   - The cashier counts the cash. The shift report shows expected vs counted cash.
6. **Purchasing.** The stock clerk creates a purchase request from the "below minimum" suggestions, and the owner approves or rejects it in Boss.
7. **Receiving.** The stock clerk enters the quantities actually received. Stock and unit costs update, and both apps see the new levels.

Revenue rules (net, refunds, voids, profit) are in [docs/SYNC.md](docs/SYNC.md).

**Roles:**
- Owner: everything, including store-wide reports, approvals and staff management.
- Cashier: sell, void/refund with a reason, shifts, stock counts.
- Stock staff: inventory, counts, purchase requests, receiving.

## Android

- POS and Boss each have a Capacitor Android project (`apps/pos/android`, `apps/boss/android`).
- Building an APK needs Android Studio (JDK 21 + SDK). Step-by-step guide, ADB install and the real-terminal test checklist: [docs/ANDROID.md](docs/ANDROID.md).
- Printer/SUNMI notes: [docs/SUNMI.md](docs/SUNMI.md).

## Status

See [docs/PLAN.md](docs/PLAN.md) for the plan and what has been tested. Not done yet:
- APK built and tested on a physical terminal (no hardware or Android SDK in the dev environment).
- FCM push tested with a real Firebase project.
- PostgreSQL. The data layer is SQLite for now; see `docs/DEPLOY.md` for the migration path.
