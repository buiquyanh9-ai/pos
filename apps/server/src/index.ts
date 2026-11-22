import { networkInterfaces } from 'node:os';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { seedIfEmpty } from './seed.ts';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? './data/shopflow.db';
const apiKey = process.env.SHOPFLOW_API_KEY || undefined;

const db = openDb(dbPath);
if (process.env.SEED !== '0') seedIfEmpty(db);

createApp({ db, apiKey }).listen(port, host, () => {
  console.log(`ShopFlow server listening on http://localhost:${port}`);
  // Print LAN addresses so they can be typed into the POS "Backend URL" setting.
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${port}`);
    }
  }
  console.log(apiKey ? '  API key: required (x-api-key)' : '  API key: disabled (set SHOPFLOW_API_KEY to enable)');
});
