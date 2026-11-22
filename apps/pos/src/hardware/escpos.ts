import type { ReceiptData } from './types';

const ESC = 0x1b;
const GS = 0x1d;
const encoder = new TextEncoder();

/** ESC/POS is commonly configured for CP437/CP858, so remove Vietnamese
 * diacritics instead of sending UTF-8 bytes that many small printers garble. */
export function printableText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function bytes(...parts: number[][]): Uint8Array {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function text(value: string): number[] {
  return [...encoder.encode(printableText(value))];
}

function line(value = ''): number[] {
  return [...bytes(text(value), [0x0a])];
}

export function cutPaper(): Uint8Array {
  return Uint8Array.from([GS, 0x56, 0x00]);
}

/** Pulse pin 2 to open the cash drawer. */
export function openCashDrawerPulse(): Uint8Array {
  return Uint8Array.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

export function encodeReceipt(receipt: ReceiptData, paperWidthChars = 32): Uint8Array {
  const width = paperWidthChars >= 40 ? 48 : 32;
  const right = (label: string, value: string) => `${label}${' '.repeat(Math.max(1, width - label.length - value.length))}${value}`;
  const output: number[][] = [
    [ESC, 0x40],
    [ESC, 0x61, 0x01],
    [ESC, 0x45, 0x01],
    line(receipt.storeName),
    [ESC, 0x45, 0x00],
    ...receipt.storeAddress ? [line(receipt.storeAddress)] : [],
    [ESC, 0x61, 0x00],
    line(`Don ${receipt.orderNumber}`),
    ...(receipt.orderTypeLabel ? [line(`Loai don: ${receipt.orderTypeLabel}`)] : []),
    ...(receipt.tableName ? [line(`Ban: ${receipt.tableName}`)] : []),
    ...(receipt.note ? [line(`Ghi chu: ${receipt.note}`)] : []),
    line(new Date(receipt.createdAt).toLocaleString('vi-VN')),
    line('-'.repeat(width)),
  ];
  for (const item of receipt.lines) {
    output.push(line(item.name));
    output.push(line(right(`  ${item.qty} x ${item.price.toLocaleString('en-US')}`, item.lineTotal.toLocaleString('en-US'))));
    if (item.note) output.push(line(`  * ${item.note}`));
  }
  output.push(
    line('-'.repeat(width)),
    line(right('Tam tinh', receipt.subtotal.toLocaleString('en-US'))),
    ...(receipt.discount ? [line(right('Giam gia', `-${receipt.discount.toLocaleString('en-US')}`))] : []),
    [ESC, 0x45, 0x01],
    line(right('TONG', receipt.total.toLocaleString('en-US'))),
    [ESC, 0x45, 0x00],
    line(`Thanh toan: ${{ cash: 'Tien mat', card: 'The', transfer: 'Chuyen khoan' }[receipt.paymentMethod]}`),
    ...(receipt.paymentMethod === 'cash' ? [line(right('Khach dua', receipt.paid.toLocaleString('en-US')))] : []),
    ...(receipt.change ? [line(right('Tien thoi', receipt.change.toLocaleString('en-US')))] : []),
    line(),
    ...(receipt.footer ? [line(receipt.footer)] : []),
    line(),
    [...cutPaper()],
  );
  return Uint8Array.from(output.flat());
}

export function toBase64(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
