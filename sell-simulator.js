// ============================================================================
// MAERMIN — Sell simulator  (window.MaerminSellSim)
// ----------------------------------------------------------------------------
// P5-4.2. "If I sell X today": the lots the sale would consume (FIFO), the
// gain, its taxable and tax-free part, and what it does to this year's tax.
//
// The tax comes from the ONE report pipeline (MaerminTaxReport.build): the
// year is built as it is and once more with the planned sale added, and the
// simulator reports the difference. Teilfreistellung, the loss pots and the
// carry-forward, the sec. 23 Freigrenze and the Sparerpauschbetrag therefore
// work exactly as in the report. For private sales (crypto and other sec. 23
// assets) it also gives the first day the same sale would be tax-free: the
// day after the youngest consumed lot turns one year old.
//
// Nothing is stored. The pure part (simulate, holdings, freeDate) is
// Node-tested in test/sell-simulator.test.js; the Panel is browser-only.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var SIM_ID = '__maermin_sell_sim__';
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }
  function reportBuild() {
    if (typeof window !== 'undefined' && window.MaerminTaxReport) return window.MaerminTaxReport.build;
    return require('./tax-report-builder.js').build;
  }

  // First tax-free day of a sec. 23 lot: the day after the anniversary of the
  // purchase (a 29 Feb purchase has its anniversary on 28 Feb).
  function freeDate(acquiredISO) {
    var s = ymd(acquiredISO);
    var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10), d = parseInt(s.slice(8, 10), 10);
    if (!(y > 0 && m > 0 && d > 0)) return '';
    var last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    var ann = new Date(Date.UTC(y + 1, m - 1, Math.min(d, last)));
    ann.setUTCDate(ann.getUTCDate() + 1);
    return ann.toISOString().slice(0, 10);
  }

  // Open positions (as of asOf, when given): [{ category, symbol, symbolName,
  // quantity, currency }] - currency of the latest trade, for the price field.
  function holdings(transactions, asOf) {
    var txs = (transactions || []).filter(function (tx) {
      return tx && tx.category !== 'options' && (!asOf || ymd(tx.date) <= asOf);
    });
    var cur = {};
    txs.forEach(function (tx) {
      if (tx.type !== 'buy' && tx.type !== 'sell') return;
      cur[(tx.category || 'crypto') + '|' + String(tx.symbol || tx.name || '').toUpperCase()] = tx.currency || 'EUR';
    });
    return ledger().build(txs, { exchangeRate: 1 }).list.filter(function (g) { return g.openQty > 1e-9; }).map(function (g) {
      return { category: g.category, symbol: String(g.symbol || '').toUpperCase(), symbolName: g.symbolName || '', quantity: g.openQty,
        currency: cur[g.category + '|' + String(g.symbol || '').toUpperCase()] || 'EUR' };
    }).sort(function (a, b) { return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0; });
  }

  // plan: { category, symbol, quantity, price (per unit, in currency),
  //         currency, date }
  // opts: the MaerminTaxReport.build options (jurisdiction 'de'); year comes
  //       from plan.date.
  // -> { error } | { lots, proceeds, gain, kind, taxFree, taxable, taxDelta,
  //      allowanceUsed, allowanceLeftBefore, carryUsed, freigrenze, bestDate,
  //      before, after }
  function simulate(transactions, plan, opts, deps) {
    plan = plan || {};
    var build = (deps && deps.build) || reportBuild();
    var sym = String(plan.symbol || '').toUpperCase();
    var cat = plan.category || 'stocks';
    var qty = num(plan.quantity), price = num(plan.price), date = ymd(plan.date);
    if (!sym || !(qty > 0) || !(price >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'invalid' };
    var txs = transactions || [];

    // The consumed lots from the same FIFO the report uses (ledger.js): the
    // sale goes last on its date, so it takes what is left after every
    // earlier trade.
    var mine = txs.filter(function (tx) {
      return tx && (tx.category || 'crypto') === cat && String(tx.symbol || tx.name || '').toUpperCase() === sym && ymd(tx.date) <= date;
    });
    var simTx = { id: SIM_ID, type: 'sell', category: cat, symbol: sym, quantity: qty, price: price, currency: plan.currency || 'EUR', date: date };
    var L = ledger();
    var lopts = { exchangeRate: num(opts && opts.exchangeRate) || 1, fxAt: opts && opts.fxAt };
    var g0 = L.build(mine, lopts).list[0];
    if (!g0 || !(g0.openQty > 1e-9)) return { error: 'notHeld' };
    if (qty > g0.openQty + 1e-9) return { error: 'oversold', held: g0.openQty };
    var g1 = L.build(mine.concat([simTx]), lopts).list[0];
    var raw = g1.disposals.slice(g0.disposals.length);

    var year = parseInt(date.slice(0, 4), 10);
    var bopts = Object.assign({}, opts || {}, { year: year, jurisdiction: 'de' });
    var before = build(txs, bopts).summary.germanDetail;
    var after = build(txs.concat([simTx]), bopts).summary.germanDetail;
    if (!before || !after) return { error: 'noTax' };

    var dShort = num(after.crypto.netShortTermGains) - num(before.crypto.netShortTermGains);
    var dExempt = num(after.crypto.exemptLongTermGains) - num(before.crypto.exemptLongTermGains);
    var gain = raw.reduce(function (s, d) { return s + d.gain; }, 0);
    var isPrivate = Math.abs(dShort) > 1e-9 || Math.abs(dExempt) > 1e-9 || (Math.abs(gain) < 1e-9 && cat === 'crypto');
    var cryptoOff = cat === 'crypto' && opts && opts.taxSettings && opts.taxSettings.cryptoExemption === false;
    var lots = raw.map(function (d) {
      var free = isPrivate && d.longTerm && !cryptoOff;
      return { quantity: d.qty, acquisitionDate: d.acquisitionDate, costBasis: d.costBasis, proceeds: d.proceeds, gain: d.gain,
        longTerm: d.longTerm, taxFree: free, taxFreeOn: isPrivate && !free && !cryptoOff ? freeDate(d.acquisitionDate) : null };
    });
    var taxFree = isPrivate ? dExempt : num(after.teilfreistellungExempt) - num(before.teilfreistellungExempt);
    var bestDate = null;
    lots.forEach(function (l) { if (l.taxFreeOn && (!bestDate || l.taxFreeOn > bestDate)) bestDate = l.taxFreeOn; });
    var bc = before.carryUsed || {}, ac = after.carryUsed || {};
    return {
      lots: lots,
      proceeds: raw.reduce(function (s, d) { return s + d.proceeds; }, 0),
      gain: gain,
      kind: isPrivate ? 'private' : 'capital',
      taxFree: taxFree,
      taxable: isPrivate ? dShort : gain - taxFree,
      taxDelta: num(after.totalTax) - num(before.totalTax),
      allowanceUsed: num(after.sparerpauschbetragUsed) - num(before.sparerpauschbetragUsed),
      allowanceLeftBefore: Math.max(0, num(before.sparerpauschbetrag) - num(before.sparerpauschbetragUsed)),
      carryUsed: { shares: num(ac.shares) - num(bc.shares), other: num(ac.other) - num(bc.other), private: num(ac.private) - num(bc.private) },
      freigrenze: { limit: after.crypto.freigrenze, before: num(before.crypto.netShortTermGains), after: num(after.crypto.netShortTermGains),
        crosses: num(before.crypto.taxable) === 0 && num(after.crypto.taxable) > 0 },
      bestDate: bestDate,
      before: before,
      after: after
    };
  }

  // ---- panel (Tax view, German rules) ----------------------------------------
  // props: { theme, transactions, prices, exchangeRate, fxAt, formatMoney,
  //          today }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var I18N = window.MaerminI18n;
    var today = props.today || new Date().toISOString().slice(0, 10);
    var txs = props.transactions || [];
    var list = useMemo(function () { return holdings(txs, today); }, [txs, today]);
    var s0 = useState(''); var pick = s0[0], setPick = s0[1];
    var s1 = useState({ quantity: '', price: '', date: today }); var form = s1[0], setForm = s1[1];
    var s2 = useState(null); var res = s2[0], setRes = s2[1];

    var h = list.filter(function (x) { return x.category + '|' + x.symbol === pick; })[0] || null;
    function priceOf(x) {
      var p = props.prices || {};
      var v = p[x.symbol] != null ? p[x.symbol] : p[x.symbol.toLowerCase()];
      return v != null && isFinite(parseFloat(v)) ? String(Math.round(parseFloat(v) * 10000) / 10000) : '';
    }
    function choose(key) {
      setPick(key); setRes(null);
      var x = list.filter(function (y) { return y.category + '|' + y.symbol === key; })[0];
      if (x) setForm({ quantity: String(Math.round(x.quantity * 1e8) / 1e8), price: priceOf(x), date: form.date || today });
    }
    function parse(v) { var U = window.MaerminUtils; return U && U.parseDecimal ? U.parseDecimal(v) : parseFloat(v); }
    function run() {
      if (!h) return;
      var r = null;
      try {
        r = simulate(txs, { category: h.category, symbol: h.symbol, quantity: parse(form.quantity), price: parse(form.price), currency: h.currency, date: form.date },
          { baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt });
      } catch (err) { r = { error: 'noTax' }; }
      setRes(r);
    }
    var set = function (k) { return function (ev) { var o = Object.assign({}, form); o[k] = ev.target.value; setForm(o); setRes(null); }; };
    var input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.82rem', fontFamily: 'inherit' };
    var label = { display: 'block', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
    var cell = { padding: '0.35rem 0.5rem', borderTop: '1px solid ' + border, fontSize: '0.78rem', color: text, textAlign: 'right' };
    var head = { padding: '0.3rem 0.5rem', color: dim, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' };
    function line(lbl, val, color, tid) {
      return e('div', { 'data-testid': tid, style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.3rem 0', borderTop: '1px solid ' + border, fontSize: '0.82rem' } },
        e('span', { style: { color: dim } }, lbl), e('span', { style: { color: color || text, fontWeight: 700 } }, val));
    }
    var errText = res && res.error ? (res.error === 'oversold' ? __('ssOversold', 'You hold only {q}.', { q: I18N.num(res.held, { min: 0, max: 8 }) })
      : res.error === 'notHeld' ? __('ssNotHeld', 'Nothing of this holding is open on that date.')
      : res.error === 'noTax' ? __('ssNoTax', 'The tax computation is not available.')
      : __('ssInvalid', 'Enter a quantity above 0, a price and a date.')) : '';

    return e('div', { 'data-testid': 'sell-sim-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('ssTitle', 'Sell simulator')),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('ssIntro', 'What a sale would do to this year\'s tax: the lots it uses (FIFO), the gain and the extra tax, with Teilfreistellung, loss pots, the Freigrenze and the Sparerpauschbetrag as in the tax report. Nothing is booked.')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', alignItems: 'end' } },
        e('div', null, e('label', { style: label, htmlFor: 'ss-holding' }, __('ssHolding', 'Holding')),
          e('select', { id: 'ss-holding', 'data-testid': 'ss-holding', value: pick, onChange: function (ev) { choose(ev.target.value); }, style: input },
            e('option', { value: '' }, __('ssPick', 'Choose…')),
            list.map(function (x) { return e('option', { key: x.category + '|' + x.symbol, value: x.category + '|' + x.symbol }, x.symbol + ' (' + I18N.num(x.quantity, { min: 0, max: 8 }) + ')'); }))),
        e('div', null, e('label', { style: label, htmlFor: 'ss-qty' }, __('ssQuantity', 'Quantity')),
          e('input', { id: 'ss-qty', 'data-testid': 'ss-qty', inputMode: 'decimal', value: form.quantity, onChange: set('quantity'), style: input })),
        e('div', null, e('label', { style: label, htmlFor: 'ss-price' }, __('ssPrice', 'Price per unit ({cur})', { cur: h ? h.currency : 'EUR' })),
          e('input', { id: 'ss-price', 'data-testid': 'ss-price', inputMode: 'decimal', value: form.price, onChange: set('price'), style: input })),
        e('div', null, e('label', { style: label, htmlFor: 'ss-date' }, __('ssDate', 'Sale date')),
          e('input', { id: 'ss-date', 'data-testid': 'ss-date', type: 'date', value: form.date, onChange: set('date'), style: input })),
        e('button', { type: 'button', 'data-testid': 'ss-run', disabled: !h, onClick: run,
          style: { padding: '0.5rem 0.9rem', borderRadius: '8px', border: 'none', background: th.accentFill || th.accent || '#7c6cff', color: '#ffffff', fontWeight: 700, fontSize: '0.82rem', cursor: h ? 'pointer' : 'default', opacity: h ? 1 : 0.5 } },
          __('ssRun', 'Simulate'))),
      errText ? e('div', { role: 'alert', 'data-testid': 'ss-error', style: { color: warn, fontSize: '0.8rem', marginTop: '0.6rem' } }, errText) : null,
      res && !res.error ? e('div', { 'data-testid': 'ss-result', style: { marginTop: '0.9rem' } },
        e('div', { style: { overflowX: 'auto' } },
          e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            e('thead', null, e('tr', null,
              e('th', { style: Object.assign({}, head, { textAlign: 'left' }) }, __('ssBought', 'Bought')),
              e('th', { style: head }, __('ssQuantity', 'Quantity')),
              e('th', { style: head }, __('ssCost', 'Cost')),
              e('th', { style: head }, __('ssProceeds', 'Proceeds')),
              e('th', { style: head }, __('ssGain', 'Gain')),
              res.kind === 'private' ? e('th', { style: head }, __('ssTaxFreeFrom', 'Tax-free from')) : null)),
            e('tbody', null, res.lots.map(function (l, i) {
              return e('tr', { key: i },
                e('td', { style: Object.assign({}, cell, { textAlign: 'left' }) }, I18N.date(l.acquisitionDate)),
                e('td', { style: cell }, I18N.num(l.quantity, { min: 0, max: 8 })),
                e('td', { style: cell }, money(l.costBasis)),
                e('td', { style: cell }, money(l.proceeds)),
                e('td', { style: cell }, money(l.gain)),
                res.kind === 'private' ? e('td', { style: Object.assign({}, cell, { color: l.taxFree ? good : text }) }, l.taxFree ? __('ssFreeNow', 'tax-free now') : I18N.date(l.taxFreeOn)) : null);
            })))),
        e('div', { style: { marginTop: '0.6rem' } },
          line(__('ssTotalGain', 'Gain'), money(res.gain), null, 'ss-gain'),
          line(res.kind === 'private' ? __('ssFreePrivate', 'Tax-free (held over one year)') : __('ssFreeTf', 'Tax-free (Teilfreistellung)'), money(res.taxFree), good, 'ss-free'),
          line(__('ssTaxable', 'Taxable part'), money(res.taxable), null, 'ss-taxable'),
          res.kind === 'capital' ? line(__('ssAllowance', 'Sparerpauschbetrag used ({left} left before)', { left: money(res.allowanceLeftBefore) }), money(res.allowanceUsed), null, 'ss-allowance') : null,
          (res.carryUsed.shares + res.carryUsed.other + res.carryUsed.private) > 0.005 ? line(__('ssCarry', 'Loss carry-forward used'), money(res.carryUsed.shares + res.carryUsed.other + res.carryUsed.private), good, 'ss-carry') : null,
          line(__('ssTaxDelta', 'Extra tax this year'), money(res.taxDelta), res.taxDelta > 0.005 ? warn : good, 'ss-tax')),
        res.kind === 'private' && res.freigrenze.crosses ? e('div', { role: 'note', 'data-testid': 'ss-freigrenze', style: { color: warn, fontSize: '0.78rem', marginTop: '0.5rem', lineHeight: 1.5 } },
          __('ssCrosses', 'This sale lifts this year\'s private-sale gains to {after}, at or above the {limit} Freigrenze: then all of them are taxable, not just this sale.', { after: money(res.freigrenze.after), limit: money(res.freigrenze.limit) })) : null,
        res.kind === 'private' && res.bestDate ? e('div', { 'data-testid': 'ss-best', style: { color: text, fontSize: '0.8rem', marginTop: '0.5rem' } },
          __('ssBestDate', 'Sold on or after {date}, this whole sale would be tax-free (all its lots held over one year).', { date: I18N.date(res.bestDate) })) : null,
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
          __('ssNote', 'Estimate for the year of the sale date; private sales at the flat-rate estimate. Not tax advice.'))) : null);
  }

  var api = { SIM_ID: SIM_ID, freeDate: freeDate, holdings: holdings, simulate: simulate, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminSellSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
