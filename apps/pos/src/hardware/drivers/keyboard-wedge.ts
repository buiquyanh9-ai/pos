import type { ScanHandler, ScannerDriver } from '../types';

const isEditable = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
};

export const keyboardWedgeScanner: ScannerDriver = {
  id: 'keyboard-wedge',
  name: 'Máy quét barcode (keyboard wedge)',
  async isAvailable() {
    return typeof window !== 'undefined';
  },
  start(onScan: ScanHandler) {
    if (listener) return;
    let buffer = '';
    let lastKeyAt = 0;
    listener = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const now = performance.now();
      if (now - lastKeyAt > 80) buffer = '';
      lastKeyAt = now;
      if (event.key === 'Enter') {
        if (buffer.length >= 3) {
          event.preventDefault();
          onScan(buffer);
        }
        buffer = '';
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) buffer += event.key;
    };
    window.addEventListener('keydown', listener);
  },
  stop() {
    if (!listener) return;
    window.removeEventListener('keydown', listener);
    listener = undefined;
  },
};

let listener: ((event: KeyboardEvent) => void) | undefined;
