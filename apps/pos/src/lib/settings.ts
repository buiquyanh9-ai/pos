import { Capacitor } from '@capacitor/core';
import type { HardwareSettings } from '../hardware/types';
import { defaultHardwareSettings } from '../hardware/registry';
import { load, save } from './storage';
import { uuid } from './ids';

export interface PosSettings {
  backendUrl: string;
  apiKey: string;
  deviceId: string;
  deviceName: string;
  storeName: string;
  storeAddress: string;
  cashier: string;
  receiptFooter: string;
  hardware: HardwareSettings;
}

const KEY = 'shopflow.settings';

/** On Windows/browser dev the backend usually runs on the same host, port 4000.
 *  Inside the Android app "localhost" is the device itself, so no guess is made there. */
export function defaultBackendUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (Capacitor.isNativePlatform()) return '';
  if (typeof location !== 'undefined' && location.protocol.startsWith('http')) {
    return `${location.protocol}//${location.hostname}:4000`;
  }
  return 'http://localhost:4000';
}

/** Accepts "192.168.1.5:4000", "http://host:4000/", "https://pos.example.com/api" -> normalized base URL. */
export function normalizeBackendUrl(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  let path = u.pathname.replace(/\/+$/, '');
  if (path.endsWith('/api')) path = path.slice(0, -4);
  return `${u.protocol}//${u.host}${path}`;
}

export function defaultSettings(): PosSettings {
  return {
    backendUrl: defaultBackendUrl(),
    apiKey: '',
    deviceId: `pos-${uuid().slice(0, 8)}`,
    deviceName: 'Quầy 1',
    storeName: 'ShopFlow Store',
    storeAddress: '',
    cashier: '',
    receiptFooter: 'Cảm ơn quý khách!',
    hardware: { ...defaultHardwareSettings },
  };
}

export function loadSettings(): PosSettings {
  const stored = load<Partial<PosSettings> | null>(KEY, null);
  const base = defaultSettings();
  if (!stored) {
    save(KEY, base); // persist deviceId on first run
    return base;
  }
  return { ...base, ...stored, hardware: { ...base.hardware, ...stored.hardware } };
}

export function saveSettings(s: PosSettings) {
  save(KEY, s);
}
