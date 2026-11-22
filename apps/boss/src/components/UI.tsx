import type { ReactNode } from 'react';
import { pct } from '@shopflow/shared';

export function Stat({ label, value, change, hint }: { label: string; value: string; change?: number | null; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {change !== undefined && (
        <span className={`delta ${change === null ? '' : change >= 0 ? 'up' : 'down'}`}>
          {change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${pct(change)}`}
          {hint && <span className="muted"> {hint}</span>}
        </span>
      )}
      {change === undefined && hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="screen-head">
      {onBack ? (
        <button className="icon-btn" aria-label="Quay lại" onClick={onBack}>
          ‹
        </button>
      ) : (
        <span className="icon-btn-spacer" />
      )}
      <h1>{title}</h1>
      {right ?? <span className="icon-btn-spacer" />}
    </header>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'seg on' : 'seg'} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="error-box">⚠ {error}</p>;
  if (loading) return <p className="empty">Đang tải…</p>;
  return null;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
