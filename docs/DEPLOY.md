# Triển khai ShopFlow cho cửa hàng thật

## Cách A: máy chủ đặt trong quán (LAN)

Dùng khi chủ chỉ xem Boss bằng Wi-Fi của quán, hoặc qua VPN hay tunnel.

1. Dùng một máy tính nhỏ hoặc mini-PC luôn bật trong quán, có IP LAN cố định (đặt DHCP reservation trên router).
2. Cài Node.js 24 LTS, chép mã nguồn, rồi chạy `npm install` và `npm run build`.
3. Trong `apps/server/.env`, đặt `SEED=0` và `DB_PATH=D:\shopflow\shopflow.db`. Sau đó tạo tài khoản chủ:
   `npm run create-owner -w apps/server -- chu <mật-khẩu-mạnh> <PIN>`.
4. Chạy máy chủ dưới dạng dịch vụ để tự khởi động lại khi máy bật lại. Một cách là dùng [NSSM](https://nssm.cc):
   `nssm install ShopFlow "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env src/index.ts"`, với thư mục làm việc là `apps\server`.
5. Mở cổng TCP 4000 trên Windows Firewall (chiều vào, profile Private).
6. Trên máy POS và điện thoại, nhập địa chỉ máy chủ `http://<ip-máy-tính>:4000` ở màn hình Cài đặt / Đăng nhập.

File `Mo ShopFlow.cmd` ở thư mục gốc là ví dụ khởi động một chạm cho cách này: sao lưu dữ liệu, chạy máy chủ và mở POS.

## Cách B: máy chủ trên Internet (khuyến nghị để chủ xem từ xa)

1. Dùng một VPS chạy Node 24. Cấu hình 1 vCPU / 1 GB RAM là đủ cho quy mô này (khoảng 10 triệu VNĐ/ngày, vài trăm đơn/ngày).
2. Đặt một reverse proxy có HTTPS phía trước, ví dụ Caddy:
   ```
   shop.example.com {
     reverse_proxy 127.0.0.1:4000 {
       flush_interval -1     # không đệm SSE để cập nhật trực tiếp không bị trễ
     }
   }
   ```
3. Chạy máy chủ với `HOST=127.0.0.1` phía sau proxy. Hai ứng dụng khi đó dùng địa chỉ `https://shop.example.com`.
4. Khi chỉ dùng HTTPS, có thể bỏ `cleartext` / `usesCleartextTraffic` khỏi bản Android.

### Ví dụ đã chạy thực tế: VPS Ubuntu + Cloudflare Tunnel

Cách này đã dùng cho cửa hàng thử nghiệm: VPS Ubuntu 24.04 (1 vCPU, 1 GB RAM, 20 GB SSD), tên miền riêng qua Cloudflare. Máy tính trong quán có thể tắt.

1. Cài Node 24, đặt múi giờ `Asia/Ho_Chi_Minh`. SSH chỉ cho đăng nhập bằng khoá; tường lửa `ufw` chỉ mở cổng SSH.
2. Chép mã nguồn đã build vào `/opt/shopflow` (gồm `apps/server`, `apps/pos/dist`, `apps/boss/dist` và `product/`). Chạy bằng một user riêng, ví dụ `shopflow`.
3. Tạo dịch vụ systemd, ví dụ `/etc/systemd/system/shopflow.service`:
   ```ini
   [Unit]
   Description=ShopFlow
   After=network-online.target

   [Service]
   User=shopflow
   WorkingDirectory=/opt/shopflow/apps/server
   Environment=HOST=127.0.0.1 PORT=4000 SEED=0
   ExecStart=/usr/bin/node --env-file-if-exists=.env src/index.ts
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Rồi chạy `systemctl enable --now shopflow`.
4. Cài `cloudflared` và chạy `cloudflared service install <TOKEN>` với token của tunnel. Nếu nhà mạng chặn QUIC/UDP, dùng `--protocol http2`. Máy chủ chỉ nghe ở `127.0.0.1:4000`, ra Internet hoàn toàn qua tunnel.
5. Kiểm tra `https://<tên-miền>/api/health`, `/pos/` và `/boss/`.
6. Chỉ để **một** nơi chạy tunnel. Nếu cả laptop và VPS cùng chạy, một nửa số yêu cầu sẽ lỗi 502.
7. Cập nhật code: đóng gói, chép lên VPS, giải nén vào `/opt/shopflow` (không ghi đè thư mục `data/`), rồi `systemctl restart shopflow`.

Với APK chạy trên máy POS Android 6, xem lưu ý về chứng chỉ Let's Encrypt trong [ANDROID.md](ANDROID.md).

## Sao lưu

Cơ sở dữ liệu là một file SQLite ở chế độ WAL. Lệnh có sẵn tạo bản sao nhất quán trong khi máy chủ vẫn chạy (`VACUUM INTO`), và giữ 30 bản gần nhất (`BACKUP_KEEP`):

```powershell
npm run backup -w apps/server -- D:\ShopFlowBackup
```

Chạy hằng ngày bằng Task Scheduler của Windows:
- Action: `npm.cmd`
- Arguments: `run backup -w apps/server -- D:\ShopFlowBackup`
- Start in: thư mục mã nguồn

Trên Linux, dùng cron, ví dụ chạy lúc 03:30 hằng ngày:
`30 3 * * * cd /opt/shopflow/apps/server && node --env-file-if-exists=.env src/backup.ts /opt/shopflow/backups`

Cũng có thể dừng dịch vụ rồi chép cùng lúc `shopflow.db`, `shopflow.db-wal` và `shopflow.db-shm`. Nên giữ bản sao ở nơi khác, và thường xuyên thử khôi phục: chép một bản sao lưu vào `DB_PATH` trong lúc máy chủ đang dừng.

## Thông báo đẩy tới điện thoại (FCM)

Khi chưa có FCM, Boss vẫn nhận cảnh báo ngay lúc đang mở hoặc chạy nền (SSE + banner trong ứng dụng + thông báo của trình duyệt). Để nhận cả khi ứng dụng đã đóng:

1. Tạo project Firebase và thêm ứng dụng Android `vn.shopflow.boss`. Đặt `google-services.json` vào `apps/boss/android/app/`.
2. Thêm `@capacitor/push-notifications` vào `apps/boss`. Khi đăng nhập, đăng ký thiết bị và gửi token lên `POST /api/notifications/push-tokens`.
3. Trong Firebase console, vào *Project settings → Service accounts → Generate new private key*. Lưu file trên máy chủ và đặt `FCM_SERVICE_ACCOUNT=đường/dẫn/key.json`.
4. Khởi động lại máy chủ. Log phải hiện `Push (FCM): enabled`.

Phần gửi phía máy chủ đã được viết (FCM HTTP v1 với JWT ký sẵn), nhưng **chưa thử với một project Firebase thật**.

## Danh sách kiểm tra bảo mật

- Đổi toàn bộ tài khoản mẫu, hoặc khởi động với `SEED=0`.
- Mật khẩu chủ tối thiểu 10 ký tự.
- Dùng HTTPS khi máy chủ truy cập được từ Internet.
- Đăng nhập bị khoá 5 phút sau 5 lần sai PIN hoặc mật khẩu.
- Mọi lần huỷ đơn, hoàn tiền, huỷ hoá đơn mở và thu/chi két đều có trong lịch sử thao tác (`GET /api/audit`).
- Nếu token Cloudflare Tunnel từng bị lộ, tạo lại token trong Cloudflare.

## Chuyển sang PostgreSQL sau này

Toàn bộ SQL nằm trong `apps/server/src/db.ts` (lược đồ), `reports.ts` và `routes/*.ts`. Chuyển sang PostgreSQL gồm:
- Chuyển lược đồ: `INTEGER PRIMARY KEY AUTOINCREMENT` → `bigserial`, `REAL` → `numeric(14,3)`.
- Thay `node:sqlite` bằng `pg`.
- Giữ nguyên ranh giới transaction. `BEGIN IMMEDIATE` đổi thành `SELECT … FOR UPDATE` trên mã đơn.

API HTTP và hai ứng dụng không cần thay đổi.
