// Import the menu from the shop's description file:
//   npm run import-menu -w apps/server [-- path/to/z.product] [--sample-stock]
import { readFileSync } from 'node:fs';
import { openDb } from './db.ts';
import { defaultMenuPath } from './menuWatch.ts';
import { importMenu, parseMenu } from './menu.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? defaultMenuPath();
const md = readFileSync(file, 'utf8');
const parsed = parseMenu(md);
for (const c of parsed.categories) {
  console.log(`\n${c}`);
  const rows = [...new Set(parsed.products.filter((p) => p.category === c).map((p) => p.row))];
  for (const r of rows) {
    const cells = [0, 1, 2, 3, 4].map((col) => parsed.products.find((p) => p.category === c && p.row === r && p.col === col));
    console.log('  ' + cells.map((p) => (p ? `${p.name} ${p.price / 1000}k` : '·')).join(' | '));
  }
}
parsed.warnings.forEach((w) => console.warn('! ' + w));
const db = openDb(process.env.DB_PATH ?? './data/shopflow.db');
const r = importMenu(db, md, { force: true, sampleStock: args.includes('--sample-stock') });
console.log(`\nĐã nhập ${r.products} món, ${r.categories} danh mục; ẩn ${r.deactivated} món không còn trong file.`);
