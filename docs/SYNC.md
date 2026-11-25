# ShopFlow API v2: contract between POS, Boss and the backend

All endpoints are under `/api`.
- **Money** is in integer VND. **Timestamps** are ISO-8601 UTC.
- Reports bucket by shop-local time; the `tz` parameter is an offset in minutes, default `420` (UTC+7).

## Authentication & roles

- `POST /auth/login`:
  - Boss sends `{ username, password }`; POS sends `{ username, pin }`.
  - Response: `{ token, expiresAt, user }`. Sessions last 30 days, so a POS terminal stays logged in through offline periods.
- Send `Authorization: Bearer <token>`. `GET /api/events` also accepts `?token=`, because EventSource cannot set headers.
- After 5 wrong passwords/PINs for a username (or from one address) within 5 minutes, login returns 429 until the window ends.
- `GET /auth/staff` is public and lists staff names for the POS PIN screen. It returns no secrets.
- Optional `x-api-key: <SHOPFLOW_API_KEY>` acts as the owner, for integrations and scripts.

| Role | Can do |
|---|---|
| `owner` | Everything. Store-wide reports, staff (`/users`), menu, approvals, audit log |
| `cashier` | Sell, void/refund (reason required), open/close own shift, shift report (`/reports/summary?shiftId=`) |

## Endpoints

### Auth & staff

`POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/staff`

Owner only: `GET/POST/PUT /users` · `GET /audit`

### Menu

| Endpoint | Notes |
|---|---|
| `GET /products` | `{ products, categories, optionGroups, serverTime }`. See *Product fields* below |
| `POST/PUT/DELETE /products/:id` | Owner. `cost?` (optional manual unit cost), `optionGroupIds: [...]`. Delete is a soft delete |
| `GET/POST/PUT /categories` | Owner for writes |
| `GET/POST/PUT /option-groups` | Size / ice / sugar / topping. `options: [{name, priceDelta}]`, `multi`, `required` |
| `GET/POST/PUT /tables` | Tables, with areas |

*Product fields:*
- `cost` is the optional manual unit cost (`null` when not entered).

### Sales

| Endpoint | Notes |
|---|---|
| `POST /orders` | Idempotent by `id` (see *Order upload*) |
| `GET /orders?from&to&status&shiftId&orderType&cashierId&deviceId` | |
| `POST /orders/:id/void` `{reason}` | Cancels a mistaken order. Excluded from revenue |
| `POST /orders/:id/refund` `{reason, shiftId?}` | Gives the money back; counted against revenue at refund time |
| `POST /shifts/open` `{deviceId, openingCash}` · `GET /shifts/current?deviceId` | One open shift per device |
| `POST /shifts/:id/close` `{countedCash, note}` | Returns the shift report: `expectedCash`, `cashDifference`, summary |
| `GET /shifts?from&to` · `GET /shifts/:id/report` | |

*Order upload (`POST /orders`):*
- The server recomputes subtotal, total and change, and validates them.
- Rules: `paid >= total`; only cash payments can have change; `discount <= subtotal`.
- Payment methods: `cash | transfer | qr | card`. Order types: `dine_in | takeaway | delivery`.
- Each item is `{productId, name, price (incl. options), qty, note?, options?, optionIds?}`.
- `optionIds` are stored on the order line with the readable `options` text; unknown ids are dropped.

### Inventory

The inventory module (stock, recipes/BOM, stock counts, kitchen, suppliers, purchasing) was removed on 25/11/2026 at the shop's request. Older databases drop those tables on startup.

### Reports, live data, notifications

| Endpoint | Notes |
|---|---|
| `GET /reports/summary?from&to[&compare=1&shiftId&cashierId&deviceId&tz]` | Any range up to the minute, max 400 days. Owner, or a cashier with `shiftId`. See *Summary fields* |
| `GET /dashboard` | Today so far, compared with yesterday up to the same time. Also open shifts and open bills |
| `GET /activity?before=` | Latest orders and open shifts, for the Boss live feed |
| `GET /events` | SSE events: `order.created`, `order.updated`, `shift.updated`, `catalog.changed`, `open_orders.changed`, `notification` |
| `GET /notifications` · `POST /notifications/read {ids \| "all"}` | |
| `GET/PUT /notifications/prefs` | Per-user on/off per notification type |
| `POST /notifications/push-tokens {token, platform}` | FCM device token from the phone app |
| `GET/PUT/DELETE /open-orders/:id` | Unpaid table bills. `PUT` with `version` for optimistic locking (409 if another terminal changed it), one open bill per table. `DELETE` with `{reason}` = cancelled (audited) |
| `GET /sync/changes?since=<cursor>` | Cursor-based change feed of products and orders, for incremental sync |

*Summary fields (`/reports/summary`):* `orderCount`, `itemsSold`, `grossSales`, `discounts`, `refunds`, `netRevenue`, `avgOrderValue`, `voidedCount`/`voidedAmount`, `costOfGoods`, `grossProfit`, `costCoverage`, `byHour[24]`, `byDay`, `byPayment`, `byOrderType`, `byCashier`, `byCategory`, `topProducts`, plus `previous`/`change` when `compare=1`.

*Notification types:* `shift.closed`, `day.summary`, `order.voided`, `order.refunded`.

## Business rules

- **No duplicate orders.** The order and its lines are written in one `BEGIN IMMEDIATE` transaction, and the order id is checked again inside the lock. Two concurrent uploads of the same order produce one 201 and one 200 `duplicate: true` (covered by a test).
- **Revenue:**
  - Sales count at **sale time**.
  - Refunds count at **refund time**, so they reduce the day or shift in which the money left the drawer.
  - Voided orders are never revenue; they are reported separately.
  - Net = sales total after discount − refunds.
- **Profit:**
  - Each order line stores its unit cost at sale time, taken from the product's manual cost (null when unknown).
  - `grossProfit` = net − cost of goods.
  - `costCoverage` < 1 means some sales have no known cost, and profit is an estimate over the covered part.
- **Expected cash for a shift** = opening cash + cash sales in the shift − cash refunds made in the shift.
- **Audit.** Logins, user changes, menu changes, voids/refunds and cash in/out are written to `audit_log`.
