import { useEffect, useState } from 'react';
import { onNotify, type Toast } from '../lib/notify';

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(
    () =>
      onNotify((t) => {
        setToasts((ts) => [...ts.slice(-3), t]);
        setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.kind === 'error' ? 6000 : 3000);
      }),
    [],
  );
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
