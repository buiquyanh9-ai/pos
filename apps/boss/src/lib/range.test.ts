import { describe, expect, it } from 'vitest';
import { customRange, localParts, presetRange } from './range';
import { moneyShort } from '@shopflow/shared';

describe('ranges (UTC+7)', () => {
  const now = new Date('2026-11-22T20:00:00Z'); // 03:00 on 23/11 local

  it('today follows the local calendar day, not UTC', () => {
    const r = presetRange('today', now);
    expect(r.from).toBe('2026-11-22T17:00:00.000Z');
    expect(r.to).toBe('2026-11-23T17:00:00.000Z');
  });

  it('custom range keeps exact hours, end minute inclusive', () => {
    const r = customRange('2026-11-20', '08:00', '2026-11-20', '11:30');
    expect(r.from).toBe('2026-11-20T01:00:00.000Z');
    expect(r.to).toBe('2026-11-20T04:31:00.000Z');
  });

  it('week starts on Monday', () => {
    const r = presetRange('week', now); // 23/11/2026 is a Monday
    expect(localParts(new Date(r.from)).dow).toBe(1);
  });

  it('short money', () => {
    expect(moneyShort(1_250_000)).toBe('1,25tr');
    expect(moneyShort(85_000)).toBe('85k');
    expect(moneyShort(12_500_000)).toBe('12,5tr');
  });
});
