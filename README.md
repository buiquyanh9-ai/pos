# ShopFlow

ShopFlow is a sales and revenue-monitoring system for food & beverage shops. It has two independent apps that share one backend and one database:

| App | Who uses it | Where it runs |
|---|---|---|
| **ShopFlow POS** (`apps/pos`) | Cashiers | Browser on Windows; APK for Android POS terminals (Capacitor) |
| **ShopFlow Boss** (`apps/boss`) | The shop owner | Phone (Android/iOS via Capacitor, or installable web app) |
| **Backend** (`apps/server`) | Both apps | Any PC or server with Node.js 24 |

```
apps/server     Node 24 + Express + SQLite (node:sqlite) · auth & roles · orders · shifts & cash drawer
                · reports · notifications · realtime (SSE)
apps/pos        React + Vite + TS · touch POS · offline-first order queue · hardware drivers (printer, scanner, drawer)
apps/boss       React + Vite + TS · owner dashboard · reports by exact time range · live activity · notifications
packages/shared Types and formatting shared by POS and Boss
docs/           SYNC.md (API & business rules) · ANDROID.md (APK) · DEPLOY.md (production) · SUNMI.md
```

## Demo bằng một thao tác

Bấm đúp **`Demo ShopFlow.cmd`** (hoặc `npm run demo`). Script ([scripts/demo.mjs](scripts/demo.mjs)):

- chạy máy chủ ở cổng 4000 với **dữ liệu MẪU riêng** `apps/server/data/demo.db` (tạo mới mỗi lần: 14 ngày bán hàng mẫu, hôm nay từ 0đ), **không đụng** `shopflow.db` và không đọc `.env`;
- bật máy in ESC/POS ảo (cổng 9100, hoá đơn lưu ở `output/virtual-printer/`);
- POS trên laptop là **app ShopFlow POS trên máy ảo Android** (như máy POS thật); Boss xem trên điện thoại của bạn ở `https://quan.t160.men/boss/`;
- bật máy ảo (nếu chưa chạy), cài APK mới nhất, mở lại app POS; máy không có Android SDK thì mở POS bản web thay thế;
- vì dùng cổng 4000, link công khai `https://quan.t160.men/boss/` cũng trỏ vào demo (điện thoại thật xem được qua 4G).

Tài khoản mẫu: POS chọn Kim, PIN `1111` (Hiền là chủ, PIN `3333`); Boss `chu` / `chu123456`.
Đóng cửa sổ demo là tắt hết. Nếu ShopFlow thật (`Mo ShopFlow.cmd`) đang chạy thì demo không chạy đè: đóng bản thật trước.
Tuỳ chọn: `--keep` (giữ dữ liệu demo lần trước), `--no-android` (không có máy ảo: mở POS bản web), `--web` (mở thêm POS bản web).

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
- On first start the backend creates **sample data**: the store "Cửa hàng mẫu", demo accounts and tables (the menu comes from `product/z.product`). Every sample record is marked "mẫu" (sample).

### POS on the PC, Boss on your phone (same Wi-Fi)

```powershell
npm run serve        # builds POS + Boss, then serves everything on port 4000
```

- On the PC, open the POS at `http://localhost:4000/pos/`.
- On the phone, use the same Wi-Fi and open `http://<PC IP>:4000/boss/` (e.g. `http://192.168.2.211:4000/boss/`). The server prints the PC's LAN IP when it starts. The browser's *Add to Home screen* turns it into an app icon.
- **iPhone:** open the address in **Safari**, tap *Share* → *Add to Home Screen*. ShopFlow Boss then gets its own icon and opens full screen like an app, without the App Store. A banner in the app explains this.
- Every sale, refund, shift close and open bill reaches the phone within about a second (SSE).
- If the phone cannot connect, allow port 4000 in Windows Firewall. In PowerShell **as Administrator**:
  `New-NetFirewallRule -DisplayName "ShopFlow 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private`.
  Also check that the Wi-Fi network is set to *Private*.

### Menu file: `product/z.product`

The shop's menu is maintained in `c:\VISUAL\pos\product\z.product`, a Markdown file next to the repo.
- The backend imports it at startup and again every time the file is saved. Products, prices, categories, the 5-slots-per-row layout and tables 001-024 all come from it.
- Photos go in `product/product_img/<label>/<name>.jpg|png|webp`. Labels: `com-trang` (white rice), `com-dao` (fried rice), `mon-them` (extra portions), `do-an-kem` (side dishes), `do-uong` (drinks). Example: `com-trang/com-trang-suon.jpg`. The server supplies `/media/products/<label>/<name>`; old flat URLs still work. Takeaway items reuse the dine-in photo. Six side-dish images are available for future menu entries; adding images does not add products or prices.
- Check the result without changing anything: `npm run import-menu -w apps/server`. It prints the grid and any warnings.

### Owner on any network (4G, other Wi-Fi)

```powershell
npm run serve          # terminal 1: the shop server
npm run tunnel         # terminal 2: public https link (Cloudflare Quick Tunnel, free)
```

`npm run tunnel` prints `https://<random>.trycloudflare.com/boss/`. Open that link in Safari on the iPhone and add it to the Home Screen. It works from anywhere, with real-time updates.
- Requires `tools/cloudflared.exe`, downloaded from github.com/cloudflare/cloudflared/releases.
- The link changes every time the tunnel restarts. For a permanent address, use a named Cloudflare tunnel with your own domain, or a VPS (`docs/DEPLOY.md`).
- When exposed to the Internet, the server applies: login lockout per account and per real client IP (proxy-aware), a per-IP rate limit, and security headers.

### Demo accounts (sample data only)

| Role | Username | Password (Boss) | PIN (POS) |
|---|---|---|---|
| Cashier (Thu ngân): Kim | `thungan` | `thungan123` | `1111` |
| Cashier (Thu ngân): Minh | `thungan2` | `thungan2123` | `2222` |
| Owner (Chủ cửa hàng): Hiền | `chu` | `chu123456` | `3333` |

For a real shop:
1. Start the backend once with `SEED=0` and an empty database.
2. Create the owner with `npm run create-owner -w apps/server -- <username> <password> [PIN]`.
3. Add staff and menu from the apps or the API.

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
2. **Backend.** In one transaction, the backend stores the order and its lines.
   - Concurrent or repeated uploads of the same order are stored once.
   - Totals are recomputed on the server.
3. **Boss sees it live.** The backend pushes events over SSE (`/api/events`), so the dashboard, activity feed and reports refresh within about a second.
4. **Alerts.** Voids, refunds and shift summaries create notifications. They appear in Boss immediately, and on the phone as a push notification when FCM is configured.
5. **End of shift.** The cashier counts the cash by denomination. The shift report shows expected vs counted cash, and the owner is notified.

**Also in the POS:**
- **Open bills.** Save a table's order unpaid, edit it from any terminal, move it to another table, then pay or cancel it (a reason is required). Busy tables are highlighted. The owner sees these bills in Boss under *Hoạt động → Hoá đơn hiện tại*.
- **Options.** Size, ice, sugar and toppings, each with a surcharge.
- **Owner back-office (*Quản lý*).** Menu and prices, categories, options, tables, staff (roles, PIN, password, lock).
- **Void / refund.** Both need a reason. Everything is in the audit log, which the owner can read in Boss under *Thêm → Lịch sử thao tác*.

Revenue rules (net, refunds, voids, profit) are in [docs/SYNC.md](docs/SYNC.md).

**Roles (two):**
- **Owner:** everything. Usually works remotely from the Boss app on the phone (reports, staff, menu); still has a POS account.
- **Cashier:** works at the POS. Selling, void/refund with a reason, shifts and the cash drawer. The former stock-staff role was merged into cashier.

## Android

- POS and Boss each have a Capacitor Android project (`apps/pos/android`, `apps/boss/android`).
- Building an APK needs Android Studio (JDK 21 + SDK). Step-by-step guide, ADB install and the real-terminal test checklist: [docs/ANDROID.md](docs/ANDROID.md).
- Printer/SUNMI notes: [docs/SUNMI.md](docs/SUNMI.md).

## Status

Not done yet:
- APK built and tested on a physical terminal (no hardware or Android SDK in the dev environment).
- FCM push tested with a real Firebase project.
- PostgreSQL. The data layer is SQLite for now; see `docs/DEPLOY.md` for the migration path.

## Bật / tắt ShopFlow khi cần (máy này làm máy chủ)

- **Bật:** bấm đúp `Mo ShopFlow.cmd` ở thư mục gốc. File sẽ sao lưu dữ liệu, chạy máy chủ (bản chính thức, không theo dõi sửa code) và mở POS.
- **Dùng:** POS `https://quan.t160.men/pos/`, Boss `https://quan.t160.men/boss/`. Máy tính và điện thoại **không cần chung wifi** (đi qua Cloudflare Tunnel, dịch vụ `cloudflared` tự chạy cùng Windows).
- **Tắt:** đóng cửa sổ ShopFlow. Khi tắt, link vẫn mở được trang nhưng không đăng nhập/đồng bộ được; POS đang mở vẫn bán offline và gửi đơn khi bật lại.
- Lưu ý: máy ngủ hoặc gập màn hình = ShopFlow tạm dừng. Không chạy cùng lúc với `npm run dev` (cùng cổng 4000).
