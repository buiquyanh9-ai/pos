# ShopFlow

ShopFlow là hệ thống bán hàng và theo dõi doanh thu cho cửa hàng đồ ăn, đồ uống. Hệ thống gồm hai ứng dụng độc lập, dùng chung một máy chủ (backend) và một cơ sở dữ liệu:

| Ứng dụng | Người dùng | Chạy trên |
|---|---|---|
| **ShopFlow POS** (`apps/pos`) | Thu ngân | Trình duyệt trên Windows; APK cho máy POS Android (Capacitor) |
| **ShopFlow Boss** (`apps/boss`) | Chủ cửa hàng | Điện thoại (Android/iOS qua Capacitor, hoặc web app cài lên màn hình chính) |
| **Máy chủ** (`apps/server`) | Cả hai ứng dụng | Máy tính hoặc server bất kỳ có Node.js 24 |

```
apps/server     Node 24 + Express + SQLite (node:sqlite) · đăng nhập & phân quyền · đơn hàng · ca & két tiền
                · báo cáo · thông báo · cập nhật thời gian thực (SSE)
apps/pos        React + Vite + TS · POS cảm ứng · hàng đợi đơn khi mất mạng · driver thiết bị (máy in, máy quét, két)
apps/boss       React + Vite + TS · dashboard chủ quán · báo cáo theo khung giờ chính xác · hoạt động trực tiếp · thông báo
packages/shared Kiểu dữ liệu và hàm định dạng dùng chung cho POS và Boss
product/        Thực đơn (z.product) và ảnh món (product_img/)
docs/           SYNC.md (API & quy tắc nghiệp vụ) · ANDROID.md (APK) · DEPLOY.md (triển khai) · SUNMI.md
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

## Chạy nhanh (Windows)

Cần **Node.js 24 trở lên**.

```powershell
npm install                         # chạy trong thư mục gốc của mã nguồn
npm run seed:demo -w apps/server    # tuỳ chọn: thêm 14 ngày bán hàng MẪU để báo cáo có số liệu
npm run dev                         # máy chủ :4000, POS :5173, Boss :5174
```

- POS: http://localhost:5173. Đăng nhập bằng cách chọn nhân viên rồi nhập PIN.
- Boss: http://localhost:5174. Đăng nhập bằng tên đăng nhập và mật khẩu của chủ. Giao diện thiết kế cho màn hình điện thoại; trên máy tính hãy bật chế độ giả lập thiết bị (device toolbar) của trình duyệt.
- Lần chạy đầu, máy chủ tự tạo **dữ liệu mẫu**: cửa hàng "Cửa hàng mẫu", các tài khoản và bàn mẫu (thực đơn lấy từ `product/z.product`). Mọi bản ghi mẫu đều được đánh dấu "mẫu".

### POS trên máy tính, Boss trên điện thoại (cùng Wi-Fi)

```powershell
npm run serve        # build POS + Boss, rồi phục vụ tất cả ở cổng 4000
```

- Trên máy tính, mở POS tại `http://localhost:4000/pos/`.
- Trên điện thoại, kết nối cùng Wi-Fi và mở `http://<IP máy tính>:4000/boss/` (ví dụ `http://192.168.2.211:4000/boss/`). Máy chủ in ra địa chỉ IP mạng LAN khi khởi động. Dùng *Thêm vào màn hình chính* của trình duyệt để có biểu tượng như một ứng dụng.
- **iPhone:** mở địa chỉ bằng **Safari**, bấm *Chia sẻ* → *Thêm vào MH chính*. ShopFlow Boss sẽ có biểu tượng riêng và mở toàn màn hình như ứng dụng, không cần App Store. Trong app có banner hướng dẫn việc này.
- Mỗi đơn bán, hoàn tiền, chốt ca và hoá đơn đang mở đều hiện trên điện thoại trong khoảng một giây (SSE).
- Nếu điện thoại không kết nối được, hãy mở cổng 4000 trên Windows Firewall. Chạy PowerShell **với quyền Administrator**:
  `New-NetFirewallRule -DisplayName "ShopFlow 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private`.
  Đồng thời kiểm tra mạng Wi-Fi đang để chế độ *Private* (Riêng tư).

### File thực đơn: `product/z.product`

Thực đơn của quán được quản lý trong `product/z.product`, một file Markdown.
- Máy chủ tìm thư mục `product/` cạnh thư mục mã nguồn trước (cách bố trí trên máy của quán), nếu không có thì dùng `product/` bên trong mã nguồn. Có thể chỉ định đường dẫn khác bằng biến `MENU_FILE` và `MENU_IMG_DIR`.
- Máy chủ nạp thực đơn khi khởi động và nạp lại mỗi khi file được lưu. Món, giá, danh mục, bố cục 5 ô mỗi hàng và các bàn 001–024 đều lấy từ file này.
- Ảnh món đặt ở `product/product_img/<nhãn>/<tên>.jpg|png|webp`. Các nhãn: `com-trang` (cơm trắng), `com-dao` (cơm đảo), `mon-them` (món thêm), `do-an-kem` (đồ ăn kèm), `do-uong` (đồ uống). Ví dụ: `com-trang/com-trang-suon.jpg`. Máy chủ phục vụ ảnh tại `/media/products/<nhãn>/<tên>`; đường dẫn kiểu cũ (không có nhãn) vẫn dùng được. Món mang đi dùng chung ảnh với món ăn tại quán. Có sẵn sáu ảnh đồ ăn kèm để dùng cho món sau này; thêm ảnh không tự thêm món hay giá.
- Kiểm tra kết quả mà không thay đổi gì: `npm run import-menu -w apps/server`. Lệnh in ra lưới thực đơn và các cảnh báo nếu có.

### Chủ quán xem từ mạng bất kỳ (4G, Wi-Fi khác)

```powershell
npm run serve          # cửa sổ 1: máy chủ của quán
npm run tunnel         # cửa sổ 2: link https công khai (Cloudflare Quick Tunnel, miễn phí)
```

`npm run tunnel` in ra `https://<ngẫu-nhiên>.trycloudflare.com/boss/`. Mở link đó bằng Safari trên iPhone và thêm vào màn hình chính. Dùng được ở mọi nơi, cập nhật thời gian thực.
- Cần file `tools/cloudflared.exe`, tải tại github.com/cloudflare/cloudflared/releases.
- Link thay đổi mỗi lần khởi động lại tunnel. Muốn địa chỉ cố định, dùng Cloudflare tunnel có tên với tên miền riêng, hoặc thuê VPS (`docs/DEPLOY.md`).
- Khi mở ra Internet, máy chủ áp dụng: khoá đăng nhập theo tài khoản và theo IP thật của người dùng (nhận biết proxy), giới hạn số yêu cầu theo IP, và các header bảo mật.

### Tài khoản mẫu (chỉ có trong dữ liệu mẫu)

| Vai trò | Tên đăng nhập | Mật khẩu (Boss) | PIN (POS) |
|---|---|---|---|
| Thu ngân: Kim | `thungan` | `thungan123` | `1111` |
| Thu ngân: Minh | `thungan2` | `thungan2123` | `2222` |
| Chủ cửa hàng: Hiền | `chu` | `chu123456` | `3333` |

Với cửa hàng thật:
1. Khởi động máy chủ một lần với `SEED=0` và cơ sở dữ liệu trống.
2. Tạo tài khoản chủ bằng `npm run create-owner -w apps/server -- <tên đăng nhập> <mật khẩu> [PIN]`.
3. Thêm nhân viên và thực đơn từ ứng dụng hoặc qua API.

### Các lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy máy chủ, POS và Boss, tự tải lại khi sửa code |
| `npm test` | Kiểm thử API và luồng nghiệp vụ của máy chủ, cùng unit test của POS và Boss |
| `npm run typecheck` | Kiểm tra TypeScript cho tất cả ứng dụng |
| `npm run build` | Build bản chính thức của POS (`apps/pos/dist`) và Boss (`apps/boss/dist`) |
| `npm start -w apps/server` | Chạy máy chủ, không theo dõi thay đổi file |
| `npm run seed:demo -w apps/server` | Thêm dữ liệu bán hàng MẪU cho 14 ngày gần nhất (chỉ chạy một lần cho mỗi cơ sở dữ liệu) |
| `npm run create-owner -w apps/server -- user pass [pin]` | Tạo hoặc đặt lại tài khoản chủ |

### Cấu hình máy chủ (`apps/server/.env`, không bắt buộc)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Lắng nghe trên mạng LAN để máy POS và điện thoại kết nối được |
| `DB_PATH` | `./data/shopflow.db` | File SQLite. Sao lưu hằng ngày, xem `docs/DEPLOY.md` |
| `SEED` | `1` | `0` để tắt dữ liệu mẫu |
| `SEED_DEMO_SALES` | `0` | `1` để thêm 14 ngày bán hàng mẫu khi khởi động |
| `SHOPFLOW_API_KEY` | *(trống)* | Khoá dịch vụ tuỳ chọn cho tích hợp. Yêu cầu dùng khoá này có quyền như chủ |
| `TZ_OFFSET_MIN` | `420` | Múi giờ của quán, tính bằng phút (UTC+7) |
| `DAY_SUMMARY_HOUR` | `22` | Giờ địa phương gửi thông báo tổng kết cuối ngày |
| `FCM_SERVICE_ACCOUNT` | *(trống)* | Đường dẫn file JSON service account của Firebase. Bật thông báo đẩy tới điện thoại khi app đang đóng |
| `MENU_FILE` / `MENU_IMG_DIR` | *(tự tìm `product/`)* | Đường dẫn file thực đơn / thư mục ảnh món, nếu muốn để ở chỗ khác |

## Cách hệ thống hoạt động

1. **Bán hàng trên POS.** Thu ngân đăng nhập bằng PIN và mở ca với số tiền đầu ca.
   - Đơn được lưu trên thiết bị trước, rồi mới gửi lên máy chủ.
   - Mỗi đơn có mã do thiết bị sinh ra, nên gửi lại nhiều lần cũng không bị trùng đơn.
   - Mất mạng vẫn bán tiếp được; thanh tiêu đề hiện số đơn đang chờ gửi.
2. **Máy chủ.** Lưu đơn và các dòng món trong cùng một transaction.
   - Một đơn gửi lên đồng thời hoặc lặp lại chỉ được lưu một lần.
   - Tổng tiền được tính lại trên máy chủ.
3. **Boss thấy ngay.** Máy chủ đẩy sự kiện qua SSE (`/api/events`), nên dashboard, luồng hoạt động và báo cáo cập nhật trong khoảng một giây.
4. **Cảnh báo.** Huỷ đơn, hoàn tiền và tổng kết ca đều tạo thông báo. Thông báo hiện ngay trong Boss, và hiện thành thông báo đẩy trên điện thoại khi đã cấu hình FCM.
5. **Cuối ca.** Thu ngân đếm tiền theo từng mệnh giá. Báo cáo ca so sánh tiền dự kiến với tiền đếm thực tế, và chủ quán nhận được thông báo.

**Các chức năng khác trên POS:**
- **Hoá đơn đang mở.** Lưu đơn của bàn khi chưa thanh toán, sửa từ máy POS bất kỳ, chuyển sang bàn khác, rồi thanh toán hoặc huỷ (bắt buộc ghi lý do). Bàn đang có khách được tô nổi. Chủ quán xem các hoá đơn này trong Boss ở *Hoạt động → Hoá đơn hiện tại*.
- **Tuỳ chọn món.** Size, đá, đường và topping, mỗi tuỳ chọn có thể cộng thêm tiền.
- **Quản lý (dành cho chủ).** Thực đơn và giá, danh mục, tuỳ chọn, bàn, nhân viên (vai trò, PIN, mật khẩu, khoá tài khoản).
- **Huỷ đơn / hoàn tiền.** Cả hai đều phải ghi lý do. Mọi thao tác được lưu vào lịch sử thao tác, chủ quán xem trong Boss ở *Thêm → Lịch sử thao tác*.

Quy tắc tính doanh thu (doanh thu thuần, hoàn tiền, huỷ đơn) nằm trong [docs/SYNC.md](docs/SYNC.md).

**Vai trò (hai vai trò):**
- **Chủ cửa hàng:** toàn quyền. Thường làm việc từ xa qua app Boss trên điện thoại (báo cáo, nhân viên, thực đơn); vẫn có tài khoản trên POS.
- **Thu ngân:** làm việc tại POS. Bán hàng, huỷ đơn/hoàn tiền có ghi lý do, ca làm việc và két tiền. Vai trò nhân viên kho trước đây đã gộp vào thu ngân.

## Android

- POS và Boss đều có project Android Capacitor (`apps/pos/android`, `apps/boss/android`).
- Build APK cần Android Studio (JDK 21 + SDK). Hướng dẫn từng bước, cài qua ADB và danh sách kiểm tra trên máy POS thật: [docs/ANDROID.md](docs/ANDROID.md).
- Ghi chú về máy in và máy SUNMI: [docs/SUNMI.md](docs/SUNMI.md).

## Tình trạng

Chưa hoàn tất:
- Build APK và kiểm thử trên máy POS thật (môi trường phát triển chưa có phần cứng và Android SDK).
- Kiểm thử thông báo đẩy FCM với một project Firebase thật.
- PostgreSQL. Tầng dữ liệu hiện dùng SQLite; cách chuyển đổi xem trong `docs/DEPLOY.md`.

## Bật / tắt ShopFlow khi cần (máy này làm máy chủ)

- **Bật:** bấm đúp `Mo ShopFlow.cmd` ở thư mục gốc. File sẽ sao lưu dữ liệu, chạy máy chủ (bản chính thức, không theo dõi sửa code) và mở POS.
- **Dùng:** POS `https://quan.t160.men/pos/`, Boss `https://quan.t160.men/boss/`. Máy tính và điện thoại **không cần chung wifi** (đi qua Cloudflare Tunnel, dịch vụ `cloudflared` tự chạy cùng Windows).
- **Tắt:** đóng cửa sổ ShopFlow. Khi tắt, link vẫn mở được trang nhưng không đăng nhập/đồng bộ được; POS đang mở vẫn bán offline và gửi đơn khi bật lại.
- Lưu ý: máy ngủ hoặc gập màn hình = ShopFlow tạm dừng. Không chạy cùng lúc với `npm run dev` (cùng cổng 4000).
