// Time ranges in the shop's local time (default UTC+7), converted to ISO instants for the API.

export const TZ_MIN = 420;

export interface Range {
  from: string; // ISO
  to: string; // ISO, exclusive
  label: string;
}

/** Local wall-clock (y, m, d, h, min) in the shop timezone -> UTC ISO string. */
export function localToIso(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(Date.UTC(y, m, d, h, min) - TZ_MIN * 60_000).toISOString();
}

/** Shop-local date parts of an instant. */
export function localParts(t = new Date()) {
  const l = new Date(t.getTime() + TZ_MIN * 60_000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), h: l.getUTCHours(), min: l.getUTCMinutes(), dow: l.getUTCDay() };
}

const ddmm = (y: number, m: number, d: number) => `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}`;

export type Preset = 'today' | 'yesterday' | 'week' | 'last7' | 'month' | 'lastMonth';
export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'yesterday', label: 'Hôm qua' },
  { id: 'week', label: 'Tuần này' },
  { id: 'last7', label: '7 ngày' },
  { id: 'month', label: 'Tháng này' },
  { id: 'lastMonth', label: 'Tháng trước' },
];

export function presetRange(p: Preset, now = new Date()): Range {
  const { y, m, d, dow } = localParts(now);
  switch (p) {
    case 'today':
      return { from: localToIso(y, m, d), to: localToIso(y, m, d + 1), label: `Hôm nay ${ddmm(y, m, d)}` };
    case 'yesterday':
      return { from: localToIso(y, m, d - 1), to: localToIso(y, m, d), label: 'Hôm qua' };
    case 'week': {
      const back = (dow + 6) % 7; // Monday-based week
      return { from: localToIso(y, m, d - back), to: localToIso(y, m, d + 1), label: 'Tuần này' };
    }
    case 'last7':
      return { from: localToIso(y, m, d - 6), to: localToIso(y, m, d + 1), label: '7 ngày qua' };
    case 'month':
      return { from: localToIso(y, m, 1), to: localToIso(y, m + 1, 1), label: `Tháng ${m + 1}/${y}` };
    case 'lastMonth':
      return { from: localToIso(y, m - 1, 1), to: localToIso(y, m, 1), label: `Tháng ${m === 0 ? 12 : m}/${m === 0 ? y - 1 : y}` };
  }
}

/** Custom range from <input type="date"> and <input type="time"> values, e.g. 08:00–11:30. */
export function customRange(fromDate: string, fromTime: string, toDate: string, toTime: string): Range {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const [fh, fmin] = (fromTime || '00:00').split(':').map(Number);
  const [th, tmin] = (toTime || '23:59').split(':').map(Number);
  const from = localToIso(fy, fm - 1, fd, fh, fmin);
  // "to" is inclusive in the UI (23:59 means end of that minute).
  const to = new Date(new Date(localToIso(ty, tm - 1, td, th, tmin)).getTime() + 60_000).toISOString();
  return { from, to, label: `${ddmm(fy, fm - 1, fd)} ${fromTime} – ${ddmm(ty, tm - 1, td)} ${toTime}` };
}

export const isoDateLocal = (iso: string) => {
  const { y, m, d } = localParts(new Date(iso));
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export const timeLocal = (iso: string) => {
  const { h, min } = localParts(new Date(iso));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

export const dateTimeLocal = (iso: string) => {
  const { y, m, d } = localParts(new Date(iso));
  return `${ddmm(y, m, d)}/${y} ${timeLocal(iso)}`;
};

/** Range length in days (for choosing hourly vs daily charts). */
export const rangeDays = (r: { from: string; to: string }) => (new Date(r.to).getTime() - new Date(r.from).getTime()) / 86400_000;
