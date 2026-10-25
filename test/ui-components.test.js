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

console.log('R1.3 components:');
const COLS = [
  { key: 'name', label: 'Asset', phone: 'title' },
  { key: 'date', label: 'Date', priority: 2, phone: 'meta' },
  { key: 'v', label: 'Amount', align: 'right', sortable: true, phone: 'value' }
];
const ROWS = [{ __group: 'May 2026', __summary: '+7,631.31 €' }, { id: 'a', name: 'NVIDIA Corp.', date: 'May 14', v: '+8,161.32 €' }, { id: 'b', name: 'Bitcoin', date: 'Mar 16', v: '−3,120.00 €' }];
m = html(h(C.Table, { columns: COLS, rows: ROWS, layout: 'table', caption: 'Transactions', sort: { key: 'v', dir: 'desc' }, onSort: noop, rowActions: () => [{ label: 'Edit' }] }));
ok('Table: caption, th scope, aria-sort on the sorted column, sort button', /<caption class="sr-only">Transactions<\/caption>/.test(m) && /scope="col"/.test(m) && /aria-sort="descending"/.test(m) && /ui-table__sort/.test(m), m.slice(0, 400));
ok('Table: group row spans every column (3 + actions = 4)', /class="ui-table__group"><td colSpan="4">/.test(m), m);
ok('Table: right-aligned money cells are tabular, priorities become classes', /class="is-right num p1"/.test(m) && /class="p2"/.test(m), m);
ok('Table: row actions = an overflow menu with an accessible name', /aria-haspopup="menu"/.test(m) && /aria-label="Actions"/.test(m) && /sr-only">Actions/.test(m), m);
m = html(h(C.Table, { columns: COLS, rows: ROWS, layout: 'phone', caption: 'Transactions' }));
ok('Table phone layout: a list with group rows, title, meta and value (no <table>)', !/<table/.test(m) && /class="ui-plist"/.test(m) && /ui-plist__group/.test(m) &&
  /ui-plist__title"><span>NVIDIA Corp\./.test(m) && /ui-plist__meta"><span>May 14/.test(m) && /ui-plist__value">\+8,161\.32/.test(m), m);
m = html(h(C.Table, { columns: COLS, rows: [], empty: h('p', null, 'Nothing yet') }));
ok('Table: no rows renders the given empty state', m === '<p>Nothing yet</p>', m);
m = html(h(C.Table, { columns: COLS, rows: [], loading: true }));
ok('Table: loading shows skeleton rows (aria-hidden)', /ui-skel ui-skel--row/.test(m) && /aria-hidden="true"/.test(m), m);
ok('Modal: closed renders nothing', html(h(C.Modal, { open: false, title: 'X' })) === '');
m = html(h(C.Modal, { open: true, title: 'Add transaction', onClose: noop, footer: h(C.Button, { variant: 'primary' }, 'Save') }, 'body'));
ok('Modal: dialog, aria-modal, labelled by its title, close button with a name, footer', /role="dialog" aria-modal="true" aria-labelledby="ui-dlg-\d+"/.test(m) &&
  /<h2 id="ui-dlg-\d+" class="ui-modal__title">Add transaction/.test(m) && /aria-label="Close"/.test(m) && /ui-modal__foot/.test(m), m);
m = html(h(C.ChartFrame, { title: 'Value, 12 months', summary: 'Value over 12 months', source: 'Sample data', legend: [{ label: 'Value', value: '176,756.66 €' }], table: { columns: [{ key: 'm', label: 'Month' }], rows: [{ id: 1, m: 'Oct' }] } }, h('svg')));
ok('ChartFrame: title, role=img summary, word legend, "Show as table", source', /Value, 12 months/.test(m) && /role="img" aria-label="Value over 12 months"/.test(m) && /ui-chart__legend/.test(m) && /Show as table/.test(m) && /Sample data/.test(m), m);
m = html(h(C.EmptyState, { title: 'No transactions yet', text: 'Add one.', kind: 'empty' }));
ok('EmptyState: the shared MaerminUI.EmptyState look', /class="mx-empty"/.test(m) && /No transactions yet/.test(m), m);
ok('no inline styles in R1.3 components', !/style="/.test(html(h('div', null, h(C.Table, { columns: COLS, rows: ROWS, layout: 'table' }), h(C.Table, { columns: COLS, rows: ROWS, layout: 'phone' }), h(C.ChartFrame, { title: 't' }, 'x'), h(C.Skeleton, { shape: 'kpi' })))));

console.log('R3.1 components:');
{
  const items = [{ key: 'a', value: 50 }, { key: 'b', value: 30 }, { key: 'c', value: 20 }, { key: 'd', value: 0 }, { key: 'e', value: 10 }];
  const cols = C.mapColumns(items, 2);
  ok('mapColumns: largest first into the lightest column (a tie goes left); zero values dropped', cols.length === 2 && cols[0].items.map((x) => x.key).join() === 'a,e' && cols[1].items.map((x) => x.key).join() === 'b,c' && cols[0].sum === 60 && cols[1].sum === 50, JSON.stringify(cols));
  ok('mapColumns: never more columns than items', C.mapColumns([{ key: 'x', value: 1 }], 4).length === 1 && C.mapColumns([], 4).length === 0);
  ok('mapTint: gain / loss tint by sign, neutral without a figure', /var\(--gain\)/.test(C.mapTint(12)) && /var\(--loss\)/.test(C.mapTint(-3)) && C.mapTint(null) === 'var(--surface-2)');
  ok('mapTint: stronger with a larger return, capped', parseInt(/(\d+)%/.exec(C.mapTint(5))[1], 10) < parseInt(/(\d+)%/.exec(C.mapTint(500))[1], 10) && /60%/.test(C.mapTint(1e6)));
  m = html(h(C.HoldingsMap, { label: 'Holdings map', items: [{ key: 's|A', label: 'AAA', title: 'A Corp', value: 10, pct: 5, pctText: '5.0 %' }, { key: 's|B', label: 'BBB', title: 'B Corp', value: 5, pct: -2, pctText: '2.0 %' }] }));
  // Audit 2026-10-24 UI-1: a tile under 12 % of its column can be drawn under
  // 24 px high on a 240 px map (WCAG 2.5.8). It stays as a picture and a mouse
  // target, but Tab skips it and screen readers do not list it: the positions
  // table under the map is the full-size way to every holding.
  {
    const tiny = html(h(C.HoldingsMap, { label: 'Holdings map', columns: 1, items: [
      { key: 's|BIG', label: 'BIG', title: 'Big Corp', value: 95, pct: 1, pctText: '1.0 %' },
      { key: 's|SML', label: 'SML', title: 'Small Corp', value: 5, pct: 1, pctText: '1.0 %' }] }));
    const tag = (key) => (tiny.match(new RegExp('<button[^>]*data-map-key="' + key.replace('|', '\\|') + '"[^>]*>')) || [''])[0];
    ok('HoldingsMap: a tile under 12 % of its column is skipped by Tab and hidden from screen readers', /tabindex="-1"/.test(tag('s|SML')) && /aria-hidden="true"/.test(tag('s|SML')), tag('s|SML'));
    ok('HoldingsMap: a large tile stays a normal focusable button', !/tabindex/.test(tag('s|BIG')) && !/aria-hidden/.test(tag('s|BIG')), tag('s|BIG'));
  }
  ok('HoldingsMap: a named group of buttons, ▲ / ▼ with every tinted figure', /role="group" aria-label="Holdings map"/.test(m) && /▲ 5\.0 %/.test(m) && /▼ 2\.0 %/.test(m) && (m.match(/<button/g) || []).length === 2, m);
  m = html(h(C.Table, { columns: COLS, rows: ROWS, layout: 'table', rowProps: (r) => ({ role: 'button', tabIndex: 0, 'data-k': r.id }) }));
  ok('Table: rowProps puts attributes on each data row (not on group rows)', (m.match(/data-k="/g) || []).length === 2 && /role="button"/.test(m) && /class="is-clickable"/.test(m), m);
  m = html(h(C.Table, { columns: COLS, rows: ROWS, layout: 'phone', rowProps: (r) => ({ 'data-k': r.id }) }));
  ok('Table phone layout: rowProps too', (m.match(/data-k="/g) || []).length === 2, m);
}

console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
