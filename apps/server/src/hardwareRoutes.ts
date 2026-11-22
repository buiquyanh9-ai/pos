import { Router } from 'express';
import net from 'node:net';

export const hardwareRouter = Router();

const MAX_PAYLOAD = 512 * 1024;
const HOSTNAME = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.(?:local|lan))?$/i;

function parseAddress(value: unknown): { host: string; port: number } {
  if (typeof value !== 'string' || value.length > 255) throw new Error('address must be host:port');
  const match = value.match(/^(.+):(\d{1,5})$/);
  if (!match) throw new Error('address must be host:port');
  const host = match[1].trim();
  const port = Number(match[2]);
  const ipv4 = host.split('.').map(Number);
  const validIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateIpv4 = validIpv4 && (ipv4[0] === 10 || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168) || ipv4[0] === 127);
  if ((!privateIpv4 && !HOSTNAME.test(host)) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('address must be a LAN IP or hostname with a valid port');
  return { host, port };
}

function decodePayload(value: unknown): Buffer {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_PAYLOAD / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('data must be base64 under 512KB');
  const data = Buffer.from(value, 'base64');
  if (!data.length || data.length > MAX_PAYLOAD) throw new Error('data must be base64 under 512KB');
  return data;
}

function sendToPrinter(host: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => { const error = new Error('printer connection timeout'); error.name = 'TimeoutError'; socket.destroy(error); }, 5000);
    const finish = (error?: Error) => { clearTimeout(timeout); socket.destroy(); error ? reject(error) : resolve(); };
    socket.once('error', finish);
    socket.once('connect', () => socket.end(data, () => finish()));
  });
}

hardwareRouter.post('/escpos', async (req, res) => {
  try {
    const { host, port } = parseAddress(req.body?.address);
    const data = decodePayload(req.body?.data);
    await sendToPrinter(host, port, data);
    res.json({ ok: true, bytes: data.length });
  } catch (error) {
    const status = error instanceof Error && error.name === 'TimeoutError' ? 504 : error instanceof Error && error.message.startsWith('connect') ? 502 : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : 'invalid hardware request' });
  }
});
