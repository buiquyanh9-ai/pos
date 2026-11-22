import { useState } from 'react';
import { money } from '../lib/format';
import type { SelectedOption } from '../lib/cart';
import type { Product } from '../lib/types';
import { Modal } from './Modal';

const QUICK_NOTES = ['Ít đá', 'Không đá', 'Ít ngọt', 'Không đường', 'Nóng', 'Mang đi riêng', 'Không hành'];

/** Pick size / ice / sugar / toppings (+ optional note) before adding a product to the cart. */
export function OptionPicker({ product, onAdd, onClose }: { product: Product; onAdd: (options: SelectedOption[], note: string, qty: number) => void; onClose: () => void }) {
  // Pre-select the first option of required single-choice groups (e.g. size M).
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(product.optionGroups.filter((g) => g.required && !g.multi && g.options.length).map((g) => [g.id, [g.options[0].id]])),
  );
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);

  const toggle = (groupId: string, optionId: string, multi: boolean) =>
    setChosen((c) => {
      const cur = c[groupId] ?? [];
      if (multi) return { ...c, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
      return { ...c, [groupId]: cur[0] === optionId ? [] : [optionId] };
    });

  const selected: SelectedOption[] = product.optionGroups.flatMap((g) =>
    g.options.filter((o) => (chosen[g.id] ?? []).includes(o.id)).map((o) => ({ groupId: g.id, optionId: o.id, name: o.name, priceDelta: o.priceDelta })),
  );
  const missing = product.optionGroups.filter((g) => g.required && !(chosen[g.id] ?? []).length);
  const unit = product.price + selected.reduce((s, o) => s + o.priceDelta, 0);

  return (
    <Modal title={product.name} onClose={onClose} wide>
      <div className="opt-groups">
        {product.optionGroups.map((g) => (
          <section key={g.id} className="opt-group">
            <h3>
              {g.name}
              <span className="muted small">{g.required ? ' · bắt buộc' : g.multi ? ' · chọn nhiều' : ' · tuỳ chọn'}</span>
            </h3>
            <div className="opt-row">
              {g.options.map((o) => {
                const on = (chosen[g.id] ?? []).includes(o.id);
                return (
                  <button key={o.id} className={on ? 'opt on' : 'opt'} aria-pressed={on} onClick={() => toggle(g.id, o.id, g.multi)}>
                    <span>{o.name}</span>
                    {o.priceDelta !== 0 && <small>{o.priceDelta > 0 ? '+' : ''}{money(o.priceDelta)}</small>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <section className="opt-group">
          <h3>Ghi chú</h3>
          <div className="opt-row">
            {QUICK_NOTES.map((n) => (
              <button key={n} className={note === n ? 'opt on' : 'opt'} onClick={() => setNote(note === n ? '' : n)}>
                {n}
              </button>
            ))}
          </div>
          <input className="opt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khác…" maxLength={200} />
        </section>
      </div>
      <div className="opt-foot">
        <div className="stepper">
          <button aria-label="Giảm" onClick={() => setQty(Math.max(1, qty - 1))}>
            −
          </button>
          <span>{qty}</span>
          <button aria-label="Tăng" onClick={() => setQty(qty + 1)}>
            +
          </button>
        </div>
        <button className="btn primary big" disabled={missing.length > 0} onClick={() => onAdd(selected, note, qty)}>
          {missing.length ? `Chọn ${missing.map((g) => g.name).join(', ')}` : `Thêm · ${money(unit * qty)}`}
        </button>
      </div>
    </Modal>
  );
}

/** Edit the note of a cart line. */
export function NoteDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(initial);
  return (
    <Modal title={`Ghi chú: ${title}`} onClose={onClose}>
      <div className="opt-row">
        {QUICK_NOTES.map((n) => (
          <button key={n} className={note === n ? 'opt on' : 'opt'} onClick={() => setNote(note === n ? '' : n)}>
            {n}
          </button>
        ))}
      </div>
      <input className="opt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú khác…" maxLength={200} autoFocus />
      <div className="cart-actions">
        <button className="btn secondary" onClick={() => onSave('')}>
          Xoá ghi chú
        </button>
        <button className="btn primary big" onClick={() => onSave(note)}>
          Lưu
        </button>
      </div>
    </Modal>
  );
}
