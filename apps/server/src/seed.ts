import { fileURLToPath } from 'node:url';
import { type DB, logChange, now, openDb, tx } from './db.ts';

const SAMPLE: [sku: string, barcode: string, name: string, category: string, price: number, stock: number][] = [
  ['CF-DEN', '8930000000011', 'Cà phê đen', 'Đồ uống', 20000, 200],
  ['CF-SUA', '8930000000028', 'Cà phê sữa', 'Đồ uống', 25000, 200],
  ['BAC-XIU', '8930000000035', 'Bạc xỉu', 'Đồ uống', 29000, 150],
  ['TRA-DAO', '8930000000042', 'Trà đào cam sả', 'Đồ uống', 35000, 120],
  ['TRA-SUA', '8930000000059', 'Trà sữa trân châu', 'Đồ uống', 32000, 120],
  ['NUOC-SUOI', '8934588012228', 'Nước suối 500ml', 'Đồ uống', 10000, 300],
  ['BANH-MI', '8930000000066', 'Bánh mì thịt', 'Đồ ăn', 25000, 80],
  ['BANH-BAO', '8930000000073', 'Bánh bao', 'Đồ ăn', 18000, 60],
  ['XOI-GA', '8930000000080', 'Xôi gà', 'Đồ ăn', 30000, 50],
  ['CROISSANT', '8930000000097', 'Bánh sừng bò', 'Đồ ăn', 22000, 40],
  ['SNACK', '8934563138165', 'Snack khoai tây', 'Tạp hoá', 12000, 100],
  ['KEO-CAO-SU', '8935001800231', 'Kẹo cao su', 'Tạp hoá', 8000, 100],
];

export function seedIfEmpty(db: DB) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
  if (Number(n) > 0) return false;
  const ins = db.prepare(
    'INSERT INTO products (id, sku, barcode, name, category, price, stock, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
  );
  tx(db, () => {
    for (const [sku, barcode, name, category, price, stock] of SAMPLE) {
      const id = `p-${sku.toLowerCase()}`;
      ins.run(id, sku, barcode, name, category, price, stock, now());
      logChange(db, 'product', id, 'upsert');
    }
  });
  console.log(`Seeded ${SAMPLE.length} sample products`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedIfEmpty(openDb(process.env.DB_PATH ?? './data/shopflow.db'));
}
