package vn.shopflow.pos;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CountDownLatch;

/**
 * Sends raw ESC/POS bytes to a receipt printer plugged into the terminal's USB port
 * (e.g. RICHTA RI-58A on a SUNMI T1). No vendor SDK: plain Android USB host API.
 * Jobs run one at a time on a single thread, so a receipt and a drawer pulse never interleave.
 */
@CapacitorPlugin(name = "UsbPrinter")
public class UsbPrinterPlugin extends Plugin {
    private static final String ACTION_PERMISSION = "vn.shopflow.pos.USB_PRINTER_PERMISSION";
    private static final int CHUNK = 4096;
    private static final int TIMEOUT_MS = 5000;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private UsbManager usb() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    /** USB network adapters built into POS terminals (the SUNMI T1's LAN port is an ASIX AX88772B). Never print to these. */
    private static final int[] NETWORK_VENDORS = { 0x0b95 /* ASIX */, 0x0bda /* Realtek */, 0x2001 /* D-Link */, 0x2357 /* TP-Link */, 0x0df6 /* Sitecom */, 0x13b1 /* Linksys */ };

    private static boolean isNetworkAdapter(UsbDevice d) {
        for (int v : NETWORK_VENDORS) if (d.getVendorId() == v) return true;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            int cls = d.getInterface(i).getInterfaceClass();
            if (cls == UsbConstants.USB_CLASS_COMM || cls == UsbConstants.USB_CLASS_CDC_DATA || cls == UsbConstants.USB_CLASS_WIRELESS_CONTROLLER) return true;
        }
        return false;
    }

    /** First interface with a bulk OUT endpoint, preferring the USB printer class (7). Skips storage/HID/hubs/network adapters. */
    private static UsbInterface printerInterface(UsbDevice d) {
        if (isNetworkAdapter(d)) return null;
        UsbInterface fallback = null;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface intf = d.getInterface(i);
            int cls = intf.getInterfaceClass();
            if (cls == UsbConstants.USB_CLASS_MASS_STORAGE || cls == UsbConstants.USB_CLASS_HID || cls == UsbConstants.USB_CLASS_HUB) continue;
            if (bulkOut(intf) == null) continue;
            if (cls == UsbConstants.USB_CLASS_PRINTER) return intf;
            if (fallback == null) fallback = intf;
        }
        return fallback;
    }

    private static UsbEndpoint bulkOut(UsbInterface intf) {
        for (int e = 0; e < intf.getEndpointCount(); e++) {
            UsbEndpoint ep = intf.getEndpoint(e);
            if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) return ep;
        }
        return null;
    }

    private UsbDevice findPrinter() {
        UsbDevice fallback = null;
        for (UsbDevice d : usb().getDeviceList().values()) {
            UsbInterface intf = printerInterface(d);
            if (intf == null) continue;
            if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return d;
            if (fallback == null) fallback = d;
        }
        return fallback;
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray arr = new JSArray();
        for (UsbDevice d : usb().getDeviceList().values()) {
            UsbInterface intf = printerInterface(d);
            JSObject o = new JSObject();
            o.put("name", d.getProductName() != null ? d.getProductName() : d.getDeviceName());
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            o.put("printer", intf != null);
            o.put("printerClass", intf != null && intf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER);
            o.put("permission", usb().hasPermission(d));
            arr.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String b64 = call.getString("data");
        if (b64 == null) { call.reject("Thiếu dữ liệu in"); return; }
        final byte[] data;
        try { data = Base64.decode(b64, Base64.DEFAULT); } catch (IllegalArgumentException e) { call.reject("Dữ liệu in không hợp lệ"); return; }
        worker.execute(() -> {
            try {
                UsbDevice device = findPrinter();
                if (device == null) throw new Exception("Không thấy máy in USB. Kiểm tra dây USB và nguồn máy in.");
                if (!usb().hasPermission(device) && !requestPermission(device)) throw new Exception("Chưa cho phép ShopFlow dùng máy in USB. Bấm In thử và chọn Đồng ý.");
                send(device, data);
                JSObject ret = new JSObject();
                ret.put("bytes", data.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString());
            }
        });
    }

    private void send(UsbDevice device, byte[] data) throws Exception {
        UsbInterface intf = printerInterface(device);
        UsbEndpoint out = intf == null ? null : bulkOut(intf);
        if (out == null) throw new Exception("Thiết bị USB không phải máy in");
        UsbDeviceConnection conn = usb().openDevice(device);
        if (conn == null) throw new Exception("Không mở được máy in USB");
        try {
            if (!conn.claimInterface(intf, true)) throw new Exception("Máy in USB đang bận");
            try {
                for (int off = 0; off < data.length; off += CHUNK) {
                    int len = Math.min(CHUNK, data.length - off);
                    byte[] part = new byte[len];
                    System.arraycopy(data, off, part, 0, len);
                    int n = conn.bulkTransfer(out, part, len, TIMEOUT_MS);
                    if (n < 0) throw new Exception("Gửi lệnh tới máy in thất bại (máy in tắt hoặc hết giấy?)");
                }
            } finally {
                conn.releaseInterface(intf);
            }
        } finally {
            conn.close();
        }
    }

    /** Shows Android's "allow app to access USB device" dialog and waits (max 60s) for the answer. */
    private boolean requestPermission(UsbDevice device) throws InterruptedException {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicBoolean granted = new AtomicBoolean(false);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                granted.set(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                done.countDown();
            }
        };
        Context ctx = getContext();
        ContextCompat.registerReceiver(ctx, receiver, new IntentFilter(ACTION_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        try {
            Intent intent = new Intent(ACTION_PERMISSION).setPackage(ctx.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            usb().requestPermission(device, PendingIntent.getBroadcast(ctx, 0, intent, flags));
            done.await(60, TimeUnit.SECONDS);
        } finally {
            ctx.unregisterReceiver(receiver);
        }
        return granted.get() || usb().hasPermission(device);
    }
}
