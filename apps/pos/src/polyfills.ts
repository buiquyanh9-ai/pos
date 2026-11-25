// Old Android POS terminals ship an old, non-updatable WebView (SUNMI T1 / Android 6 = Chrome 69).
// Polyfill the few newer built-ins the app uses, and flag missing flexbox `gap` so the stylesheet
// fallbacks generated in vite.config.ts (legacyCss) can kick in. Must be imported first.

/* eslint-disable @typescript-eslint/no-explicit-any */
const O = Object as any;
if (!O.fromEntries) {
  O.fromEntries = (entries: Iterable<readonly [PropertyKey, unknown]>) => {
    const out: Record<PropertyKey, unknown> = {};
    for (const [k, v] of entries) out[k] = v;
    return out;
  };
}
const P = Promise as any;
if (!P.allSettled) {
  P.allSettled = (items: Iterable<unknown>) =>
    Promise.all(Array.from(items, (p) => Promise.resolve(p).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))));
}
if (typeof (window as any).globalThis === 'undefined') (window as any).globalThis = window;

/** Flexbox `gap` arrived in Chrome 84; `@supports (gap: 1px)` is true earlier because of CSS grid, so measure it. */
function hasFlexGap(): boolean {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
  el.appendChild(document.createElement('div'));
  el.appendChild(document.createElement('div'));
  document.documentElement.appendChild(el);
  const ok = el.scrollHeight === 1;
  el.remove();
  return ok;
}
if (!hasFlexGap()) document.documentElement.classList.add('no-flexgap');

/** Chrome < 83 lays out <button> as a fixed inner box and ignores `display: flex` on it, so the
 *  children of a column button (product tile, KPI card…) stay inline on one line. Measure it. */
function hasButtonFlex(): boolean {
  const b = document.createElement('button');
  b.style.cssText = 'display:flex;flex-direction:column;padding:0;border:0;margin:0;position:absolute;visibility:hidden;font-size:1px;line-height:1px';
  for (let i = 0; i < 2; i++) {
    const s = document.createElement('span');
    s.style.height = '10px'; // ignored on an inline span, honoured on a flex item
    b.appendChild(s);
  }
  document.documentElement.appendChild(b);
  const ok = b.offsetHeight >= 20;
  b.remove();
  return ok;
}
if (!hasButtonFlex()) document.documentElement.classList.add('no-btnflex');
