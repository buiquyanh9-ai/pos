import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

let httpServer: Server;
let base: string;
let printer: net.Server;
let received: Buffer[] = [];

before(async () => {
  printer = net.createServer((socket) => {
    socket.on('data', (chunk) => received.push(chunk));
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => printer.once('listening', resolve));
  httpServer = createApp({ db: openDb(':memory:'), apiKey: 'test-key' }).listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/hardware`;
});

after(() => {
  printer.close();
  httpServer.close();
});

async function post(body: unknown) {
  const response = await fetch(`${base}/escpos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as { error?: string; bytes?: number } };
}

test('ESC/POS route validates LAN addresses and forwards bytes', async () => {
  const port = (printer.address() as AddressInfo).port;
  assert.equal((await post({ address: `8.8.8.8:${port}`, data: 'AQI=' })).status, 400);
  assert.equal((await post({ address: `127.0.0.1:${port}`, data: 'not-base64!' })).status, 400);

  received = [];
  const response = await post({ address: `127.0.0.1:${port}`, data: 'AQI=' });
  assert.equal(response.status, 200);
  assert.equal(response.body.bytes, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(Buffer.concat(received), Buffer.from([1, 2]));
});

test('ESC/POS route reports printer connection errors as bad gateway', async () => {
  const unused = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => unused.once('listening', resolve));
  const port = (unused.address() as AddressInfo).port;
  await new Promise((resolve) => unused.close(resolve));
  assert.equal((await post({ address: `127.0.0.1:${port}`, data: 'AQI=' })).status, 502);
});
