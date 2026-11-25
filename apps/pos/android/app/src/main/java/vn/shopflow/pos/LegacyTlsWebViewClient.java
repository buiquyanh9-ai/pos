package vn.shopflow.pos;

import android.content.Context;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * Android 6/7.0 do not trust ISRG Root X1 (Let's Encrypt, used by Cloudflare for quan.t160.men),
 * so the WebView rejects the shop server's valid HTTPS certificate. When that happens this client
 * re-checks the server itself with a trust store = system roots + the bundled ISRG Root X1
 * (res/raw/isrg_root_x1.pem), including hostname verification, and only proceeds when the
 * certificate the WebView saw is exactly the one that validated. Anything else is still rejected.
 */
public class LegacyTlsWebViewClient extends BridgeWebViewClient {
    private static final String TAG = "ShopFlowTLS";
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    /** host -> DER of the leaf certificate already validated in this app session. */
    private final Map<String, byte[]> verified = new ConcurrentHashMap<>();
    private SSLContext sslContext;

    public LegacyTlsWebViewClient(Bridge bridge, Context context) {
        super(bridge);
        this.context = context.getApplicationContext();
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        final String host = Uri.parse(error.getUrl()).getHost();
        final byte[] seen = leafDer(error.getCertificate());
        if (host == null || seen == null || error.getPrimaryError() != SslError.SSL_UNTRUSTED) {
            handler.cancel();
            return;
        }
        byte[] known = verified.get(host);
        if (known != null && Arrays.equals(known, seen)) {
            handler.proceed();
            return;
        }
        worker.execute(() -> {
            boolean ok = false;
            try {
                byte[] valid = validatedLeaf(host);
                ok = Arrays.equals(valid, seen);
                if (ok) verified.put(host, valid);
            } catch (Exception e) {
                Log.w(TAG, "Re-validation failed for " + host, e);
            }
            final boolean proceed = ok;
            Log.i(TAG, host + (proceed ? ": valid with bundled ISRG Root X1" : ": rejected"));
            main.post(() -> { if (proceed) handler.proceed(); else handler.cancel(); });
        });
    }

    private static byte[] leafDer(SslCertificate cert) {
        if (cert == null) return null;
        Bundle state = SslCertificate.saveState(cert);
        return state == null ? null : state.getByteArray("x509-certificate");
    }

    /** Connects to https://host/ trusting system + ISRG Root X1 and returns the server's leaf certificate. */
    private byte[] validatedLeaf(String host) throws Exception {
        HttpsURLConnection conn = (HttpsURLConnection) new URL("https://" + host + "/api/health").openConnection();
        conn.setSSLSocketFactory(sslContext().getSocketFactory());
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(10_000);
        try {
            conn.connect(); // handshake: chain + hostname are verified here
            Certificate[] chain = conn.getServerCertificates();
            return ((X509Certificate) chain[0]).getEncoded();
        } finally {
            conn.disconnect();
        }
    }

    private synchronized SSLContext sslContext() throws Exception {
        if (sslContext != null) return sslContext;
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
        ks.load(null, null);
        KeyStore system = KeyStore.getInstance("AndroidCAStore");
        system.load(null, null);
        for (String alias : java.util.Collections.list(system.aliases())) ks.setCertificateEntry("sys:" + alias, system.getCertificate(alias));
        try (InputStream in = context.getResources().openRawResource(R.raw.isrg_root_x1)) {
            ks.setCertificateEntry("isrg-root-x1", CertificateFactory.getInstance("X.509").generateCertificate(in));
        }
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks);
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, tmf.getTrustManagers(), null);
        sslContext = ctx;
        return ctx;
    }
}
