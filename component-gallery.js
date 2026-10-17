// ============================================================================
// MAERMIN — Component gallery  (window.MaerminGallery)
// ----------------------------------------------------------------------------
// PLAN Phase 6, R1.2/R1.3. A hidden review page for the shared components
// (MaerminComponents): every component in every state, in the active theme,
// with a theme switcher. Open the app with `?gallery` (works with `?demo`).
// Not in nav-model.js, the sidebar or the command palette; renders nothing
// unless asked for. Demo figures only.
// ============================================================================
(function () {
  'use strict';
  function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function isOn(search) { return /(^|[?&])gallery(=1|=true)?(&|$)/.test(String(search || '')); }

  var THEMES = [['dark', 'Dark'], ['white', 'Light'], ['purple', 'Nebula'], ['contrast', 'High contrast'], ['cb', 'Colour-blind']];

  function View(props) {
    var React = window.React, h = React.createElement, C = window.MaerminComponents;
    if (!C) return null;
    var I = function (n) { return window.MaerminIcons && window.MaerminIcons.has(n) ? window.MaerminIcons.Icon(n, { size: 16 }) : null; };
    var st = React.useState('overview'), tab = st[0], setTab = st[1];
    var sp = React.useState('1Y'), period = sp[0], setPeriod = sp[1];
    var sc = React.useState(true), chipA = sc[0], setChipA = sc[1];
    var sm = React.useState(false), masked = sm[0], setMasked = sm[1];
    var sl = React.useState(false), busy = sl[0], setBusy = sl[1];
    var themeName = props.themeName || 'dark';

    function section(title, children) {
      return h('section', { className: 'ui-gallery__section', 'data-testid': 'gallery-' + title.toLowerCase().replace(/[^a-z]+/g, '-') },
        h('h2', { className: 'ui-gallery__h' }, title), h('div', { className: 'ui-gallery__row' }, children));
    }
    function cell(label, node) { return h('div', { className: 'ui-gallery__cell' }, h('div', { className: 'ui-gallery__label' }, label), node); }

    var sections = [
      section('Buttons', [
        cell('primary', h(C.Button, { variant: 'primary', key: 1 }, 'Add transaction')),
        cell('secondary', h(C.Button, { key: 2 }, 'Import statement')),
        cell('quiet', h(C.Button, { variant: 'quiet', key: 3 }, 'Cancel')),
        cell('danger', h(C.Button, { variant: 'danger', key: 4 }, 'Move to trash')),
        cell('with icon + kbd', h(C.Button, { variant: 'primary', icon: I('plus'), kbd: 'N', key: 5 }, 'Add')),
        cell('small', h(C.Button, { size: 'sm', key: 6 }, 'CSV')),
        cell('large', h(C.Button, { size: 'lg', variant: 'primary', key: 7 }, 'Save')),
        cell('disabled', h(C.Button, { disabled: true, variant: 'primary', key: 8 }, 'Save')),
        cell('loading', h(C.Button, { loading: busy, variant: 'primary', onClick: function () { setBusy(true); setTimeout(function () { setBusy(false); }, 1500); }, key: 9 }, busy ? 'Saving…' : 'Click to load'))
      ]),
      section('Icon buttons', [
        cell('default', h(C.IconButton, { label: __('uiMore', 'More actions'), icon: I('more') || '⋯', key: 1 })),
        cell('toggle off/on', h(C.IconButton, { label: __('uiHideAmounts', 'Hide amounts'), pressed: masked, onClick: function () { setMasked(!masked); }, icon: I('eye') || '◉', key: 2 })),
        cell('small', h(C.IconButton, { size: 'sm', label: __('uiClose', 'Close'), icon: '×', key: 3 })),
        cell('disabled', h(C.IconButton, { disabled: true, label: __('uiClose', 'Close'), icon: '×', key: 4 }))
      ]),
      section('Stats', [
        cell('hero (lg)', h(C.Stat, { size: 'lg', label: 'Net worth', value: h(C.Mask, { masked: masked }, '178,556.70 €'), sub: 'both portfolios + cash', key: 1 })),
        cell('gain', h(C.Stat, { label: 'Return per year', value: '+19.63%', signed: 19.63, sub: 'money-weighted, since Jan 2023', key: 2 })),
        cell('income + split', h(C.Stat, { label: 'Income, next 12 months', tone: 'income', value: h(C.Mask, { masked: masked }, '1,404.15 €'), sub: '≈ 117 € a month', split: [{ label: 'Received', value: '4,964.83 €' }, { label: 'Gross', value: '5,435.65 €' }], key: 3 })),
        cell('loss', h(C.Stat, { label: 'Realty Income', value: '−8.38%', signed: -8.38, key: 4 })),
        cell('zero (neutral)', h(C.Stat, { label: 'Realised this year', value: '±0.00 €', signed: 0, key: 5 })),
        cell('clickable', h(C.Stat, { label: 'Health score', value: '80', sub: 'Grade B', onClick: function () {}, key: 6 }))
      ]),
      section('Badges and chips', [
        cell('badge', h(C.Badge, { key: 1 }, 'Sample data')),
        cell('chip on', h(C.Chip, { pressed: chipA, count: 224, onClick: function () { setChipA(!chipA); }, key: 2 }, 'All')),
        cell('chip off', h(C.Chip, { pressed: !chipA, count: 179, onClick: function () { setChipA(!chipA); }, key: 3 }, 'Dividends')),
        cell('tone gain', h(C.ToneChip, { value: 111.29, text: '+111.29%', key: 4 })),
        cell('tone loss', h(C.ToneChip, { value: -7.99, text: '−7.99%', key: 5 })),
        cell('tone zero', h(C.ToneChip, { value: 0, text: '±0.00%', key: 6 }))
      ]),
      section('Tabs', [
        cell('page tabs (arrow keys)', h(C.PageTabs, { label: 'Home views', value: tab, onChange: setTab, tabs: [{ id: 'overview', label: 'Overview' }, { id: 'portfolios', label: 'Portfolios' }, { id: 'net-worth', label: 'Net worth' }, { id: 'watchlist', label: 'Watchlist' }], key: 1 })),
        cell('segmented', h(C.Segmented, { label: 'Period', value: period, onChange: setPeriod, options: ['1M', '6M', 'YTD', '1Y', '3Y', 'All'].map(function (p) { return { value: p, label: p }; }), key: 2 }))
      ]),
      section('Inputs', [
        cell('input', h(C.Input, { label: 'Search', placeholder: 'Name, symbol or note', key: 1 })),
        cell('hint', h(C.Input, { label: 'Price', inputMode: 'decimal', defaultValue: '147.85', hint: 'In the trade currency', key: 2 })),
        cell('error', h(C.Input, { label: 'Quantity', defaultValue: '−3', error: 'Enter a quantity above 0', key: 3 })),
        cell('disabled', h(C.Input, { label: 'ISIN', defaultValue: 'US67066G1040', disabled: true, key: 4 })),
        cell('select', h(C.Select, { label: 'Portfolio', defaultValue: 'main', options: [{ value: 'main', label: 'Main depot' }, { value: 'sp', label: 'Savings plan broker' }], key: 5 }))
      ]),
      section('Cards', [
        cell('card with action', h(C.Card, { title: 'Holdings map', subtitle: '31 positions', action: h('a', { href: '#', onClick: function (e) { e.preventDefault(); } }, 'Allocation →'), key: 1 }, 'Card body')),
        cell('answer card', h(C.Card, { variant: 'answer', key: 2 }, h(C.Stat, { label: 'Return per year', value: '+19.63%', signed: 1 }))),
        cell('plain card', h(C.Card, { variant: 'plain', title: 'Positions', key: 3 }, h('div', { className: 'ui-gallery__plain' }, 'A table goes here, edge to edge.')))
      ])
    ];
    // R1.3: Table (desktop + phone rows), EmptyState, Skeleton, ChartFrame, Modal
    var so = React.useState({ key: 'value', dir: 'desc' }), sort = so[0], setSort = so[1];
    var ss = React.useState(function () { return new Set(); }), selected = ss[0], setSelected = ss[1];
    var sd = React.useState(false), dlg = sd[0], setDlg = sd[1];
    var ROWS = [
      { __group: 'May 2026', __summary: 'net cash +7,631.31 €' },
      { id: 't1', date: 'May 15', type: 'Dividend', name: 'Microsoft Corp.', sym: 'MSFT', amount: 11.73, cur: '12.75 USD' },
      { id: 't2', date: 'May 14', type: 'Sale', name: 'NVIDIA Corp.', sym: 'NVDA', amount: 8161.32, cur: '8,871.00 USD' },
      { id: 't3', date: 'May 14', type: 'Tax', name: 'Abgeltungsteuer + Soli (NVDA)', sym: 'TAX', amount: -1658.14, cur: '' },
      { __group: 'March 2026', __summary: 'net cash −3,120.00 €' },
      { id: 't4', date: 'Mar 16', type: 'Buy', name: 'Bitcoin', sym: 'BTC', amount: -3120, cur: '' }
    ];
    var money = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; };
    var COLS = [
      { key: 'date', label: 'Date', priority: 1, phone: 'meta' },
      { key: 'type', label: 'Type', priority: 2, phone: 'meta' },
      { key: 'name', label: 'Asset', priority: 1, phone: 'title', render: function (r) { return h('span', null, h('b', { className: 'ui-gallery__sym' }, r.sym), ' ', r.name); } },
      { key: 'cur', label: 'Original', priority: 3, align: 'right', phone: 'sub' },
      { key: 'value', label: 'Amount', priority: 1, align: 'right', sortable: true, phone: 'value', render: function (r) { return h('span', { className: r.type === 'Dividend' ? 'tone-income' : '' }, h(C.Mask, { masked: masked }, money(r.amount))); } }
    ];
    var tableProps = {
      columns: COLS, rows: ROWS, caption: 'Transactions', sort: sort, onSort: function (k, d) { setSort({ key: k, dir: d }); },
      selected: selected, onSelect: function (k, on) { var n = new Set(selected); if (k === 'all') ROWS.forEach(function (r) { if (!r.__group) n.add(r.id); }); else if (k === 'none') n.clear(); else if (on) n.add(k); else n.delete(k); setSelected(n); },
      rowActions: function () { return [{ label: 'Edit' }, { label: 'Duplicate' }, { label: 'Move to trash', danger: true }]; }
    };
    sections = sections.concat([
      section('Table', [
        h('div', { className: 'ui-gallery__cell ui-gallery__wide', key: 1 }, h('div', { className: 'ui-gallery__label' }, 'desktop (phone rows below 768 px)'),
          h(C.Card, { variant: 'plain', title: 'Transactions' }, h(C.Table, Object.assign({ 'data-testid': 'gallery-table' }, tableProps)))),
        h('div', { className: 'ui-gallery__cell', key: 2 }, h('div', { className: 'ui-gallery__label' }, 'phone rows (forced)'),
          h(C.Card, { variant: 'plain' }, h(C.Table, Object.assign({}, tableProps, { layout: 'phone' })))),
        h('div', { className: 'ui-gallery__cell', key: 3 }, h('div', { className: 'ui-gallery__label' }, 'loading'), h(C.Card, { variant: 'plain' }, h(C.Table, { columns: COLS, rows: [], loading: true })))
      ]),
      section('Empty states', [
        cell('empty', h(C.EmptyState, { title: 'No transactions yet', text: 'Add your first buy or import a statement.', action: { label: 'Import statement', onClick: function () {} }, key: 1 })),
        cell('needs Worker', h(C.EmptyState, { kind: 'worker', title: 'Needs your Worker', text: 'News loads through your own Worker.', action: { label: 'Open API Settings', onClick: function () {} }, key: 2 })),
        cell('loading', h(C.EmptyState, { kind: 'loading', title: 'Loading prices…', key: 3 })),
        cell('skeleton KPI', h(C.Skeleton, { shape: 'kpi', key: 4 })),
        cell('skeleton text', h(C.Skeleton, { shape: 'text', lines: 3, key: 5 }))
      ]),
      section('Chart frame', [
        h('div', { className: 'ui-gallery__cell ui-gallery__wide', key: 1 }, h(C.ChartFrame, {
          title: 'Value, 12 months', subtitle: 'Both portfolios, securities', summary: 'Portfolio value over 12 months, ending at 176,756.66 euros', source: 'Sample data',
          legend: [{ label: 'Value', value: '176,756.66 €', series: 1 }, { label: 'Money in', value: '98,701.72 €', series: 2 }],
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'v', label: 'Value', align: 'right' }], rows: [{ id: 1, m: 'Aug 2026', v: '168,402 €' }, { id: 2, m: 'Sep 2026', v: '171,016 €' }, { id: 3, m: 'Oct 2026', v: '176,757 €' }] }
        }, h('svg', { viewBox: '0 0 600 160', width: '100%', height: 160, 'aria-hidden': 'true' },
          h('path', { d: 'M0 130 L60 120 L120 125 L180 100 L240 90 L300 96 L360 70 L420 74 L480 50 L540 56 L600 30', fill: 'none', stroke: 'var(--chart-1)', strokeWidth: 2 }),
          h('path', { d: 'M0 140 L600 118', fill: 'none', stroke: 'var(--chart-2)', strokeWidth: 2, strokeDasharray: '4 4' }))))
      ]),
      section('Modal', [
        cell('dialog / phone sheet', h(C.Button, { onClick: function () { setDlg(true); }, key: 1 }, 'Open dialog'))
      ])
    ]);
    if (dlg) sections.push(h(C.Modal, { key: 'dlg', open: true, title: 'Add transaction', onClose: function () { setDlg(false); },
      footer: [h(C.Button, { key: 'c', variant: 'quiet', onClick: function () { setDlg(false); } }, 'Cancel'), h(C.Button, { key: 's', variant: 'primary', onClick: function () { setDlg(false); } }, 'Save')] },
      h(C.Input, { label: 'Symbol', placeholder: 'e.g. VWCE.DE' })));
    if (window.MaerminGallery.extra) sections = sections.concat(window.MaerminGallery.extra(h, C, { masked: masked, I: I }));

    return h('div', { className: 'ui-gallery', 'data-testid': 'component-gallery' },
      h('header', { className: 'ui-gallery__top' },
        h('h1', { className: 'ui-gallery__title' }, 'Component gallery'),
        h('p', { className: 'ui-gallery__note' }, 'Hidden review page (R1.2 / R1.3). Demo figures only.'),
        h(C.Segmented, { label: 'Theme', value: themeName, onChange: function (v) { if (props.setTheme) props.setTheme(v); }, options: THEMES.map(function (t) { return { value: t[0], label: t[1] }; }), 'data-testid': 'gallery-theme' })),
      sections);
  }

  var api = { isOn: isOn, View: View, THEMES: THEMES, extra: null };
  if (typeof window !== 'undefined') window.MaerminGallery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
