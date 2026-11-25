import { useEffect, useState } from 'react';
import { StoreSettings } from '../components/StoreSettings';
import { Capacitor } from '@capacitor/core';
import { api } from '../lib/api';
import { normalizeBackendUrl, type PosSettings } from '../lib/settings';
import { APP_VERSION, CONNECTION_LABEL, getState, updateSettings, usePos } from '../lib/store';
import { listDrawers, listPrinters, listScanners } from '../hardware';
import { listUsbDevices, type UsbDeviceInfo } from '../hardware/drivers/escpos-usb';
import { openDrawer, printReceipt } from '../lib/receipt';
import { notify } from '../lib/notify';
import { dateTime } from '../lib/format';
import type { LocalOrder } from '../lib/types';

interface DriverOption {
  id: string;
  name: string;
  available: boolean;
}

/** `refreshKey` changes when saved settings change: drivers such as the network printer only become
 *  available once a printer address is saved, so availability must be re-checked after "Lưu cài đặt". */
function useDriverOptions(list: { id: string; name: string; isAvailable(): Promise<boolean> }[], refreshKey: string) {
  const [opts, setOpts] = useState<DriverOption[]>(() => list.map((d) => ({ id: d.id, name: d.name, available: true })));
  useEffect(() => {
    let alive = true;
    Promise.all(list.map(async (d) => ({ id: d.id, name: d.name, available: await d.isAvailable().catch(() => false) }))).then(
      (r) => alive && setOpts(r),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  return opts;
}

const SAMPLE_ORDER: LocalOrder = {
  id: 'test',
  number: 'TEST-0001',
  deviceId: 'test',
  shiftId: null,
  cashierId: null,
  cashier: '',
  orderType: 'dine_in',
  tableName: '',
  note: '',
  items: [
    { productId: null, name: 'Cơm trắng sườn', price: 50000, qty: 1, lineTotal: 50000 },
    { productId: null, name: 'Trà đá', price: 5000, qty: 5, lineTotal: 25000 },
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

/** `beforeLogin`: opened from the login screen, so only what works without a session is shown. */
export function SettingsScreen({ beforeLogin = false }: { beforeLogin?: boolean }) {
  const saved = usePos((s) => s.settings);
  const connection = usePos((s) => s.connection);
  const lastSyncAt = usePos((s) => s.lastSyncAt);
  const lastError = usePos((s) => s.lastError);
  const [form, setForm] = useState<PosSettings>(saved);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [section, setSection] = useState<'server' | 'store' | 'shop' | 'hardware' | 'about'>('server');
  const driverKey = `${saved.backendUrl}|${saved.hardware?.printerAddress ?? ''}`;
  const printers = useDriverOptions(listPrinters(), driverKey);
  const scanners = useDriverOptions(listScanners(), driverKey);
  const drawers = useDriverOptions(listDrawers(), driverKey);

  const field = <K extends keyof PosSettings>(k: K) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value }),
  });
  const hw = <K extends keyof PosSettings['hardware']>(k: K, v: PosSettings['hardware'][K]) =>
    setForm({ ...form, hardware: { ...form.hardware, [k]: v } });

  // Only the fields edited on this page; shop info (name, address…) arrives from the server meanwhile.
  const mine = (x: PosSettings) => ({ backendUrl: x.backendUrl, apiKey: x.apiKey, deviceName: x.deviceName, hardware: x.hardware });
  const normalized = (): PosSettings | null => {
    try {
      return { ...saved, ...mine(form), backendUrl: normalizeBackendUrl(form.backendUrl) };
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

  const dirty = JSON.stringify(mine(form)) !== JSON.stringify(mine(saved));

  return (
    <div className="settings-layout"><aside className="settings-menu"><div><span className="eyebrow">HỆ THỐNG</span><h1>Cài đặt</h1></div>{([['server','Máy chủ','Kết nối & đồng bộ'],['store','Máy này','Tên quầy / thiết bị'],['shop','Cửa hàng & chuyển khoản','Hoá đơn, tài khoản ngân hàng, mã QR'],['hardware','Phần cứng','Máy in, máy quét, két tiền'],['about','Thông tin','Phiên bản ứng dụng']] as const).filter(([id]) => !beforeLogin || id === 'server' || id === 'hardware' || id === 'about').map(([id,label,desc]) => <button key={id} className={section === id ? 'settings-menu-item active' : 'settings-menu-item'} onClick={() => setSection(id as typeof section)}><strong>{label}</strong><small>{desc}</small></button>)}</aside><div className="settings">
      {section === 'shop' && <StoreSettings />}
      {section === 'server' && <section className="card">
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
      </section>}

      {section === 'store' && <section className="card">
        <h2>Máy này</h2>
        <label>
          Tên quầy / thiết bị
          <input {...field('deviceName')} placeholder="Quầy 1" />
        </label>
        <p className="muted small">Tên quán, địa chỉ và lời cảm ơn trên hoá đơn chỉnh ở mục “Cửa hàng & chuyển khoản”, áp dụng cho mọi máy.</p>
        <p className="muted small">
          Mã thiết bị: {form.deviceId} · Phiên bản {APP_VERSION} · {Capacitor.isNativePlatform() ? `Android app` : 'Trình duyệt'}
        </p>
      </section>}

      {section === 'hardware' && <section className="card">
        <h2>Phần cứng</h2>
        <DriverSelect label="Máy in hoá đơn" options={printers} value={form.hardware.printer} onChange={(v) => hw('printer', v)} />
        <DriverSelect label="Máy quét mã vạch" options={scanners} value={form.hardware.scanner} onChange={(v) => hw('scanner', v)} />
        <DriverSelect label="Két tiền" options={drawers} value={form.hardware.drawer} onChange={(v) => hw('drawer', v)} />
        {Capacitor.isNativePlatform() && <UsbStatus />}
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
      </section>}

      {section === 'about' && <section className="card about-card"><img className="brand-mark large" src="./logo.svg" alt="ShopFlow" /><h2>ShopFlow POS</h2><p className="muted">Hệ thống bán hàng và quản lý cửa hàng dành cho mô hình F&B.</p><div className="about-row"><span>Phiên bản ứng dụng</span><strong>{APP_VERSION}</strong></div><div className="about-row"><span>Nền tảng</span><strong>{Capacitor.isNativePlatform() ? 'Android POS' : 'Windows / trình duyệt'}</strong></div><div className="about-row"><span>Đồng bộ gần nhất</span><strong>{lastSyncAt ? dateTime(lastSyncAt) : 'Chưa có'}</strong></div></section>}

      {section !== 'shop' && section !== 'about' && <div className="settings-actions">
        <button className="btn secondary" disabled={!dirty} onClick={() => setForm(saved)}>
          Huỷ thay đổi
        </button>
        <button className="btn primary big" disabled={!dirty} onClick={onSave}>
          Lưu cài đặt
        </button>
      </div>}
    </div></div>
  );
}

/** Which USB devices the Android app sees, so a cable/permission problem is visible on the POS itself. */
function UsbStatus() {
  const [devices, setDevices] = useState<UsbDeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); listUsbDevices().then(setDevices, (e: unknown) => setError(e instanceof Error ? e.message : String(e))); };
  useEffect(refresh, []);
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  const printers = devices?.filter((d) => d.printer) ?? [];
  return (
    <p className="muted small">
      Máy in USB:{' '}
      {error ? `lỗi ${error}` : devices === null ? 'đang kiểm tra…' : printers.length === 0 ? 'không thấy (kiểm tra dây USB, nguồn máy in)' : printers.map((d) => `${d.name} [${hex(d.vendorId)}:${hex(d.productId)}]${d.permission ? '' : ' · chưa cấp quyền'}`).join(', ')}{' '}
      <button className="btn ghost small" onClick={refresh}>Kiểm tra lại</button>
    </p>
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
