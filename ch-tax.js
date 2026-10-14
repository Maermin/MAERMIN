// ============================================================================
// MAERMIN — Swiss securities statement  (window.MaerminCHTax)
// ----------------------------------------------------------------------------
// P5-4.10. Sources approved by the owner on 2026-10-14:
//
//   Art. 16 Abs. 3 DBG, Art. 7 Abs. 4 lit. b StHG: capital gains on private
//     movable assets are tax-free; shown for information only
//   Art. 20 DBG, Art. 7 StHG: dividends, interest and the income of
//     accumulating collective investments (Art. 20 Abs. 1 lit. e DBG) are
//     taxable income, gross
//   Art. 4, 13 VStG: 35 % Verrechnungssteuer on Swiss dividends and interest;
//     a resident reclaims it by declaring the income (column A of the
//     Wertschriftenverzeichnis); income without VST goes in column B
//   Art. 13, 14 StHG: wealth tax on the securities at their year-end value
//     (ESTV Kursliste), converted to CHF
//   Formular DA-1 (Verordnung über die Anrechnung ausländischer Quellensteuern,
//     SR 672.201): foreign withholding up to the treaty's residual rate
//     (15 % for the usual treaty countries) is credited; anything above it is
//     reclaimed in the source country
//   ESTV Kreisschreiben Nr. 36 (27.7.2012), "Gewerbsmässiger
//     Wertschriftenhandel": private asset management is assumed when all of
//     these are met - holding period at least 6 months; yearly volume at most
//     5 x the holdings at the start of the year; capital gains under 50 % of
//     the net income; no debt financing (or securities income above the debt
//     interest); derivatives only for hedging. Thurgau reads the holding
//     period as one year; the panel says so.
//
// No tax amount: the wealth and income tax is cantonal and progressive.
// Amounts in CHF; a non-CHF amount is converted to EUR at its date
// (fx-history) and then to CHF at the dated EUR/CHF rate, else opts.chfPerEur,
// else today's cross rate. Without any CHF rate the result says missingRate.
// Settings: 'maermin_ch_settings' (encrypted, in the backup):
//   { otherIncome: CHF | null, debtFinanced: bool | null, funds: { SYM: { age: { YYYY: CHF } } } }
// Node-tested in test/ch-tax.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var VST = 0.35, DA1_CAP = 0.15, HOLD_DAYS = 183, VOLUME_X = 5, GAINS_SHARE = 0.5;
  var PRICE_MAX_AGE = 14; // days: an older last price is not "the year-end price"
  var SETTINGS_KEY = 'maermin_ch_settings';
  var SKIP = { cash: true, cashflow: true, skins: true };
  var DERIVATIVES = { options: true, futures: true, derivatives: true };
  var EPS = 1e-9, DAY = 86400000;
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }
  function fxh() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }
  function defaultCountry(sym) {
    var W = (typeof window !== 'undefined' && window.MaerminWithholding) || null;
    return W && W.countryOf ? W.countryOf(sym) : null;
  }

  function normalizeSettings(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    raw = raw && typeof raw === 'object' ? raw : {};
    var oi = parseFloat(raw.otherIncome);
    var funds = {};
    Object.keys(raw.funds || {}).forEach(function (k) {
      var f = raw.funds[k];
      if (!f || typeof f !== 'object') return;
      var age = {};
      Object.keys(f.age || {}).forEach(function (y) { var n = parseFloat(f.age[y]); if (/^\d{4}$/.test(y) && isFinite(n)) age[y] = n; });
      funds[String(k).toUpperCase()] = { age: age };
    });
    return { otherIncome: isFinite(oi) ? oi : null, debtFinanced: raw.debtFinanced === true ? true : raw.debtFinanced === false ? false : null, funds: funds };
  }
  function loadSettings() { try { return normalizeSettings(localStorage.getItem(SETTINGS_KEY)); } catch (e) { return normalizeSettings(null); } }
  function saveSettings(s) { var n = normalizeSettings(s); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(n)); } catch (e) { /* non-fatal */ } return n; }

  // Last price on or before `end`, at most PRICE_MAX_AGE days older.
  function priceAt(series, end) {
    var best = null;
    (series || []).forEach(function (p) {
      var d = ymd(typeof p.timestamp === 'number' ? new Date(p.timestamp).toISOString() : p.timestamp), v = num(p.price);
      if (v > 0 && d && d <= end && (!best || d > best.d)) best = { d: d, p: v };
    });
    return best && days(best.d, end) <= PRICE_MAX_AGE ? best.p : null;
  }

  // opts: { year, exchangeRate, fxAt, chfPerEur, today, priceHistory, countryOf, funds, settings }
  function compute(transactions, opts) {
    opts = opts || {};
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 1;
    var today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
    var provisional = today <= year + '-12-31';
    var end = provisional ? today : year + '-12-31';
    var ph = opts.priceHistory || {};
    var countryOf = typeof opts.countryOf === 'function' ? opts.countryOf : defaultCountry;
    var settings = normalizeSettings(opts.settings || {});
    var funds = normalizeSettings({ funds: opts.funds || settings.funds }).funds;
    var F = fxh(), missingRate = false;

    // CHF per 1 EUR on a date: the dated history, the given rate, today's cross.
    function chfPerEur(date) {
      var r = F && F.currencyRateAt ? F.currencyRateAt('CHF', date) : null; // EUR per 1 CHF
      if (r > 0) return 1 / r;
      if (num(opts.chfPerEur) > 0) return num(opts.chfPerEur);
      var v = F && F.quoteToEUR ? F.quoteToEUR(1, 'CHF', rate) : null;
      return v > 0 ? 1 / v : null;
    }
    function toCHF(amount, currency, date) {
      var cur = String(currency || 'EUR').toUpperCase();
      if (cur === 'CHF') return num(amount);
      var e = F && F.txToEUR ? F.txToEUR(amount, currency, date, rate, opts.fxAt).value : (cur === 'USD' ? num(amount) * rate : num(amount));
      var c = chfPerEur(date);
      if (!c) { missingRate = true; return 0; }
      return e * c;
    }

    var txs = (transactions || []).filter(function (tx) { return tx && ymd(tx.date) && ymd(tx.date) <= end; })
      .slice().sort(function (a, b) { var x = ymd(a.date), y = ymd(b.date); return x < y ? -1 : x > y ? 1 : (a.type === 'buy' ? 0 : 1) - (b.type === 'buy' ? 0 : 1); });

    // Holdings walk: moving average in CHF (for the cost fallback and the
    // tax-free gains) and FIFO dates (for the KS 36 holding period).
    var pos = {}, gains = 0, volume = 0, shortHeld = 0, derivatives = false, startSnap = null;
    var startDay = year + '-01-01';
    function keyOf(tx) { return String(tx.symbol || '').toUpperCase(); }
    function P(tx) {
      var k = keyOf(tx);
      return pos[k] || (pos[k] = { symbol: k, category: tx.category, currency: String(tx.currency || 'EUR'), qty: 0, cost: 0, lots: [], incomeA: 0, incomeB: 0 });
    }
    function snapshot() { var s = {}; Object.keys(pos).forEach(function (k) { s[k] = { qty: pos[k].qty, cost: pos[k].cost, category: pos[k].category, currency: pos[k].currency }; }); return s; }
    txs.forEach(function (tx) {
      var d = ymd(tx.date);
      if (!startSnap && d >= startDay) startSnap = snapshot();
      if (SKIP[tx.category] || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      var q = num(tx.quantity);
      if (!(q > 0)) return;
      var inYear = d.slice(0, 4) === String(year);
      if (DERIVATIVES[tx.category] && inYear) derivatives = true;
      var p = P(tx), amount = toCHF(q * num(tx.price), tx.currency, d);
      if (inYear) volume += amount;
      if (tx.type === 'buy') {
        p.qty += q; p.cost += amount; p.currency = String(tx.currency || p.currency); p.lots.push({ d: d, q: q });
        return;
      }
      var t = Math.min(q, p.qty), avg = p.qty > EPS ? p.cost / p.qty : 0;
      if (inYear) gains += amount * (t / q) - avg * t;
      p.qty -= t; p.cost -= avg * t;
      if (p.qty < EPS) { p.qty = 0; p.cost = 0; }
      var left = t;
      while (left > EPS && p.lots.length) {
        var lot = p.lots[0], u = Math.min(lot.q, left);
        if (inYear && days(lot.d, d) < HOLD_DAYS) shortHeld += u;
        lot.q -= u; left -= u;
        if (lot.q < EPS) p.lots.shift();
      }
    });
    if (!startSnap) startSnap = snapshot();

    // Value of one holding at a date: the last price (crypto in EUR, others in
    // the trade currency); without one, the cost - flagged, not guessed.
    function value(sym, h, at) {
      var px = priceAt(ph[sym] || ph[sym.toLowerCase()], at);
      if (px == null) return { v: h.cost, missing: true };
      return { v: toCHF(h.qty * px, h.category === 'crypto' ? 'EUR' : h.currency, at), missing: false };
    }

    // Income of the year, column A (Swiss, with VST) or B.
    var foreign = {};
    txs.forEach(function (tx) {
      var d = ymd(tx.date);
      if (d.slice(0, 4) !== String(year) || (tx.type !== 'dividend' && tx.type !== 'interest')) return;
      var gross = toCHF(num(tx.quantity) * num(tx.price) || num(tx.amount), tx.currency, d);
      var withheld = toCHF(Math.max(0, num(tx.withholdingTax)), tx.currency, d);
      var p = P(tx);
      if (String(tx.currency || '').toUpperCase() === 'CHF' && num(tx.withholdingTax) > 0) { p.incomeA += gross; return; }
      p.incomeB += gross;
      if (!(withheld > 0)) return;
      var c = countryOf(p.symbol) || 'unknown';
      if (c === 'CH') return;
      var f = foreign[c] || (foreign[c] = { country: c, gross: 0, withheld: 0, creditable: 0, excess: 0 });
      var cred = Math.min(withheld, DA1_CAP * gross);
      f.gross += gross; f.withheld += withheld; f.creditable += cred; f.excess += withheld - cred;
    });
    // Accumulating funds: the year's reported income for the holding.
    var fundIncome = 0;
    Object.keys(funds).forEach(function (sym) {
      var p = pos[sym], amt = funds[sym].age[String(year)];
      if (!p || amt == null) return;
      var swiss = (countryOf(sym) || (String(p.currency).toUpperCase() === 'CHF' ? 'CH' : '')) === 'CH';
      if (swiss) p.incomeA += amt; else p.incomeB += amt;
      fundIncome += amt;
    });

    var positions = [], totals = { valueCHF: 0, incomeA: 0, incomeB: 0, vstClaim: 0, fundIncome: fundIncome };
    Object.keys(pos).sort().forEach(function (k) {
      var p = pos[k];
      if (!(p.qty > EPS) && !p.incomeA && !p.incomeB) return;
      var v = p.qty > EPS ? value(k, p, end) : { v: 0, missing: false };
      positions.push({ symbol: k, category: p.category, quantity: p.qty, valueCHF: v.v, missingPrice: v.missing, incomeA: p.incomeA, incomeB: p.incomeB });
      totals.valueCHF += v.v; totals.incomeA += p.incomeA; totals.incomeB += p.incomeB;
    });
    totals.vstClaim = VST * totals.incomeA;

    // KS 36 - each criterion met, not met, to check, or unknown (no answer).
    var startValue = 0, prevEnd = (year - 1) + '-12-31';
    Object.keys(startSnap).forEach(function (k) { if (startSnap[k].qty > EPS) startValue += value(k, startSnap[k], prevEnd).v; });
    var income = totals.incomeA + totals.incomeB;
    var criteria = [
      { key: 'holding', status: shortHeld > EPS ? 'not-met' : 'met' },
      { key: 'volume', status: volume <= VOLUME_X * startValue + EPS ? 'met' : 'not-met', volume: volume, limit: VOLUME_X * startValue },
      { key: 'gains', status: settings.otherIncome == null ? 'unknown' : gains < GAINS_SHARE * (settings.otherIncome + income) ? 'met' : 'not-met' },
      { key: 'debt', status: settings.debtFinanced == null ? 'unknown' : settings.debtFinanced ? 'check' : 'met' },
      { key: 'derivatives', status: derivatives ? 'check' : 'met' }
    ];
    var st = criteria.map(function (c) { return c.status; });
    var status = st.every(function (s) { return s === 'met'; }) ? 'private'
      : st.some(function (s) { return s === 'not-met' || s === 'check'; }) ? 'check' : 'unknown';

    return {
      year: year, end: end, provisional: provisional, missingRate: missingRate, chfPerEur: chfPerEur(end),
      positions: positions, totals: totals,
      foreign: Object.keys(foreign).sort().map(function (c) { return foreign[c]; }),
      gains: { realized: gains, taxFree: true },
      ks36: { criteria: criteria, status: status }
    };
  }

  // Rows for the PDF / Excel export (value(v) formats or passes CHF numbers).
  function reportRows(d, value) {
    if (!d) return [];
    var rows = [
      [__('chValue', 'Securities and crypto at year-end (wealth)'), value(d.totals.valueCHF)],
      [__('chIncomeA', 'Income with Verrechnungssteuer (column A)'), value(d.totals.incomeA)],
      [__('chIncomeB', 'Income without Verrechnungssteuer (column B)'), value(d.totals.incomeB)],
      [__('chFundIncome', 'Of which accumulating funds'), value(d.totals.fundIncome)],
      [__('chVst', 'Verrechnungssteuer to reclaim (35 % of A)'), value(d.totals.vstClaim)],
      [__('chGains', 'Capital gains, tax-free (for information)'), value(d.gains.realized)]
    ];
    d.foreign.forEach(function (f) {
      rows.push([__('chDa1Row', 'DA-1 {c}: credit {cred}, reclaim abroad {ex}', { c: f.country, cred: value(f.creditable), ex: value(f.excess) }), value(f.gross)]);
    });
    d.positions.forEach(function (p) {
      rows.push([p.symbol + (p.missingPrice ? ' ' + __('chAtCost', '(at cost, no price)') : ''), value(p.valueCHF)]);
    });
    return rows;
  }

  function criterionLabel(key) {
    return key === 'holding' ? __('chKsHolding', 'Holding period at least 6 months')
      : key === 'volume' ? __('chKsVolume', 'Volume at most 5 x the holdings at the start of the year')
      : key === 'gains' ? __('chKsGains', 'Capital gains under 50 % of the net income')
      : key === 'debt' ? __('chKsDebt', 'Not financed with debt')
      : __('chKsDerivatives', 'Derivatives only for hedging');
  }
  function statusLabel(s) {
    return s === 'met' ? __('chMet', 'met') : s === 'not-met' ? __('chNotMet', 'not met') : s === 'check' ? __('chCheck', 'to check') : __('chUnknown', 'no answer');
  }

  // ---- panel (Tax view, Switzerland) ---------------------------------------------
  // props: { theme, report, year, privacy, onChange }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b', bad = th.danger || '#ef4444';
    var chf = function (v) { return props.privacy ? '••••••' : window.MaerminI18n.money(v, 'CHF'); };
    var d = props.report && props.report.summary && props.report.summary.swissDetail;
    var year = props.year || new Date().getFullYear();
    var s0 = useState(loadSettings); var st = s0[0], setSt = s0[1];
    var s1 = useState(''); var newSym = s1[0], setNewSym = s1[1];
    function update(next) { setSt(saveSettings(next)); if (props.onChange) props.onChange(); }
    function line(lbl, val, tid, color, strong) {
      return e('div', { 'data-testid': tid, style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.3rem 0', borderTop: '1px solid ' + border, fontSize: '0.82rem' } },
        e('span', { style: { color: dim } }, lbl), e('span', { style: { color: color || text, fontWeight: strong ? 800 : 700 } }, val));
    }
    var input = { boxSizing: 'border-box', padding: '0.35rem 0.5rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.8rem', fontFamily: 'inherit' };
    var btn = { padding: '0.35rem 0.8rem', borderRadius: '8px', border: '1px solid ' + border, background: th.inputBg, color: text, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600 };
    var sub = { color: text, fontWeight: 700, fontSize: '0.86rem', margin: '0.75rem 0 0.3rem' };
    var cell = { padding: '0.25rem 0.4rem', borderTop: '1px solid ' + border, fontSize: '0.76rem', textAlign: 'right', whiteSpace: 'nowrap' };
    var syms = Object.keys(st.funds).sort();
    var ksColor = function (s) { return s === 'met' ? good : s === 'not-met' ? bad : warn; };
    return e('div', { 'data-testid': 'ch-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('chTitle', 'Switzerland: Wertschriftenverzeichnis {y}', { y: year })),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.6rem', lineHeight: 1.5 } },
        __('chIntro', 'Year-end values in CHF for the wealth tax, gross income in column A (Swiss, with 35 % Verrechnungssteuer) or B, the foreign withholding for form DA-1. Private capital gains are tax-free. MAERMIN does not estimate the tax itself: it is cantonal and progressive.')),
      d ? e('div', null,
        d.provisional ? e('div', { 'data-testid': 'ch-provisional', style: { color: warn, fontSize: '0.76rem', marginBottom: '0.4rem' } }, __('chProvisional', 'The year is not over: values at today\'s prices.')) : null,
        d.missingRate ? e('div', { style: { color: bad, fontSize: '0.76rem', marginBottom: '0.4rem' } }, __('chNoRate', 'No CHF exchange rate: amounts in other currencies are missing.')) : null,
        line(__('chValue', 'Securities and crypto at year-end (wealth)'), chf(d.totals.valueCHF), 'ch-value', null, true),
        line(__('chIncomeA', 'Income with Verrechnungssteuer (column A)'), chf(d.totals.incomeA), 'ch-income-a'),
        line(__('chIncomeB', 'Income without Verrechnungssteuer (column B)'), chf(d.totals.incomeB), 'ch-income-b'),
        d.totals.fundIncome ? line(__('chFundIncome', 'Of which accumulating funds'), chf(d.totals.fundIncome), 'ch-fund') : null,
        line(__('chVst', 'Verrechnungssteuer to reclaim (35 % of A)'), chf(d.totals.vstClaim), 'ch-vst', good),
        line(__('chGains', 'Capital gains, tax-free (for information)'), chf(d.gains.realized), 'ch-gains', good),
        d.positions.length ? e('div', { style: { overflowX: 'auto', marginTop: '0.5rem' } },
          e('table', { 'data-testid': 'ch-positions', style: { width: '100%', borderCollapse: 'collapse', color: text } },
            e('thead', null, e('tr', null, [__('symbol', 'Symbol'), __('colQty', 'Qty'), __('chColValue', 'Value 31.12.'), 'A', 'B'].map(function (h, i) {
              return e('th', { key: i, style: Object.assign({}, cell, { color: dim, fontWeight: 600, textAlign: i ? 'right' : 'left' }) }, h);
            }))),
            e('tbody', null, d.positions.map(function (p) {
              return e('tr', { key: p.symbol },
                e('td', { style: Object.assign({}, cell, { textAlign: 'left', fontWeight: 700 }) }, p.symbol),
                e('td', { style: cell }, window.MaerminI18n.num(p.quantity, 4)),
                e('td', { style: Object.assign({}, cell, { color: p.missingPrice ? warn : text }), title: p.missingPrice ? __('chAtCost', '(at cost, no price)') : '' }, chf(p.valueCHF) + (p.missingPrice ? ' *' : '')),
                e('td', { style: cell }, p.incomeA ? chf(p.incomeA) : '–'),
                e('td', { style: cell }, p.incomeB ? chf(p.incomeB) : '–'));
            })))) : null,
        d.positions.some(function (p) { return p.missingPrice; }) ? e('div', { style: { color: warn, fontSize: '0.72rem', marginTop: '0.3rem' } }, __('chAtCostNote', '* No year-end price: valued at cost. Take the value from the ESTV Kursliste.')) : null,
        d.foreign.length ? e('div', { 'data-testid': 'ch-da1' },
          e('div', { style: sub }, __('chDa1Title', 'Form DA-1: foreign withholding')),
          d.foreign.map(function (f) {
            return line(__('chDa1Line', '{c}: gross {g}, withheld {w}', { c: f.country === 'unknown' ? __('chCountryUnknown', 'country unknown') : f.country, g: chf(f.gross), w: chf(f.withheld) }),
              __('chDa1Credit', 'credit {cred} · reclaim abroad {ex}', { cred: chf(f.creditable), ex: chf(f.excess) }), 'ch-da1-' + f.country);
          })) : null,
        e('div', { 'data-testid': 'ch-ks36' },
          e('div', { style: sub }, __('chKsTitle', 'Private asset management (ESTV Kreisschreiben 36)')),
          d.ks36.criteria.map(function (c) { return line(criterionLabel(c.key), statusLabel(c.status), 'ch-ks-' + c.key, ksColor(c.status)); }),
          e('div', { 'data-testid': 'ch-ks-status', style: { color: d.ks36.status === 'private' ? good : warn, fontSize: '0.78rem', fontWeight: 700, marginTop: '0.35rem' } },
            d.ks36.status === 'private' ? __('chKsPrivate', 'All criteria met: private asset management, gains tax-free.')
              : d.ks36.status === 'check' ? __('chKsCheck', 'Not every criterion is met: the tax office decides case by case whether this is professional trading (gains then taxable as income).')
                : __('chKsUnknownMsg', 'Answer the questions below to complete the check.'))))
        : e('div', { style: { color: dim, fontSize: '0.8rem' } }, __('chNoReport', 'Open the Tax Report to see the statement.')),
      e('div', { style: { borderTop: '1px solid ' + border, marginTop: '0.75rem', paddingTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
        e('label', { style: { color: dim, fontSize: '0.76rem' } }, __('chOtherIncome', 'Net income {y} without capital gains (CHF)', { y: year })),
        e('input', { 'data-testid': 'ch-other-income', inputMode: 'decimal', style: Object.assign({}, input, { width: '130px' }), defaultValue: st.otherIncome != null ? String(st.otherIncome) : '',
          onBlur: function (ev) { var v = parseFloat(String(ev.target.value).replace(/'/g, '').replace(',', '.')); update(Object.assign({}, st, { otherIncome: isFinite(v) ? v : null })); } }),
        e('label', { style: { color: dim, fontSize: '0.76rem' } }, __('chDebtQ', 'Investments financed with debt?')),
        e('select', { 'data-testid': 'ch-debt', style: input, value: st.debtFinanced == null ? '' : st.debtFinanced ? 'yes' : 'no',
          onChange: function (ev) { update(Object.assign({}, st, { debtFinanced: ev.target.value === 'yes' ? true : ev.target.value === 'no' ? false : null })); } },
          e('option', { value: '' }, __('chNoAnswer', '–')), e('option', { value: 'no' }, __('chNo', 'No')), e('option', { value: 'yes' }, __('chYes', 'Yes')))),
      e('div', { style: { borderTop: '1px solid ' + border, marginTop: '0.75rem', paddingTop: '0.6rem' } },
        e('div', { style: { color: text, fontWeight: 700, fontSize: '0.86rem', marginBottom: '0.3rem' } }, __('chFundsTitle', 'Accumulating funds')),
        e('div', { style: { color: dim, fontSize: '0.74rem', marginBottom: '0.5rem', lineHeight: 1.5 } },
          __('chFundsHint', 'Enter the reinvested income of {y} for your whole holding (ESTV Kursliste or the fund\'s tax report). Swiss funds go in column A, foreign funds in B.', { y: year })),
        syms.map(function (sym) {
          var f = st.funds[sym];
          return e('div', { key: sym, 'data-testid': 'ch-fund-' + sym, style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.3rem 0', borderTop: '1px solid ' + border } },
            e('span', { style: { color: text, fontWeight: 700, minWidth: '90px', fontSize: '0.8rem' } }, sym),
            e('input', { 'data-testid': 'ch-age-' + sym, inputMode: 'decimal', placeholder: __('chAgePlaceholder', 'CHF {y}', { y: year }), style: Object.assign({}, input, { width: '120px' }),
              defaultValue: f.age[String(year)] != null ? String(f.age[String(year)]) : '',
              onBlur: function (ev) { var v = parseFloat(String(ev.target.value).replace(',', '.')); var n = Object.assign({}, st.funds); var age = Object.assign({}, f.age); if (isFinite(v)) age[String(year)] = v; else delete age[String(year)]; n[sym] = { age: age }; update(Object.assign({}, st, { funds: n })); } }),
            e('button', { style: btn, onClick: function () { var n = Object.assign({}, st.funds); delete n[sym]; update(Object.assign({}, st, { funds: n })); } }, __('chRemove', 'Remove')));
        }),
        e('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          e('input', { 'data-testid': 'ch-new-fund', value: newSym, placeholder: __('chFundSymbol', 'Fund symbol, e.g. CHSPI.SW'), style: Object.assign({}, input, { flex: '1 1 160px' }), onChange: function (ev) { setNewSym(ev.target.value); } }),
          e('button', { 'data-testid': 'ch-add-fund', style: btn, onClick: function () { var s = newSym.trim().toUpperCase(); if (!s) return; var n = Object.assign({}, st.funds); n[s] = n[s] || { age: {} }; update(Object.assign({}, st, { funds: n })); setNewSym(''); } }, __('chAddFund', 'Add fund')))),
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        __('chNote', 'Helper for the Wertschriftenverzeichnis, not tax advice. Sources: Art. 16 Abs. 3, Art. 20 DBG; Art. 7, 13, 14 StHG; Art. 4 VStG; form DA-1; ESTV Kreisschreiben Nr. 36. The canton of Thurgau reads the holding period as one year, not six months. The DA-1 credit assumes a treaty residual rate of 15 %.')));
  }

  var api = { VST: VST, SETTINGS_KEY: SETTINGS_KEY, compute: compute, reportRows: reportRows,
    normalizeSettings: normalizeSettings, loadSettings: loadSettings, saveSettings: saveSettings, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminCHTax = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
