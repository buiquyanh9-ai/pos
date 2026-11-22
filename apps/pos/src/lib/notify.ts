// Tiny toast bus so non-React code (drivers, sync loop) can show messages.
export type ToastKind = 'info' | 'success' | 'error';
export interface Toast { id: number; text: string; kind: ToastKind }
type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let seq = 0;

export function notify(text: string, kind: ToastKind = 'info') {
  const t = { id: ++seq, text, kind };
  listeners.forEach((l) => l(t));
}

export function onNotify(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
