// ============================================================================
// MAERMIN — Employee equity: employer matching  (window.MaerminEquityMatch)
// ----------------------------------------------------------------------------
// PLAN-EQUITY Package 5. Rules per ESPP plan with effective dates
// (plan.matchRules, `normalizeRule`):
//   { from, pct (e.g. 25), basis purchase_value | own_contribution | ratio,
//     ratioFree, ratioPer (X free shares per Y bought), caps { currency,
//     periodAmount, yearAmount, periodShares, yearShares }, delivery
//     immediate | vesting, vest { years, cliffMonths, freqMonths } (e.g. a
//     2-year holding period), forfeitOnLeave, forfeitOnSale, rounding }
//
//   ruleAt(plan, date)                    the rule in force on a date
//   matchFor(ev, plan, rule, used, ctx)   { units, value } for one purchase:
//       purchase_value    pct × the amount paid for the shares
//       own_contribution  pct × the own contribution (salary currency, at the
//                         purchase-day rate)
//       ratio             ratioFree per ratioPer shares bought
//     value / FMV at purchase = units (rounded down unless fractional), caps
//     per offering / calendar year in amount or shares
//   regenerate(state, opts)               a MATCH grant per purchase (id
//       <purchase>-m, parentEventId): immediate = one tranche on the purchase
//       day, vesting = its schedule from the purchase day. A sale of the
//       underlying purchase lot during the holding period forfeits the same
//       share of the unvested match (decision 7: that purchase's shares), per
//       tranche in grant.match.forfeitByStep, applied by equity-vesting.js.
//   forfeitPreview(state, transactions, sale)   what a planned sale would forfeit
//   purchaseSummary(state, ev)            own money, discount, match, "free" value
//
// Pure + Node-tested (test/equity-match.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function load(f) { try { return require(f); } catch (e) { return null; } }
  function efx() { return W.MaerminEquityFx || load('./equity-fx.js'); }
  function vest() { return W.MaerminEquityVesting || load('./equity-vesting.js'); }
  function ledger() { return W.MaerminLedger || load('./ledger.js'); }

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function pos(v) { var n = num(v); return n != null && n > 0 ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  function normalizeRule(r) {
    r = r && typeof r === 'object' ? r : {};
    var caps = r.caps || {}, v = r.vest || {};
    return {
      from: ymd(r.from) || '0000-01-01',
      pct: num(r.pct) != null && num(r.pct) >= 0 ? num(r.pct) : 0,
      basis: ['purchase_value', 'own_contribution', 'ratio'].indexOf(r.basis) > -1 ? r.basis : 'purchase_value',
      ratioFree: pos(r.ratioFree) || 1, ratioPer: pos(r.ratioPer) || 3,
      caps: { currency: typeof caps.currency === 'string' && /^[A-Z]{3}$/.test(caps.currency) ? caps.currency : null,
        periodAmount: pos(caps.periodAmount), yearAmount: pos(caps.yearAmount), periodShares: pos(caps.periodShares), yearShares: pos(caps.yearShares) },
      delivery: r.delivery === 'vesting' ? 'vesting' : 'immediate',
      vest: { years: pos(v.years) || 2, cliffMonths: num(v.cliffMonths) != null ? num(v.cliffMonths) : 24, freqMonths: pos(v.freqMonths) || 24 },
      forfeitOnLeave: r.forfeitOnLeave !== false,
      forfeitOnSale: !!r.forfeitOnSale,
      rounding: r.rounding === 'none' ? 'none' : 'floor'
    };
  }
  function rules(plan) {
    return ((plan && plan.matchRules) || []).map(normalizeRule).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  }
  function ruleAt(plan, date) {
    var out = null;
    rules(plan).forEach(function (r) { if (r.from <= date) out = r; });
    return out && (out.pct > 0 || out.basis === 'ratio') ? out : null;
  }

  // used: { year: { amount, shares }, period: { amount, shares } } in the cap currency
  function matchFor(ev, plan, rule, used, ctx) {
    var F = efx();
    if (!rule || !(ev.grossUnits > 0) || !(ev.fmv > 0)) return { units: 0, value: 0 };
    var value;
    if (rule.basis === 'ratio') {
      var u = Math.floor(ev.grossUnits / rule.ratioPer + 1e-9) * rule.ratioFree;
      value = u * ev.fmv;
    } else if (rule.basis === 'own_contribution') {
      var c = ev.contributed || {};
      var own = num(c.amount) || 0, inShare = own;
      if (c.currency && c.currency !== ev.shareCurrency) {
        var rec = ev.fx && ev.fx[c.currency];   // units of the salary currency per share-currency unit
        if (rec && rec.rate > 0) inShare = own / rec.rate;
        else { var x = F.convert(own, c.currency, ev.shareCurrency, ev.date, ctx || {}); inShare = x ? x.value : 0; }
      }
      value = inShare * rule.pct / 100;
    } else {
      value = ev.grossUnits * (ev.purchasePrice > 0 ? ev.purchasePrice : ev.fmv) * rule.pct / 100;
    }
    // caps (amount in the cap currency, else the share currency; shares)
    var capCur = rule.caps.currency || ev.shareCurrency;
    var toCap = function (v) { if (capCur === ev.shareCurrency) return v; var y = F.convert(v, ev.shareCurrency, capCur, ev.date, ctx || {}); return y ? y.value : v; };
    var fromCap = function (v) { if (capCur === ev.shareCurrency) return v; var y = F.convert(v, capCur, ev.shareCurrency, ev.date, ctx || {}); return y ? y.value : v; };
    var capped = null;
    used = used || { year: { amount: 0, shares: 0 }, period: { amount: 0, shares: 0 } };
    var room = Infinity;
    if (rule.caps.periodAmount) room = Math.min(room, rule.caps.periodAmount - used.period.amount);
    if (rule.caps.yearAmount) room = Math.min(room, rule.caps.yearAmount - used.year.amount);
    if (toCap(value) > room) { value = fromCap(Math.max(0, room)); capped = 'amount'; }
    var units = value / ev.fmv;
    var maxShares = Infinity;
    if (rule.caps.periodShares) maxShares = Math.min(maxShares, rule.caps.periodShares - used.period.shares);
    if (rule.caps.yearShares) maxShares = Math.min(maxShares, rule.caps.yearShares - used.year.shares);
    if (units > maxShares) { units = Math.max(0, maxShares); capped = 'shares'; }
    units = rule.rounding === 'none' ? units : Math.floor(units + 1e-9);
    return { units: units, value: units * ev.fmv, capped: capped, rawValue: value };
  }

  // Share of the purchase lot sold before `date` (the underlying of a match).
  function soldShare(ev, disposals, beforeDate) {
    var lotId = 'eq-' + ev.id, sold = 0;
    (disposals || []).forEach(function (d) {
      // a sell-to-cover of a later vest is no sale of these shares for the
      // plan (it sells the vested units), even where FIFO books it on them
      if (/-cover$/.test(String(d.disposalTxId || ''))) return;
      if (d.acquisitionTxId === lotId && d.disposalDate && d.disposalDate < beforeDate) sold += d.qty;
    });
    return ev.grossUnits > 0 ? Math.min(1, sold / ev.grossUnits) : 0;
  }
  function disposalsOf(transactions) {
    var L = ledger();
    if (!L) return [];
    var out = [];
    L.build(transactions || [], { perPortfolio: true }).list.forEach(function (g) { out = out.concat(g.disposals || []); });
    return out;
  }

  function regenerate(state, opts) {
    opts = opts || {};
    var out = Object.assign({}, state);
    var disposals = opts.disposals || (opts.transactions ? disposalsOf(opts.transactions) : []);
    var keepGrant = function (g) { return !(g.type === 'MATCH' && g.parentEventId && /-m$/.test(g.id)); };
    var grants = state.grants.filter(keepGrant), auto = [];
    var usedBy = {};   // planId|year / planId|offering
    state.events.filter(function (e) { return e.kind === 'purchase'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .forEach(function (ev) {
        var g = byId(state.grants, ev.grantId), plan = g && byId(state.plans, g.planId);
        var rule = plan && ruleAt(plan, ev.date);
        if (!rule) return;
        var yk = plan.id + '|' + ev.date.slice(0, 4), pk = plan.id + '|' + (ev.offeringStart || ev.date);
        var used = { year: usedBy[yk] || { amount: 0, shares: 0 }, period: usedBy[pk] || { amount: 0, shares: 0 } };
        var m = matchFor(ev, plan, rule, used, opts.fxCtx);
        var capCur = rule.caps.currency || ev.shareCurrency, F = efx();
        var mv = capCur === ev.shareCurrency ? m.value : ((F.convert(m.value, ev.shareCurrency, capCur, ev.date, opts.fxCtx || {}) || { value: m.value }).value);
        usedBy[yk] = { amount: used.year.amount + mv, shares: used.year.shares + m.units };
        usedBy[pk] = { amount: used.period.amount + mv, shares: used.period.shares + m.units };
        if (!(m.units > 0)) return;
        var id = ev.id + '-m';
        var prev = byId(state.grants, id);
        var schedule = rule.delivery === 'vesting'
          ? { years: rule.vest.years, cliffMonths: rule.vest.cliffMonths, freqMonths: rule.vest.freqMonths, start: ev.date }
          : { custom: [{ date: ev.date, pct: 100 }] };
        var mg = {
          id: id, planId: plan.id, type: 'MATCH', name: (prev && prev.name) || '', grantDate: ev.date, units: m.units, parentEventId: ev.id,
          schedule: schedule, rounding: rule.rounding === 'none' ? 'none' : 'floor_trueup', withholding: 'payroll',
          match: { value: m.value, capped: m.capped, basis: rule.basis, pct: rule.pct, forfeitOnLeave: rule.forfeitOnLeave, forfeitOnSale: rule.forfeitOnSale }
        };
        // a sale of the underlying during the holding period forfeits that share
        // of the units still unvested at the sale
        if (rule.forfeitOnSale && rule.delivery === 'vesting') {
          var V = vest(), st = V.steps(schedule, ev.date), alloc = V.allocate(m.units, st.map(function (x) { return x.pct; }), mg.rounding);
          // per tranche: the units it loses (kept = rounded down share not sold)
          var byStep = st.map(function (s, i) {
            var f = soldShare(ev, disposals, s.date);
            var kept = rule.rounding === 'none' ? alloc[i] * (1 - f) : Math.floor(alloc[i] * (1 - f) + 1e-9);
            return alloc[i] - kept;
          });
          var forfeited = byStep.reduce(function (a, x) { return a + x; }, 0);
          if (forfeited > 0) { mg.match.forfeitedBySale = forfeited; mg.match.forfeitByStep = byStep; }
        }
        auto.push(mg);
      });
    out.grants = grants.concat(auto);
    var ids = {}; out.grants.forEach(function (g) { ids[g.id] = true; });
    // tranches and events of match grants that are gone, or whose units changed, go
    var changed = {};
    auto.forEach(function (mg) { var p = byId(state.grants, mg.id); if (!p || p.units !== mg.units || JSON.stringify(p.schedule) !== JSON.stringify(mg.schedule)) changed[mg.id] = true; });
    out.tranches = state.tranches.filter(function (t) { return ids[t.grantId] && !(changed[t.grantId] && t.status !== 'forfeited'); });
    out.events = state.events.filter(function (e) { return ids[e.grantId] && !(changed[e.grantId] && e.source === 'auto'); });
    return { state: out, grants: auto.length };
  }

  // What a planned sale would forfeit: { units, perGrant: [{ grantId, units, date }] }.
  // sale = { portfolioId, symbol, quantity, date }
  function forfeitPreview(state, transactions, sale) {
    var tx = (transactions || []).concat([{ id: '__preview', type: 'sell', category: 'stocks', symbol: sale.symbol, quantity: sale.quantity,
      price: 0, currency: 'EUR', date: sale.date, portfolioId: sale.portfolioId }]);
    var after = disposalsOf(tx).filter(function (d) { return d.disposalTxId === '__preview'; });
    var total = 0, per = [];
    state.grants.forEach(function (g) {
      if (g.type !== 'MATCH' || !g.match || !g.match.forfeitOnSale || !g.parentEventId) return;
      var ev = byId(state.events, g.parentEventId);
      if (!ev) return;
      var sold = after.filter(function (d) { return d.acquisitionTxId === 'eq-' + ev.id; }).reduce(function (a, d) { return a + d.qty; }, 0);
      if (!(sold > 0)) return;
      var share = Math.min(1, sold / ev.grossUnits);
      var unvested = state.tranches.filter(function (t) { return t.grantId === g.id && t.status === 'unvested' && t.date > sale.date; })
        .reduce(function (a, t) { return a + t.units; }, 0);
      var u = g.rounding === 'none' ? unvested * share : Math.ceil(unvested * share - 1e-9);
      if (u > 0) { total += u; per.push({ grantId: g.id, units: u, purchase: ev.date }); }
    });
    return { units: total, perGrant: per };
  }

  // Own money, discount, match and the "free" value of one purchase (share currency).
  function purchaseSummary(state, ev) {
    var mg = state.grants.filter(function (g) { return g.parentEventId === ev.id && g.type === 'MATCH'; })[0];
    var paid = ev.grossUnits * (ev.purchasePrice || ev.fmv);
    var discount = (num(ev.discountAmount) || 0) + (num(ev.lookbackGain) || 0);
    var matchValue = mg ? mg.units * ev.fmv : 0;
    var free = discount + matchValue;
    return { own: paid, discount: discount, matchUnits: mg ? mg.units : 0, matchValue: matchValue, free: free, returnOnOwn: paid > 0 ? free / paid : null,
      effectiveDiscountInclMatch: (paid + free) > 0 ? free / (paid + free) * 100 : null };
  }

  // Effective discount including the match for a purchase at price p of value v.
  function effectiveInclMatch(rule, paid, fmvValue) {
    if (!rule) return paid && fmvValue ? (1 - paid / fmvValue) * 100 : null;
    var match = rule.basis === 'ratio' ? fmvValue * rule.ratioFree / rule.ratioPer : paid * rule.pct / 100;
    return (1 - paid / (fmvValue + match)) * 100;
  }

  var api = {
    normalizeRule: normalizeRule, rules: rules, ruleAt: ruleAt, matchFor: matchFor, soldShare: soldShare, disposalsOf: disposalsOf,
    regenerate: regenerate, forfeitPreview: forfeitPreview, purchaseSummary: purchaseSummary, effectiveInclMatch: effectiveInclMatch
  };
  if (typeof window !== 'undefined') window.MaerminEquityMatch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
