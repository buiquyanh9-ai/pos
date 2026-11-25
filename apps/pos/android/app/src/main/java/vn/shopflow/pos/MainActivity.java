package vn.shopflow.pos;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        // Old Android (SUNMI T1 = Android 6) does not trust Let's Encrypt's root: re-validate with a bundled copy.
        getBridge().setWebViewClient(new LegacyTlsWebViewClient(getBridge(), this));
        // A POS terminal must not leave the sale screen when the cashier hits the system Back key
        // (the web app has its own navigation). Registered after Capacitor's callback, so it wins.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Intentionally ignored.
            }
        });
    }
}
