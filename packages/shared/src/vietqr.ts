// VietQR (NAPAS 247) payload, EMVCo format. Any Vietnamese banking app can scan it and gets the
// account, amount and message pre-filled. Built locally: no account data leaves the shop.

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo. */
export function crc16(s: string) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove accents and characters banks reject in the transfer message. */
export const qrText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25);

export function vietQrPayload(p: { bin: string; account: string; amount?: number; message?: string }) {
  const beneficiary = field('00', p.bin) + field('01', p.account);
  const merchant = field('00', 'A000000727') + field('01', beneficiary) + field('02', 'QRIBFTTA');
  let s = field('00', '01') + field('01', p.amount ? '12' : '11') + field('38', merchant) + field('53', '704');
  if (p.amount) s += field('54', String(Math.round(p.amount)));
  s += field('58', 'VN');
  const msg = p.message ? qrText(p.message) : '';
  if (msg) s += field('62', field('08', msg));
  s += '6304';
  return s + crc16(s);
}

/** Common banks (NAPAS BIN). The owner can also type any 6-digit BIN. */
export const BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970448', name: 'OCB' },
  { bin: '970454', name: 'Viet Capital Bank' },
];
