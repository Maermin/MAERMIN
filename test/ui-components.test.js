// Shared components (PLAN Phase 6, R1.2 / R1.3; docs/DESIGN-SYSTEM.md § 4):
// states, ARIA and class names, rendered to static markup.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

const noop = () => {};
globalThis.React = React;
globalThis.window = globalThis.window || {};
globalThis.window.React = React;
globalThis.document = globalThis.document || { addEventListener: noop, removeEventListener: noop, documentElement: { getAttribute: () => 'dark' } };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.window.MaerminI18n = require('../i18n.js');
globalThis.window.MaerminUtils = require('../utils.js');
globalThis.window.MaerminUI = require('../ui-store.js');
const C = require('../renderer-components.js').Components;
const html = (el) => renderToStaticMarkup(el);
const h = React.createElement;

console.log('R1.2 components:');
ok('exported on module and window', C && window.MaerminComponents === C);
ok('toneOf: gain / loss / neutral (zero is neutral)', C.toneOf(3) === 'gain' && C.toneOf(-0.1) === 'loss' && C.toneOf(0) === 'neutral' && C.toneOf(NaN) === 'neutral');

let m = html(h(C.Button, { variant: 'primary' }, 'Save'));
ok('Button primary: native button, type=button, classes', /^<button[^>]*type="button"/.test(m) && /ui-btn ui-btn--primary ui-btn--md/.test(m) && /Save/.test(m), m);
m = html(h(C.Button, { variant: 'nope' }, 'X'));
ok('Button: unknown variant falls back to secondary', /ui-btn--secondary/.test(m));
m = html(h(C.Button, { loading: true, variant: 'primary' }, 'Saving'));
ok('Button loading: aria-busy, disabled, spinner', /aria-busy="true"/.test(m) && /disabled=""/.test(m) && /ui-spinner/.test(m), m);
m = html(h(C.Button, { kbd: 'N', 'data-testid': 'x' }, 'Add'));
ok('Button: kbd hint and pass-through props', /<kbd class="ui-kbd">N<\/kbd>/.test(m) && /data-testid="x"/.test(m));

m = html(h(C.IconButton, { label: 'Hide amounts', pressed: true, icon: 'o' }));
ok('IconButton: aria-label + title from label, aria-pressed when a toggle', /aria-label="Hide amounts"/.test(m) && /title="Hide amounts"/.test(m) && /aria-pressed="true"/.test(m));
m = html(h(C.IconButton, { label: 'More', icon: 'o' }));
ok('IconButton: no aria-pressed when not a toggle', !/aria-pressed/.test(m));

m = html(h(C.Stat, { label: 'Return', value: '+19.63%', signed: 19.63, sub: 'p.a.' }));
ok('Stat: tone from the signed figure, tabular value', /ui-stat__value num tone-gain/.test(m) && /p\.a\./.test(m), m);
m = html(h(C.Stat, { label: 'Realised', value: '±0.00 €', signed: 0 }));
ok('Stat: zero is neutral, never green or red', /tone-neutral/.test(m));
m = html(h(C.Stat, { label: 'Health', value: '80', onClick: noop }));
ok('Stat clickable: role=link and focusable', /role="link"/.test(m) && /tabindex="0"/.test(m));

m = html(h(C.ToneChip, { value: -7.99, text: '−7.99%' }));
ok('ToneChip: loss tone with ▼ (never colour alone)', /tone-loss/.test(m) && /▼/.test(m));
m = html(h(C.ToneChip, { value: 0, text: '±0.00%' }));
ok('ToneChip: zero has no arrow', !/[▲▼]/.test(m) && /tone-neutral/.test(m));

m = html(h(C.Chip, { pressed: true, count: 224 }, 'All'));
ok('Chip: aria-pressed and count', /aria-pressed="true"/.test(m) && /224/.test(m));

m = html(h(C.PageTabs, { label: 'Home views', value: 'b', tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }));
ok('PageTabs: tablist with one selected tab, roving tabindex, data-tab', /role="tablist"/.test(m) && (m.match(/role="tab"/g) || []).length === 3 &&
  /data-tab="b"[^>]*aria-selected="true"[^>]*tabindex="0"/.test(m) && (m.match(/tabindex="-1"/g) || []).length === 2, m);
m = html(h(C.Segmented, { label: 'Period', value: '1Y', options: [{ value: '1M', label: '1M' }, { value: '1Y', label: '1Y' }] }));
ok('Segmented: radiogroup with aria-checked', /role="radiogroup"/.test(m) && /role="radio" aria-checked="true" tabindex="0"[^>]*>1Y/.test(m), m);

m = html(h(C.Input, { label: 'Quantity', error: 'Enter a quantity above 0', id: 'q' }));
ok('Input: visible label for the field, error linked by aria-describedby', /<label class="ui-field__label" for="q">Quantity/.test(m) && /aria-invalid="true"/.test(m) && /aria-describedby="q-msg"/.test(m) && /id="q-msg" role="alert"/.test(m), m);
m = html(h(C.Select, { label: 'Portfolio', id: 's', options: [{ value: 'a', label: 'Main' }] }));
ok('Select: label + options', /for="s"/.test(m) && /<option value="a">Main<\/option>/.test(m));

m = html(h(C.Mask, { masked: true }, '178,556.70 €'));
ok('Mask: the amount never reaches the markup while masked', !/178/.test(m) && /••••••/.test(m) && /aria-label=/.test(m));
m = html(h(C.Card, { title: 'Holdings map', subtitle: '31 positions', action: h('a', { href: '#' }, 'Allocation →') }, 'body'));
ok('Card: heading, subtitle, action, body', /<h2 class="ui-card__title">Holdings map<\/h2>/.test(m) && /31 positions/.test(m) && /Allocation/.test(m) && /ui-card__body">body/.test(m));
ok('no inline styles in R1.2 components', !/style="/.test(html(h('div', null, h(C.Button, null, 'a'), h(C.IconButton, { label: 'b' }), h(C.Stat, { label: 'c', value: '1' }), h(C.Chip, null, 'd'), h(C.PageTabs, { tabs: [{ id: 'x', label: 'x' }] }), h(C.Card, { title: 'e' }, 'f')))));

console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
