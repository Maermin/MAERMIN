// ============================================================================
// MAERMIN — Vorabpauschale forecast  (window.MaerminVapForecast)
// ----------------------------------------------------------------------------
// P5-4.3. The Vorabpauschale each fund is expected to trigger for the current
// value year, deemed received on the first working day of the next January
// (sec. 18 (3) InvStG), the tax on it and the cash needed on the clearing
// account, per portfolio when there are several. A December reminder says how
// much to keep there.
//
// Per fund the inputs come from the Vorabpauschale worksheet's prefill
// (MaerminGermanTaxView.prefillRow: 1 January price x units held, the
// distributions so far, the month factor per lot); the live price stands in
// for the 31 December value until the year is over. In January the forecast
// is for the year just ended, whose Vorabpauschale is being debited. A
// Vorabpauschale saved in the worksheet for that fund and year is used as is.
// The amount is deemed received in January, so it counts against the new
// year's Sparerpauschbetrag (Freistellungsauftrag).
//
// Stores only the years already reminded (maermin_vap_reminded, no amounts).
// The pure part is Node-tested in test/vap-forecast.test.js; the Panel is
// browser-only. An estimate, not tax advice.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var REMINDED_KEY = 'maermin_vap_reminded';
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function germanTax() {
    if (typeof window !== 'undefined' && window.TaxCalculationEngine) return window.TaxCalculationEngine.GermanTax;
    return require('./tax-calculation-engine.js').GermanTax;
  }
  function taxView() {
    if (typeof window !== 'undefined' && window.MaerminGermanTaxView) return window.MaerminGermanTaxView;
    return require('./german-tax-view.js');
  }

  // Value year for a date: the year itself, but in January the year just
  // ended - its Vorabpauschale is the one being debited.
  function valueYear(asOfISO) {
    var s = ymd(asOfISO);
    var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10);
    return m === 1 ? y - 1 : y;
  }

  // First working day of a year: 1 January is a holiday; a Saturday is a
  // working day (Werktag), a Sunday is not.
  function firstWorkingDay(year) {
    var d = new Date(Date.UTC(year, 0, 2));
    if (d.getUTCDay() === 0) d.setUTCDate(3);
    return d.toISOString().slice(0, 10);
  }

  // Fund symbols bought at some point, with the currency of the latest trade.
  function fundSymbols(transactions, opts) {
    var fundTypes = opts.fundTypes || {};
    var isFund = typeof opts.isFund === 'function' ? opts.isFund : function () { return false; };
    var out = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || (tx.type !== 'buy' && tx.type !== 'sell') || tx.category === 'crypto' || tx.category === 'options') return;
      var sym = String(tx.symbol || '').toUpperCase();
      if (!sym) return;
      if (!out[sym] && !(fundTypes[sym] || isFund(sym, tx.symbolName || tx.name || ''))) return;
      if (!out[sym] || ymd(tx.date) >= out[sym].date) out[sym] = { symbol: sym, name: tx.symbolName || tx.name || (out[sym] && out[sym].name) || sym, currency: tx.currency || 'EUR', date: ymd(tx.date) };
    });
    return Object.keys(out).sort().map(function (k) { return out[k]; });
  }

  function priceOf(prices, sym) {
    var p = prices || {};
    var v = p[sym] != null ? p[sym] : p[sym.toLowerCase()];
    v = parseFloat(v);
    return isFinite(v) && v > 0 ? v : null;
  }

  // PURE. opts: { asOf, year?, priceHistory, prices, fundTypes, vapRecords,
  // basiszinsOverrides, freistellungsauftrag, kirchensteuer, exchangeRate,
  // isFund(symbol, name) }. Amounts in EUR.
  function forecast(transactions, opts) {
    opts = opts || {};
    var GT = opts.germanTax || germanTax();
    var TV = taxView();
    var asOf = ymd(opts.asOf) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var year = opts.year || valueYear(asOf);
    var live = year === parseInt(asOf.slice(0, 4), 10);
    var basiszins = GT.basiszinsFor(year, opts.basiszinsOverrides || {});
    var k = num(opts.kirchensteuer);
    var fx = num(opts.exchangeRate);
    var records = opts.vapRecords || {};
    var fundTypes = opts.fundTypes || {};
    var txs = (transactions || []).filter(function (tx) { return tx && ymd(tx.date) <= year + '-12-31'; });

    var rows = [];
    fundSymbols(txs, opts).forEach(function (f) {
      var pre = TV.prefillRow(txs, opts.priceHistory || {}, f.symbol, year, fx);
      if (!(pre.shares > 1e-9)) return;
      // Prices are in the fund's trade currency; USD is converted to EUR.
      var conv = f.currency === 'USD' && fx > 0 ? fx : 1;
      var valueStart = pre.valueStart != null ? pre.valueStart * conv : null;
      var livePrice = priceOf(opts.prices, f.symbol);
      var valueEnd = live && livePrice != null ? livePrice * pre.shares * conv
        : (pre.valueEnd != null ? pre.valueEnd * conv : (livePrice != null ? livePrice * pre.shares * conv : null));
      var type = fundTypes[f.symbol] || 'none';
      var saved = records[f.symbol] && (records[f.symbol][year] != null ? records[f.symbol][year] : records[f.symbol][String(year)]);
      var row = { symbol: f.symbol, name: f.name, fundType: type, unclassified: !fundTypes[f.symbol], shares: pre.shares,
        valueStart: valueStart, valueEnd: valueEnd, distributions: pre.distributions, monthsFactor: pre.monthsFactor,
        basisertrag: 0, vorabpauschale: 0, tfRate: 0, taxable: 0, tax: 0, source: 'estimate', missing: null };
      if (saved != null && num(saved) > 0) {
        row.vorabpauschale = num(saved); row.source = 'saved';
      } else if (valueStart == null) {
        row.missing = 'start';
      } else if (valueEnd == null) {
        row.missing = 'end';
      } else {
        var v = GT.computeVorabpauschale({ valueStart: valueStart, valueEnd: valueEnd, distributions: pre.distributions, basiszins: basiszins, monthsFactor: pre.monthsFactor });
        row.basisertrag = v.basisertrag; row.vorabpauschale = v.vorabpauschale;
      }
      var tf = GT.applyTeilfreistellung(row.vorabpauschale, type);
      row.tfRate = tf.rate; row.taxable = tf.taxable;
      row.tax = GT.abgeltungsteuer(row.taxable, k).total;
      rows.push(row);
    });

    var totals = { vorabpauschale: 0, taxable: 0, taxWithoutAllowance: 0, allowance: 0, cashNeeded: 0 };
    rows.forEach(function (r) { totals.vorabpauschale += r.vorabpauschale; totals.taxable += r.taxable; });
    totals.taxWithoutAllowance = GT.abgeltungsteuer(totals.taxable, k).total;
    // Deemed received in January of year + 1: that year's allowance.
    totals.allowance = GT.sparerpauschbetragFor(year + 1, opts.freistellungsauftrag != null ? opts.freistellungsauftrag : 1000);
    totals.cashNeeded = GT.abgeltungsteuer(Math.max(0, totals.taxable - totals.allowance), k).total;

    // Per portfolio (clearing account): the same forecast on its own
    // transactions, without the allowance (the orders are split per bank).
    // A saved amount is split by the units each portfolio holds.
    var byPortfolio = [];
    if (!opts._noBreakdown && rows.length) {
      var syms = {}; rows.forEach(function (r) { syms[r.symbol] = r; });
      var pids = {};
      txs.forEach(function (tx) { if (syms[String(tx.symbol || '').toUpperCase()]) pids[tx.portfolioId || ''] = true; });
      var ids = Object.keys(pids).sort();
      if (ids.length >= 2) {
        byPortfolio = ids.map(function (pid) {
          var own = txs.filter(function (tx) { return (tx.portfolioId || '') === pid; });
          var recs = {};
          rows.forEach(function (r) {
            if (r.source !== 'saved') return;
            var q = TV.qtyAt(own, r.symbol, year + '-12-31T23:59:59Z');
            recs[r.symbol] = {}; recs[r.symbol][year] = r.vorabpauschale * (r.shares > 0 ? q / r.shares : 0);
          });
          var sub = forecast(own, Object.assign({}, opts, { year: year, asOf: asOf, vapRecords: recs, _noBreakdown: true }));
          return { portfolioId: pid, vorabpauschale: sub.totals.vorabpauschale, taxable: sub.totals.taxable, tax: sub.totals.taxWithoutAllowance };
        }).filter(function (p) { return p.vorabpauschale > 0; });
      }
    }

    return { year: year, asOf: asOf, deemedOn: firstWorkingDay(year + 1), basiszins: basiszins, rows: rows, totals: totals,
      byPortfolio: byPortfolio, missing: rows.filter(function (r) { return r.missing; }).length };
  }

  // ---- December reminder ----------------------------------------------------
  function loadReminded() {
    try { var v = JSON.parse(localStorage.getItem(REMINDED_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function saveReminded(state) {
    try { localStorage.setItem(REMINDED_KEY, JSON.stringify(state || {})); } catch (e) { /* non-fatal */ }
    return state;
  }
  function markReminded(state, year) {
    var next = Object.assign({}, state || {}); next[String(year)] = true; return next;
  }
  // PURE: once per value year, in December, when tax on a Vorabpauschale is
  // expected at all (the allowance may already be used at the bank).
  function reminderDue(fc, state, todayISO) {
    var s = ymd(todayISO);
    if (!fc || s.slice(5, 7) !== '12' || parseInt(s.slice(0, 4), 10) !== fc.year) return false;
    if ((state || {})[String(fc.year)]) return false;
    return fc.totals.taxWithoutAllowance > 0.005;
  }
  function reminderText(fc, o) {
    o = o || {};
    var money = o.formatMoney || function (v) { return v.toFixed(2); };
    var I = (typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n : require('./i18n.js');
    return __('vfReminder', 'Vorabpauschale on {date}: keep about {cash} on the clearing account ({max} if your Freistellungsauftrag is used up).',
      { date: I.date ? I.date(fc.deemedOn) : fc.deemedOn, cash: money(fc.totals.cashNeeded), max: money(fc.totals.taxWithoutAllowance) });
  }

  // ---- React Panel (browser only; Tax view, Germany) ------------------------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var GT = typeof window !== 'undefined' && window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
    if (!React || !GT || !window.MaerminGermanTaxView) return null;
    var e = React.createElement, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var I18N = window.MaerminI18n;
    var today = props.today || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var fc = useMemo(function () {
      var TS = window.MaerminTaxSettings, s = null;
      try { s = TS ? TS.load() : null; } catch (err) { s = null; }
      var LT = window.MaerminLookThrough;
      try {
        return forecast(props.transactions || [], {
          asOf: today, priceHistory: props.priceHistory || {}, prices: props.prices || {},
          fundTypes: GT.loadFundTypes(), vapRecords: GT.loadVapRecords(), basiszinsOverrides: GT.loadBasiszinsOverrides(),
          freistellungsauftrag: s ? s.freistellungsauftrag : 1000,
          kirchensteuer: s ? s.kirchensteuer : GT.loadKirchensteuerRate(),
          exchangeRate: props.exchangeRate,
          isFund: function (sym, name) { return LT && LT.isFundCandidate ? LT.isFundCandidate(sym, name) : false; }
        });
      } catch (err) { return null; }
    }, [props.transactions, props.prices, props.priceHistory, props.exchangeRate, props.rev, today]);
    if (!fc) return null;

    // R4.6: Card, the shared table look, the totals on shared rows
    var UIC = window.MaerminComponents;
    function line(lbl, val, tid, strong) {
      return e('li', { key: tid, 'data-testid': tid, className: 'ui-rows__row' },
        e('span', { className: 'ui-muted' }, lbl), e('b', { className: ['num', strong ? 'ui-taxp__strong' : ''].join(' ').trim() }, val));
    }
    var portfolios = props.portfolios || [];
    function pName(id) {
      var p = portfolios.filter(function (x) { return x && x.id === id; })[0];
      return p ? p.name : (id || __('vfNoPortfolio', 'Without portfolio'));
    }
    var dateText = I18N.date ? I18N.date(fc.deemedOn) : fc.deemedOn;

    return e(UIC.Card, { 'data-testid': 'vap-forecast-panel', className: 'ui-taxp', headingLevel: 'h3', title: (window.MaerminGlossary ? e(window.MaerminGlossary.Term, { id: 'vorabpauschale' }, __('vfTitle', 'Vorabpauschale forecast {y}', { y: fc.year })) : __('vfTitle', 'Vorabpauschale forecast {y}', { y: fc.year })),
      subtitle: __('vfIntro', 'What your funds are expected to trigger for {y}, deemed received on {date}. The bank debits the tax then, so the cash has to be on the clearing account. Basiszins {rate}.',
        { y: fc.year, date: dateText, rate: I18N.pct(fc.basiszins * 100, 2) }) },
      !fc.rows.length ? window.MaerminUtils.emptyState({ compact: true, testid: 'vf-empty', text: __('vfEmpty', 'No funds held at the end of {y}.', { y: fc.year }) }) :
      e('div', { className: 'ui-taxp__body' },
        e('div', { className: 'ui-table-wrap' },
          e('table', { 'data-testid': 'vf-table', className: ['ui-table', 'ui-table--dense', 'ui-table--tall'].join(' ') },
            e('thead', null, e('tr', null,
              [__('gtFund', 'Fund'), __('gtValueJan1', 'Value Jan 1'), __('vfValueNow', 'Value now'), 'Vorabpauschale', __('gtTaxableAfterTf', 'Taxable after TF'), __('vfTax', 'Tax')].map(function (h, i) {
                return e('th', { key: i, scope: 'col', className: i === 0 ? 'is-sticky' : 'is-right' }, h);
              }))),
            e('tbody', null, fc.rows.map(function (r) {
              var note = r.missing === 'start' ? __('vfMissingStart', 'no price on 1 January')
                : r.missing === 'end' ? __('vfMissingEnd', 'no current price')
                : r.source === 'saved' ? __('vfSaved', 'saved') : r.unclassified ? __('vfUnclassified', 'type not set: no Teilfreistellung') : '';
              return e('tr', { key: r.symbol, 'data-testid': 'vf-row-' + r.symbol },
                e('th', { scope: 'row', className: 'is-sticky' }, r.symbol,
                  note ? e('span', { className: ['ui-tcell__sub', r.missing || r.unclassified ? 'tone-warning' : ''].join(' ').trim() }, (r.missing || r.unclassified ? '! ' : '') + note) : null),
                e('td', null, r.valueStart != null ? money(r.valueStart) : '–'),
                e('td', null, r.valueEnd != null ? money(r.valueEnd) : '–'),
                e('td', null, r.missing ? '–' : money(r.vorabpauschale)),
                e('td', null, r.missing ? '–' : money(r.taxable)),
                e('td', null, r.missing ? '–' : money(r.tax)));
            })))),
        e('ul', { className: 'ui-rows' },
          line(__('vfTotalVap', 'Vorabpauschale in total'), money(fc.totals.vorabpauschale), 'vf-total'),
          line(__('vfTaxable', 'Taxable after Teilfreistellung'), money(fc.totals.taxable), 'vf-taxable'),
          line(__('vfAllowance', 'Sparerpauschbetrag {y}', { y: fc.year + 1 }), money(fc.totals.allowance), 'vf-allowance'),
          line(__('vfCash', 'Cash needed on {date}', { date: dateText }), money(fc.totals.cashNeeded), 'vf-cash', true),
          line(__('vfCashMax', 'If your Freistellungsauftrag is used up'), money(fc.totals.taxWithoutAllowance), 'vf-cash-max')),
        fc.byPortfolio.length ? e('div', { 'data-testid': 'vf-portfolios' },
          e('h4', { className: 'ui-sublabel' }, __('vfPerPortfolio', 'Per clearing account (without allowance)')),
          e('ul', { className: 'ui-rows' }, fc.byPortfolio.map(function (p) { return line(pName(p.portfolioId), money(p.tax), 'vf-p-' + (p.portfolioId || 'none')); }))) : null),
      e('p', { className: 'ui-note' },
        __('vfNote', 'Estimate at today\'s price: the final figure uses the price on 31 December. Units bought during the year count with their month factor. Not tax advice.')));
  }

  var api = { REMINDED_KEY: REMINDED_KEY, valueYear: valueYear, firstWorkingDay: firstWorkingDay, forecast: forecast,
    loadReminded: loadReminded, saveReminded: saveReminded, markReminded: markReminded, reminderDue: reminderDue, reminderText: reminderText, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminVapForecast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
