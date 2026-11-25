import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { legacyCss } from './legacy-css';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build works inside the Capacitor WebView.
  base: './',
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  // Oldest target: SUNMI T1 (Android 6) WebView = Chrome 69, which cannot be updated on that device.
  build: { target: ['es2019', 'chrome69'], cssTarget: 'chrome69' },
  css: { postcss: { plugins: [legacyCss()] } },
});
