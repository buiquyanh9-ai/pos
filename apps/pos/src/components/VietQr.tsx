import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { BANKS, vietQrPayload } from '@shopflow/shared';
import { api, type StoreInfo } from '../lib/api';
import { money } from '../lib/format';
import { remote } from '../lib/store';

let cache: { at: number; info: StoreInfo } | null = null;

/** Store info shared by all terminals (bank account, receipt header). Cached for a minute. */
export function useStoreInfo() {
  const [info, setInfo] = useState<StoreInfo | null>(cache?.info ?? null);
  useEffect(() => {
    if (cache && Date.now() - cache.at < 60_000) return;
    remote(api.store)
      .then((i) => {
        cache = { at: Date.now(), info: i };
        setInfo(i);
      })
      .catch(() => undefined);
  }, []);
  return [info, (i: StoreInfo) => ((cache = { at: Date.now(), info: i }), setInfo(i))] as const;
}

/** Bank-transfer QR with the exact amount and the order number as message. */
export function VietQr({ amount, message, size = 220 }: { amount: number; message: string; size?: number }) {
  const [info] = useStoreInfo();
  const [svg, setSvg] = useState<string | null>(null);
  const ok = Boolean(info?.bank_bin && info.bank_account);
  useEffect(() => {
    if (!ok || !info) return;
    const payload = vietQrPayload({ bin: info.bank_bin, account: info.bank_account, amount, message });
    QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: size })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [ok, info, amount, message, size]);

  if (!info) return <p className="muted">Đang tải thông tin chuyển khoản…</p>;
  if (!ok) return <p className="muted">Chưa cài tài khoản nhận chuyển khoản. Chủ cửa hàng vào ••• → Cài đặt → Chuyển khoản để thêm, mã QR sẽ tự hiện ở đây.</p>;
  const bank = BANKS.find((b) => b.bin === info.bank_bin)?.name ?? info.bank_name;
  return (
    <div className="vietqr">
      {/* SVG markup generated locally by the qrcode library from our own payload */}
      <div className="vietqr-code" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      <div className="vietqr-info">
        <span className="muted">Quét bằng app ngân hàng bất kỳ</span>
        <strong>{money(amount)}</strong>
        <span>{bank}</span>
        <span className="vietqr-acc">{info.bank_account}</span>
        <span>{info.bank_holder}</span>
        <span className="muted small">Nội dung: {message}</span>
      </div>
    </div>
  );
}
