/** Folder labels shared by menu import, stored URLs and the media route. */
export const PRODUCT_IMAGE_GROUPS = ['com-trang', 'com-dao', 'mon-them', 'do-an-kem', 'do-uong'] as const;

const drinks = new Set(['sua-dau', 'coca-cola', 'tra-da', 'nuoc-gao', 'nuoc-loc']);
const sides = new Set(['khoai-tay-chien', 'trung-op', 'ngo-chien', 'lap-xuong', 'xuc-xich', 'trung-kho']);

export function productImagePath(name: string): string {
  if (name === 'com-trang-them' || name === 'com-dao-them' || name.endsWith('-them')) return `mon-them/${name}`;
  if (name.startsWith('com-trang-')) return `com-trang/${name}`;
  if (name.startsWith('com-dao-')) return `com-dao/${name}`;
  if (drinks.has(name)) return `do-uong/${name}`;
  if (sides.has(name)) return `do-an-kem/${name}`;
  return name;
}
