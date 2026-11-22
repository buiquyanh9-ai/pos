import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.shopflow.pos',
  appName: 'ShopFlow POS',
  webDir: 'dist',
  server: {
    // Serve the app from http://localhost so requests to a plain-HTTP backend on the LAN
    // (http://192.168.x.x:4000) are not blocked as mixed content.
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
