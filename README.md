# ShopFlow POS

ShopFlow POS is the point-of-sale app for counters. It works without any POS hardware and is designed to be wrapped as an Android APK for real POS terminals later.

```
apps/
  server/   shared backend: Node 24 + Express + SQLite (node:sqlite), used by POS and ShopFlow Boss
  pos/      POS app: React + Vite + TypeScript, Android wrapper via Capacitor (apps/pos/android)
docs/
  ANDROID.md   build, install (ADB) and test the APK on an Android POS device
  SYNC.md      API contract for ShopFlow Boss <-> backend <-> POS
  SUNMI.md     optional SUNMI printer integration path
```

ShopFlow POS is a separate app from ShopFlow Boss Mobile. The two only share the backend API.

## Requirements

- Windows 10/11 (or macOS/Linux)
- **Node.js 24+** (the server uses the built-in `node:sqlite` and runs `.ts` files directly)
- For the APK only: JDK 21 and Android Studio / Android SDK (see [docs/ANDROID.md](docs/ANDROID.md))

## Run on Windows (development)

```powershell
npm install
npm run dev
```

- POS: http://localhost:5173. It is touch-friendly and also works with a mouse.
- Backend: http://localhost:4000. On first start it seeds 12 sample products into `apps/server/data/shopflow.db`.
- The server prints its LAN addresses. Use one of those as the **Backend URL** under *Cài đặt* (Settings) when the POS runs on another device.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Server API tests (node:test) and POS unit tests (vitest) |
| `npm run typecheck` | TypeScript check for both apps |
| `npm run build` | Production build of the POS web app into `apps/pos/dist` |
| `npm start -w apps/server` | Run the backend without file watching |

### Backend configuration (`apps/server/.env`, optional)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `HOST` | `0.0.0.0` | Listens on the LAN so POS devices can connect |
| `SHOPFLOW_API_KEY` | *(empty)* | When set, every request needs the `x-api-key` header. Enter the key in POS Settings |
| `DB_PATH` | `./data/shopflow.db` | SQLite file |
| `SEED` | `1` | Set to `0` to skip sample products |

If a POS device on the LAN cannot reach the backend, allow port 4000 in Windows Firewall (inbound, private network).

## How it works

- **Offline-first sales.** A sale is saved on the device first. The sync loop then uploads it, every 15 s and whenever the connection comes back. Each order carries an id generated on the device, so a retried upload never creates a duplicate. The header pill shows connection status and how many orders are still waiting to upload.
- **Catalog.** The product list is cached on the device, so the POS keeps selling while offline. Prices are taken at the time of sale.
- **Server computes totals.** The server recomputes the subtotal, total and change and rejects inconsistent orders. A rejected order is flagged in *Đơn hàng* (Orders) and can be re-sent.
- **ShopFlow Boss sync.** Boss manages the catalog through `/api/products` and reads sales through the cursor-based change feed `/api/sync/changes` and `/api/reports/summary`. See [docs/SYNC.md](docs/SYNC.md).
- **Hardware is modular.** `apps/pos/src/hardware/types.ts` defines the printer, scanner and cash drawer interfaces. The available drivers are:
  - mock: console only, the default
  - browser print
  - keyboard-wedge barcode scanner (USB/Bluetooth scanners that act as a keyboard)
  - network ESC/POS printer and drawer, relayed by the backend to `ip:9100`
  - SUNMI: optional, only shown when a SUNMI bridge is present

  A failing device never blocks a sale. You can choose drivers and run a test print under *Cài đặt* (Settings).
- **Screens.** The layout uses two columns in landscape (1024×600 and up) and a bottom-sheet cart in portrait (handhelds around 720×1440). Touch targets are at least 52 px.

## Roadmap

1. ✅ POS on Windows
2. ✅ POS ↔ Backend ↔ Boss sync API (Boss app itself is a separate project)
3. ✅ Android project prepared (`apps/pos/android`). Building the APK needs a JDK and the Android SDK
4. ⏳ Test on a real Android POS terminal
5. ⏳ Device-specific printer and scanner drivers (SUNMI native bridge, etc.)
