import { imageSrc as sharedImageSrc } from '@shopflow/shared';
import { getState } from './store';

const vnd = new Intl.NumberFormat('vi-VN');

/** Absolute URL of a product photo (null = no photo, show the letter tile). Usage: imageSrc(p.imageUrl). */
export const imageSrc = (imageUrl: string | null | undefined) => sharedImageSrc(imageUrl, getState().settings.backendUrl);

export const money = (n: number) => `${vnd.format(n)}đ`;

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Start/end (exclusive) of the local calendar day containing `d`, as ISO strings. */
export function localDayRange(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Lowercase and strip Vietnamese diacritics for search. */
export function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}
