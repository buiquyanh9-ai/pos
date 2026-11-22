import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.shopflow.boss',
  appName: 'ShopFlow Boss',
  webDir: 'dist',
  // Same reasoning as the POS app: allow a plain-HTTP backend on the LAN during testing.
  server: { androidScheme: 'http', cleartext: true },
  android: { allowMixedContent: true },
};

export default config;
