// ============================================================================
// MAERMIN — Loss carry-forward  (window.MaerminLossCarry)
// ----------------------------------------------------------------------------
// P5-4.1. Losses a tax year could not use are carried into the next one, in
// three pots that never mix:
//   shares   sec. 20 (6) S.4 EStG - only against gains from selling shares
//   other    sec. 20 (6) EStG     - against all capital income
//   private  sec. 23 (3) EStG     - only against private-sale gains
// The computation itself lives in TaxCalculationEngine.GermanTax
// (computeGermanTaxDetailed carryIn/carryOut, privateSalesWithCarry); this
// module runs it year by year over the app's own history (chain), keeps the
// optional opening balances from the user's last loss assessment
// (Verlustfeststellungsbescheid) or bank loss certificate, and shows the
// Tax view panel.
//
// The carry-forward is computed for all portfolios together, as the tax
// office settles it in the return. breakdown() shows, per portfolio, what
// each one on its own would carry - roughly what each bank's loss pot holds.
// Anlage KAP stays per year: the tax office applies the carry-forward itself.
//
// Storage key 'maermin_loss_carry' (sensitive: encrypted, synced, in the
// backup): { version: 1, opening: { 'YYYY': { shares, other, private } } }
// - the losses brought INTO that year, added to what the app computes.
// Pure parts are Node-tested in test/loss-carry.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_loss_carry';
  var POTS = ['shares', 'other', 'private'];
  var MAX_YEARS = 30;

  function round2(v) { return Math.round(v * 100) / 100; }
  function zero() { return { shares: 0, other: 0, private: 0 }; }
  // Losses as positive amounts in cents; anything else is 0.
  function pots(p) {
    var o = zero();
    if (p && typeof p === 'object') POTS.forEach(function (k) { var v = parseFloat(p[k]); o[k] = isFinite(v) && v > 0 ? round2(v) : 0; });
    return o;
  }
  function add(a, b) { var o = zero(); POTS.forEach(function (k) { o[k] = round2((a ? a[k] || 0 : 0) + (b ? b[k] || 0 : 0)); }); return o; }
  function isEmpty(p) { return !p || POTS.every(function (k) { return !(p[k] > 0); }); }

  // ---- store -----------------------------------------------------------------
  function normalize(raw) {
    var out = { version: 1, opening: {} };
    var op = raw && raw.opening && typeof raw.opening === 'object' ? raw.opening : {};
    Object.keys(op).forEach(function (y) {
      if (!/^\d{4}$/.test(y)) return;
      var p = pots(op[y]);
      if (!isEmpty(p)) out.opening[y] = p;
    });
    return out;
  }
  function ls() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function load() {
    try { var s = ls() && ls().getItem(KEY); return normalize(s ? JSON.parse(s) : null); } catch (e) { return normalize(null); }
  }
  function save(state) {
    var n = normalize(state);
    try { if (ls()) ls().setItem(KEY, JSON.stringify(n)); } catch (e) { /* quota */ }
    return n;
  }
  function setOpening(state, year, p) {
    var n = normalize(state);
    var v = pots(p);
    if (isEmpty(v)) delete n.opening[String(year)]; else n.opening[String(year)] = v;
    return n;
  }
  function openingFor(state, year) { return pots(state && state.opening && state.opening[String(year)]); }

  // ---- year chain --------------------------------------------------------------
  // First year to start from: the earliest transaction or opening balance,
  // never more than MAX_YEARS back.
  function firstYear(transactions, state, year) {
    var y0 = year;
    (transactions || []).forEach(function (tx) {
      var y = tx && parseInt(String(tx.date || '').slice(0, 4), 10);
      if (y > 1900 && y < y0) y0 = y;
    });
    Object.keys((state && state.opening) || {}).forEach(function (k) { var y = parseInt(k, 10); if (y < y0) y0 = y; });
    return Math.max(y0, year - MAX_YEARS);
  }

  // Runs build(transactions, opts) for every year before opts.year with the
  // carry of the year before, plus that year's opening balance.
  // -> { carryIn (for opts.year), years: [{ year, carryIn, carryOut }] }
  function chain(transactions, opts, build) {
    var year = opts.year;
    var state = opts.lossCarryState ? normalize(opts.lossCarryState) : load();
    var c = zero(), years = [];
    for (var y = firstYear(transactions, state, year); y < year; y++) {
      var cin = add(c, openingFor(state, y));
      var r = null;
      try {
        r = build(transactions, Object.assign({}, opts, { year: y, carryIn: cin, vorabpauschalen: undefined, lossCarryState: state }));
      } catch (e) { r = null; }
      var g = r && r.summary && r.summary.germanDetail;
      c = g && g.carryOut ? pots(g.carryOut) : cin;
      years.push({ year: y, carryIn: cin, carryOut: c });
    }
    return { carryIn: add(c, openingFor(state, year)), years: years };
  }

  // Per portfolio, what it would carry out of opts.year on its own (own FIFO,
  // own netting, no opening balances). Empty with fewer than two portfolios.
  // -> [{ portfolioId, carryOut }]
  function breakdown(transactions, opts, build) {
    var by = {}, order = [];
    (transactions || []).forEach(function (tx) {
      if (!tx) return;
      var id = String(tx.portfolioId || 'default');
      if (!by[id]) { by[id] = []; order.push(id); }
      by[id].push(tx);
    });
    if (order.length < 2) return [];
    return order.map(function (id) {
      var g = null;
      try {
        var r = build(by[id], Object.assign({}, opts, { carryIn: undefined, lossCarry: true, lossCarryState: { version: 1, opening: {} } }));
        g = r && r.summary && r.summary.germanDetail;
      } catch (e) { g = null; }
      return { portfolioId: id, carryOut: pots(g && g.carryOut) };
    });
  }

  function potLabel(k) {
    return k === 'shares' ? __('lcPotShares', 'Shares')
      : k === 'other' ? __('lcPotOther', 'Other capital income')
      : __('lcPotPrivate', 'Private sales (sec. 23)');
  }

  // ---- panel (Tax view, German rules) ----------------------------------------
  // props: { theme, report, transactions, portfolios, year, exchangeRate,
  //          fxAt, formatMoney, onChange }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var year = props.year;
    var s0 = useState(load); var state = s0[0], setState = s0[1];
    var s1 = useState(false); var showBd = s1[0], setShowBd = s1[1];
    var g = props.report && props.report.summary && props.report.summary.germanDetail;
    var txs = props.transactions || [];

    var bd = useMemo(function () {
      if (!showBd || !window.MaerminTaxReport) return [];
      return breakdown(txs, { year: year, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt }, window.MaerminTaxReport.build);
    }, [showBd, txs, year, props.exchangeRate, props.fxAt]);

    var opening = openingFor(state, year);
    function commit(k, raw) {
      var U = window.MaerminUtils;
      var v = raw === '' ? 0 : (U && U.parseDecimal ? U.parseDecimal(raw) : parseFloat(raw));
      if (!(v >= 0)) return;
      var p = Object.assign({}, opening); p[k] = v;
      setState(save(setOpening(state, year, p)));
      if (props.onChange) props.onChange();
    }

    var cin = pots(g && g.carryIn), used = g ? { shares: (g.carryUsed || {}).shares || 0, other: (g.carryUsed || {}).other || 0, private: (g.crypto || {}).carryUsed || 0 } : zero();
    var cout = pots(g && g.carryOut);
    var cell = { padding: '0.4rem 0.5rem', borderTop: '1px solid ' + border, fontSize: '0.8rem', color: text, textAlign: 'right' };
    var head = { padding: '0.35rem 0.5rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' };
    var inp = { width: '110px', padding: '0.3rem 0.45rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '6px', color: text, fontSize: '0.78rem', textAlign: 'right' };
    var names = {};
    (props.portfolios || []).forEach(function (p) { names[String(p.id)] = p.name; });

    return e('div', { 'data-testid': 'loss-carry-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: 'var(--text-body)', fontWeight: 700, margin: '0 0 0.35rem' } }, __('lcTitle', 'Loss carry-forward {y}', { y: year })),
      e('p', { style: { color: dim, fontSize: 'var(--text-sm)', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('lcIntro', 'Losses an earlier year could not use, computed from your transactions for all portfolios together. Share losses only offset share gains, private-sale losses only private-sale gains. Carried losses are used before the Sparerpauschbetrag; a private-sale gain below the Freigrenze stays tax-free and leaves them untouched.')),
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null,
            e('th', { style: Object.assign({}, head, { textAlign: 'left' }) }, __('lcPot', 'Pot')),
            e('th', { style: head }, __('lcBroughtForward', 'Brought forward')),
            e('th', { style: head }, __('lcUsed', 'Used in {y}', { y: year })),
            e('th', { style: head }, __('lcCarried', 'Carried to {y}', { y: year + 1 })),
            e('th', { style: head }, __('lcOpening', 'From your assessment')))),
          e('tbody', null, POTS.map(function (k) {
            return e('tr', { key: k, 'data-testid': 'lc-row-' + k },
              e('td', { style: Object.assign({}, cell, { textAlign: 'left', fontWeight: 600 }) }, potLabel(k)),
              e('td', { style: cell }, money(cin[k])),
              e('td', { style: cell }, money(used[k])),
              e('td', { style: cell }, money(cout[k])),
              e('td', { style: cell }, e('input', {
                key: k + '|' + year + '|' + opening[k], defaultValue: opening[k] ? String(opening[k]) : '', inputMode: 'decimal', placeholder: '0',
                'data-testid': 'lc-open-' + k, 'aria-label': __('lcOpeningOf', 'Losses brought into {y} from your assessment: {pot}', { y: year, pot: potLabel(k) }),
                onBlur: function (ev) { commit(k, ev.target.value.trim()); },
                onKeyDown: function (ev) { if (ev.key === 'Enter') ev.target.blur(); },
                style: inp
              })));
          })))),
      e('p', { style: { color: dim, fontSize: 'var(--text-xs)', margin: '0.6rem 0 0', lineHeight: 1.5 } },
        __('lcOpeningHint', 'From your assessment: the remaining loss carry-forward on your last Verlustfeststellungsbescheid, or a bank\'s Verlustbescheinigung, entered in the year it is brought into. It is added to what MAERMIN computes.')),
      e('p', { role: 'note', style: { color: dim, fontSize: 'var(--text-xs)', margin: '0.35rem 0 0', lineHeight: 1.5 } },
        __('lcKapNote', 'Anlage KAP stays per year: the tax office applies the carry-forward itself from its loss assessment.')),
      (props.portfolios || []).length > 1 ? e('div', { style: { marginTop: '0.75rem' } },
        e('button', { type: 'button', 'data-testid': 'lc-breakdown', 'aria-expanded': showBd, onClick: function () { setShowBd(!showBd); },
          style: { padding: '0.35rem 0.8rem', borderRadius: '7px', border: '1px solid ' + border, background: 'transparent', color: text, fontSize: 'var(--text-xs)', cursor: 'pointer' } },
          showBd ? __('lcHideBreakdown', 'Hide per portfolio') : __('lcShowBreakdown', 'Per portfolio, as each bank would keep it')),
        showBd ? e('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' } },
          e('thead', null, e('tr', null,
            e('th', { style: Object.assign({}, head, { textAlign: 'left' }) }, __('portfolio', 'Portfolio')),
            POTS.map(function (k) { return e('th', { key: k, style: head }, potLabel(k)); }))),
          e('tbody', null, bd.map(function (row) {
            return e('tr', { key: row.portfolioId },
              e('td', { style: Object.assign({}, cell, { textAlign: 'left' }) }, names[row.portfolioId] || row.portfolioId),
              POTS.map(function (k) { return e('td', { key: k, style: cell }, money(row.carryOut[k])); }));
          }))) : null) : null);
  }

  var api = {
    KEY: KEY, POTS: POTS,
    pots: pots, add: add, normalize: normalize, load: load, save: save,
    setOpening: setOpening, openingFor: openingFor, firstYear: firstYear,
    chain: chain, breakdown: breakdown, potLabel: potLabel, Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminLossCarry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
