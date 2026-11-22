# ShopFlow – kế hoạch triển khai (Claude + Codex)

Nguồn yêu cầu: `c:\VISUAL\pos\CLAUDE.md`. Tham khảo giao diện: `c:\VISUAL\pos\Giaodien\*.png`. Chỉ học bố cục và luồng thao tác, không dùng logo, tên hay ảnh của Ocha.

## Quyết định kiến trúc

| Thành phần | Chọn | Lý do |
|---|---|---|
| Backend | Node 24 + Express + SQLite (`node:sqlite`), `apps/server` | User đã chọn ở đầu dự án; đã có test. Truy cập DB gom trong `db.ts` và các module, có thể chuyển sang PostgreSQL sau |
| POS | React + Vite + TS + Capacitor, `apps/pos` | Chạy trên Windows và đóng gói APK |
| Boss Mobile | React + Vite + TS + Capacitor, `apps/boss` (thiết kế mobile-first) | Tương đương Expo theo CLAUDE.md §6; cài được Android/iOS; dùng chung tooling và kiểm thử được bằng trình duyệt |
| Realtime | SSE `GET /api/events` | Một chiều server → client là đủ cho dashboard và cảnh báo |
| Push | Bảng `notifications` + SSE + Web Notification. Adapter FCM HTTP v1 tuỳ chọn (cần file service account) | Không phụ thuộc dịch vụ ngoài khi dev |
| Auth | Đăng nhập username + mật khẩu (Boss) hoặc PIN (POS); bearer token; vai trò `owner`, `cashier`, `stock` | CLAUDE.md §2 Quản lý nhân viên |

## Mô hình nghiệp vụ (backend)

- **Thực đơn:** categories, products (giá bán, giá vốn, ảnh), option groups (size, đá, đường… có cộng tiền), tables (bàn và khu vực).
- **Kho:** `inventory_items` (nguyên liệu hoặc hàng hoá: đơn vị, tồn, tồn tối thiểu), `recipes` (BOM món → nguyên liệu), `stock_moves` (sổ cái: sale, void, refund, import, adjust, count).
- **Bán hàng:**
  - Mỗi đơn có `id` do client sinh, nên upload lại không bị trùng.
  - Lưu đơn và trừ kho trong cùng một transaction `BEGIN IMMEDIATE`, chống trừ kho hai lần.
  - Hủy đơn (void) hoặc hoàn tiền (refund) thì trả lại kho và có ghi lý do.
  - Phương thức thanh toán: tiền mặt, thẻ, chuyển khoản, QR.
- **Ca làm việc:** mở ca (tiền đầu ca), đóng ca (tiền đếm thực tế so với tiền dự kiến), báo cáo ca. Đơn được gắn với ca và thu ngân.
- **Kiểm kê:** phiếu kiểm kê theo ca, gồm tồn dự kiến, tồn thực tế, chênh lệch và lý do. Tạo bút toán điều chỉnh, và gửi thông báo nếu có chênh lệch.
- **Nhập hàng:**
  - Nhà cung cấp.
  - Đề xuất nhập: nháp → chờ duyệt → duyệt hoặc từ chối → đã nhập.
  - Chủ cửa hàng duyệt. Khi nhận hàng thì cộng tồn.
- **Cảnh báo:** khi tồn vượt xuống dưới ngưỡng tối thiểu thì phát thông báo `stock.low`. Ngoài ra có `stock.variance`, `shift.closed` (tổng kết ca) và `purchase.pending`.
- **Báo cáo:**
  - Khoảng thời gian bất kỳ, chính xác đến từng phút; múi giờ +07:00.
  - Doanh thu gộp, chiết khấu, hoàn tiền, doanh thu thuần, giá vốn, lợi nhuận (khi có dữ liệu giá vốn).
  - Phân tích theo giờ, theo ngày, theo danh mục, theo phương thức thanh toán, theo nhân viên; món bán chạy; so sánh với kỳ trước.
- **Lịch sử thao tác:** `audit_log`.

## Phân công

| Giai đoạn | Claude | Codex |
|---|---|---|
| 1 | Backend v2 (toàn bộ nghiệp vụ trên) + test + `docs/SYNC.md` | Giao diện POS kiểu F&B: khung app, Bán hàng, Thanh toán, Đơn hàng, Cài đặt (theo tin 19:10 trong z_chat và ảnh `Giaodien/ocha_pos_*.png`) |
| 2 | `apps/boss`: đăng nhập, Tổng quan, Báo cáo (chọn giờ chính xác, theo giờ, danh mục, món, PTTT, nhân viên, so sánh), Hoạt động realtime, Kho, Duyệt nhập hàng, Thông báo | Các trang POS mới gọi API v2: đăng nhập PIN, Ca làm việc, Bàn, Kho (danh sách, sắp hết, lịch sử), Kiểm kê cuối ca, Phiếu nhập, Báo cáo ca |
| 3 | Review chéo, test luồng end-to-end (POS bán → Boss thấy doanh thu → hết hàng → cảnh báo → đề xuất → duyệt → nhập → tồn cập nhật), tài liệu, commit | Review chéo, sửa lỗi UI, chụp màn hình kiểm tra |

## Quy ước

- Mỗi agent chỉ sửa file thuộc phần mình. Cần đổi ở phần của người kia thì hỏi trong `z_chat`.
- Trước khi báo xong: `npm run typecheck`, `npm test` và `npm run build` đều phải pass.
- Không tự nhận một tính năng là xong nếu chưa kiểm thử.
- Commit không ghi dòng co-author. Claude commit và push theo mốc.
- Dữ liệu mẫu ghi rõ là dữ liệu mẫu (tên cửa hàng "Cửa hàng mẫu", tài khoản demo). Mật khẩu demo ghi trong README.
