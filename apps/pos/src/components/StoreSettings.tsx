import { useEffect, useState } from 'react';
import { BANKS } from '@shopflow/shared';
import { api, type StoreInfo } from '../lib/api';
import { notify } from '../lib/notify';
import { remote, usePos } from '../lib/store';
import { VietQr, useStoreInfo } from './VietQr';

/** Store-wide info for every terminal: receipt header + bank account used for the transfer QR. */
export function StoreSettings() {
  const owner = usePos((s) => s.session?.user.role === 'owner');
  const [info, setInfo] = useStoreInfo();
  const [form, setForm] = useState<StoreInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (info && !form) setForm(info);
  }, [info, form]);
  if (!form) return <p className="muted">Đang tải…</p>;
  const set = (k: keyof StoreInfo) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const saved = await remote(api.saveStore, { ...form, bank_holder: form.bank_holder.toUpperCase() });
      setInfo(saved);
      setForm(saved);
      notify('Đã lưu thông tin cửa hàng cho mọi máy', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="store-settings">
      <section className="card">
        <h2>Thông tin cửa hàng (in trên hoá đơn)</h2>
        <label>
          Tên cửa hàng
          <input value={form.store_name} onChange={set('store_name')} disabled={!owner} />
        </label>
        <label>
          Địa chỉ
          <input value={form.store_address} onChange={set('store_address')} disabled={!owner} />
        </label>
        <label>
          Số điện thoại
          <input value={form.store_phone} onChange={set('store_phone')} disabled={!owner} inputMode="tel" />
        </label>
        <label>
          Lời cảm ơn cuối hoá đơn
          <input value={form.receipt_footer} onChange={set('receipt_footer')} disabled={!owner} />
        </label>
      </section>
      <section className="card">
        <h2>Tài khoản nhận chuyển khoản</h2>
        <p className="muted small">Khi khách chọn Chuyển khoản, POS hiện mã VietQR có sẵn số tiền và mã đơn. Khách quét bằng app ngân hàng nào cũng được.</p>
        <label>
          Ngân hàng
          <select
            value={form.bank_bin}
            disabled={!owner}
            onChange={(e) => setForm({ ...form, bank_bin: e.target.value, bank_name: BANKS.find((b) => b.bin === e.target.value)?.name ?? form.bank_name })}
          >
            <option value="">— Chọn ngân hàng —</option>
            {BANKS.map((b) => (
              <option key={b.bin} value={b.bin}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Số tài khoản
          <input value={form.bank_account} onChange={set('bank_account')} disabled={!owner} inputMode="numeric" />
        </label>
        <label>
          Tên chủ tài khoản (không dấu)
          <input value={form.bank_holder} onChange={set('bank_holder')} disabled={!owner} />
        </label>
        {!owner && <p className="muted small">Chỉ chủ cửa hàng được sửa.</p>}
        {owner && (
          <button className="btn primary big" disabled={busy} onClick={() => void save()}>
            Lưu cho tất cả máy
          </button>
        )}
      </section>
      <section className="card">
        <h2>Xem thử mã QR</h2>
        <VietQr amount={55000} message="Don thu 001" />
      </section>
    </div>
  );
}
