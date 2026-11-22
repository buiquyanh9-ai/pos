import { describe, expect, it } from 'vitest';
import { crc16, qrText, vietQrPayload } from '@shopflow/shared';

describe('VietQR', () => {
  it('CRC16-CCITT-FALSE reference value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('builds a dynamic payload with amount and message, ending with a valid CRC', () => {
    const p = vietQrPayload({ bin: '970436', account: '0123456789', amount: 55000, message: 'Đơn A-001 bàn 005' });
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('0010A000000727');
    expect(p).toContain('5405' + '55000');
    expect(p).toContain('0208QRIBFTTA');
    expect(p).toContain('5802VN');
    const body = p.slice(0, -4);
    expect(p.slice(-4)).toBe(crc16(body));
    expect(qrText('Đơn A-001 bàn 005')).toBe('Don A 001 ban 005');
  });
});
