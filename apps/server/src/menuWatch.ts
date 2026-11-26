import { existsSync, readFileSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.ts';
import { importMenu } from './menu.ts';

/** The shop's product folder: <workspace>/product next to the repo if present, otherwise <repo>/product. */
export function productDir() {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const beside = join(repo, '..', 'product');
  return existsSync(join(beside, 'z.product')) ? beside : join(repo, 'product');
}

/** product/z.product (see productDir), or MENU_FILE. */
export function defaultMenuPath() {
  return process.env.MENU_FILE ?? join(productDir(), 'z.product');
}

/** Import the menu at startup if the file changed, then re-import whenever it is saved. */
export function watchMenu(db: DB) {
  const file = defaultMenuPath();
  if (!existsSync(file)) return console.log(`  Menu file: not found (${file}), using the menu in the database`);
  const run = () => {
    try {
      const r = importMenu(db, readFileSync(file, 'utf8'));
      if (r.changed) console.log(`  Menu imported from ${file}: ${r.products} món, ${r.categories} danh mục, ẩn ${r.deactivated}`);
      r.warnings.forEach((w) => console.warn(`  ! menu: ${w}`));
    } catch (err) {
      console.error(`  ! menu import failed, keeping the current menu: ${err instanceof Error ? err.message : err}`);
    }
  };
  run();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(file, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 500);
    });
  } catch {
    /* watching not supported: restart the server after editing the menu */
  }
}
