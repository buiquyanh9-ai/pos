const vnd = new Intl.NumberFormat('vi-VN');

export const money = (n: number) => `${vnd.format(n)}đ`;
/** 1.250.000 -> "1,25tr", 85.000 -> "85k" (axis labels, tight tiles). */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(a >= 10_000_000_000 ? 0 : 1).replace('.', ',')}tỷ`;
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '').replace('.', ',')}tr`;
  if (a >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
export const qty = (n: number) => vnd.format(Math.round(n * 1000) / 1000);
export const pct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('vi-VN')}%`);
