import { describe, expect, it } from 'vitest';
import { normalizeBackendUrl } from './settings';

describe('normalizeBackendUrl', () => {
  it.each([
    ['192.168.1.5:4000', 'http://192.168.1.5:4000'],
    ['http://192.168.1.5:4000/', 'http://192.168.1.5:4000'],
    ['https://pos.example.com/api', 'https://pos.example.com'],
    ['https://example.com/shopflow/api/', 'https://example.com/shopflow'],
    ['  ', ''],
  ])('%s -> %s', (input, out) => {
    expect(normalizeBackendUrl(input)).toBe(out);
  });

  it('throws on garbage', () => {
    expect(() => normalizeBackendUrl('http://')).toThrow();
  });
});
