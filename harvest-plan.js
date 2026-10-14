// ============================================================================
// MAERMIN — Allowance harvesting plan  (window.MaerminHarvest)
// ----------------------------------------------------------------------------
// P5-4.4. A December plan: which lots to sell and buy back the same day so the
// rest of this year's Sparerpauschbetrag is used. The realised gain stays
// tax-free and the buy-back raises the cost basis, so the same gain is not
// taxed later.
//
// Candidates are shares and funds (category 'stocks') with open lots at a
// gain at today's price; crypto and other sec. 23 assets are not capital
// income and are left out. Per holding the gain of selling q units comes from
// the FIFO ledger (ledger.js: the oldest lots first), less the sell fee, after
// the fund's Teilfreistellung. The plan takes whole holdings with the largest
// taxable gain first (fewest orders) and the last one in part, in whole units
// unless the holding is fractional. It is then checked through the ONE report
// pipeline (MaerminTaxReport.build) like the sell simulator: the allowance
// actually used, the carry-forward used and the extra tax, which must stay 0.
// When the report nets losses or a carry-forward first, the plan is extended;
// when it would cause tax, it is cut back.
//
// Nothing is booked or stored. The pure part is Node-tested in
// test/harvest-plan.test.js; the Panel is browser-only. An estimate, not tax
// advice.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var SIM_PREFIX = '__maermin_harvest_';
  var EPS = 1e-9;
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }
  function germanTax() {
    if (typeof window !== 'undefined' && window.TaxCalculationEngine) return window.TaxCalculationEngine.GermanTax;
    return require('./tax-calculation-engine.js').GermanTax;
  }
  function reportBuild() {
    if (typeof window !== 'undefined' && window.MaerminTaxReport) return window.MaerminTaxReport.build;
    return require('./tax-report-builder.js').build;
  }

  // Price of one unit in EUR: EUR as is, USD with the exchange rate, other
  // currencies through MaerminFxHistory when it is loaded. Null when unknown.
  function toEUR(price, currency, date, rate) {
    var cur = String(currency || 'EUR').toUpperCase();
    if (cur === 'EUR') return price;
    if (cur === 'USD') return rate > 0 ? price * rate : null;
    var FXH = typeof window !== 'undefined' && window.MaerminFxHistory;
    if (FXH && FXH.txToEUR) { var r = FXH.txToEUR(price, cur, date, rate, null); return r && r.status !== 'unknown' ? r.value : null; }
    return null;
  }

  // One candidate holding: its open FIFO lots and how the gain of selling q
  // units grows. fee: { fixed, pct } per order in EUR.
  function candidate(g, info, o) {
    var lots = (g.openLots || []).filter(function (l) { return l.qty > EPS; });
    var held = lots.reduce(function (s, l) { return s + l.qty; }, 0);
    var whole = lots.every(function (l) { return Math.abs(l.qty - Math.round(l.qty)) < 1e-9; });
    var fee = function (q) { return q > 0 ? num(o.fee.fixed) + num(o.fee.pct) * q * info.priceEUR : 0; };
    function walk(q) {
      var left = q, gross = 0, used = [];
      for (var i = 0; i < lots.length && left > EPS; i++) {
        var take = Math.min(left, lots[i].qty);
        gross += (info.priceEUR - lots[i].unitCostEUR) * take;
        used.push({ acquisitionDate: ymd(lots[i].date), quantity: take, unitCostEUR: lots[i].unitCostEUR });
        left -= take;
      }
      var gain = gross - fee(q);
      return { gain: gain, taxable: gain * (1 - info.tf), lots: used };
    }
    // The gain is piecewise linear in q: its best point is a lot boundary.
    var best = { q: 0, taxable: 0 }, cum = 0;
    lots.forEach(function (l) {
      cum += l.qty;
      var t = walk(cum).taxable;
      if (t > best.taxable + 1e-9) best = { q: cum, taxable: t };
    });
    // The largest q in [0, best.q] whose taxable gain stays within `limit`.
    function fit(limit) {
      if (best.taxable <= limit + 1e-9) return best.q;
      var lo = 0, hi = best.q;
      for (var k = 0; k < 60; k++) { var mid = (lo + hi) / 2; if (walk(mid).taxable <= limit + 1e-9) lo = mid; else hi = mid; }
      var q = whole ? Math.floor(lo + 1e-9) : Math.floor(lo * 1e6) / 1e6;
      return walk(q).taxable <= limit + 1e-9 ? q : 0;
    }
    return { symbol: info.symbol, name: info.name, category: g.category, currency: info.currency, price: info.price, priceEUR: info.priceEUR,
      tf: info.tf, held: held, whole: whole, maxQ: best.q, maxTaxable: best.taxable, walk: walk, fee: fee, fit: fit };
  }

  // plan: { date, prices: { SYMBOL: price in the trade currency }, fee: { fixed, pct } }
  // opts: the MaerminTaxReport.build options (jurisdiction 'de').
  // -> { status: 'ok'|'none'|'nothing'|'noTax', allowanceLeft, legs, allowanceUsed,
  //      taxDelta, carryUsed, fees, taxSaved, netBenefit, feesExceed, skipped }
  function plan(transactions, p, opts, deps) {
    p = p || {}; opts = opts || {};
    var build = (deps && deps.build) || reportBuild();
    var GT = opts.germanTax || germanTax();
    var date = ymd(p.date) || new Date().toISOString().slice(0, 10);
    var year = parseInt(date.slice(0, 4), 10);
    var o = { fee: { fixed: Math.max(0, num(p.fee && p.fee.fixed)), pct: Math.max(0, num(p.fee && p.fee.pct)) } };
    var rate = num(opts.exchangeRate) || 1;
    var txs = (transactions || []).filter(function (tx) { return tx && ymd(tx.date) <= date; });
    var bopts = Object.assign({}, opts, { year: year, jurisdiction: 'de' });
    var empty = { legs: [], allowanceUsed: 0, taxDelta: 0, carryUsed: { shares: 0, other: 0, private: 0 }, fees: 0, taxSaved: 0, netBenefit: 0, feesExceed: false, skipped: [] };
    var before = build(txs, bopts).summary.germanDetail;
    if (!before) return Object.assign({ status: 'noTax', allowanceLeft: 0 }, empty);
    var R = Math.max(0, num(before.sparerpauschbetrag) - num(before.sparerpauschbetragUsed));
    if (R < 0.01) return Object.assign({ status: 'none', allowanceLeft: 0 }, empty);

    // Candidates: open 'stocks' holdings with a price and a gain to realise.
    var curOf = {}, nameOf = {};
    txs.forEach(function (tx) {
      if (tx.category !== 'stocks' || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      var s = String(tx.symbol || '').toUpperCase();
      curOf[s] = tx.currency || 'EUR'; if (tx.symbolName || tx.name) nameOf[s] = tx.symbolName || tx.name;
    });
    // The Teilfreistellung follows the fund type, read like the report does.
    var fundTypes = opts.fundTypes || (GT.loadFundTypes ? GT.loadFundTypes() : {});
    var skipped = [], cands = [];
    var groups = ledger().build(txs.filter(function (tx) { return tx.category === 'stocks'; }), { exchangeRate: rate, fxAt: opts.fxAt }).list;
    groups.forEach(function (g) {
      if (!(g.openQty > EPS)) return;
      var sym = String(g.symbol || '').toUpperCase();
      var pr = p.prices || {};
      var price = num(pr[sym] != null ? pr[sym] : pr[sym.toLowerCase()]);
      var priceEUR = price > 0 ? toEUR(price, curOf[sym], date, rate) : null;
      if (!(priceEUR > 0)) { skipped.push(sym); return; }
      var tf = GT.teilfreistellungRate(fundTypes[sym] || 'none');
      var c = candidate(g, { symbol: sym, name: nameOf[sym] || g.symbolName || sym, currency: curOf[sym] || 'EUR', price: price, priceEUR: priceEUR, tf: tf }, o);
      if (c.maxTaxable > 0.005) cands.push(c);
    });
    cands.sort(function (a, b) { return b.maxTaxable - a.maxTaxable || (a.symbol < b.symbol ? -1 : 1); });
    var capacity = cands.reduce(function (s, c) { return s + c.maxTaxable; }, 0);
    if (!cands.length) return Object.assign({ status: 'nothing', allowanceLeft: R }, empty, { skipped: skipped });

    function greedy(target) {
      var left = target, out = [];
      for (var i = 0; i < cands.length && left > 0.005; i++) {
        var q = cands[i].fit(left);
        if (!(q > EPS)) continue;
        out.push({ c: cands[i], q: q });
        left -= cands[i].walk(q).taxable;
      }
      return out;
    }
    function evaluate(legs) {
      var sells = legs.map(function (l, i) {
        var feeCur = l.c.fee(l.q) / (String(l.c.currency).toUpperCase() === 'USD' ? rate : 1);
        return { id: SIM_PREFIX + i + '__', type: 'sell', category: 'stocks', symbol: l.c.symbol, quantity: l.q, price: l.c.price, fees: feeCur, currency: l.c.currency, date: date };
      });
      var after = build(txs.concat(sells), bopts).summary.germanDetail;
      if (!after) return null;
      var bc = before.carryUsed || {}, ac = after.carryUsed || {};
      return { after: after, allowanceUsed: num(after.sparerpauschbetragUsed) - num(before.sparerpauschbetragUsed),
        left: Math.max(0, num(after.sparerpauschbetrag) - num(after.sparerpauschbetragUsed)),
        taxDelta: num(after.totalTax) - num(before.totalTax),
        carryUsed: { shares: num(ac.shares) - num(bc.shares), other: num(ac.other) - num(bc.other), private: num(ac.private) - num(bc.private) } };
    }

    // Fill the allowance; extend when the report nets losses first, cut back
    // when it would cause tax.
    var best = null, target = R, good = 0;
    for (var it = 0; it < 6; it++) {
      var legs = greedy(target), ev = evaluate(legs);
      if (!ev) break;
      if (ev.taxDelta > 0.005) {
        // Too far: the largest target between the last good one and this one
        // that still causes no tax.
        var lo = good, hi = target;
        for (var k = 0; k < 24 && hi - lo > 0.01; k++) {
          var mid = (lo + hi) / 2, l2 = greedy(mid), e2 = evaluate(l2);
          if (e2 && e2.taxDelta <= 0.005) { lo = mid; if (!best || e2.allowanceUsed > best.ev.allowanceUsed) best = { legs: l2, ev: e2 }; } else hi = mid;
        }
        break;
      }
      if (!best || ev.allowanceUsed >= best.ev.allowanceUsed) best = { legs: legs, ev: ev };
      good = target;
      if (ev.left <= 0.5 || target >= capacity - 0.005) break;
      target = Math.min(capacity, target + ev.left);
    }
    if (!best || !best.legs.length) return Object.assign({ status: 'nothing', allowanceLeft: R }, empty, { skipped: skipped });

    var k1 = opts.taxSettings && opts.taxSettings.kirchensteuer != null ? num(opts.taxSettings.kirchensteuer) : num(opts.kirchensteuerRate);
    var unitTax = GT.abgeltungsteuer(1, k1).total;
    var out = best.legs.map(function (l) {
      var w = l.c.walk(l.q);
      return { symbol: l.c.symbol, name: l.c.name, currency: l.c.currency, quantity: l.q, held: l.c.held, price: l.c.price, priceEUR: l.c.priceEUR,
        proceeds: l.q * l.c.priceEUR, gain: w.gain, taxable: w.taxable, tfRate: l.c.tf, fees: 2 * l.c.fee(l.q), lots: w.lots };
    });
    var fees = out.reduce(function (s, l) { return s + l.fees; }, 0);
    var taxSaved = Math.max(0, best.ev.allowanceUsed) * unitTax;
    return { status: 'ok', allowanceLeft: R, legs: out, allowanceUsed: best.ev.allowanceUsed, taxDelta: best.ev.taxDelta,
      carryUsed: best.ev.carryUsed, fees: fees, taxSaved: taxSaved, netBenefit: taxSaved - fees, feesExceed: taxSaved - fees < 0, skipped: skipped };
  }

  // ---- panel (Tax view, German rules) ----------------------------------------
  // props: { theme, transactions, prices, exchangeRate, fxAt, formatMoney, today, rev }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !window.MaerminTaxReport) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var I18N = window.MaerminI18n;
    var today = props.today || new Date().toISOString().slice(0, 10);
    var s0 = useState('1'); var feeFixed = s0[0], setFeeFixed = s0[1];
    var s1 = useState('0'); var feePct = s1[0], setFeePct = s1[1];
    function parse(v) { var U = window.MaerminUtils; var n = U && U.parseDecimal ? U.parseDecimal(v) : parseFloat(v); return isFinite(n) ? n : 0; }
    var res = useMemo(function () {
      try {
        return plan(props.transactions || [], { date: today, prices: props.prices || {}, fee: { fixed: parse(feeFixed), pct: parse(feePct) / 100 } },
          { baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt });
      } catch (err) { return { status: 'noTax', legs: [] }; }
    }, [props.transactions, props.prices, props.exchangeRate, props.fxAt, props.rev, feeFixed, feePct, today]);

    var input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.82rem', fontFamily: 'inherit' };
    var label = { display: 'block', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
    var cell = { padding: '0.35rem 0.5rem', borderTop: '1px solid ' + border, fontSize: '0.78rem', color: text, textAlign: 'right', whiteSpace: 'nowrap' };
    var head = { padding: '0.3rem 0.5rem', color: dim, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap' };
    function line(lbl, val, tid, color) {
      return e('div', { 'data-testid': tid, style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.3rem 0', borderTop: '1px solid ' + border, fontSize: '0.82rem' } },
        e('span', { style: { color: dim } }, lbl), e('span', { style: { color: color || text, fontWeight: 700 } }, val));
    }
    var qty = function (v) { return I18N.num(v, { min: 0, max: 8 }); };
    var msg = res.status === 'none' ? __('hvNone', 'Your Sparerpauschbetrag for this year is already used: nothing to harvest.')
      : res.status === 'nothing' ? __('hvNothing', 'No share or fund lot is at a gain at today\'s prices (the oldest lots are sold first).')
      : res.status === 'noTax' ? __('hvNoTax', 'The tax computation is not available.') : '';

    return e('div', { 'data-testid': 'harvest-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('hvTitle', 'December plan: use the Sparerpauschbetrag')),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('hvIntro', 'Sell these lots and buy them back the same day: the gain stays within this year\'s allowance and the buy-back raises your cost basis, so the same gain is not taxed later. Checked through the tax report (FIFO, Teilfreistellung, loss pots, carry-forward). Nothing is booked.')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem', maxWidth: '420px' } },
        e('div', null, e('label', { style: label, htmlFor: 'hv-fee' }, __('hvFeeFixed', 'Fee per order (EUR)')),
          e('input', { id: 'hv-fee', 'data-testid': 'hv-fee', inputMode: 'decimal', value: feeFixed, onChange: function (ev) { setFeeFixed(ev.target.value); }, style: input })),
        e('div', null, e('label', { style: label, htmlFor: 'hv-fee-pct' }, __('hvFeePct', 'Fee per order (%)')),
          e('input', { id: 'hv-fee-pct', 'data-testid': 'hv-fee-pct', inputMode: 'decimal', value: feePct, onChange: function (ev) { setFeePct(ev.target.value); }, style: input }))),
      e('div', { style: { marginTop: '0.75rem' } },
        line(__('hvLeft', 'Sparerpauschbetrag left this year'), money(res.allowanceLeft || 0), 'hv-left')),
      msg ? e('div', { 'data-testid': 'hv-msg', style: { color: dim, fontSize: '0.82rem', marginTop: '0.5rem' } }, msg) :
      e('div', { 'data-testid': 'hv-result' },
        e('div', { style: { overflowX: 'auto', marginTop: '0.5rem' } },
          e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            e('thead', null, e('tr', null, [__('hvHolding', 'Holding'), __('hvSellBuy', 'Sell and buy back'), __('hvLots', 'Lots (bought)'), __('hvGain', 'Gain'), __('hvTaxable', 'Taxable'), __('hvFees', 'Fees')].map(function (h, i) {
              return e('th', { key: i, style: Object.assign({}, head, i === 0 || i === 2 ? { textAlign: 'left' } : null) }, h);
            }))),
            e('tbody', null, res.legs.map(function (l) {
              return e('tr', { key: l.symbol, 'data-testid': 'hv-leg-' + l.symbol },
                e('td', { style: Object.assign({}, cell, { textAlign: 'left' }) }, l.symbol),
                e('td', { style: cell }, __('hvQtyOf', '{q} of {held}', { q: qty(l.quantity), held: qty(l.held) })),
                e('td', { style: Object.assign({}, cell, { textAlign: 'left', whiteSpace: 'normal', color: dim }) }, l.lots.map(function (x) { return qty(x.quantity) + ' × ' + I18N.date(x.acquisitionDate); }).join(', ')),
                e('td', { style: cell }, money(l.gain)),
                e('td', { style: cell }, money(l.taxable)),
                e('td', { style: cell }, money(l.fees)));
            })))),
        e('div', { style: { marginTop: '0.6rem' } },
          line(__('hvUsed', 'Sparerpauschbetrag used by the plan'), money(res.allowanceUsed), 'hv-used'),
          res.carryUsed && (res.carryUsed.shares + res.carryUsed.other) > 0.005 ? line(__('hvCarry', 'Loss carry-forward used'), money(res.carryUsed.shares + res.carryUsed.other), 'hv-carry') : null,
          line(__('hvExtraTax', 'Extra tax this year'), money(Math.max(0, res.taxDelta)), 'hv-tax'),
          line(__('hvFeesTotal', 'Fees (sell and buy back)'), money(res.fees), 'hv-fees'),
          line(__('hvSaved', 'Later tax avoided'), money(res.taxSaved), 'hv-saved'),
          line(__('hvNet', 'Net benefit'), money(res.netBenefit), 'hv-net', res.netBenefit >= 0 ? good : warn)),
        res.feesExceed ? e('div', { 'data-testid': 'hv-fees-exceed', style: { color: warn, fontSize: '0.8rem', marginTop: '0.5rem' } }, __('hvFeesExceed', 'The fees are higher than the tax it avoids: not worth it.')) : null),
      res.skipped && res.skipped.length ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.5rem' } }, __('hvSkipped', 'Without a current price: {list}', { list: res.skipped.join(', ') })) : null,
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        __('hvNote', 'Estimate at today\'s prices; prices move until the order is filled, so leave a little room. Shares and funds only; crypto falls under the private-sale rules. Not tax advice.')));
  }

  var api = { plan: plan, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminHarvest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
