// ============================================================================
// MAERMIN — Austrian tax on capital income  (window.MaerminATTax)
// ----------------------------------------------------------------------------
// P5-4.9. Sources approved by the owner on 2026-10-14 and checked against the
// current consolidated texts (RIS / jusline, 14.10.2026):
//
//   § 27a Abs 1 EStG 1988 (in force since 20.07.2024): a special rate of 25 %
//     on interest from deposits at banks (Z 1), 27.5 % in all other cases (Z 2)
//   § 27a Abs 4 Z 2 EStG: acquisition cost without incidental costs (fees are
//     not deductible, § 20 Abs 2); Z 3: the moving average price in euro per
//     depot and securities number; Z 3a: the same per crypto address/wallet
//     (KryptowährungsVO, BGBl. II Nr. 455/2022)
//   § 27 Abs 4a, § 27b EStG: crypto is capital income since 1.3.2022; gains
//     are taxable whatever the holding period; § 27b Abs 3 Z 2: swapping a
//     crypto for another crypto is not a realisation (EStR Rz 6178ab: the
//     given coin's cost carries over)
//   § 124b Z 384 EStG (BGBl. I Nr. 10/2022): crypto bought before 1.3.2021
//     ("Altvermögen") stays outside; its gains are not taxed (EStR Rz 6178aa:
//     kept out of the moving average; on a mixed sale the taxpayer may
//     allocate - MAERMIN allocates the Altvermögen first)
//   § 27 Abs 8 EStG, EStR 2000 Rz 6229 ff, VfGH E 1722/2020: losses offset
//     only within the same year, never against bank-deposit interest; no
//     carry-forward
//   § 186 InvFG 2011, InvFR 2018: funds' deemed distributed income
//     (ausschüttungsgleiche Erträge) is taxed when deemed received and raises
//     the cost; for a fund without a tax report ("Nichtmeldefonds") a flat
//     90 % of the year's price gain, at least 10 % of the last price, deemed
//     received on 31 December
//   Double tax treaties: foreign withholding credited up to 15 %
//
// Not modelled: derivatives/options, private sales under § 31 (physical gold,
// collectibles), the option for regular taxation (§ 27a Abs 5), the KESt the
// bank already withheld. The result is an estimate for the Veranlagung.
// Fund settings: 'maermin_at_funds' (encrypted, in the backup):
//   { SYMBOL: { type: 'melde'|'nichtmelde', age: { YYYY: EUR } } }
// Node-tested in test/at-tax.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var RATE = 0.275, RATE_BANK = 0.25, WHT_CAP = 0.15;
  var CRYPTO_CUTOFF = '2021-03-01'; // § 124b Z 384: bought before = Altvermögen
  var CAPITAL = { stocks: true, bonds: true, crypto: true };
  var FUNDS_KEY = 'maermin_at_funds';
  var EPS = 1e-9;
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function fxh() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }
  function eur(amount, tx, rate, fxAt) {
    var F = fxh();
    if (F && F.txToEUR) return F.txToEUR(amount, tx.currency, tx.date, rate, fxAt).value;
    return String(tx.currency || 'EUR').toUpperCase() === 'USD' && rate > 0 ? num(amount) * rate : num(amount);
  }

  function normalizeFunds(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var f = raw[k];
      if (!f || typeof f !== 'object') return;
      var age = {};
      Object.keys(f.age || {}).forEach(function (y) { var n = parseFloat(f.age[y]); if (/^\d{4}$/.test(y) && isFinite(n)) age[y] = r2(n); });
      out[String(k).toUpperCase()] = { type: f.type === 'nichtmelde' ? 'nichtmelde' : 'melde', age: age };
    });
    return out;
  }
  function loadFunds() { try { return normalizeFunds(localStorage.getItem(FUNDS_KEY)); } catch (e) { return {}; } }
  function saveFunds(f) { var n = normalizeFunds(f); try { localStorage.setItem(FUNDS_KEY, JSON.stringify(n)); } catch (e) { /* non-fatal */ } return n; }

  // First and last price inside a calendar year from a { timestamp, price } series.
  function yearPrices(series, year) {
    var pts = (series || []).map(function (p) { return { d: ymd(typeof p.timestamp === 'number' ? new Date(p.timestamp).toISOString() : p.timestamp), p: num(p.price) }; })
      .filter(function (p) { return p.p > 0 && p.d.slice(0, 4) === String(year); }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return pts.length ? { first: pts[0].p, last: pts[pts.length - 1].p } : null;
  }

  // opts: { year, exchangeRate, fxAt, funds, priceHistory, today }
  function compute(transactions, opts) {
    opts = opts || {};
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 1;
    var today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
    var funds = normalizeFunds(opts.funds || {});
    var txs = (transactions || []).filter(function (tx) { return tx && ymd(tx.date) && ymd(tx.date) <= year + '-12-31'; });
    var cryptoSyms = {};
    txs.forEach(function (tx) { if (tx.category === 'crypto') cryptoSyms[String(tx.symbol || '').toUpperCase()] = true; });

    // Swaps: a crypto buy priced in another crypto, with a sale of that coin
    // on the same day in the same wallet.
    var swapOf = {}, used = {};
    txs.forEach(function (b, i) {
      if (b.type !== 'buy' || b.category !== 'crypto') return;
      var cur = String(b.currency || 'EUR').toUpperCase();
      if (!cryptoSyms[cur]) return;
      for (var j = 0; j < txs.length; j++) {
        var s = txs[j];
        if (used[j] || s.type !== 'sell' || s.category !== 'crypto' || String(s.symbol || '').toUpperCase() !== cur) continue;
        if (ymd(s.date) !== ymd(b.date) || String(s.portfolioId || 'default') !== String(b.portfolioId || 'default')) continue;
        used[j] = true; swapOf[i] = j; break;
      }
    });
    var swapSell = {}; Object.keys(swapOf).forEach(function (i) { swapSell[swapOf[i]] = parseInt(i, 10); });

    // Events in date order: trades (buys before sells; a swap's sale before
    // its buy) and the funds' deemed income at each 31 December.
    var events = [];
    txs.forEach(function (tx, i) {
      if (!CAPITAL[tx.category] || (tx.type !== 'buy' && tx.type !== 'sell') || !(num(tx.quantity) > 0)) return;
      var order = tx.type === 'buy' ? (swapOf[i] != null ? 2 : 0) : (swapSell[i] != null ? 1 : 3);
      events.push({ d: ymd(tx.date), order: order, i: i, tx: tx });
    });
    var fundYears = {};
    Object.keys(funds).forEach(function (sym) {
      var first = null;
      txs.forEach(function (tx) { if (String(tx.symbol || '').toUpperCase() === sym && tx.type === 'buy' && (!first || ymd(tx.date) < first)) first = ymd(tx.date); });
      if (!first) return;
      for (var y = parseInt(first.slice(0, 4), 10); y <= year; y++) events.push({ d: y + '-12-31', order: 4, fund: sym, y: y });
    });
    events.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.order - b.order); });

    var state = {}, disposals = [], swaps = [], fundRows = [], carried = {};
    function key(tx, pool) { return String(tx.portfolioId || 'default') + '|' + tx.category + '|' + String(tx.symbol || '').toUpperCase() + (pool ? '|' + pool : ''); }
    function pos(k) { return state[k] || (state[k] = { qty: 0, cost: 0 }); }
    // Take q units out of a position at its average cost.
    function take(k, q) { var p = pos(k); var avg = p.qty > EPS ? p.cost / p.qty : 0; var t = Math.min(q, p.qty); p.qty -= t; p.cost -= avg * t; if (p.qty < EPS) { p.qty = 0; p.cost = 0; } return { qty: t, cost: avg * t }; }

    events.forEach(function (ev) {
      if (ev.fund) {
        // Deemed income of the year for every depot holding the fund.
        var held = [];
        Object.keys(state).forEach(function (k) { var parts = k.split('|'); if (parts[2] === ev.fund && state[k].qty > EPS) held.push(k); });
        var total = held.reduce(function (s, k) { return s + state[k].qty; }, 0);
        var f = funds[ev.fund], row = { symbol: ev.fund, year: ev.y, method: f.type === 'melde' ? 'reported' : 'flat', amount: 0, pending: false, missing: false };
        if (!(total > EPS)) return;
        if (f.type === 'melde') {
          row.amount = num(f.age[String(ev.y)]);
          if (!(String(ev.y) in f.age)) row.missing = true;
        } else if (today <= ev.y + '-12-31') {
          row.pending = true;
        } else {
          var yp = yearPrices((opts.priceHistory || {})[ev.fund] || (opts.priceHistory || {})[ev.fund.toLowerCase()], ev.y);
          if (!yp) row.missing = true;
          else row.amount = Math.max(0.9 * (yp.last - yp.first), 0.1 * yp.last) * total;
        }
        held.forEach(function (k) { state[k].cost += row.amount * state[k].qty / total; });
        if (ev.y === year) fundRows.push(row);
        return;
      }
      var tx = ev.tx, q = num(tx.quantity), isCrypto = tx.category === 'crypto';
      if (tx.type === 'buy') {
        var pool = isCrypto ? (ymd(tx.date) < CRYPTO_CUTOFF ? 'alt' : 'neu') : '';
        var p = pos(key(tx, pool));
        var cost = swapOf[ev.i] != null && carried[swapOf[ev.i]] != null ? carried[swapOf[ev.i]] : eur(q * num(tx.price), tx, rate, opts.fxAt);
        p.qty += q; p.cost += cost;
        if (swapOf[ev.i] != null && ymd(tx.date).slice(0, 4) === String(year)) swaps.push({ date: ymd(tx.date), from: String(tx.currency).toUpperCase(), to: String(tx.symbol || '').toUpperCase(), quantity: q, cost: cost });
        return;
      }
      // Sale: Altvermögen first for crypto, then the average-cost pool.
      var parts = isCrypto ? [take(key(tx, 'alt'), q), null] : [take(key(tx, ''), q)];
      if (isCrypto) parts[1] = take(key(tx, 'neu'), q - parts[0].qty);
      if (swapSell[ev.i] != null) { carried[ev.i] = parts.reduce(function (s, x) { return s + x.cost; }, 0); return; }
      if (ymd(tx.date).slice(0, 4) !== String(year)) return;
      var unit = eur(num(tx.price), tx, rate, opts.fxAt);
      parts.forEach(function (x, n) {
        if (!x || !(x.qty > EPS)) return;
        var proceeds = unit * x.qty;
        disposals.push({ symbol: String(tx.symbol || '').toUpperCase(), category: tx.category, symbolName: tx.symbolName || '', quantity: x.qty,
          acquisitionDate: '', disposalDate: ymd(tx.date), holdingPeriodDays: null, longTerm: false,
          proceeds: proceeds, costBasis: x.cost, gain: proceeds - x.cost, altvermoegen: isCrypto && n === 0, portfolioId: tx.portfolioId || 'default' });
      });
    });

    // Income of the year.
    var gains = 0, losses = 0, cryptoTaxable = 0, alt = 0;
    disposals.forEach(function (d) {
      if (d.altvermoegen) { alt += d.gain; return; }
      if (d.gain >= 0) gains += d.gain; else losses += d.gain;
      if (d.category === 'crypto') cryptoTaxable += d.gain;
    });
    var dividends = 0, secInterest = 0, bankInterest = 0, creditable = 0;
    txs.forEach(function (tx) {
      if (ymd(tx.date).slice(0, 4) !== String(year)) return;
      if (tx.type !== 'dividend' && tx.type !== 'interest') return;
      var gross = eur(num(tx.quantity) * num(tx.price) || num(tx.amount), tx, rate, opts.fxAt);
      if (tx.type === 'dividend') {
        dividends += gross;
        var w = eur(Math.max(0, num(tx.withholdingTax)), tx, rate, opts.fxAt);
        creditable += Math.min(w, WHT_CAP * gross);
      } else if (tx.category === 'bonds' || tx.category === 'stocks') secInterest += gross;
      else bankInterest += gross;
    });
    var fundIncome = fundRows.reduce(function (s, f) { return s + f.amount; }, 0);
    var pool = gains + losses + dividends + secInterest + fundIncome;
    var lossesLost = pool < 0 ? -pool : 0;
    pool = Math.max(0, pool);
    var credit = Math.min(creditable, RATE * Math.min(dividends, pool));
    var tax27 = Math.max(0, RATE * pool - credit), tax25 = RATE_BANK * Math.max(0, bankInterest);
    return {
      year: year, method: 'moving-average', disposals: disposals, swaps: swaps, funds: fundRows,
      gains: r2(gains), losses: r2(losses), dividends: r2(dividends), securitiesInterest: r2(secInterest), bankInterest: r2(bankInterest),
      fundIncome: r2(fundIncome), cryptoTaxable: r2(cryptoTaxable), altvermoegenExempt: r2(alt),
      pool27: r2(pool), lossesLost: r2(lossesLost), taxableIncome: r2(pool + bankInterest),
      withholdingCredit: r2(credit), tax27: r2(tax27), tax25: r2(tax25), tax: r2(tax27 + tax25)
    };
  }

  // Rows for the PDF / Excel export (value(v) formats or passes numbers).
  function reportRows(d, value) {
    if (!d) return [];
    return [
      [__('atGains', 'Realised gains (moving average, no fees)'), value(d.gains)],
      [__('atLosses', 'Realised losses'), value(d.losses)],
      [__('atDividends', 'Dividends (gross)'), value(d.dividends)],
      [__('atSecInterest', 'Interest on securities'), value(d.securitiesInterest)],
      [__('atFundIncome', 'Funds: ausschüttungsgleiche Erträge'), value(d.fundIncome)],
      [__('atCrypto', 'Of which crypto (Neuvermögen)'), value(d.cryptoTaxable)],
      [__('atAlt', 'Crypto Altvermögen, tax-free'), value(d.altvermoegenExempt)],
      [__('atLost', 'Losses not offset (lost, no carry-forward)'), value(d.lossesLost)],
      [__('atPool', 'Income at 27.5 %'), value(d.pool27)],
      [__('atCredit', 'Foreign withholding credited (max. 15 %)'), value(-d.withholdingCredit)],
      [__('atTax27', 'Tax at 27.5 %'), value(d.tax27)],
      [__('atBank', 'Bank interest at 25 %'), value(d.bankInterest)],
      [__('atTax25', 'Tax at 25 %'), value(d.tax25)],
      [__('atTotal', 'Estimated tax'), value(d.tax)]
    ];
  }

  // ---- panel (Tax view, Austria) -------------------------------------------------
  // props: { theme, report, transactions, year, formatMoney, onChange }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var d = props.report && props.report.summary && props.report.summary.austrianDetail;
    var year = props.year || new Date().getFullYear();
    var s0 = useState(loadFunds); var funds = s0[0], setFunds = s0[1];
    var s1 = useState(''); var newSym = s1[0], setNewSym = s1[1];
    function update(next) { setFunds(saveFunds(next)); if (props.onChange) props.onChange(); }
    function line(lbl, val, tid, color, strong) {
      return e('div', { 'data-testid': tid, style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.3rem 0', borderTop: '1px solid ' + border, fontSize: '0.82rem' } },
        e('span', { style: { color: dim } }, lbl), e('span', { style: { color: color || text, fontWeight: strong ? 800 : 700 } }, val));
    }
    var input = { boxSizing: 'border-box', padding: '0.35rem 0.5rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.8rem', fontFamily: 'inherit' };
    var btn = { padding: '0.35rem 0.8rem', borderRadius: '8px', border: '1px solid ' + border, background: th.inputBg, color: text, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600 };
    var syms = Object.keys(funds).sort();
    return e('div', { 'data-testid': 'at-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('atTitle', 'Austria: tax on capital income {y}', { y: year })),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.6rem', lineHeight: 1.5 } },
        __('atIntro', '27.5 % on gains, dividends, interest on securities, fund income and crypto; 25 % on bank interest. Cost is the moving average per depot (crypto: per wallet) without fees; losses offset only within the year.')),
      d ? e('div', null,
        line(__('atGains', 'Realised gains (moving average, no fees)'), money(d.gains), 'at-gains'),
        line(__('atLosses', 'Realised losses'), money(d.losses), 'at-losses'),
        line(__('atDividends', 'Dividends (gross)'), money(d.dividends), 'at-div'),
        d.securitiesInterest ? line(__('atSecInterest', 'Interest on securities'), money(d.securitiesInterest), 'at-sec') : null,
        line(__('atFundIncome', 'Funds: ausschüttungsgleiche Erträge'), money(d.fundIncome), 'at-fund'),
        line(__('atCrypto', 'Of which crypto (Neuvermögen)'), money(d.cryptoTaxable), 'at-crypto'),
        d.altvermoegenExempt ? line(__('atAlt', 'Crypto Altvermögen, tax-free'), money(d.altvermoegenExempt), 'at-alt', good) : null,
        d.lossesLost > 0 ? line(__('atLost', 'Losses not offset (lost, no carry-forward)'), money(d.lossesLost), 'at-lost', warn) : null,
        line(__('atPool', 'Income at 27.5 %'), money(d.pool27), 'at-pool'),
        d.withholdingCredit ? line(__('atCredit', 'Foreign withholding credited (max. 15 %)'), '-' + money(d.withholdingCredit), 'at-credit', good) : null,
        d.bankInterest ? line(__('atBank', 'Bank interest at 25 %'), money(d.bankInterest), 'at-bank') : null,
        line(__('atTotal', 'Estimated tax'), money(d.tax), 'at-total', warn, true),
        d.swaps.length ? e('div', { style: { color: dim, fontSize: '0.74rem', marginTop: '0.4rem' } }, __('atSwaps', 'Crypto swaps this year (not taxed, cost carried over): {list}', { list: d.swaps.map(function (s) { return s.from + ' → ' + s.to; }).join(', ') })) : null)
        : e('div', { style: { color: dim, fontSize: '0.8rem' } }, __('atNoReport', 'Open the Tax Report to see the computation.')),
      e('div', { style: { borderTop: '1px solid ' + border, marginTop: '0.75rem', paddingTop: '0.6rem' } },
        e('div', { style: { color: text, fontWeight: 700, fontSize: '0.86rem', marginBottom: '0.3rem' } }, __('atFundsTitle', 'Funds')),
        e('div', { style: { color: dim, fontSize: '0.74rem', marginBottom: '0.5rem', lineHeight: 1.5 } },
          __('atFundsHint', 'Meldefonds: enter the ausschüttungsgleiche Erträge of {y} for your whole holding from the OeKB (profitweb.at). Nichtmeldefonds: 90 % of the year\'s price gain, at least 10 % of the last price, counted on 31 December.', { y: year })),
        syms.map(function (sym) {
          var f = funds[sym], row = (d && d.funds || []).filter(function (x) { return x.symbol === sym; })[0];
          return e('div', { key: sym, 'data-testid': 'at-fund-' + sym, style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.3rem 0', borderTop: '1px solid ' + border } },
            e('span', { style: { color: text, fontWeight: 700, minWidth: '90px', fontSize: '0.8rem' } }, sym),
            e('select', { value: f.type, style: input, 'aria-label': __('atFundType', 'Fund type'), onChange: function (ev) { var n = Object.assign({}, funds); n[sym] = Object.assign({}, f, { type: ev.target.value }); update(n); } },
              e('option', { value: 'melde' }, __('atMelde', 'Meldefonds')), e('option', { value: 'nichtmelde' }, __('atNichtmelde', 'Nichtmeldefonds'))),
            f.type === 'melde' ? e('input', { 'data-testid': 'at-age-' + sym, inputMode: 'decimal', placeholder: __('atAgePlaceholder', 'EUR {y}', { y: year }), style: Object.assign({}, input, { width: '120px' }),
              defaultValue: f.age[String(year)] != null ? String(f.age[String(year)]) : '',
              onBlur: function (ev) { var v = parseFloat(String(ev.target.value).replace(',', '.')); var n = Object.assign({}, funds); var age = Object.assign({}, f.age); if (isFinite(v)) age[String(year)] = v; else delete age[String(year)]; n[sym] = Object.assign({}, f, { age: age }); update(n); } }) : null,
            row ? e('span', { style: { color: row.missing || row.pending ? warn : dim, fontSize: '0.74rem' } },
              row.pending ? __('atPending', 'counted on 31 December') : row.missing ? __('atMissing', 'no figure for {y}', { y: year }) : money(row.amount)) : null,
            e('button', { style: btn, onClick: function () { var n = Object.assign({}, funds); delete n[sym]; update(n); } }, __('atRemove', 'Remove')));
        }),
        e('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          e('input', { 'data-testid': 'at-new-fund', value: newSym, placeholder: __('atFundSymbol', 'Fund symbol, e.g. VWCE.DE'), style: Object.assign({}, input, { flex: '1 1 160px' }), onChange: function (ev) { setNewSym(ev.target.value); } }),
          e('button', { 'data-testid': 'at-add-fund', style: btn, onClick: function () { var s = newSym.trim().toUpperCase(); if (!s) return; var n = Object.assign({}, funds); n[s] = n[s] || { type: 'melde', age: {} }; update(n); setNewSym(''); } }, __('atAddFund', 'Add fund')))),
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        __('atNote', 'Estimate for the tax return (Veranlagung); your Austrian bank withholds the KESt itself. Sources: § 27, § 27a, § 27b, § 124b Z 384 EStG 1988; § 186 InvFG 2011; EStR 2000. Not modelled: derivatives, private sales (§ 31), regular taxation option. Not tax advice.')));
  }

  var api = { RATE: RATE, RATE_BANK: RATE_BANK, FUNDS_KEY: FUNDS_KEY, compute: compute, reportRows: reportRows,
    normalizeFunds: normalizeFunds, loadFunds: loadFunds, saveFunds: saveFunds, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminATTax = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
