import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from '../lib/api';
import { normalizeBackendUrl, type PosSettings } from '../lib/settings';
import { APP_VERSION, CONNECTION_LABEL, getState, updateSettings, usePos } from '../lib/store';
import { listDrawers, listPrinters, listScanners } from '../hardware';
import { openDrawer, printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { dateTime } from '../lib/format';
import type { LocalOrder } from '../lib/types';

interface DriverOption {
  id: string;
  name: string;
  available: boolean;
}

function useDriverOptions(list: { id: string; name: string; isAvailable(): Promise<boolean> }[]) {
  const [opts, setOpts] = useState<DriverOption[]>(() => list.map((d) => ({ id: d.id, name: d.name, available: true })));
  useEffect(() => {
    let alive = true;
    Promise.all(list.map(async (d) => ({ id: d.id, name: d.name, available: await d.isAvailable().catch(() => false) }))).then(
      (r) => alive && setOpts(r),
    );
    return () => {
      alive = false;
    };
  }, []);
  return opts;
}

const SAMPLE_ORDER: LocalOrder = {
  id: 'test',
  number: 'TEST-0001',
  deviceId: 'test',
  cashier: '',
  orderType: 'dine_in',
  tableName: '',
  note: '',
  items: [
    { productId: null, name: 'Cà phê sữa', price: 25000, qty: 2, lineTotal: 50000 },
    { productId: null, name: 'Bánh mì thịt', price: 25000, qty: 1, lineTotal: 25000 },
  ],
  subtotal: 75000,
  discount: 5000,
  total: 70000,
  paymentMethod: 'cash',
  paid: 100000,
  change: 30000,
  createdAt: new Date().toISOString(),
  status: 'completed',
  sync: 'synced',
};

export function SettingsScreen() {
  const saved = usePos((s) => s.settings);
  const connection = usePos((s) => s.connection);
  const lastSyncAt = usePos((s) => s.lastSyncAt);
  const lastError = usePos((s) => s.lastError);
  const [form, setForm] = useState<PosSettings>(saved);
  const [testResult, setTestResult] = useState<string | null>(null);
  const printers = useDriverOptions(listPrinters());
  const scanners = useDriverOptions(listScanners());
  const drawers = useDriverOptions(listDrawers());

  const field = <K extends keyof PosSettings>(k: K) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }),
  });
  const hw = <K extends keyof PosSettings['hardware']>(k: K, v: PosSettings['hardware'][K]) =>
    setForm({ ...form, hardware: { ...form.hardware, [k]: v } });

  const normalized = (): PosSettings | null => {
    try {
      return { ...form, backendUrl: normalizeBackendUrl(form.backendUrl) };
    } catch {
      notify('Địa chỉ máy chủ không hợp lệ', 'error');
      return null;
    }
  };

  const testConnection = async () => {
    const s = normalized();
    if (!s) return;
    setTestResult('Đang kiểm tra…');
    try {
      const h = await api.health(s);
      const auth = { disabled: 'không yêu cầu API key', ok: 'API key đúng', missing: 'THIẾU API key', invalid: 'SAI API key' }[h.auth];
      setTestResult(`Kết nối OK (API v${h.apiVersion}), ${auth}`);
    } catch (err) {
      setTestResult(`Lỗi: ${err instanceof Error ? err.message : err}`);
    }
  };

  const onSave = () => {
    const s = normalized();
    if (!s) return;
    setForm(s);
    updateSettings(s);
    notify('Đã lưu cài đặt', 'success');
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <div className="settings">
      <section className="card">
        <h2>Máy chủ</h2>
        <label>
          Địa chỉ backend (LAN hoặc Internet)
          <input {...field('backendUrl')} placeholder="http://192.168.1.10:4000" inputMode="url" autoCapitalize="off" autoCorrect="off" />
        </label>
        <label>
          API key
          <input {...field('apiKey')} type="password" autoComplete="off" placeholder="Để trống nếu máy chủ không yêu cầu" />
        </label>
        <div className="inline">
          <button className="btn secondary" onClick={testConnection}>
            Kiểm tra kết nối
          </button>
          {testResult && <span className="muted">{testResult}</span>}
        </div>
        <p className="muted small">
          Trạng thái: {CONNECTION_LABEL[connection]}
          {lastSyncAt && ` · đồng bộ lần cuối ${dateTime(lastSyncAt)}`}
          {lastError && ` · ${lastError}`}
        </p>
      </section>

      <section className="card">
        <h2>Cửa hàng & thiết bị</h2>
        <label>
          Tên cửa hàng (in trên hoá đơn)
          <input {...field('storeName')} />
        </label>
        <label>
          Địa chỉ cửa hàng
          <input {...field('storeAddress')} />
        </label>
        <label>
          Tên quầy / thiết bị
          <input {...field('deviceName')} />
        </label>
        <label>
          Thu ngân
          <input {...field('cashier')} />
        </label>
        <label>
          Lời cảm ơn cuối hoá đơn
          <input {...field('receiptFooter')} />
        </label>
        <p className="muted small">
          Mã thiết bị: {form.deviceId} · Phiên bản {APP_VERSION} · {Capacitor.isNativePlatform() ? `Android app` : 'Trình duyệt'}
        </p>
      </section>

      <section className="card">
        <h2>Phần cứng</h2>
        <DriverSelect label="Máy in hoá đơn" options={printers} value={form.hardware.printer} onChange={(v) => hw('printer', v)} />
        <DriverSelect label="Máy quét mã vạch" options={scanners} value={form.hardware.scanner} onChange={(v) => hw('scanner', v)} />
        <DriverSelect label="Két tiền" options={drawers} value={form.hardware.drawer} onChange={(v) => hw('drawer', v)} />
        <label>
          Địa chỉ máy in mạng (ESC/POS)
          <input
            value={form.hardware.printerAddress ?? ''}
            onChange={(e) => hw('printerAddress', e.target.value)}
            placeholder="192.168.1.50:9100"
            autoCapitalize="off"
          />
        </label>
        <label>
          Khổ giấy
          <select value={form.hardware.paperWidthChars ?? 32} onChange={(e) => hw('paperWidthChars', Number(e.target.value))}>
            <option value={32}>58mm (32 ký tự)</option>
            <option value={48}>80mm (48 ký tự)</option>
          </select>
        </label>
        <div className="inline">
          <button className="btn secondary" disabled={dirty} onClick={() => void printReceipt(SAMPLE_ORDER, getState().settings)}>
            In thử
          </button>
          <button className="btn secondary" disabled={dirty} onClick={() => void openDrawer(getState().settings)}>
            Mở két thử
          </button>
          {dirty && <span className="muted small">Lưu cài đặt trước khi thử</span>}
        </div>
      </section>

      <div className="settings-actions">
        <button className="btn secondary" disabled={!dirty} onClick={() => setForm(saved)}>
          Huỷ thay đổi
        </button>
        <button className="btn primary big" disabled={!dirty} onClick={onSave}>
          Lưu cài đặt
        </button>
      </div>
    </div>
  );
}

function DriverSelect({ label, options, value, onChange }: { label: string; options: DriverOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.available && o.id !== value}>
            {o.name}
            {o.available ? '' : ' (không khả dụng trên thiết bị này)'}
          </option>
        ))}
      </select>
    </label>
  );
}
