<p align="center">
  <img src="packages/shared/brand/logo.svg" alt="ShopFlow" width="96" />
</p>

<h1 align="center">ShopFlow</h1>

<p align="center">
  Hệ thống bán hàng cho cửa hàng ăn uống, gồm <b>ứng dụng POS</b> tại quầy và <b>ứng dụng giám sát từ xa</b> cho chủ cửa hàng.
</p>

---

## Mục lục

1. [Giới thiệu](#1-giới-thiệu)
2. [Tính năng](#2-tính-năng)
3. [Kiến trúc và công nghệ](#3-kiến-trúc-và-công-nghệ)
4. [Cấu trúc thư mục](#4-cấu-trúc-thư-mục)
5. [Cài đặt và chạy thử](#5-cài-đặt-và-chạy-thử)
6. [Dùng Boss trên điện thoại](#6-dùng-boss-trên-điện-thoại)
7. [Thực đơn và ảnh món](#7-thực-đơn-và-ảnh-món)
8. [Đóng gói ứng dụng Android (APK)](#8-đóng-gói-ứng-dụng-android-apk)
9. [Thiết bị ngoại vi](#9-thiết-bị-ngoại-vi)
10. [Triển khai cho cửa hàng thật](#10-triển-khai-cho-cửa-hàng-thật)
11. [Cấu hình máy chủ](#11-cấu-hình-máy-chủ)
12. [Nghiệp vụ và đồng bộ dữ liệu](#12-nghiệp-vụ-và-đồng-bộ-dữ-liệu)
13. [Bảo mật](#13-bảo-mật)
14. [Kiểm thử](#14-kiểm-thử)
15. [Kết quả chạy thực tế và giới hạn](#15-kết-quả-chạy-thực-tế-và-giới-hạn)
16. [Tài liệu chi tiết](#16-tài-liệu-chi-tiết)

---

## 1. Giới thiệu

ShopFlow phục vụ cửa hàng đồ ăn, đồ uống quy mô vừa, có thu ngân và chủ cửa hàng. Hệ thống gồm hai ứng dụng độc lập, dùng chung một máy chủ và một cơ sở dữ liệu:

| Ứng dụng | Người dùng | Chạy trên |
|---|---|---|
| **ShopFlow POS** (`apps/pos`) | Thu ngân | Trình duyệt trên Windows; APK cho máy POS Android (đã chạy trên SUNMI T1-G) |
| **ShopFlow Boss** (`apps/boss`) | Chủ cửa hàng | Điện thoại Android (APK) hoặc iPhone/Android dạng web app cài lên màn hình chính |
| **Máy chủ** (`apps/server`) | Cả hai ứng dụng | Máy tính trong quán hoặc VPS có Node.js 24 |

Mọi số liệu trên Boss đều lấy từ giao dịch thật trên POS và cập nhật trong khoảng một giây. Dữ liệu mẫu chỉ dùng để chạy thử, luôn được đánh dấu "mẫu" và nằm trong cơ sở dữ liệu riêng.

## 2. Tính năng

### ShopFlow POS (thu ngân)

- **Bán hàng cảm ứng:** lưới món theo danh mục, tìm món, tuỳ chọn món (size, đá, đường, topping có cộng tiền), ghi chú, chiết khấu.
- **Ăn tại quán và mang đi:** sơ đồ bàn, bàn đang có khách được tô nổi; lưu hoá đơn chưa thanh toán, sửa từ máy bất kỳ, chuyển bàn.
- **Thanh toán:** tiền mặt (tính tiền thối), chuyển khoản kèm mã **VietQR** tự sinh theo số tiền.
- **Huỷ đơn, hoàn tiền, sửa đơn đã thanh toán:** bắt buộc ghi lý do, lưu vào lịch sử thao tác.
- **Ca làm việc và két tiền:** mở ca với tiền đầu ca, thu/chi tiền mặt trong ca, đếm tiền theo mệnh giá khi đóng ca, so sánh tiền dự kiến và tiền thực tế, in phiếu tổng kết ca.
- **Bán khi mất mạng:** đơn lưu trên máy trước, tự gửi lên khi có mạng lại, không bao giờ trùng đơn.
- **In hoá đơn và mở két:** máy in nhiệt ESC/POS qua USB hoặc mạng LAN; két mở khi thanh toán tiền mặt.
- **Báo cáo tại quầy:** doanh thu theo giờ (tách tiền mặt và chuyển khoản), bấm vào cột để xem danh sách đơn.
- **Quản lý (chỉ chủ):** thực đơn, giá, danh mục, tuỳ chọn, bàn, nhân viên (vai trò, PIN, mật khẩu, khoá tài khoản), thông tin cửa hàng và tài khoản ngân hàng.

### ShopFlow Boss (chủ cửa hàng)

- **Dashboard doanh thu thời gian thực:** doanh thu, số đơn, số món bán ra, hoàn tiền, chiết khấu, giá trị đơn trung bình.
- **Báo cáo theo khoảng thời gian:** hôm nay, hôm qua, 7 ngày, tháng, hoặc **chọn chính xác giờ bắt đầu và kết thúc** (ví dụ 08:00–11:30).
- **Phân tích:** biểu đồ doanh thu theo giờ và theo ngày, so sánh với kỳ trước, món bán chạy, doanh thu theo danh mục, theo phương thức thanh toán, theo thu ngân và theo ca.
- **Hoạt động trực tiếp:** luồng đơn mới, hoá đơn đang mở tại các bàn, lịch sử ca.
- **Thông báo:** huỷ đơn, hoàn tiền, tổng kết cuối ca và cuối ngày; tuỳ chọn loại thông báo muốn nhận.
- **Lịch sử thao tác:** đăng nhập, sửa thực đơn, sửa nhân viên, huỷ/hoàn tiền, thu/chi két.

### Phân quyền

| Vai trò | Quyền |
|---|---|
| **Chủ cửa hàng** | Toàn quyền: báo cáo toàn cửa hàng, nhân viên, thực đơn, lịch sử thao tác. Có tài khoản trên cả POS và Boss |
| **Thu ngân** | Bán hàng, huỷ/hoàn tiền có lý do, mở/đóng ca, thu/chi két, báo cáo của ca mình |

Máy chủ kiểm tra quyền ở từng API, không chỉ ẩn nút trên giao diện.

## 3. Kiến trúc và công nghệ

```
 ┌───────────────────────┐                         ┌────────────────────────┐
 │  ShopFlow POS         │   REST /api  (HTTPS)    │  ShopFlow Boss         │
 │  Windows / APK Android│ ───────────┐ ┌───────── │  Điện thoại chủ        │
 │  hàng đợi đơn offline │            │ │          │  (Wi-Fi hoặc 4G)       │
 └──────────┬────────────┘            ▼ ▼          └───────────▲────────────┘
            │ ESC/POS (USB/LAN)  ┌──────────────┐  SSE /api/events│ + FCM
            ▼                    │  Máy chủ     │ ────────────────┘
   Máy in nhiệt ──► Két tiền     │  Node 24     │
                                 │  Express     │──► SQLite (WAL)
                                 └──────────────┘
```

| Thành phần | Công nghệ |
|---|---|
| POS | React 19, Vite, TypeScript, Capacitor 7 (Android) |
| Boss | React 19, Vite, TypeScript, Capacitor 7 (Android), PWA cho iPhone |
| Máy chủ | Node.js 24, Express, `node:sqlite` (SQLite chế độ WAL) |
| Thời gian thực | Server-Sent Events (`/api/events`), tự nối lại khi mất kết nối |
| Thông báo đẩy | Bảng thông báo + SSE; gửi FCM HTTP v1 khi có cấu hình Firebase |
| Xác thực | PIN (POS) hoặc mật khẩu (Boss), bearer token, mật khẩu băm scrypt |
| Dùng chung | `packages/shared`: kiểu dữ liệu, định dạng tiền/giờ, tạo mã VietQR |

Cùng một mã nguồn giao diện chạy trên trình duyệt Windows và trong APK Android, không phải viết lại. Mọi truy vấn cơ sở dữ liệu gom trong máy chủ, nên có thể chuyển sang PostgreSQL mà không đổi API hay hai ứng dụng (xem [docs/DEPLOY.md](docs/DEPLOY.md)).

## 4. Cấu trúc thư mục

```
apps/
  server/          Máy chủ: API, phân quyền, đơn hàng, ca & két, báo cáo, thông báo, SSE
    src/routes/    Các nhóm API
    test/          Kiểm thử API và nghiệp vụ
  pos/             Ứng dụng POS
    src/screens/   Màn hình: đăng nhập, bán hàng, đơn, ca, báo cáo, quản lý, cài đặt
    src/hardware/  Driver máy in, két, máy quét
    android/       Project Android (Capacitor)
  boss/            Ứng dụng Boss
    src/screens/   Tổng quan, báo cáo, hoạt động, thêm (thông báo, lịch sử)
    android/       Project Android (Capacitor)
packages/shared/   Mã dùng chung cho POS và Boss
product/           Thực đơn (z.product) và ảnh món (product_img/)
docs/              Tài liệu kỹ thuật chi tiết
scripts/           Demo một thao tác, máy in ảo, tunnel, tạo icon
```

## 5. Cài đặt và chạy thử

### Yêu cầu

- **Node.js 24** trở lên (dùng `node:sqlite` có sẵn, không cần cài cơ sở dữ liệu riêng).
- Windows 10/11 (đã kiểm thử), macOS hoặc Linux.
- Để build APK: Android Studio (JDK 21 + Android SDK 35).

### Chạy ở chế độ phát triển

```powershell
git clone https://github.com/buiquyanh9-ai/pos.git shopflow
cd shopflow
npm install
npm run seed:demo -w apps/server    # tuỳ chọn: thêm 14 ngày bán hàng MẪU để báo cáo có số liệu
npm run dev                         # máy chủ :4000, POS :5173, Boss :5174
```

- **POS:** http://localhost:5173. Chọn nhân viên rồi nhập PIN.
- **Boss:** http://localhost:5174. Đăng nhập bằng tên đăng nhập và mật khẩu của chủ. Giao diện thiết kế cho điện thoại; trên máy tính hãy bật chế độ giả lập thiết bị của trình duyệt.

Lần chạy đầu, máy chủ tự tạo cơ sở dữ liệu `apps/server/data/shopflow.db` với cửa hàng mẫu, tài khoản mẫu, bàn và thực đơn từ `product/z.product`.

### Tài khoản mẫu

| Vai trò | Tên đăng nhập | Mật khẩu (Boss) | PIN (POS) |
|---|---|---|---|
| Thu ngân: Kim | `thungan` | `thungan123` | `1111` |
| Thu ngân: Minh | `thungan2` | `thungan2123` | `2222` |
| Chủ cửa hàng: Hiền | `chu` | `chu123456` | `3333` |

> Chỉ dùng để chạy thử. Với cửa hàng thật, xem [mục 10](#10-triển-khai-cho-cửa-hàng-thật).

### Demo toàn hệ thống bằng một thao tác (Windows)

Bấm đúp **`Demo ShopFlow.cmd`** (hoặc `npm run demo`). Script [scripts/demo.mjs](scripts/demo.mjs) sẽ:

- chạy máy chủ ở cổng 4000 với **cơ sở dữ liệu mẫu riêng** `apps/server/data/demo.db` (tạo mới mỗi lần: 14 ngày bán hàng mẫu), không đụng dữ liệu thật;
- bật máy in ESC/POS ảo ở cổng 9100 (hoá đơn lưu ở `output/virtual-printer/`);
- mở POS trên máy ảo Android nếu có Android SDK, nếu không thì mở POS bản web; mở Boss.

Đóng cửa sổ demo là tắt hết. Tuỳ chọn: `--keep` (giữ dữ liệu demo lần trước), `--no-android` (mở POS bản web), `--web` (mở thêm POS bản web).

### Các lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy máy chủ, POS và Boss, tự tải lại khi sửa code |
| `npm run build` | Build bản chính thức của POS (`apps/pos/dist`) và Boss (`apps/boss/dist`) |
| `npm run serve` | Build rồi phục vụ POS + Boss + API trên cùng cổng 4000 |
| `npm test` | Chạy toàn bộ kiểm thử |
| `npm run typecheck` | Kiểm tra TypeScript cho cả ba ứng dụng |
| `npm run demo` | Demo toàn hệ thống (như trên) |
| `npm run tunnel` | Tạo link HTTPS công khai tạm thời qua Cloudflare Quick Tunnel |
| `npm start -w apps/server` | Chạy máy chủ bản chính thức (không theo dõi sửa code) |
| `npm run seed:demo -w apps/server` | Thêm 14 ngày bán hàng mẫu (một lần cho mỗi cơ sở dữ liệu) |
| `npm run create-owner -w apps/server -- <user> <pass> [PIN]` | Tạo hoặc đặt lại tài khoản chủ |
| `npm run import-menu -w apps/server` | Kiểm tra file thực đơn, in lưới món và cảnh báo, không thay đổi dữ liệu |
| `npm run backup -w apps/server -- <thư mục>` | Sao lưu cơ sở dữ liệu khi máy chủ đang chạy |
| `npm run android:apk -w apps/pos` | Build APK POS (tương tự với `apps/boss`) |

## 6. Dùng Boss trên điện thoại

### Cùng mạng Wi-Fi với máy chủ

```powershell
npm run serve
```

- Máy tính mở POS tại `http://localhost:4000/pos/`.
- Điện thoại mở `http://<IP máy tính>:4000/boss/`. Máy chủ in ra IP mạng LAN khi khởi động.
- Nếu điện thoại không vào được, mở cổng 4000 trên Windows Firewall (PowerShell quyền Administrator):
  `New-NetFirewallRule -DisplayName "ShopFlow 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private`,
  và để mạng Wi-Fi ở chế độ *Private*.

### Từ mạng bất kỳ (4G, Wi-Fi khác)

- **Lâu dài:** đặt máy chủ trên VPS hoặc sau Cloudflare Tunnel có tên miền riêng ([mục 10](#10-triển-khai-cho-cửa-hàng-thật)).
- **Thử nhanh:** chạy `npm run serve` và `npm run tunnel` ở hai cửa sổ. Lệnh tunnel in ra link `https://<ngẫu-nhiên>.trycloudflare.com/boss/`; link đổi mỗi lần chạy lại. Cần file `tools/cloudflared.exe` (tải tại github.com/cloudflare/cloudflared/releases).

### Cài lên màn hình chính

- **iPhone:** mở link bằng **Safari** → *Chia sẻ* → *Thêm vào MH chính*. Boss có biểu tượng riêng và mở toàn màn hình như ứng dụng, không cần App Store.
- **Android:** cài APK Boss ([mục 8](#8-đóng-gói-ứng-dụng-android-apk)) hoặc dùng *Thêm vào màn hình chính* của Chrome.

## 7. Thực đơn và ảnh món

Thực đơn được quản lý trong file Markdown `product/z.product`:

- Máy chủ nạp file khi khởi động và nạp lại mỗi khi file được lưu. Món, giá, danh mục, bố cục 5 ô mỗi hàng và các bàn 001–024 đều lấy từ file này.
- Ảnh món đặt ở `product/product_img/<nhãn>/<tên>.jpg|png|webp`. Các nhãn: `com-trang`, `com-dao`, `mon-them`, `do-an-kem`, `do-uong`. Máy chủ phục vụ ảnh tại `/media/products/<nhãn>/<tên>`. Món mang đi dùng chung ảnh với món ăn tại quán.
- Máy chủ ưu tiên thư mục `product/` đặt **cạnh** thư mục mã nguồn (để thực đơn của quán không bị ghi đè khi cập nhật code), nếu không có thì dùng `product/` bên trong mã nguồn. Có thể chỉ định đường dẫn khác bằng `MENU_FILE` và `MENU_IMG_DIR`.
- Chủ cũng có thể sửa thực đơn trực tiếp trong POS (*Quản lý*).

## 8. Đóng gói ứng dụng Android (APK)

POS và Boss đều có project Android Capacitor (`apps/pos/android`, mã ứng dụng `vn.shopflow.pos`; `apps/boss/android`, mã `vn.shopflow.boss`). Yêu cầu Android 6.0 trở lên (minSdk 23).

```powershell
npm run android:apk -w apps/pos     # → apps/pos/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk -w apps/boss
adb install -r apps/pos/android/app/build/outputs/apk/debug/app-debug.apk
```

- Có thể cài không cần cáp: đặt file APK lên một đường dẫn web, mở bằng trình duyệt trên máy POS, tải về và cài (cần bật *Nguồn không xác định*).
- Lần mở đầu, vào **Cài đặt** của POS để nhập địa chỉ máy chủ (ví dụ `https://shop.example.com`) và bấm **Kiểm tra kết nối**.
- Trên APK, phím Back của Android không thoát POS, giao diện không bị tràn dưới thanh hệ thống trên Android 15.

Hướng dẫn từng bước (cài Android Studio, biến môi trường, ký APK, danh sách kiểm tra trên máy thật): [docs/ANDROID.md](docs/ANDROID.md).

## 9. Thiết bị ngoại vi

Tính năng bán hàng không phụ thuộc phần cứng: khi không có thiết bị, POS vẫn chạy với driver in qua trình duyệt hoặc driver giả lập. Chọn thiết bị trong **Cài đặt → Phần cứng** của POS, có nút **In thử** và **Mở két thử**.

| Driver | Thiết bị | Ghi chú |
|---|---|---|
| `escpos-usb` | Máy in nhiệt ESC/POS cắm USB vào máy POS Android | In và mở két trực tiếp từ máy POS, chạy được cả khi mất mạng |
| `escpos-network` | Máy in nhiệt ESC/POS qua mạng LAN (cổng 9100) | Gửi qua máy chủ trong cùng mạng |
| `sunmi` | Máy in tích hợp của SUNMI | Dùng khi thiết bị có cầu nối dịch vụ in SUNMI ([docs/SUNMI.md](docs/SUNMI.md)) |
| `browser-print` | Máy in bất kỳ qua hộp thoại in của trình duyệt | Dùng trên Windows |
| `keyboard-wedge` | Máy quét mã vạch dạng bàn phím (USB/Bluetooth) | Quét để thêm món |
| `mock` | Không có thiết bị | Dùng khi phát triển và kiểm thử |

Két tiền cắm vào máy in (cổng RJ11) và mở bằng lệnh ESC/POS khi thanh toán tiền mặt. Không cần máy in thật để thử: `node scripts/virtual-printer.cjs 9100` tạo máy in mạng ảo, giải mã lệnh và lưu từng hoá đơn ra file.

## 10. Triển khai cho cửa hàng thật

Có hai cách, chi tiết trong [docs/DEPLOY.md](docs/DEPLOY.md):

- **Máy chủ trên VPS (khuyến nghị):** VPS Linux nhỏ (1 vCPU, 1 GB RAM) chạy Node 24, đặt sau HTTPS (Caddy hoặc Cloudflare Tunnel). POS và Boss dùng được ở mọi nơi, máy tính trong quán có thể tắt.
- **Máy chủ trong quán (LAN):** một máy tính luôn bật, IP cố định trong mạng; chạy máy chủ như dịch vụ Windows. Có thể thêm Cloudflare Tunnel để chủ xem từ xa. File `Mo ShopFlow.cmd` là ví dụ khởi động một chạm cho cách này (sao lưu dữ liệu rồi chạy máy chủ).

Các bước chung:

1. `npm install` và `npm run build`.
2. Tạo `apps/server/.env` với `SEED=0` (không tạo dữ liệu mẫu) và `DB_PATH` trỏ tới nơi lưu dữ liệu.
3. Tạo tài khoản chủ: `npm run create-owner -w apps/server -- <tên đăng nhập> <mật khẩu mạnh> <PIN>`.
4. Chạy `npm start -w apps/server` dưới dạng dịch vụ tự khởi động lại.
5. Thêm nhân viên và thực đơn từ POS (*Quản lý*) hoặc file `product/z.product`.
6. Lên lịch sao lưu hằng ngày: `npm run backup -w apps/server -- <thư mục sao lưu>` (giữ 30 bản gần nhất).

## 11. Cấu hình máy chủ

File `apps/server/.env` (không bắt buộc, xem mẫu ở `apps/server/.env.example`):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Cổng và địa chỉ lắng nghe. Đặt `HOST=127.0.0.1` khi chạy sau reverse proxy |
| `DB_PATH` | `./data/shopflow.db` | File SQLite |
| `SEED` | `1` | `0` để không tạo dữ liệu mẫu |
| `SEED_DEMO_SALES` | `0` | `1` để thêm 14 ngày bán hàng mẫu khi khởi động |
| `TZ_OFFSET_MIN` | `420` | Múi giờ của quán, tính bằng phút (UTC+7) |
| `DAY_SUMMARY_HOUR` | `22` | Giờ gửi thông báo tổng kết cuối ngày |
| `FCM_SERVICE_ACCOUNT` | *(trống)* | File JSON service account Firebase, bật thông báo đẩy khi app Boss đang đóng |
| `SHOPFLOW_API_KEY` | *(trống)* | Khoá dịch vụ cho tích hợp, có quyền như chủ |
| `MENU_FILE` / `MENU_IMG_DIR` | *(tự tìm `product/`)* | Đường dẫn file thực đơn và thư mục ảnh món |
| `BACKUP_KEEP` | `30` | Số bản sao lưu giữ lại |

Cấu hình phía POS và Boss (địa chỉ máy chủ, máy in, két) nhập trong màn hình Cài đặt / Đăng nhập của từng ứng dụng.

## 12. Nghiệp vụ và đồng bộ dữ liệu

Luồng chính:

1. Thu ngân đăng nhập bằng PIN, mở ca với tiền đầu ca.
2. Tạo đơn và thanh toán trên POS. Đơn được lưu trên máy trước rồi gửi lên máy chủ; mất mạng vẫn bán tiếp, thanh tiêu đề hiện số đơn đang chờ gửi.
3. Máy chủ lưu đơn và các dòng món trong **một transaction**, tính lại tổng tiền phía máy chủ.
4. Máy chủ phát sự kiện qua SSE; Boss cập nhật doanh thu, số đơn, số món trong khoảng một giây.
5. Huỷ đơn, hoàn tiền và tổng kết ca tạo thông báo cho chủ.
6. Cuối ca, thu ngân đếm tiền theo mệnh giá; báo cáo ca so sánh tiền dự kiến và tiền thực tế, gửi về Boss.

Đảm bảo tính đúng:

- **Chống trùng đơn:** mỗi đơn có mã do thiết bị sinh ra. Gửi lại nhiều lần hoặc gửi đồng thời đều chỉ lưu một lần.
- **Hoá đơn mở dùng khoá lạc quan:** hai máy cùng sửa một bàn thì máy sau nhận lỗi xung đột thay vì ghi đè. Mỗi bàn chỉ có một hoá đơn mở.
- **Doanh thu chính xác theo giờ:** tính theo múi giờ của quán; doanh thu thuần đã trừ chiết khấu và hoàn tiền; đơn huỷ không tính vào doanh thu nhưng vẫn được thống kê riêng.
- **Boss tự nối lại** khi điện thoại khoá màn hình, đổi ứng dụng hoặc đổi mạng, rồi tải lại số liệu để không hiện số cũ.

Danh sách API, quy tắc tính doanh thu và các sự kiện thời gian thực: [docs/SYNC.md](docs/SYNC.md).

## 13. Bảo mật

- Mật khẩu và PIN được băm, không lưu dạng rõ.
- Khoá đăng nhập 5 phút sau 5 lần nhập sai, theo tài khoản và theo IP thật của người dùng (nhận biết proxy).
- Giới hạn số yêu cầu theo IP và thêm các header bảo mật khi mở ra Internet.
- Mọi thao tác nhạy cảm (huỷ, hoàn tiền, huỷ hoá đơn mở, thu/chi két, sửa nhân viên và thực đơn, đăng nhập) được ghi vào lịch sử thao tác.
- Khi triển khai thật: đổi hoặc không tạo tài khoản mẫu (`SEED=0`), dùng HTTPS, mật khẩu chủ tối thiểu 10 ký tự.

## 14. Kiểm thử

```powershell
npm test            # máy chủ (node:test) + POS và Boss (Vitest)
npm run typecheck   # TypeScript cho cả ba ứng dụng
```

Bộ kiểm thử gồm 51 ca, chạy trên cơ sở dữ liệu tạm trong bộ nhớ:

- **Máy chủ (30 ca):** đăng nhập và phân quyền, tạo đơn, chống trùng khi gửi lại và gửi đồng thời, huỷ và hoàn tiền, ca và két tiền, hoá đơn mở và khoá lạc quan, báo cáo theo giờ và theo khoảng thời gian, thông báo, SSE, luồng E2E từ POS tới Boss, nạp thực đơn, ảnh món, lệnh in ESC/POS.
- **POS (15 ca):** giỏ hàng và tính tiền, cài đặt máy chủ/thiết bị, tổng kết ca.
- **Boss (6 ca):** tính khoảng thời gian báo cáo (theo giờ chính xác), tạo mã VietQR.

## 15. Kết quả chạy thực tế và giới hạn

Đã chạy thực tế:

- POS bản APK trên **máy POS SUNMI T1-G** với máy in nhiệt rời cắm USB và két tiền: bán hàng, in hoá đơn, mở két khi thanh toán tiền mặt.
- Máy chủ trên VPS, truy cập qua HTTPS: POS tại quầy và Boss trên điện thoại qua 4G đồng bộ trong khoảng một giây, máy tính trong quán tắt.
- Mất Wi-Fi/LAN trên máy POS vẫn bán, in và mở két; có mạng lại thì đơn tự đồng bộ trong khoảng 10 giây. Đơn trong giỏ vẫn còn sau khi tắt hẳn ứng dụng và mở lại.
- POS và Boss bản APK trên máy ảo Android 15.

Giới hạn hiện tại và hướng phát triển:

- **Thông báo đẩy khi app Boss đang đóng (FCM):** phần gửi phía máy chủ đã viết, nhưng chưa thử với một project Firebase thật. Khi Boss đang mở hoặc chạy nền, thông báo vẫn đến ngay qua SSE.
- **Cơ sở dữ liệu:** đang dùng SQLite, đủ cho quy mô một cửa hàng; đường chuyển sang PostgreSQL đã mô tả trong [docs/DEPLOY.md](docs/DEPLOY.md).
- **Boss trên iPhone** dùng dạng web app; chưa build bản iOS gốc qua App Store.
- Theo yêu cầu của cửa hàng, phiên bản này **không có module kho và không tính giá vốn/lợi nhuận**, chỉ theo dõi doanh thu.

## 16. Tài liệu chi tiết

| Tài liệu | Nội dung |
|---|---|
| [docs/SYNC.md](docs/SYNC.md) | API, quy tắc nghiệp vụ, công thức doanh thu, sự kiện thời gian thực |
| [docs/ANDROID.md](docs/ANDROID.md) | Build, ký và cài APK; kiểm tra trên máy POS thật |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Triển khai LAN hoặc VPS, sao lưu, FCM, bảo mật, chuyển sang PostgreSQL |
| [docs/SUNMI.md](docs/SUNMI.md) | Tích hợp máy in SUNMI |
