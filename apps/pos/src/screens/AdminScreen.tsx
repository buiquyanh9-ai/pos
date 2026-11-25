import { useCallback, useEffect, useState } from 'react';
import { api, type ProductInput } from '../lib/api';
import { money } from '../lib/format';
import { notify } from '../lib/notify';
import { remote, syncNow } from '../lib/store';
import { ROLE_LABEL, type Category, type DiningTable, type OptionGroup, type Product, type Role, type User } from '../lib/types';
import { Modal } from '../components/Modal';

// Owner back-office on the POS: menu (products, prices, categories, options), tables, staff.

type Section = 'products' | 'options' | 'tables' | 'staff';
type AdminProduct = Product;
const fail = (e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error');
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export function AdminScreen() {
  const [section, setSection] = useState<Section>('products');
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const reload = useCallback(async () => {
    try {
      const cat = await remote(api.productsAll);
      setProducts(cat.products);
      setCategories(cat.categories);
      setGroups(cat.optionGroups);
      void syncNow(); // refresh the sale screen's cached menu
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => void reload(), [reload]);

  const menu: [Section, string][] = [
    ['products', 'Món & giá bán'],
    ['options', 'Tuỳ chọn món'],
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
        {section === 'products' && <Products products={products} categories={categories} groups={groups} onChanged={reload} />}
        {section === 'options' && <Options groups={groups} onChanged={reload} />}
        {section === 'tables' && <Tables />}
        {section === 'staff' && <Staff />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- products
function Products({ products, categories, groups, onChanged }: { products: AdminProduct[]; categories: Category[]; groups: OptionGroup[]; onChanged: () => void }) {
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
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), onChanged())}
        />
      )}
    </>
  );
}

function ProductForm({ product: p, categories, groups, onClose, onSaved }: { product: AdminProduct | null; categories: Category[]; groups: OptionGroup[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(p?.name ?? '');
  const [price, setPrice] = useState(String(p?.price ?? ''));
  const [categoryId, setCategoryId] = useState(p?.categoryId ?? categories[0]?.id ?? '');
  const [sku, setSku] = useState(p?.sku ?? '');
  const [barcode, setBarcode] = useState(p?.barcode ?? '');
  const [imageUrl, setImageUrl] = useState(p?.imageUrl ?? '');
  const [active, setActive] = useState(p?.active ?? true);
  const [optionIds, setOptionIds] = useState<string[]>(p?.optionGroups.map((g) => g.id) ?? []);
  const [busy, setBusy] = useState(false);

  const priceN = num(price);
  const valid = name.trim() && Number.isInteger(priceN) && priceN >= 0;

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
function Options({ groups, onChanged }: { groups: OptionGroup[]; onChanged: () => void }) {
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
      {editing && <OptionForm group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), onChanged())} />}
    </>
  );
}

function OptionForm({ group: g, onClose, onSaved }: { group: OptionGroup | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(g?.name ?? '');
  const [multi, setMulti] = useState(g?.multi ?? false);
  const [required, setRequired] = useState(g?.required ?? false);
  type Row = { id?: string; name: string; price: string };
  const [options, setOptions] = useState<Row[]>(
    g?.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: String(o.priceDelta),
    })) ?? [{ name: '', price: '0' }],
  );
  const set = (i: number, patch: Partial<Row>) => setOptions(options.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const valid =
    name.trim() &&
    options.length > 0 &&
    options.every((o) => o.name.trim() && Number.isInteger(num(o.price || '0')));
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
        {options.map((o, i) => (
          <div key={i} className="option-edit">
            <input value={o.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Tên lựa chọn" />
            <input inputMode="numeric" value={o.price} onChange={(e) => set(i, { price: e.target.value })} placeholder="+ giá" title="Giá cộng thêm" />
            <button className="icon-btn" aria-label="Xoá" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn secondary" onClick={() => setOptions([...options, { name: '', price: '0' }])}>
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
