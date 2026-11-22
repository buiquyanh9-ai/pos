# SUNMI printer integration (optional)

ShopFlow POS does not require a SUNMI terminal or SUNMI SDK. The POS works in browser mode with the browser-print and mock drivers, and the Android build can use the network ESC/POS driver when a printer is reachable on the LAN.

## Optional bridge

The `sunmi` driver becomes available only when the host exposes one of these bridges:

- `window.SunmiPrinterService.printText(text)` and optionally `lineWrap(count)`.
- `window.sunmiPrinter.printText(text)` and optionally `lineWrap(count)`.
- For a cash drawer, the same bridge may expose `openDrawer()`.

A Capacitor plugin or a small native Android bridge can expose those methods by calling the official SUNMI printer SDK. Keep that bridge in the Android-specific layer; do not import an SDK in the browser bundle or make it a requirement for checkout.

## Device notes

SUNMI models and firmware can expose different printer APIs. Check the official SDK for the exact terminal model, printer service, paper width and permission requirements. A generic Android POS may not expose a SUNMI bridge at all, and some devices restrict arbitrary APK installation. Always retain browser/mock/network fallbacks.

## Testing without hardware

1. Run the POS in a desktop browser and select the mock or browser printer.
2. Test the Android bridge by injecting a fake `window.SunmiPrinterService` with `printText` in a development build.
3. On a real device, verify printer availability before enabling the SUNMI option and test Vietnamese text, paper cut, drawer pulse and failure recovery.
