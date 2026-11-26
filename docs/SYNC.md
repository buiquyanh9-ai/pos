# ShopFlow API v2: hợp đồng giữa POS, Boss và máy chủ

Mọi endpoint nằm dưới `/api`.
- **Tiền** là số nguyên, đơn vị VNĐ. **Thời gian** theo ISO-8601 UTC.
- Báo cáo chia nhóm theo giờ địa phương của quán; tham số `tz` là độ lệch tính bằng phút, mặc định `420` (UTC+7).

## Xác thực và vai trò

- `POST /auth/login`:
  - Boss gửi `{ username, password }`; POS gửi `{ username, pin }`.
  - Trả về: `{ token, expiresAt, user }`. Phiên đăng nhập kéo dài 30 ngày, để máy POS vẫn đăng nhập trong lúc mất mạng.
- Gửi kèm `Authorization: Bearer <token>`. `GET /api/events` nhận thêm `?token=`, vì EventSource không đặt được header.
- Sau 5 lần sai mật khẩu/PIN với một tài khoản (hoặc từ một địa chỉ) trong 5 phút, đăng nhập trả về 429 cho tới hết khoảng thời gian đó.
- `GET /auth/staff` công khai, liệt kê tên nhân viên cho màn hình nhập PIN của POS. Không trả về thông tin bí mật.
- Header tuỳ chọn `x-api-key: <SHOPFLOW_API_KEY>` có quyền như chủ, dùng cho tích hợp và script.

| Vai trò | Quyền |
|---|---|
| `owner` (chủ) | Toàn quyền: báo cáo toàn cửa hàng, nhân viên (`/users`), thực đơn, lịch sử thao tác |
| `cashier` (thu ngân) | Bán hàng, huỷ/hoàn tiền (bắt buộc lý do), mở/đóng ca của mình, báo cáo ca (`/reports/summary?shiftId=`) |

## Các endpoint

### Đăng nhập và nhân viên

`POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/staff`

Chỉ chủ: `GET/POST/PUT /users` · `GET /audit`

### Thực đơn

| Endpoint | Ghi chú |
|---|---|
| `GET /products` | `{ products, categories, optionGroups, serverTime }` |
| `POST/PUT/DELETE /products/:id` | Chỉ chủ. `optionGroupIds: [...]`. Xoá là xoá mềm |
| `GET/POST/PUT /categories` | Ghi: chỉ chủ |
| `GET/POST/PUT /option-groups` | Size / đá / đường / topping. `options: [{name, priceDelta}]`, `multi`, `required` |
| `GET/POST/PUT /tables` | Bàn, kèm khu vực |

Sản phẩm còn trường `cost` (giá vốn nhập tay, tuỳ chọn, `null` khi chưa nhập). Giao diện POS và Boss không dùng trường này.

### Bán hàng

| Endpoint | Ghi chú |
|---|---|
| `POST /orders` | Không trùng theo `id` (xem *Gửi đơn*) |
| `GET /orders?from&to&status&shiftId&orderType&cashierId&deviceId&paymentMethod` | |
| `POST /orders/:id/void` `{reason}` | Huỷ đơn bấm nhầm. Không tính vào doanh thu |
| `POST /orders/:id/refund` `{reason, shiftId?}` | Trả lại tiền; trừ vào doanh thu tại thời điểm hoàn tiền |
| `POST /shifts/open` `{deviceId, openingCash}` · `GET /shifts/current?deviceId` | Mỗi người một ca đang mở trên một máy |
| `POST /shifts/:id/close` `{countedCash, note}` | Trả về báo cáo ca: `expectedCash`, `cashDifference`, tổng hợp |
| `GET /shifts?from&to` · `GET /shifts/:id/report` | |

*Gửi đơn (`POST /orders`):*
- Máy chủ tính lại tạm tính, tổng tiền và tiền thối, rồi kiểm tra.
- Quy tắc: `paid >= total`; chỉ thanh toán tiền mặt mới có tiền thối; `discount <= subtotal`.
- Phương thức thanh toán: `cash | transfer | card`. Máy cũ gửi `qr` được ghi nhận là `transfer`. Loại đơn: `dine_in | takeaway | delivery`.
- Mỗi dòng món là `{productId, name, price (đã gồm tuỳ chọn), qty, note?, options?, optionIds?}`.
- `optionIds` được lưu trên dòng món cùng chuỗi `options` dễ đọc; id không tồn tại bị bỏ qua.

### Kho

Phiên bản này không có module kho. Cơ sở dữ liệu từ phiên bản cũ có bảng kho sẽ được tự dọn khi khởi động.

### Báo cáo, dữ liệu trực tiếp, thông báo

| Endpoint | Ghi chú |
|---|---|
| `GET /reports/summary?from&to[&compare=1&shiftId&cashierId&deviceId&tz]` | Khoảng thời gian bất kỳ, chính xác tới phút, tối đa 400 ngày. Chủ, hoặc thu ngân kèm `shiftId`. Xem *Các trường tổng hợp* |
| `GET /dashboard` | Hôm nay tính tới hiện tại, so với hôm qua cùng giờ. Kèm các ca và hoá đơn đang mở |
| `GET /activity?before=` | Đơn mới nhất và ca đang mở, cho luồng hoạt động của Boss |
| `GET /events` | Sự kiện SSE: `order.created`, `order.updated`, `shift.updated`, `catalog.changed`, `open_orders.changed`, `notification`, `ping` |
| `GET /notifications` · `POST /notifications/read {ids \| "all"}` | |
| `GET/PUT /notifications/prefs` | Bật/tắt từng loại thông báo cho từng người |
| `POST /notifications/push-tokens {token, platform}` | Token FCM của điện thoại |
| `GET/PUT/DELETE /open-orders/:id` | Hoá đơn bàn chưa thanh toán. `PUT` kèm `version` để khoá lạc quan (409 nếu máy khác đã sửa), mỗi bàn một hoá đơn mở. `DELETE` kèm `{reason}` = huỷ (có ghi lịch sử) |
| `GET /sync/changes?since=<cursor>` | Luồng thay đổi theo con trỏ của sản phẩm và đơn hàng, để đồng bộ từng phần |

*Các trường tổng hợp (`/reports/summary`):* `orderCount`, `itemsSold`, `grossSales`, `discounts`, `refunds`, `netRevenue`, `avgOrderValue`, `voidedCount`/`voidedAmount`, `byHour[24]` (kèm `byMethod` tách tiền mặt và chuyển khoản), `byDay`, `byPayment`, `byOrderType`, `byCashier`, `byCategory`, `topProducts`, cùng `previous`/`change` khi `compare=1`. Máy chủ vẫn trả `costOfGoods`, `grossProfit`, `costCoverage` nhưng giao diện không hiển thị.

*Các loại thông báo:* `shift.closed`, `day.summary`, `order.voided`, `order.refunded`.

## Quy tắc nghiệp vụ

- **Không trùng đơn.** Đơn và các dòng món được ghi trong một transaction `BEGIN IMMEDIATE`, và mã đơn được kiểm tra lại bên trong khoá. Hai lần gửi đồng thời cùng một đơn cho ra một phản hồi 201 và một phản hồi 200 `duplicate: true` (có test kiểm tra).
- **Doanh thu:**
  - Đơn bán tính tại **thời điểm bán**.
  - Hoàn tiền tính tại **thời điểm hoàn tiền**, nên trừ vào ngày hoặc ca mà tiền thực sự ra khỏi két.
  - Đơn huỷ không bao giờ tính là doanh thu; được thống kê riêng.
  - Doanh thu thuần = tổng tiền bán sau chiết khấu − hoàn tiền.
- **Tiền dự kiến trong két của một ca** = tiền đầu ca + tiền mặt bán trong ca + tiền thu thêm − tiền chi ra − tiền mặt hoàn trong ca.
- **Lịch sử thao tác.** Đăng nhập, sửa nhân viên, sửa thực đơn, huỷ/hoàn tiền và thu/chi két đều được ghi vào `audit_log`.
