// Guard for the type scale (FINDINGS O-3): inline font sizes in style objects
// use the scale tokens (var(--text-…)); raw sizes are left only for display
// figures that sit far from every step. Also checks that the CSS tokens and
// MaerminUI.tokens.text describe the same scale.
// Run: node test/type-scale.test.js
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 600) : '')); }
}
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const STEPS = { '3xs': 0.625, '2xs': 0.6875, xs: 0.75, sm: 0.8125, base: 0.875, md: 0.9375, body: 1, lg: 1.125, title: 1.25, 'title-lg': 1.375, xl: 1.5, '2xl': 2 };

console.log('tokens:');
const missing = Object.entries(STEPS).filter(([k, v]) => !new RegExp('--text-' + k + ':\\s*' + String(v).replace('.', '\\.') + 'rem').test(css));
ok('styles.css defines the twelve steps', missing.length === 0, missing);
global.window = {};
const UI = require('../ui-store.js');
const jsKey = (k) => k === 'title-lg' ? 'titleLg' : k;
const diff = Object.entries(STEPS).filter(([k, v]) => parseFloat(UI.tokens.text[jsKey(k)]) !== v);
ok('MaerminUI.tokens.text mirrors them', diff.length === 0, diff);

console.log('views:');
// raw sizes that may stay: display figures without a step within 0.8 px
const ALLOWED = new Set(['0.55rem', '1.6rem', '1.75rem', '1.85rem', '2.2rem', '2.5rem', '4rem']);
const files = fs.readdirSync(root).filter((f) => f.endsWith('.js') && !/^(translations|sw|service-worker)/.test(f));
const raw = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const re = /style:\s*\{[^{}]*?fontSize:\s*'([0-9.]+(?:rem|px))'/g;
  let m;
  while ((m = re.exec(s))) if (!ALLOWED.has(m[1])) raw.push(f + ' ' + m[1]);
}
ok('no raw font size in a style object outside the display figures', raw.length === 0, raw.slice(0, 20));

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
