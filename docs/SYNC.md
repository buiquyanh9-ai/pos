# Sync contract: POS ↔ Backend ↔ ShopFlow Boss

All endpoints are under `/api`. Every endpoint except `/api/health` requires the `x-api-key` header when the server has `SHOPFLOW_API_KEY` set. Money is in **integer VND**, and timestamps are ISO-8601 UTC.

## Roles

| Client | Writes | Reads |
|---|---|---|
| POS | `POST /orders`, `POST /orders/:id/void`, `POST /devices/heartbeat` | `GET /products`, `GET /reports/summary` |
| ShopFlow Boss | `POST/PUT/DELETE /products` | `GET /sync/changes`, `GET /orders`, `GET /reports/summary`, `GET /devices` |

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok, apiVersion, time, auth: disabled\|ok\|missing\|invalid }`. Public |
| `GET /products?includeInactive=1&since=ISO` | Product list |
| `POST /products` | Create product `{ sku?, barcode?, name, category?, price, stock?, active? }`. Returns 409 if the SKU already exists |
| `PUT /products/:id` | Partial update |
| `DELETE /products/:id` | Soft delete (`active=false`), so order history keeps its references |
| `POST /orders` | Upload a sale (see below). **Idempotent by `id`**: a repeat returns 200 with `duplicate: true` |
| `GET /orders?from&to&deviceId&limit` | Orders, newest first |
| `POST /orders/:id/void` | Void an order and put its stock back |
| `GET /reports/summary?from&to` | `{ orderCount, revenue, discount, byPayment[], topProducts[] }` for completed orders |
| `GET /sync/changes?since=<cursor>&limit=200` | Change feed (see below) |
| `POST /devices/heartbeat` | `{ id, name, kind: pos\|boss, appVersion }` |
| `GET /devices` | Known devices and when each was last seen |
| `POST /hardware/escpos` | Relay raw ESC/POS bytes to a LAN printer (used by the POS network printer driver) |

### Order upload

```json
{
  "id": "uuid generated on the POS",
  "number": "3F9A-261122-007",
  "deviceId": "pos-3f9a1c2b",
  "cashier": "Lan",
  "items": [{ "productId": "p-cf-den", "name": "Cà phê đen", "price": 20000, "qty": 2 }],
  "discount": 0,
  "paymentMethod": "cash",
  "paid": 50000,
  "createdAt": "2026-11-22T10:00:00.000Z"
}
```

The server recomputes `subtotal`, `total` and `change` and validates:

- `paid >= total`
- only cash payments can have change
- `discount <= subtotal`

It then decrements stock. Stock may go negative, because an offline sale has already happened and must still be recorded. The POS treats 4xx responses other than 401, 408 and 429 as permanent and marks the order *rejected*. It retries all other failures.

### Change feed (for Boss)

```
GET /api/sync/changes?since=0&limit=200
-> { "changes": [{ "seq": 1, "entity": "product"|"order", "id": "...", "op": "upsert"|"delete", "at": "...", "data": { ...current snapshot } }],
     "cursor": 200, "hasMore": true }
```

Boss stores `cursor` and calls again with `since=cursor` until `hasMore` is false. After that it polls, or polls when its screen opens. `data` is the **current** state of the entity, not the state at the time of the change, so applying the changes in order is always safe: last write wins.
