# Running ShopFlow for a real shop

## Option A: everything in the shop (LAN)

Use this when the owner only checks Boss on the shop Wi-Fi, or through a VPN or tunnel.

1. Use a small always-on PC or mini-PC in the shop, with a fixed LAN IP (set a DHCP reservation on the router).
2. Install Node.js 24 LTS, copy the repo, then run `npm install` and `npm run build`.
3. In `apps/server/.env`, set `SEED=0` and `DB_PATH=D:\shopflow\shopflow.db`. Then create the owner:
   `npm run create-owner -w apps/server -- chu <strong-password> <PIN>`.
4. Run the backend as a service so it restarts on reboot. One option is [NSSM](https://nssm.cc):
   `nssm install ShopFlow "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env src/index.ts"`, with the working dir set to `apps\server`.
5. Open TCP 4000 in Windows Firewall (inbound, private profile).
6. On the POS terminals and phones, enter the backend URL `http://<pc-ip>:4000` in Settings / Login.

## Option B: backend on the Internet (recommended for remote Boss)

1. Use a VPS (1 vCPU / 1 GB is enough at this scale: about 10M VND/day, a few hundred orders/day) running Node 24.
2. Put a reverse proxy with HTTPS in front, for example Caddy:
   ```
   shop.example.com {
     reverse_proxy 127.0.0.1:4000 {
       flush_interval -1     # keep SSE (live updates) unbuffered
     }
   }
   ```
3. Run the backend with `HOST=127.0.0.1` behind the proxy. The apps then use `https://shop.example.com`.
4. With HTTPS only, you can remove `cleartext` / `usesCleartextTraffic` from the Android builds.

## Backups

The database is a single SQLite file in WAL mode. Back it up at least daily while the server is running:

```powershell
sqlite3 D:\shopflow\shopflow.db ".backup 'E:\backup\shopflow-%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.db'"
```

You can also stop the service and copy `shopflow.db`, `shopflow.db-wal` and `shopflow.db-shm` together. Keep copies off-site, and test a restore regularly.

## Push notifications to phones (FCM)

Without FCM, Boss still gets alerts instantly while it is open or in the background (SSE + in-app banner + browser notification). To also notify when the app is closed:

1. Create a Firebase project and add the Android app `vn.shopflow.boss`. Put `google-services.json` in `apps/boss/android/app/`.
2. Add `@capacitor/push-notifications` to `apps/boss`. On login, register the device and send its token to `POST /api/notifications/push-tokens`.
3. In Firebase console, go to *Project settings → Service accounts → Generate new private key*. Save the file on the server and set `FCM_SERVICE_ACCOUNT=path/to/key.json`.
4. Restart the backend. The log should show `Push (FCM): enabled`.

The server-side sender is implemented (FCM HTTP v1 with a signed JWT), but it has **not been tested against a real Firebase project yet**.

## Moving to PostgreSQL later

All SQL lives in `apps/server/src/db.ts` (schema), `inventory.ts`, `reports.ts` and `routes/*.ts`. Moving to PostgreSQL means:
- Port the schema: `INTEGER PRIMARY KEY AUTOINCREMENT` → `bigserial`, `REAL` → `numeric(14,3)`.
- Replace `node:sqlite` with `pg`.
- Keep the same transaction boundaries. `BEGIN IMMEDIATE` becomes `SELECT … FOR UPDATE` on the order id.

The HTTP API and both apps stay unchanged.
