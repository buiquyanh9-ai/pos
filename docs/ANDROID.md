# Android APK: build, cài đặt, kiểm thử

> Hướng dẫn này dùng ứng dụng POS (`apps/pos`). Ứng dụng Boss (`apps/boss`, mã `vn.shopflow.boss`) build theo cùng cách: thay `apps/pos` bằng `apps/boss` và `-w apps/pos` bằng `-w apps/boss`. Boss cài lên điện thoại của chủ thay vì máy POS.

Ứng dụng web POS (`apps/pos`) chạy bên trong WebView của Capacitor. Project Android nằm ở `apps/pos/android`. Cùng một mã nguồn giao diện chạy trên trình duyệt Windows và trong APK, không có phần nào phải viết hai lần.

> Không cần máy POS để phát triển. Dùng trình duyệt trên Windows hoặc máy ảo Android. Máy thật chỉ cần cho bước kiểm thử phần cứng cuối cùng.

Yêu cầu thiết bị: **Android 6.0 trở lên** (minSdk 23). Mã nguồn được build cho WebView đời cũ (Chrome 69 trở lên), nên chạy được trên máy POS chưa cập nhật WebView.

## 1. Cài đặt một lần (Windows)

1. Cài **Android Studio** (đã kèm JDK 21 và Android SDK).
2. Trong Android Studio, mở *SDK Manager* và cài **Android SDK Platform 35** cùng **Android SDK Platform-Tools**. Platform-Tools cung cấp lệnh `adb`.
3. Đặt biến môi trường (chạy trong PowerShell, rồi mở lại cửa sổ dòng lệnh):
   ```powershell
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
   setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
   ```
4. Kiểm tra: `adb version` và `java -version` (phải in ra 21.x).

## 2. Build APK bản debug

Tại thư mục gốc của mã nguồn:

```powershell
npm install
npm run android:apk -w apps/pos
```

Lệnh này build ứng dụng web, chép vào project Android (`cap sync`) rồi chạy Gradle `assembleDebug`.
Kết quả: `apps/pos/android/app/build/outputs/apk/debug/app-debug.apk`

Muốn làm trong Android Studio: chạy `npm run android:sync -w apps/pos`, rồi `npm run android:open -w apps/pos`, sau đó bấm *Run*.

**APK bản phát hành.** Tạo keystore và cấu hình ký trong `android/app/build.gradle`, rồi chạy `gradlew.bat assembleRelease`. Không bao giờ commit keystore; `*.keystore` đã có trong `.gitignore`.

## 3. Cài lên thiết bị

**Qua ADB (khuyến nghị khi phát triển)**
1. Trên thiết bị, mở *Cài đặt → Giới thiệu* và bấm *Số hiệu bản dựng* 7 lần để mở tuỳ chọn nhà phát triển. Sau đó vào *Tuỳ chọn nhà phát triển* và bật **Gỡ lỗi USB**.
2. Cắm cáp USB và chấp nhận hộp thoại RSA trên thiết bị. Kiểm tra bằng `adb devices`.
3. Cài: `adb install -r apps\pos\android\app\build\outputs\apk\debug\app-debug.apk`

Qua Wi-Fi (Android 11 trở lên): trên thiết bị, mở *Tuỳ chọn nhà phát triển → Gỡ lỗi không dây*. Sau đó chạy `adb pair <ip>:<cổng-ghép>` rồi `adb connect <ip>:<cổng>`.

**Cài thủ công.** Chép APK vào thiết bị (USB, Bluetooth, ổ đám mây, thư mục chia sẻ trong mạng LAN, hoặc đặt file lên máy chủ rồi tải bằng trình duyệt). Mở file và cho phép *Cài ứng dụng không rõ nguồn gốc*. Google Play Protect có thể hỏi xác nhận vì APK không qua cửa hàng; chọn cài tiếp.

> ⚠️ **Không phải máy POS nào cũng cho cài APK ngoài.** Một số hãng (máy của ngân hàng hoặc nhà cung cấp thanh toán, bản SUNMI hay PAX bị khoá) chặn cài ngoài, hoặc chỉ nhận ứng dụng qua cửa hàng riêng hay hệ thống MDM, có thể cần chữ ký của hãng. Hãy hỏi nhà cung cấp trước khi mua hoặc triển khai. Nếu bị chặn, phương án thay thế là mở POS bằng trình duyệt của thiết bị tại địa chỉ máy chủ (ví dụ `https://<tên-miền>/pos/`), khi đó in và mở két sẽ bị hạn chế.

## 4. Kết nối với máy chủ

1. Chạy máy chủ trên máy tính hoặc server mà thiết bị truy cập được: `npm start -w apps/server`. Máy chủ lắng nghe ở `0.0.0.0:4000` và in ra các IP trong mạng LAN.
2. Trong ứng dụng, mở **Cài đặt → Địa chỉ backend** và nhập ví dụ `192.168.1.10:4000` (hoặc `https://<tên-miền>`), kèm API key nếu có đặt. Bấm **Kiểm tra kết nối**, rồi **Lưu cài đặt**.
3. Khi đi qua Internet, dùng HTTPS (reverse proxy như Caddy hoặc Nginx, hoặc Cloudflare Tunnel đặt trước máy chủ).

Máy chủ HTTP thường trong mạng LAN vẫn dùng được, vì ứng dụng được phục vụ từ `http://localhost` (`server.androidScheme: 'http'`) và manifest đặt `android:usesCleartextTraffic="true"`. Nếu chỉ triển khai qua HTTPS, có thể bỏ cả hai để an toàn hơn.

**Android 6 và chứng chỉ Let's Encrypt.** Android 6 không tin chứng chỉ gốc ISRG Root X1 (Let's Encrypt, cũng là chứng chỉ Cloudflare cấp miễn phí). APK POS có kèm chứng chỉ gốc này (`res/raw/isrg_root_x1.pem`). Khi WebView báo chứng chỉ không đáng tin, ứng dụng kiểm tra lại bằng kho chứng chỉ hệ thống cộng ISRG Root X1, có kiểm tra tên miền, và chỉ cho đi tiếp khi chứng chỉ hợp lệ.

## 5. Danh sách kiểm tra trên máy POS thật

- [ ] Ứng dụng cài và mở được. Bố cục vừa màn hình ở chế độ ngang và dọc (nếu thiết bị xoay được).
- [ ] Cài đặt: kiểm tra kết nối thành công và tải được danh sách món.
- [ ] Bán hàng bằng tiền mặt và chuyển khoản. Đơn hiện trạng thái *Đã đồng bộ*.
- [ ] Tắt Wi-Fi/rút dây mạng, bán 2 đơn. Đơn hiện *Chờ gửi*. Bật mạng lại: đơn được gửi lên trong khoảng 15 giây, không trùng.
- [ ] Mã vạch: máy quét tích hợp hoặc máy quét USB ở chế độ bàn phím thêm được món (driver *keyboard wedge*).
- [ ] Máy in: in thử bằng driver phù hợp (ESC/POS USB, ESC/POS qua mạng hoặc SUNMI, xem `docs/SUNMI.md`). Kiểm tra chữ tiếng Việt và cắt giấy.
- [ ] Két tiền mở sau khi thanh toán tiền mặt (nếu két cắm vào máy in).
- [ ] Tắt hẳn ứng dụng rồi mở lại: đơn đang chờ gửi và giỏ hàng vẫn còn.

## 6. Gỡ lỗi

- Console của WebView: trên Chrome máy tính, mở `chrome://inspect`, rồi chọn *inspect* ứng dụng (chỉ với bản debug).
- Log: `adb logcat | findstr Capacitor`
- Trang **Cài đặt → Phần cứng** của POS liệt kê các thiết bị USB đang cắm kèm VID:PID, giúp xác định máy in.
- Máy in nhiệt in ra toàn số hex nghĩa là máy đang ở chế độ HEX DUMP (bị bật khi giữ nút FEED lúc mở nguồn). Tắt máy in rồi bật lại, không bấm nút nào.

## Độ phân giải thường gặp của máy POS Android

| Loại thiết bị | Độ phân giải | Bố cục |
|---|---|---|
| Máy để bàn 15,6" (ví dụ SUNMI T2/D2s) | 1920×1080 | hai cột |
| Máy để bàn 10–11" | 1280×800 | hai cột |
| Máy nhỏ 7–8" | 1024×600 | hai cột thu gọn |
| Máy cầm tay (ví dụ SUNMI V2/P2) | 720×1440 dọc | giỏ hàng dạng ngăn kéo dưới |
