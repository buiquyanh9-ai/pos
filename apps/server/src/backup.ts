// Online backup of the SQLite database (safe while the server is running):
//   npm run backup -w apps/server -- [target-dir]      (default ./backups)
// Keeps the last BACKUP_KEEP files (default 30).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from './db.ts';

const dir = resolve(process.argv[2] ?? process.env.BACKUP_DIR ?? './backups');
const keep = Number(process.env.BACKUP_KEEP ?? 30);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const target = join(dir, `shopflow-${stamp}.db`);
const db = openDb(process.env.DB_PATH ?? './data/shopflow.db');
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
const old = readdirSync(dir).filter((f) => /^shopflow-.*\.db$/.test(f)).sort();
for (const f of old.slice(0, Math.max(0, old.length - keep))) rmSync(join(dir, f));
console.log(`Backup written: ${target}`);
