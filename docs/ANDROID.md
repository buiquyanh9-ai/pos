# Android APK: build, install, test

The POS web app (`apps/pos`) runs inside a Capacitor WebView. The native project lives in `apps/pos/android`. The same frontend code runs in the browser on Windows and in the APK, with nothing duplicated.

> You do not need a POS terminal to develop. Use the browser on Windows or an Android emulator. A physical device is only needed for the final hardware tests.

## 1. One-time setup (Windows)

1. Install **Android Studio** (it bundles a JDK 21 and the Android SDK).
2. In Android Studio, open *SDK Manager* and install **Android SDK Platform 35** and **Android SDK Platform-Tools**. Platform-Tools provides `adb`.
3. Set the environment variables (PowerShell, then reopen the terminal):
   ```powershell
   setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
   setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
   setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
   ```
4. Check: `adb version` and `java -version` (should print 21.x).

## 2. Build a debug APK

From the repo root:

```powershell
npm install
npm run android:apk -w apps/pos
```

This builds the web app, copies it into the Android project (`cap sync`) and runs Gradle `assembleDebug`.
Output: `apps/pos/android/app/build/outputs/apk/debug/app-debug.apk`

To work in Android Studio instead: `npm run android:sync -w apps/pos`, then `npm run android:open -w apps/pos`, then *Run*.

**Release APK.** Create a keystore and configure signing in `android/app/build.gradle`, then run `gradlew.bat assembleRelease`. Never commit the keystore; `*.keystore` is in `.gitignore`.

## 3. Install on the device

**ADB (recommended)**
1. On the device, open *Settings → About* and tap *Build number* 7 times to unlock developer options. Then go to *Developer options* and turn on **USB debugging**.
2. Connect USB and accept the RSA prompt on the device. Check with `adb devices`.
3. Install with `adb install -r apps\pos\android\app\build\outputs\apk\debug\app-debug.apk`

Over Wi-Fi (Android 11+): on the device, open *Developer options → Wireless debugging*. Then run `adb pair <ip>:<pair-port>` followed by `adb connect <ip>:<port>`.

**Manual install.** Copy the APK to the device (USB storage, cloud drive or LAN share). Open it and allow *Install unknown apps* for the file manager.

> ⚠️ **Not every POS terminal allows this.** Some vendors (certain bank or payment-provider terminals, locked SUNMI or PAX images) block sideloading or only accept apps through their own app store or MDM, which may require vendor signing. Check with the vendor before you buy or deploy. If sideloading is blocked, the fallback is to open the POS in the device's browser: `http://<server-ip>:5173` in dev or a hosted build.

## 4. Connect to the backend

1. Run the backend on a PC or server reachable from the device: `npm start -w apps/server`. It listens on `0.0.0.0:4000` and prints its LAN IPs.
2. In the app, open **Cài đặt (Settings) → Địa chỉ backend (Backend URL)** and enter e.g. `192.168.1.10:4000`, plus the API key if one is set. Tap **Kiểm tra kết nối** (Test connection), then **Lưu cài đặt** (Save settings).
3. Over the Internet, use HTTPS (reverse proxy such as Caddy or Nginx in front of the server) and always set `SHOPFLOW_API_KEY`.

Plain-HTTP LAN backends work because the app is served from `http://localhost` (`server.androidScheme: 'http'`) and the manifest sets `android:usesCleartextTraffic="true"`. If you deploy only over HTTPS, remove both for tighter security.

## 5. Test checklist on a real terminal

- [ ] App installs and launches. Layout fits the screen in landscape and portrait (if the device rotates).
- [ ] Settings: test connection succeeds and products load.
- [ ] Sale with cash, card and transfer. The order appears as *Đã đồng bộ* (Synced).
- [ ] Turn off Wi-Fi, make 2 sales. They show as *Chờ gửi* (Pending). Turn Wi-Fi back on: they upload within about 15 s with no duplicates.
- [ ] Barcode: a built-in or USB scanner in keyboard mode adds products (driver *keyboard wedge*).
- [ ] Printer: test print with the available driver (network ESC/POS or SUNMI, see `docs/SUNMI.md`).
- [ ] Cash drawer opens after a cash sale (if connected through the printer).
- [ ] App survives being killed and restarted. Pending orders are still there.

## 6. Debugging

- WebView console: in desktop Chrome, open `chrome://inspect`, then inspect the app (debug builds only).
- Logs: `adb logcat | findstr Capacitor`

## Common Android POS resolutions

| Device class | Resolution | Layout used |
|---|---|---|
| Desktop terminal 15.6" (e.g. SUNMI T2/D2s) | 1920×1080 | two columns |
| Desktop terminal 10–11" | 1280×800 | two columns |
| Small terminal 7–8" | 1024×600 | compact two columns |
| Handheld (e.g. SUNMI V2/P2) | 720×1440 portrait | cart as bottom sheet |
