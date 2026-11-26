# Tích hợp máy in SUNMI (không bắt buộc)

ShopFlow POS không bắt buộc phải có máy SUNMI hay SDK của SUNMI. Trên trình duyệt, POS dùng driver in qua trình duyệt hoặc driver giả lập. Bản Android dùng driver ESC/POS qua USB (máy in rời cắm vào máy POS) hoặc ESC/POS qua mạng khi có máy in trong mạng LAN.

> Đã chạy thực tế trên **SUNMI T1-G** (bản không có máy in tích hợp) với máy in rời RICHTA RI-58A cắm USB và két tiền cắm vào máy in, dùng driver `escpos-usb`. Trường hợp này không cần SDK của SUNMI.

## Cầu nối tuỳ chọn cho máy in tích hợp

Driver `sunmi` chỉ xuất hiện khi môi trường chạy cung cấp một trong các cầu nối sau:

- `window.SunmiPrinterService.printText(text)` và có thể có `lineWrap(count)`.
- `window.sunmiPrinter.printText(text)` và có thể có `lineWrap(count)`.
- Để mở két, cầu nối đó có thể cung cấp thêm `openDrawer()`.

Một plugin Capacitor hoặc một cầu nối Android nhỏ có thể cung cấp các hàm trên bằng cách gọi SDK máy in chính thức của SUNMI. Hãy để cầu nối này ở tầng riêng của Android; không đưa SDK vào bản web và không biến nó thành điều kiện bắt buộc để thanh toán.

## Lưu ý theo thiết bị

Mỗi đời máy và firmware SUNMI có thể cung cấp API máy in khác nhau. Hãy xem SDK chính thức cho đúng model máy, dịch vụ máy in, khổ giấy và quyền cần cấp. Máy POS Android thông thường có thể không có cầu nối SUNMI, và một số máy hạn chế cài APK ngoài. Luôn giữ các phương án dự phòng: in qua trình duyệt, giả lập, qua mạng hoặc USB.

## Kiểm thử khi không có phần cứng

1. Chạy POS trên trình duyệt máy tính và chọn máy in giả lập hoặc máy in qua trình duyệt.
2. Thử máy in mạng bằng máy in ảo: `node scripts/virtual-printer.cjs 9100`. Máy in ảo giải mã lệnh ESC/POS (căn lề, chữ đậm, cắt giấy, mở két) và lưu mỗi hoá đơn ra file.
3. Thử cầu nối Android bằng cách gắn một `window.SunmiPrinterService` giả có hàm `printText` trong bản phát triển.
4. Trên máy thật, kiểm tra máy in có sẵn sàng trước khi bật lựa chọn SUNMI, rồi thử chữ tiếng Việt, cắt giấy, mở két và khả năng phục hồi khi lỗi.
