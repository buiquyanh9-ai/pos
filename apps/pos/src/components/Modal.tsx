import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** On-screen numeric keypad. Value is an integer; "000" speeds up VND entry. */
export function Numpad({ value, onChange, max = 9_999_999_999 }: { value: number; onChange: (v: number) => void; max?: number }) {
  const press = (k: string) => {
    if (k === 'C') return onChange(0);
    if (k === '⌫') return onChange(Math.floor(value / 10));
    const next = Number(`${value || ''}${k}`);
    if (Number.isSafeInteger(next) && next <= max) onChange(next);
  };
  return (
    <div className="numpad">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '000', '⌫'].map((k) => (
        <button key={k} className={k === '⌫' ? 'key key-wide' : 'key'} onClick={() => press(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}
