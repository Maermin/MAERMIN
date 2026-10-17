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
    if (window.MaerminGallery.extra) sections = sections.concat(window.MaerminGallery.extra(h, C, { masked: masked, I: I }));

    return h('div', { className: 'ui-gallery', 'data-testid': 'component-gallery' },
      h('header', { className: 'ui-gallery__top' },
        h('h1', { className: 'ui-gallery__title' }, 'Component gallery'),
        h('p', { className: 'ui-gallery__note' }, 'Hidden review page (R1.2). Demo figures only.'),
        h(C.Segmented, { label: 'Theme', value: themeName, onChange: function (v) { if (props.setTheme) props.setTheme(v); }, options: THEMES.map(function (t) { return { value: t[0], label: t[1] }; }), 'data-testid': 'gallery-theme' })),
      sections);
  }

  var api = { isOn: isOn, View: View, THEMES: THEMES, extra: null };
  if (typeof window !== 'undefined') window.MaerminGallery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
