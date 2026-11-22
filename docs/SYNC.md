# ShopFlow API v2: contract between POS, Boss and the backend

All endpoints are under `/api`.
- **Money** is in integer VND. **Stock quantities** are decimals with 3 decimal places (kg, l, …). **Timestamps** are ISO-8601 UTC.
- Reports bucket by shop-local time; the `tz` parameter is an offset in minutes, default `420` (UTC+7).

## Authentication & roles

- `POST /auth/login`:
  - Boss sends `{ username, password }`; POS sends `{ username, pin }`.
  - Response: `{ token, expiresAt, user }`. Sessions last 30 days, so a POS terminal stays logged in through offline periods.
- Send `Authorization: Bearer <token>`. `GET /api/events` also accepts `?token=`, because EventSource cannot set headers.
- `GET /auth/staff` is public and lists staff names for the POS PIN screen. It returns no secrets.
- Optional `x-api-key: <SHOPFLOW_API_KEY>` acts as the owner, for integrations and scripts.

| Role | Can do |
|---|---|
| `owner` | Everything. Store-wide reports, staff (`/users`), menu, approvals, audit log |
| `cashier` | Sell, void/refund (reason required), open/close own shift, shift report (`/reports/summary?shiftId=`), stock counts |
| `stock` | Inventory items, adjustments, stock counts, suppliers, purchase requests, receiving goods |

## Endpoints

### Auth & staff

`POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/staff`

Owner only: `GET/POST/PUT /users` · `GET /audit`

### Menu

| Endpoint | Notes |
|---|---|
| `GET /products` | `{ products, categories, optionGroups, serverTime }`. See *Product fields* below |
| `POST/PUT/DELETE /products/:id` | Owner. `recipe: [{itemId, qty}]`, `optionGroupIds: [...]`. Delete is a soft delete |
| `GET/POST/PUT /categories` | Owner for writes |
| `GET/POST/PUT /option-groups` | Size / ice / sugar / topping. `options: [{name, priceDelta}]`, `multi`, `required` |
| `GET/POST/PUT /tables` | Tables, with areas |

*Product fields:*
- `stock` is the number of portions that can still be made from current inventory (BOM). `null` means stock is not tracked for this product.
- `cost` is the unit cost: from the recipe, or the manual `cost` field.

### Sales

| Endpoint | Notes |
|---|---|
| `POST /orders` | Idempotent by `id` (see *Order upload*) |
| `GET /orders?from&to&status&shiftId&orderType&cashierId&deviceId` | |
| `POST /orders/:id/void` `{reason}` | Cancels a mistaken order. Stock goes back. Excluded from revenue |
| `POST /orders/:id/refund` `{reason, restock?, shiftId?}` | Gives the money back. Stock returns only with `restock: true`, e.g. an unopened bottle |
| `POST /shifts/open` `{deviceId, openingCash}` · `GET /shifts/current?deviceId` | One open shift per device |
| `POST /shifts/:id/close` `{countedCash, note}` | Returns the shift report: `expectedCash`, `cashDifference`, summary, stock counts |
| `GET /shifts?from&to` · `GET /shifts/:id/report` | |

*Order upload (`POST /orders`):*
- The server recomputes subtotal, total and change, and validates them.
- Rules: `paid >= total`; only cash payments can have change; `discount <= subtotal`.
- Payment methods: `cash | transfer | qr | card`. Order types: `dine_in | takeaway | delivery`.
- Each item is `{productId, name, price (incl. options), qty, note?, options?}`.

### Inventory & purchasing

| Endpoint | Notes |
|---|---|
| `GET /inventory/items?low=1&kind=` · `POST/PUT /inventory/items` | |
| `POST /inventory/items/:id/adjust` `{delta \| qty, reason}` | |
| `GET /inventory/moves?itemId&type&from&to` | Ledger. Types: `sale`, `void`, `refund`, `import`, `adjust`, `count` |
| `POST /inventory/stocktakes` `{shiftId?, lines:[{itemId, counted, reason}]}` | A reason is required when the count differs. The stock difference is applied |
| `GET /suppliers` · `POST/PUT /suppliers` | |
| `GET /purchases/suggestions` | Items below minimum, topped up to 2× the minimum |
| `POST /purchases` | Status `pending`, or `approved` straight away if the owner creates it |
| `POST /purchases/:id/approve` · `/reject` | Owner |
| `POST /purchases/:id/receive` `{lines:[{itemId, receivedQty?, unitCost?}]}` | Approved requests only. Stock is added and the unit cost updated |

### Reports, live data, notifications

| Endpoint | Notes |
|---|---|
| `GET /reports/summary?from&to[&compare=1&shiftId&cashierId&deviceId&tz]` | Any range up to the minute, max 400 days. Owner, or a cashier with `shiftId`. See *Summary fields* |
| `GET /dashboard` | Today so far, compared with yesterday up to the same time. Also low-stock count, pending purchases, open shifts |
| `GET /activity?before=` | Latest orders and open shifts, for the Boss live feed |
| `GET /events` | SSE events: `order.created`, `order.updated`, `stock.changed`, `shift.updated`, `purchase.updated`, `catalog.changed`, `notification` |
| `GET /notifications` · `POST /notifications/read {ids \| "all"}` | |
| `GET/PUT /notifications/prefs` | Per-user on/off per notification type |
| `POST /notifications/push-tokens {token, platform}` | FCM device token from the phone app |
| `GET /sync/changes?since=<cursor>` | Cursor-based change feed of products and orders, for incremental sync |

*Summary fields (`/reports/summary`):* `orderCount`, `itemsSold`, `grossSales`, `discounts`, `refunds`, `netRevenue`, `avgOrderValue`, `voidedCount`/`voidedAmount`, `costOfGoods`, `grossProfit`, `costCoverage`, `byHour[24]`, `byDay`, `byPayment`, `byOrderType`, `byCashier`, `byCategory`, `topProducts`, plus `previous`/`change` when `compare=1`.

*Notification types:* `stock.low`, `stock.variance`, `shift.closed`, `day.summary`, `purchase.pending`, `purchase.decided`, `order.voided`, `order.refunded`.

## Business rules

- **No double stock deduction.** The order insert and the stock deduction happen in one `BEGIN IMMEDIATE` transaction, and the order id is checked again inside the lock. Two concurrent uploads of the same order produce one 201 and one 200 `duplicate: true` (covered by a test).
- **Revenue:**
  - Sales count at **sale time**.
  - Refunds count at **refund time**, so they reduce the day or shift in which the money left the drawer.
  - Voided orders are never revenue; they are reported separately.
  - Net = sales total after discount − refunds.
- **Profit:**
  - Each order line stores its unit cost at sale time, taken from the recipe × ingredient cost or the product's manual cost.
  - `grossProfit` = net − cost of goods.
  - `costCoverage` < 1 means some sales have no known cost, and profit is an estimate over the covered part.
- **Low-stock alert.** It fires only when an item **crosses** below its minimum, not on every later sale.
- **Expected cash for a shift** = opening cash + cash sales in the shift − cash refunds made in the shift.
- **Audit.** Logins, user changes, menu changes, voids/refunds, adjustments, counts and purchase decisions are written to `audit_log`.
