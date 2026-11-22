import { useCallback, useEffect, useState } from 'react';
import { api, type ProductInput } from '../lib/api';
import { money } from '../lib/format';
import { notify } from '../lib/notify';
import { remote, syncNow } from '../lib/store';
import { ROLE_LABEL, type Category, type DiningTable, type InventoryItem, type OptionGroup, type Product, type Role, type Supplier, type User } from '../lib/types';
import { Modal } from '../components/Modal';

// Owner back-office on the POS: menu (products, prices, categories, options, recipes), tables, staff, stock items.

type Section = 'products' | 'options' | 'tables' | 'items' | 'suppliers' | 'staff';
type AdminProduct = Product & { recipe: { itemId: string; itemName: string; unit: string; qty: number }[] };
const fail = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error');
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const dec = (s: string) => Number(s.replace(',', '.'));

export function AdminScreen() {
  const [section, setSection] = useState<Section>('products');
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const reload = useCallback(async () => {
    try {
      const [cat, inv] = await Promise.all([remote(api.productsAll), remote(api.inventory)]);
      setProducts(cat.products);
      setCategories(cat.categories);
      setGroups(cat.optionGroups);
      setItems(inv.items);
      void syncNow(); // refresh the sale screen's cached menu
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const menu: [Section, string][] = [
    ['products', 'Món & giá bán'],
    ['options', 'Tuỳ chọn món'],
    ['items', 'Nguyên liệu / hàng hoá'],
    ['suppliers', 'Nhà cung cấp'],
    ['tables', 'Bàn'],
    ['staff', 'Nhân viên'],
  ];
  return (
    <div className="stock-layout">
      <nav className="stock-menu">
        <span className="eyebrow">QUẢN LÝ</span>
        {menu.map(([id, label]) => (
          <button key={id} className={section === id ? 'stock-menu-item active' : 'stock-menu-item'} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <section className="stock-body">
        {section === 'products' && <Products products={products} categories={categories} groups={groups} items={items} onChanged={reload} />}
        {section === 'options' && <Options groups={groups} items={items} onChanged={reload} />}
        {section === 'items' && <Items items={items} onChanged={reload} />}
        {section === 'tables' && <Tables />}
        {section === 'suppliers' && <Suppliers />}
        {section === 'staff' && <Staff />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- products
function Products({ products, categories, groups, items, onChanged }: { products: AdminProduct[]; categories: Category[]; groups: OptionGroup[]; items: InventoryItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [newCat, setNewCat] = useState('');
  return (
    <>
      <div className="stock-actions">
        <input className="admin-inline" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Tên danh mục mới" />
        <button
          className="btn secondary"
          disabled={!newCat.trim()}
          onClick={() =>
            remote(api.saveCategory, null, { name: newCat.trim(), sort: categories.length + 1 })
              .then(() => (setNewCat(''), notify('Đã thêm danh mục', 'success'), onChanged()))
              .catch(fail)
          }
        >
          ＋ Danh mục
        </button>
        <button className="btn primary" onClick={() => setEditing('new')}>
          ＋ Thêm món
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Món</th>
            <th>Danh mục</th>
            <th className="num">Giá bán</th>
            <th className="num">Giá vốn</th>
            <th className="num">Còn bán được</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} onClick={() => setEditing(p)} className="clickable">
              <td>
                <strong>{p.name}</strong>
                {p.optionGroups.length > 0 && <span className="muted small"> · {p.optionGroups.map((g) => g.name).join(', ')}</span>}
              </td>
              <td>{p.category}</td>
              <td className="num">{money(p.price)}</td>
              <td className="num muted">
                {p.cost === null ? '—' : money(p.cost)}
                {p.cost !== null && p.price > 0 && <span className="small"> ({Math.round((p.cost / p.price) * 100)}%)</span>}
              </td>
              <td className="num">{p.stock === null ? <span className="muted">không theo dõi</span> : p.stock}</td>
              <td>{p.active ? <span className="pill pill-synced">Đang bán</span> : <span className="pill">Ngừng bán</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          groups={groups}
          items={items}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), onChanged())}
        />
      )}
    </>
  );
}

function ProductForm({ product: p, categories, groups, items, onClose, onSaved }: { product: AdminProduct | null; categories: Category[]; groups: OptionGroup[]; items: InventoryItem[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(p?.name ?? '');
  const [price, setPrice] = useState(String(p?.price ?? ''));
  const [categoryId, setCategoryId] = useState(p?.categoryId ?? categories[0]?.id ?? '');
  const [sku, setSku] = useState(p?.sku ?? '');
  const [barcode, setBarcode] = useState(p?.barcode ?? '');
  const [imageUrl, setImageUrl] = useState(p?.imageUrl ?? '');
  const [cost, setCost] = useState(p && p.recipe.length === 0 && p.cost !== null ? String(p.cost) : '');
  const [active, setActive] = useState(p?.active ?? true);
  const [optionIds, setOptionIds] = useState<string[]>(p?.optionGroups.map((g) => g.id) ?? []);
  const [recipe, setRecipe] = useState<{ itemId: string; qty: string }[]>(p?.recipe.map((r) => ({ itemId: r.itemId, qty: String(r.qty) })) ?? []);
  const [busy, setBusy] = useState(false);

  const recipeCost = recipe.reduce((s, r) => s + (dec(r.qty) || 0) * (items.find((i) => i.id === r.itemId)?.unitCost ?? 0), 0);
  const priceN = num(price);
  const valid = name.trim() && Number.isInteger(priceN) && priceN >= 0 && recipe.every((r) => r.itemId && dec(r.qty) > 0);

  const save = async () => {
    setBusy(true);
    const body: ProductInput = {
      name: name.trim(),
      price: priceN,
      categoryId: categoryId || undefined,
      sku: sku.trim() || undefined,
      barcode: barcode.trim() || undefined,
      imageUrl: imageUrl.trim() || null,
      active,
      optionGroupIds: optionIds,
      recipe: recipe.map((r) => ({ itemId: r.itemId, qty: dec(r.qty) })),
      cost: recipe.length ? null : cost.trim() ? num(cost) : null,
    };
    try {
      await remote(api.saveProduct, p?.id ?? null, body);
      notify(p ? 'Đã cập nhật món' : 'Đã thêm món', 'success');
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `Sửa món: ${p.name}` : 'Thêm món mới'} onClose={onClose} wide>
      <div className="admin-form">
        <div className="admin-grid">
          <label className="field">
            Tên món
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            Giá bán (đ)
            <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            Danh mục
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Mã SKU
            <input value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label className="field">
            Mã vạch
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <label className="field">
            Ảnh (URL)
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </label>
        </div>

        <h3>Tuỳ chọn áp dụng</h3>
        <div className="opt-row">
          {groups.map((g) => {
            const on = optionIds.includes(g.id);
            return (
              <button key={g.id} className={on ? 'opt on' : 'opt'} onClick={() => setOptionIds(on ? optionIds.filter((x) => x !== g.id) : [...optionIds, g.id])}>
                {g.name}
                <small>{g.options.map((o) => o.name).join(' / ')}</small>
              </button>
            );
          })}
        </div>

        <h3>Công thức (định mức nguyên liệu cho 1 phần)</h3>
        <p className="muted small">Bán 1 phần sẽ tự trừ kho theo công thức. Không có công thức = không theo dõi tồn kho món này.</p>
        {recipe.map((r, i) => {
          const it = items.find((x) => x.id === r.itemId);
          return (
            <div key={i} className="recipe-row">
              <select value={r.itemId} onChange={(e) => setRecipe(recipe.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                <option value="">— Chọn nguyên liệu —</option>
                {items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.unit})
                  </option>
                ))}
              </select>
              <input inputMode="decimal" value={r.qty} onChange={(e) => setRecipe(recipe.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} placeholder="Định mức" />
              <span className="muted small">{it ? `${it.unit} · ${money(Math.round((dec(r.qty) || 0) * it.unitCost))}` : ''}</span>
              <button className="icon-btn" aria-label="Xoá dòng" onClick={() => setRecipe(recipe.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          );
        })}
        <button className="btn secondary" onClick={() => setRecipe([...recipe, { itemId: '', qty: '' }])}>
          ＋ Thêm nguyên liệu
        </button>
        {recipe.length > 0 ? (
          <p className="muted">
            Giá vốn theo công thức: <strong>{money(Math.round(recipeCost))}</strong>
            {priceN > 0 && ` · ${Math.round((recipeCost / priceN) * 100)}% giá bán`}
          </p>
        ) : (
          <label className="field">
            Giá vốn nhập tay (đ, không bắt buộc)
            <input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang bán
        </label>
        <button className="btn primary big full" disabled={!valid || busy} onClick={save}>
          Lưu món
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- option groups
function Options({ groups, items, onChanged }: { groups: OptionGroup[]; items: InventoryItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<OptionGroup | 'new' | null>(null);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setEditing('new')}>
          ＋ Nhóm tuỳ chọn
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Nhóm</th>
            <th>Lựa chọn</th>
            <th>Kiểu</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} className="clickable" onClick={() => setEditing(g)}>
              <td>
                <strong>{g.name}</strong>
              </td>
              <td>{g.options.map((o) => `${o.name}${o.priceDelta ? ` (+${money(o.priceDelta)})` : ''}`).join(', ')}</td>
              <td className="muted">
                {g.required ? 'Bắt buộc' : 'Tuỳ chọn'} · {g.multi ? 'chọn nhiều' : 'chọn một'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <OptionForm group={editing === 'new' ? null : editing} items={items} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />}
    </>
  );
}

function OptionForm({ group: g, items, onClose, onSaved }: { group: OptionGroup | null; items: InventoryItem[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(g?.name ?? '');
  const [multi, setMulti] = useState(g?.multi ?? false);
  const [required, setRequired] = useState(g?.required ?? false);
  type Row = { id?: string; name: string; price: string; factor: string; itemId: string; itemQty: string };
  const [options, setOptions] = useState<Row[]>(
    g?.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: String(o.priceDelta),
      factor: String(o.recipeFactor ?? 1),
      itemId: o.recipe?.[0]?.itemId ?? '',
      itemQty: o.recipe?.[0] ? String(o.recipe[0].qty) : '',
    })) ?? [{ name: '', price: '0', factor: '1', itemId: '', itemQty: '' }],
  );
  const set = (i: number, patch: Partial<Row>) => setOptions(options.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const valid =
    name.trim() &&
    options.length > 0 &&
    options.every((o) => o.name.trim() && Number.isInteger(num(o.price || '0')) && dec(o.factor || '1') > 0 && (!o.itemId || dec(o.itemQty) > 0));
  return (
    <Modal title={g ? `Sửa: ${g.name}` : 'Nhóm tuỳ chọn mới'} onClose={onClose}>
      <div className="admin-form">
        <label className="field">
          Tên nhóm (vd: Size, Đá, Topping)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Bắt buộc chọn
        </label>
        <label className="check">
          <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Cho chọn nhiều (topping)
        </label>
        <p className="muted small">
          Hệ số định mức nhân toàn bộ công thức món (vd size L = 1,4). Nguyên liệu thêm dùng cho topping (vd Thêm trân châu = 0,03 kg trân châu).
        </p>
        {options.map((o, i) => (
          <div key={i} className="option-edit">
            <input value={o.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Tên lựa chọn" />
            <input inputMode="numeric" value={o.price} onChange={(e) => set(i, { price: e.target.value })} placeholder="+ giá" title="Giá cộng thêm" />
            <input inputMode="decimal" value={o.factor} onChange={(e) => set(i, { factor: e.target.value })} placeholder="Hệ số" title="Hệ số định mức" />
            <select value={o.itemId} onChange={(e) => set(i, { itemId: e.target.value })} title="Nguyên liệu thêm">
              <option value="">— Không dùng thêm —</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.unit})
                </option>
              ))}
            </select>
            <input inputMode="decimal" value={o.itemQty} disabled={!o.itemId} onChange={(e) => set(i, { itemQty: e.target.value })} placeholder="Lượng" />
            <button className="icon-btn" aria-label="Xoá" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn secondary" onClick={() => setOptions([...options, { name: '', price: '0', factor: '1', itemId: '', itemQty: '' }])}>
          ＋ Lựa chọn
        </button>
        <button
          className="btn primary big full"
          disabled={!valid}
          onClick={() =>
            remote(api.saveOptionGroup, g?.id ?? null, {
              name: name.trim(),
              multi,
              required,
              options: options.map((o) => ({
                id: o.id,
                name: o.name.trim(),
                priceDelta: num(o.price || '0'),
                recipeFactor: dec(o.factor || '1'),
                recipe: o.itemId ? [{ itemId: o.itemId, qty: dec(o.itemQty) }] : [],
              })),
            })
              .then(() => (notify('Đã lưu tuỳ chọn', 'success'), onSaved()))
              .catch(fail)
          }
        >
          Lưu
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- inventory items
function Items({ items, onChanged }: { items: InventoryItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setEditing('new')}>
          ＋ Nguyên liệu / hàng hoá
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Loại</th>
            <th>Đơn vị</th>
            <th className="num">Tối thiểu</th>
            <th className="num">Giá vốn / đơn vị</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => setEditing(i)}>
              <td>
                <strong>{i.name}</strong>
              </td>
              <td className="muted">{i.kind === 'goods' ? 'Hàng hoá' : 'Nguyên liệu'}</td>
              <td>{i.unit}</td>
              <td className="num">{i.minQty}</td>
              <td className="num">{money(i.unitCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />}
    </>
  );
}

function ItemForm({ item: it, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(it?.name ?? '');
  const [unit, setUnit] = useState(it?.unit ?? 'kg');
  const [kind, setKind] = useState<'ingredient' | 'goods'>(it?.kind ?? 'ingredient');
  const [minQty, setMinQty] = useState(String(it?.minQty ?? 0));
  const [unitCost, setUnitCost] = useState(String(it?.unitCost ?? 0));
  const [qty, setQty] = useState('0');
  const valid = name.trim() && unit.trim() && dec(minQty) >= 0 && Number.isInteger(num(unitCost));
  return (
    <Modal title={it ? `Sửa: ${it.name}` : 'Nguyên liệu / hàng hoá mới'} onClose={onClose}>
      <div className="admin-form">
        <label className="field">
          Tên
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="admin-grid">
          <label className="field">
            Đơn vị
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg, l, cái, chai…" />
          </label>
          <label className="field">
            Loại
            <select value={kind} onChange={(e) => setKind(e.target.value as 'ingredient' | 'goods')}>
              <option value="ingredient">Nguyên liệu</option>
              <option value="goods">Hàng hoá bán nguyên</option>
            </select>
          </label>
          <label className="field">
            Tồn tối thiểu (cảnh báo)
            <input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </label>
          <label className="field">
            Giá vốn / {unit || 'đơn vị'} (đ)
            <input inputMode="numeric" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
          {!it && (
            <label className="field">
              Tồn đầu kỳ
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
          )}
        </div>
        {it && <p className="muted small">Thay đổi số lượng tồn ở mục Kho → Điều chỉnh / Kiểm kê, để có lịch sử và lý do.</p>}
        <button
          className="btn primary big full"
          disabled={!valid}
          onClick={() =>
            remote(api.saveInventoryItem, it?.id ?? null, {
              name: name.trim(),
              unit: unit.trim(),
              kind,
              minQty: dec(minQty),
              unitCost: num(unitCost),
              ...(it ? {} : { qty: dec(qty) || 0 }),
            })
              .then(() => (notify('Đã lưu', 'success'), onSaved()))
              .catch(fail)
          }
        >
          Lưu
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- tables
function Tables() {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [name, setName] = useState('');
  const [area, setArea] = useState('Trong nhà');
  const reload = useCallback(() => remote(api.tables).then((r) => setTables(r.tables)).catch(fail), []);
  useEffect(() => void reload(), [reload]);
  const areas = [...new Set(tables.map((t) => t.area))];
  return (
    <>
      <div className="stock-actions">
        <input className="admin-inline" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên bàn (vd: Bàn 9)" />
        <input className="admin-inline" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Khu vực" list="areas" />
        <datalist id="areas">
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <button
          className="btn primary"
          disabled={!name.trim()}
          onClick={() =>
            remote(api.saveTable, null, { name: name.trim(), area: area.trim(), sort: tables.length + 1 })
              .then(() => (setName(''), reload(), void syncNow()))
              .catch(fail)
          }
        >
          ＋ Thêm bàn
        </button>
      </div>
      {areas.map((a) => (
        <section key={a}>
          <h3>{a || 'Chưa phân khu'}</h3>
          <div className="opt-row">
            {tables
              .filter((t) => t.area === a)
              .map((t) => (
                <span key={t.id} className="opt">
                  {t.name}
                  <button
                    className="link small"
                    onClick={() =>
                      remote(api.saveTable, t.id, { active: false })
                        .then(() => (reload(), void syncNow()))
                        .catch(fail)
                    }
                  >
                    Xoá
                  </button>
                </span>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- suppliers
function Suppliers() {
  const [list, setList] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const reload = useCallback(() => remote(api.suppliers).then((r) => setList(r.suppliers)).catch(fail), []);
  useEffect(() => void reload(), [reload]);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setEditing('new')}>
          ＋ Nhà cung cấp
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Điện thoại</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => setEditing(s)}>
              <td>
                <strong>{s.name}</strong>
              </td>
              <td>{s.phone}</td>
              <td className="muted">{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <p className="empty">Chưa có nhà cung cấp</p>}
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />}
    </>
  );
}

function SupplierForm({ supplier: s, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(s?.name ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [note, setNote] = useState(s?.note ?? '');
  return (
    <Modal title={s ? `Nhà cung cấp: ${s.name}` : 'Nhà cung cấp mới'} onClose={onClose}>
      <div className="admin-form">
        <label className="field">
          Tên
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Điện thoại
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          Ghi chú (mặt hàng, lịch giao…)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="cart-actions">
          {s && (
            <button className="btn secondary" onClick={() => remote(api.saveSupplier, s.id, { active: false }).then(onSaved).catch(fail)}>
              Ngừng hợp tác
            </button>
          )}
          <button
            className="btn primary big"
            disabled={!name.trim()}
            onClick={() =>
              remote(api.saveSupplier, s?.id ?? null, { name: name.trim(), phone: phone.trim(), note: note.trim() })
                .then(() => (notify('Đã lưu nhà cung cấp', 'success'), onSaved()))
                .catch(fail)
            }
          >
            Lưu
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- staff
type StaffUser = User & { active: boolean; hasPin: boolean; hasPassword: boolean };
function Staff() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null);
  const reload = useCallback(() => remote(api.users).then((r) => setUsers(r.users)).catch(fail), []);
  useEffect(() => void reload(), [reload]);
  return (
    <>
      <div className="stock-actions">
        <button className="btn primary" onClick={() => setEditing('new')}>
          ＋ Thêm nhân viên
        </button>
      </div>
      <table className="stock-table">
        <thead>
          <tr>
            <th>Tên</th>
            <th>Tên đăng nhập</th>
            <th>Vai trò</th>
            <th>Đăng nhập bằng</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="clickable" onClick={() => setEditing(u)}>
              <td>
                <strong>{u.name}</strong>
              </td>
              <td className="muted">{u.username}</td>
              <td>{ROLE_LABEL[u.role]}</td>
              <td className="muted">{[u.hasPin && 'PIN (POS)', u.hasPassword && 'Mật khẩu (Boss)'].filter(Boolean).join(', ')}</td>
              <td>{u.active ? <span className="pill pill-synced">Đang làm</span> : <span className="pill">Đã khoá</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <StaffForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />}
    </>
  );
}

function StaffForm({ user: u, onClose, onSaved }: { user: StaffUser | null; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(u?.username ?? '');
  const [name, setName] = useState(u?.name ?? '');
  const [role, setRole] = useState<Role>(u?.role ?? 'cashier');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(u?.active ?? true);
  const pinOk = !pin || /^\d{4,8}$/.test(pin);
  const pwOk = !password || password.length >= 6;
  const valid = name.trim() && (u || (/^[a-z0-9._-]{2,64}$/.test(username) && (pin || password))) && pinOk && pwOk;
  return (
    <Modal title={u ? `Nhân viên: ${u.name}` : 'Thêm nhân viên'} onClose={onClose}>
      <div className="admin-form">
        {!u && (
          <label className="field">
            Tên đăng nhập (chữ thường, không dấu)
            <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="off" />
          </label>
        )}
        <label className="field">
          Họ tên
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Vai trò
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {u ? 'Đặt PIN mới (để trống nếu giữ nguyên)' : 'PIN đăng nhập POS (4–8 số)'}
          <input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} type="password" autoComplete="off" />
        </label>
        <label className="field">
          {u ? 'Đặt mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu app Boss (≥ 6 ký tự, không bắt buộc)'}
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" />
        </label>
        {u && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang làm việc (bỏ chọn để khoá tài khoản)
          </label>
        )}
        {!pinOk && <p className="error-text">PIN phải gồm 4–8 chữ số</p>}
        {!pwOk && <p className="error-text">Mật khẩu tối thiểu 6 ký tự</p>}
        <button
          className="btn primary big full"
          disabled={!valid}
          onClick={() =>
            remote(api.saveUser, u?.id ?? null, {
              ...(u ? {} : { username }),
              name: name.trim(),
              role,
              ...(pin ? { pin } : {}),
              ...(password ? { password } : {}),
              ...(u ? { active } : {}),
            })
              .then(() => (notify('Đã lưu nhân viên', 'success'), onSaved()))
              .catch(fail)
          }
        >
          Lưu
        </button>
      </div>
    </Modal>
  );
}
