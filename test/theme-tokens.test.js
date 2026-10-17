// Design tokens and the token bridge (PLAN Phase 6, R1.1; docs/DESIGN-SYSTEM.md § 2–3).
const fs = require('fs');
const path = require('path');
const T = require('../theme-tokens.js');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

console.log('MaerminTokens:');
ok('alpha keeps hex as #rrggbbaa (byte form, the old `${c}15` suffix)', T.alpha('#a497ff', 0x15) === '#a497ff15');
ok('alpha takes a fraction too', T.alpha('#fff', 0.5) === '#ffffff80');
ok('alpha of a var() is a color-mix CSS resolves per theme', T.alpha('var(--accent)', 0x33) === 'color-mix(in srgb, var(--accent) 20%, transparent)');
ok('alpha of an empty colour is transparent', T.alpha('', 0.5) === 'transparent');
ok('isVar', T.isVar('var(--gain)') && !T.isVar('#45d49a') && !T.isVar(null));
ok('resolve in Node reads the Dark values', T.resolve('var(--gain)') === '#45d49a' && T.resolve('var(--loss)') === '#ff7b8a');
ok('resolve leaves plain colours alone', T.resolve('#123456') === '#123456' && T.resolve('rgba(0,0,0,0.5)') === 'rgba(0,0,0,0.5)');
ok('resolve uses the fallback of an unknown var', T.resolve('var(--nope, #abcdef)') === '#abcdef');

// ---- styles.css: every theme defines the colour tokens -------------------------
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
function block(selectorStart) {
  const i = css.indexOf(selectorStart);
  if (i < 0) return null;
  const open = css.indexOf('{', i), close = css.indexOf('\n}', open);
  const out = {};
  css.slice(open + 1, close).replace(/--([a-z0-9-]+):\s*([^;]+);/g, (_, k, v) => { out[k] = v.trim(); });
  return out;
}
const root = block(':root {');
const THEMES = {
  dark: root,
  white: Object.assign({}, root, block('html[data-theme="white"]')),
  purple: Object.assign({}, root, block('html[data-theme="purple"]')),
  contrast: Object.assign({}, root, block('html[data-theme="contrast"]')),
  cb: Object.assign({}, root, block('html[data-theme="cb"]'))
};
const COLOUR = ['bg', 'surface', 'surface-2', 'border', 'border-strong', 'control', 'text', 'text-dim', 'text-faint', 'accent',
  'accent-fill', 'on-accent', 'gain', 'loss', 'income', 'warning', 'comp-invested', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];

const hex = (v) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (c) => c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

console.log('styles.css tokens:');
for (const [name, t] of Object.entries(THEMES)) {
  const missing = COLOUR.filter((k) => !hex(t[k]));
  ok(name + ': every colour token is a hex value', missing.length === 0, missing.join(', '));
}

// ---- DESIGN-SYSTEM § 2.1 contrast pairs, per theme ------------------------------
console.log('contrast (WCAG 2.1 AA):');
for (const [name, t] of Object.entries(THEMES)) {
  const bad = [];
  const textMin = name === 'contrast' ? 7 : 4.5;
  for (const fg of ['text', 'text-dim', 'text-faint', 'accent', 'gain', 'loss', 'income', 'warning']) {
    for (const bg of ['bg', 'surface', 'surface-2']) {
      const min = fg === 'text' ? textMin : 4.5;
      const r = ratio(t[fg], t[bg]);
      if (r < min) bad.push(fg + ' on ' + bg + ' ' + r.toFixed(2));
    }
  }
  if (ratio(t['on-accent'], t['accent-fill']) < 4.5) bad.push('on-accent on accent-fill');
  for (const bg of ['surface', 'surface-2']) if (ratio(t.control, t[bg]) < 3) bad.push('control on ' + bg + ' ' + ratio(t.control, t[bg]).toFixed(2));
  for (const k of ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']) if (ratio(t[k], t.surface) < 3) bad.push(k + ' on surface ' + ratio(t[k], t.surface).toFixed(2));
  ok(name + ': text ≥ ' + textMin + ' : 1 (others 4.5), controls and chart series ≥ 3 : 1', bad.length === 0, bad.join('; '));
}
{
  // badges and tone chips put a tone on its own tint (color-mix 20 % over the surface)
  const tint = (c, base, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * t + parseInt(base.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
  const bad = [];
  for (const [name, t] of Object.entries(THEMES)) {
    for (const k of ['gain', 'loss', 'income', 'warning']) {
      for (const bg of ['surface', 'surface-2']) {
        const r = ratio(t[k], tint(t[k], t[bg], bg === 'surface' ? 0.2 : 0.15));
        if (r < 4.5) bad.push(name + ' ' + k + ' on its tint over ' + bg + ' ' + r.toFixed(2));
      }
    }
  }
  ok('money tones hold 4.5 : 1 on their own tint (badges, tone chips) in every theme', bad.length === 0, bad.join('; '));
}
ok('colour-blind: gain and loss are blue and orange, never green/red', THEMES.cb.gain.toLowerCase() === '#56b4e9' && THEMES.cb.loss.toLowerCase() === '#e69f00');

// ---- renderer.js: the theme objects only reference tokens -----------------------
console.log('theme objects:');
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const m = /const THEME_TOKENS = \{([\s\S]*?)\n\};/.exec(src);
ok('renderer.js defines THEME_TOKENS', !!m);
if (m) {
  const pairs = [...m[1].matchAll(/(\w+):\s*'([^']+)'/g)].map((x) => [x[1], x[2]]);
  const notVar = pairs.filter(([, v]) => !/^var\(--[a-z0-9-]+\)$/.test(v));
  ok('every theme value is a var() reference', pairs.length > 20 && notVar.length === 0, notVar.map((x) => x.join('=')).join(', '));
  const unknown = pairs.filter(([, v]) => !(v.slice(6, -1) in root));
  ok('every referenced token is defined in :root', unknown.length === 0, unknown.map((x) => x[1]).join(', '));
  for (const k of ['text', 'textSecondary', 'card', 'cardBorder', 'inputBg', 'inputBorder', 'accent', 'accentFill', 'success', 'danger', 'warning']) {
    if (!pairs.some(([key]) => key === k)) ok('theme key ' + k + ' kept for existing call sites', false);
  }
  ok('the five theme ids are unchanged', /dark: themeOf\('dark', 'dark'\)/.test(src) && /white: themeOf\('white', 'light'\)/.test(src) &&
    /purple: themeOf\('purple', 'dark'\)/.test(src) && /contrast: themeOf\('contrast', 'dark'\)/.test(src) && /cb: themeOf\('cb', 'dark'\)/.test(src));
}

console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
