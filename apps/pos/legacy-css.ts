import type { Declaration, Plugin, Rule } from 'postcss';

/**
 * Build-time CSS fallbacks for old Android POS WebViews (SUNMI T1 / Android 6 ships Chrome 69, which
 * cannot be updated there). For each modern construct a fallback declaration is inserted BEFORE the
 * original, so modern browsers keep using the original (the Windows/web POS looks exactly the same)
 * and Chrome 69 drops the declaration it cannot parse and keeps the fallback.
 *
 *  - color-mix(in srgb, var(--x) P%, …)  -> rgba(var(--x-rgb), P)   (--x-rgb generated from each --x: #hex)
 *  - clamp(a, b, c) -> b ; min(a, b) -> the absolute length ; max(a, b) -> the relative length
 *  - inset: …       -> top/right/bottom/left
 *  - flex `gap`     -> `.no-flexgap <rule> > * + *` margins (class set by src/polyfills.ts)
 */

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Replaces every top-level `name(...)` call in `value` using `fn(args)`; skips e.g. `minmax(` for `min(`. */
function replaceCalls(value: string, name: string, fn: (args: string[]) => string | null): string | null {
  let result = '', i = 0, changed = false;
  const re = new RegExp(`(^|[^a-z-])${name}\\(`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const start = m.index + m[1].length;
    let depth = 0, j = start + name.length;
    for (; j < value.length; j++) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')' && --depth === 0) break;
    }
    const replacement = fn(splitArgs(value.slice(start + name.length + 1, j)));
    if (replacement === null) return null;
    result += value.slice(i, start) + replacement;
    i = j + 1; re.lastIndex = i; changed = true;
  }
  return changed ? result + value.slice(i) : value;
}

const relative = (v: string) => /%|vw|vh|vmin|vmax|fr\b/.test(v);
function lowerMath(value: string): string {
  let v = value;
  for (let pass = 0; pass < 4; pass++) {
    const before = v;
    v = replaceCalls(v, 'clamp', (a) => (a.length === 3 ? a[1] : a[0])) ?? v;
    v = replaceCalls(v, 'min', (a) => a.find((x) => !relative(x)) ?? a[0]) ?? v;
    v = replaceCalls(v, 'max', (a) => a.find((x) => relative(x)) ?? a[a.length - 1]) ?? v;
    if (v === before) break;
  }
  return v;
}

function lowerColorMix(value: string): string | null {
  return replaceCalls(value, 'color-mix', (a) => {
    // a = ['in srgb', 'var(--x) 35%', 'transparent' | other]
    const m = /^var\((--[\w-]+)\)\s+([\d.]+)%$/.exec(a[1] ?? '');
    if (!m) return null;
    return `rgba(var(${m[1]}-rgb), ${Number(m[2]) / 100})`; // mixing with a light surface ≈ alpha over it
  });
}

function hexToRgb(hex: string): string | null {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.length === 6 ? h : null;
  if (!full) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(', ');
}

function flexGapFallback(rule: Rule) {
  const decls = rule.nodes.filter((n): n is Declaration => n.type === 'decl');
  const display = decls.find((d) => d.prop === 'display')?.value;
  const gap = decls.find((d) => d.prop === 'gap')?.value;
  if (!gap || !display || !/^(inline-)?flex$/.test(display.trim())) return;
  const [rowGap, colGap = rowGap] = gap.trim().split(/\s+/);
  const column = /column/.test(decls.find((d) => d.prop === 'flex-direction')?.value ?? '');
  const wrap = /^wrap/.test(decls.find((d) => d.prop === 'flex-wrap')?.value ?? '');
  const important = decls.some((d) => d.prop === 'gap' && d.important) ? ' !important' : '';
  const selectors = rule.selectors.map((s) => `.no-flexgap ${s}`);
  const css = wrap
    ? `${selectors.map((s) => `${s} > *`).join(', ')} { margin-right: ${colGap}${important}; margin-bottom: ${rowGap}${important}; }`
    // Space after every element child (not before): keeps `margin-left: auto` push-right layouts intact,
    // and also separates an icon from a trailing bare text node ("<Icon/> Lưu"), which no selector can see.
    : `${selectors.map((s) => `${s} > *`).join(', ')} { ${column ? 'margin-bottom' : 'margin-right'}: ${column ? rowGap : colGap}${important}; }`;
  rule.after(css);
}

/** Chrome < 83 ignores flex on <button>: children of a column flex box would stay inline on one
 *  line. Under `.no-btnflex` (set by src/polyfills.ts only on such browsers), stack inline children. */
function buttonColumnFallback(rule: Rule) {
  const decls = rule.nodes.filter((n): n is Declaration => n.type === 'decl');
  const display = decls.find((d) => d.prop === 'display')?.value.trim() ?? '';
  const column = /column/.test(decls.find((d) => d.prop === 'flex-direction')?.value ?? '');
  if (!/^(inline-)?flex$/.test(display) || !column) return;
  const kids = ['span', 'strong', 'small', 'b', 'em', 'img'];
  const sel = rule.selectors.flatMap((s) => kids.map((k) => `.no-btnflex ${s} > ${k}:not([hidden])`)).join(', ');
  const align = decls.find((d) => d.prop === 'align-items')?.value.trim();
  rule.after(`${sel} { display: block;${align === 'center' ? ' text-align: center;' : ''} }`);
}

export function legacyCss(): Plugin {
  return {
    postcssPlugin: 'shopflow-legacy-css',
    Once(root) {
      root.walkRules((rule) => {
        if (rule.selector.startsWith('.no-flexgap') || rule.selector.startsWith('.no-btnflex')) return;
        flexGapFallback(rule);
        buttonColumnFallback(rule);
      });
      root.walkDecls((decl) => {
        if (decl.prop.startsWith('--')) {
          const rgb = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(decl.value.trim()) ? hexToRgb(decl.value.trim()) : null;
          if (rgb && !decl.prop.endsWith('-rgb')) decl.cloneAfter({ prop: `${decl.prop}-rgb`, value: rgb });
          return;
        }
        if (decl.prop === 'inset') {
          const p = decl.value.trim().split(/\s+/);
          const [t, r = t, b = t, l = r] = p;
          decl.cloneBefore({ prop: 'top', value: t });
          decl.cloneBefore({ prop: 'right', value: r });
          decl.cloneBefore({ prop: 'bottom', value: b });
          decl.cloneBefore({ prop: 'left', value: l });
          return;
        }
        let v = decl.value;
        if (/color-mix\(/i.test(v)) v = lowerColorMix(v) ?? v;
        if (/(^|[^a-z-])(clamp|min|max)\(/i.test(v)) v = lowerMath(v);
        if (v !== decl.value) decl.cloneBefore({ value: v });
      });
    },
  };
}
legacyCss.postcss = true;
