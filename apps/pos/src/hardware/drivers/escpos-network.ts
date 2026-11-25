import type { CashDrawerDriver, PrinterDriver, ReceiptData } from '../types';
import { encodeReceipt, openCashDrawerPulse, toBase64 } from '../escpos';
import { getState } from '../../lib/store';

function config() {
  const st = getState();
  const s = st.settings;
  return { backendUrl: s.backendUrl?.replace(/\/$/, ''), token: st.session?.token, apiKey: s.apiKey, address: s.hardware?.printerAddress, paperWidthChars: s.hardware?.paperWidthChars };
}
async function send(data: Uint8Array): Promise<void> {
  const c = config();
  if (!c.backendUrl || !c.address) throw new Error('Chưa cấu hình backend hoặc địa chỉ máy in');
  // /api/hardware requires a session like every other API call: send the logged-in user's token.
  const auth: Record<string, string> = c.token ? { authorization: `Bearer ${c.token}` } : c.apiKey ? { 'x-api-key': c.apiKey } : {};
  if (!auth.authorization && !auth['x-api-key']) throw new Error('Đăng nhập trước khi in (máy chủ yêu cầu đăng nhập)');
  const response = await fetch(`${c.backendUrl}/api/hardware/escpos`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ address: c.address, data: toBase64(data) }) });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* non-JSON response */ }
    throw new Error(message);
  }
}

export const escposNetworkPrinter: PrinterDriver = {
  id: 'escpos-network', name: 'Máy in ESC/POS qua mạng',
  async isAvailable() { const c = config(); return Boolean(c.backendUrl && c.address); },
  async printReceipt(receipt: ReceiptData) { const c = config(); await send(encodeReceipt(receipt, c.paperWidthChars)); },
};

export const escposNetworkDrawer: CashDrawerDriver = {
  id: 'escpos-network', name: 'Két tiền qua máy in mạng',
  async isAvailable() { const c = config(); return Boolean(c.backendUrl && c.address); },
  async open() { await send(openCashDrawerPulse()); },
};
