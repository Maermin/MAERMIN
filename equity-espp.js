// ============================================================================
// MAERMIN — Employee equity: ESPP  (window.MaerminEquityEspp)
// ----------------------------------------------------------------------------
// PLAN-EQUITY Package 4: variable contributions from the income timeline,
// caps, purchases with discount and lookback, carry-over and refunds.
//
// Settings live on the ESPP grant (grant.contribution, `normalizeSettings`):
//   anchor (first offering start), periodMonths (6), endDate (enrolment end),
//   discountPct (15), lookback (true), pctHistory [{ from, pct }],
//   midPeriodDecrease (false: the % changes only at an offering start),
//   withdrawals [{ date }] (contributions stop; the period's cash is refunded),
//   eligible base | base_bonus | custom + customKinds { base, bonus, 13th, other },
//   caps { currency, periodAmount, yearAmount, periodShares, yearShares,
//          offeringFmvYearAmount (a US §423-style limit valued at the offering-
//          start FMV, 26 U.S.C. § 423(b)(8); a plan parameter, not a default),
//          excess carry | refund },
//   fxMode purchase | monthly, leftover carry | refund, fractional (false =
//   whole shares), sellImmediately, actuals { 'YYYY-MM': deduction from the
//   payslip }, salePrices { purchaseDate: price } (sale right after purchase)
//
//   monthIncome(entries, 'YYYY-MM')       { byKind, currency } salary of a month:
//       base pay prorated by day (raises mid-month, part-time via FTE %, leave
//       = an entry of 0), one-offs (bonus, 13th salary) in their month
//   eligibleOf(income, settings)          pay the % applies to
//   pctAt(settings, date, offeringStart)  contribution % of a month
//   offerings(settings, toISO)            [{ index, start, end }] (end = purchase date)
//   purchasePrice(d, lookback, fmvStart, fmvEnd)
//   schedule(state, grant, opts)          every offering up to today: months with
//       calculated vs confirmed amounts, caps (headroom, warnings), cash, the
//       purchase (shares, price, discount, lookback gain, effective discount,
//       FX effect, refund / carry) and the open offering's cash
//   regenerate(state, opts)               auto purchase events for past offerings
//   returnOnCash(grant, sched, fxRecord)  XIRR of the contributions (salary and base)
//
// opts: { today, income: entries, closes(ticker), fxCtx, targets, base }
// Pure + Node-tested (test/equity-espp.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function load(f) { try { return require(f); } catch (e) { return null; } }
  function efx() { return W.MaerminEquityFx || load('./equity-fx.js'); }
  function vest() { return W.MaerminEquityVesting || load('./equity-vesting.js'); }
  function ret() { return W.MaerminReturns || load('./returns-engine.js'); }

  var DAY = 86400000;
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function pos(v) { var n = num(v); return n != null && n > 0 ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && isFinite(Date.parse(s + 'T00:00:00Z')) ? s : null; }
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function isoOf(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function ym(iso) { return iso.slice(0, 7); }
  function monthStart(m) { return m + '-01'; }
  function monthEnd(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
  function nextMonth(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? (y + 1) + '-01' : y + '-' + String(mo + 1).padStart(2, '0'); }
  function addMonths(iso, n) { var V = vest(); return V.addMonths(iso, n); }
  function r2(x) { return Math.round(x * 100) / 100; }

  // ---- settings ------------------------------------------------------------------
  function normalizeSettings(c, grantDate) {
    c = c && typeof c === 'object' ? c : {};
    var caps = c.caps && typeof c.caps === 'object' ? c.caps : {};
    var kinds = c.customKinds && typeof c.customKinds === 'object' ? c.customKinds : {};
    var pctHistory = (Array.isArray(c.pctHistory) ? c.pctHistory : []).map(function (p) {
      var from = ymd(p && p.from), pct = num(p && p.pct);
      return from && pct != null && pct >= 0 && pct <= 100 ? { from: from, pct: pct } : null;
    }).filter(Boolean).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var actuals = {};
    Object.keys(c.actuals || {}).forEach(function (k) { var v = num(c.actuals[k]); if (/^\d{4}-\d{2}$/.test(k) && v != null && v >= 0) actuals[k] = v; });
    var salePrices = {};
    Object.keys(c.salePrices || {}).forEach(function (k) { var v = pos(c.salePrices[k]); if (ymd(k) && v) salePrices[k] = v; });
    var disc = num(c.discountPct);
    return {
      anchor: ymd(c.anchor) || ymd(grantDate),
      periodMonths: pos(c.periodMonths) ? Math.round(c.periodMonths) : 6,
      endDate: ymd(c.endDate),
      discountPct: disc != null && disc >= 0 && disc < 100 ? disc : 15,
      lookback: c.lookback !== false,
      pctHistory: pctHistory,
      midPeriodDecrease: !!c.midPeriodDecrease,
      withdrawals: (Array.isArray(c.withdrawals) ? c.withdrawals : []).map(function (w) { return ymd(w && w.date); }).filter(Boolean).sort(),
      eligible: ['base', 'base_bonus', 'custom'].indexOf(c.eligible) > -1 ? c.eligible : 'base',
      customKinds: { base: kinds.base !== false, bonus: !!kinds.bonus, '13th': !!kinds['13th'], other: !!kinds.other },
      caps: {
        currency: typeof caps.currency === 'string' && /^[A-Z]{3}$/.test(caps.currency) ? caps.currency : null,
        periodAmount: pos(caps.periodAmount), yearAmount: pos(caps.yearAmount),
        periodShares: pos(caps.periodShares), yearShares: pos(caps.yearShares),
        offeringFmvYearAmount: pos(caps.offeringFmvYearAmount),
        excess: caps.excess === 'carry' ? 'carry' : 'refund'
      },
      fxMode: c.fxMode === 'monthly' ? 'monthly' : 'purchase',
      leftover: c.leftover === 'refund' ? 'refund' : 'carry',
      fractional: !!c.fractional,
      sellImmediately: !!c.sellImmediately,
      actuals: actuals,
      salePrices: salePrices
    };
  }

  // ---- income ---------------------------------------------------------------------
  // Monthly pay of one entry (FTE applied).
  function perMonth(e) { return (e.period === 'year' ? e.amount / 12 : e.amount) * (e.ftePct != null ? e.ftePct : 100) / 100; }
  function monthIncome(entries, m) {
    var start = monthStart(m), end = monthEnd(m), days = dayNo(end) - dayNo(start) + 1;
    var byKind = { base: 0, bonus: 0, '13th': 0, other: 0 }, currency = null;
    var list = (entries || []).filter(Boolean);
    // base pay: per day the latest base entry in force, prorated
    var bases = list.filter(function (e) { return e.kind === 'base'; });
    var used = {};
    for (var d = dayNo(start); d <= dayNo(end); d++) {
      var iso = isoOf(d), pick = null;
      bases.forEach(function (e) { if (e.from <= iso && (!e.to || e.to >= iso) && (!pick || e.from > pick.from)) pick = e; });
      if (pick) used[pick.id] = (used[pick.id] || 0) + 1;
    }
    Object.keys(used).forEach(function (id) {
      var e = bases.filter(function (x) { return x.id === id; })[0];
      byKind.base += perMonth(e) * used[id] / days;
      currency = currency || e.currency;
    });
    // one-offs in their month; recurring non-base pay per month in force
    list.forEach(function (e) {
      if (e.kind === 'base') return;
      var inMonth = e.period === 'once' ? (e.from >= start && e.from <= end) : (e.from <= end && (!e.to || e.to >= start));
      if (!inMonth) return;
      byKind[e.kind] = (byKind[e.kind] || 0) + (e.period === 'once' ? e.amount : perMonth(e));
      currency = currency || e.currency;
    });
    return { byKind: byKind, currency: currency };
  }
  function eligibleOf(inc, s) {
    var k = inc.byKind;
    if (s.eligible === 'base') return k.base;
    if (s.eligible === 'base_bonus') return k.base + k.bonus;
    return Object.keys(k).reduce(function (a, key) { return a + (s.customKinds[key] ? k[key] : 0); }, 0);
  }
  function pctOn(s, date) {
    var p = 0;
    s.pctHistory.forEach(function (h) { if (h.from <= date) p = h.pct; });
    return p;
  }
  // Fixed at the offering start; a later decrease counts only when allowed.
  function pctAt(s, date, offeringStart) {
    var atStart = pctOn(s, offeringStart);
    if (!s.midPeriodDecrease) return atStart;
    return Math.min(atStart, pctOn(s, date));
  }

  // ---- offerings ------------------------------------------------------------------------
  function offerings(s, toISO) {
    var out = [];
    if (!s.anchor) return out;
    for (var i = 0; i < 400; i++) {
      var start = addMonths(s.anchor, i * s.periodMonths);
      if (toISO && start > toISO) break;
      if (s.endDate && start > s.endDate) break;
      var end = isoOf(dayNo(addMonths(s.anchor, (i + 1) * s.periodMonths)) - 1);
      out.push({ index: i, start: start, end: end });
    }
    return out;
  }

  function purchasePrice(discountPct, lookback, fmvStart, fmvEnd) {
    var base = lookback && fmvStart > 0 ? Math.min(fmvStart, fmvEnd) : fmvEnd;
    return { base: base, price: base * (1 - discountPct / 100) };
  }

  // ---- the schedule ---------------------------------------------------------------------
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  function schedule(state, grant, opts) {
    opts = opts || {};
    var F = efx(), V = vest();
    var today = ymd(opts.today) || isoOf(Math.floor(Date.now() / DAY));
    var plan = byId(state.plans, grant.planId);
    var s = normalizeSettings(grant.contribution, grant.grantDate);
    var fxCtx = opts.fxCtx || {};
    var series = opts.closes && plan ? opts.closes(plan.ticker) : null;
    var share = plan ? plan.shareCurrency : 'USD';
    var capCur = s.caps.currency;
    var events = state.events.filter(function (e) { return e.grantId === grant.id && e.kind === 'purchase'; });
    // opts.from: leave out offerings that end before it; opts.carryIn = { amount,
    // currency }: the cash the first included offering starts with (the forecast)
    var out = [], carry = 0, carryCur = null, yearUsed = {}, yearShares = {}, yearFmvValue = {}, missing = [];
    var from = ymd(opts.from), firstIncluded = true;
    var withdrawnAt = s.withdrawals[0] || null, stopped = false;
    offerings(s, today).forEach(function (o) {
      if (stopped) return;   // a withdrawal ends the enrolment
      if (from && o.end < from) return;
      if (firstIncluded) { firstIncluded = false; if (opts.carryIn && opts.carryIn.amount > 0) { carry = opts.carryIn.amount; carryCur = opts.carryIn.currency; } }
      var row = { index: o.index, start: o.start, end: o.end, months: [], warnings: [], carryIn: carry, carryInCurrency: carryCur,
        status: o.end <= today ? 'done' : 'open', purchase: null, refund: 0, carryOut: 0, currency: null };
      var periodUsed = 0, cash = carry, cur = carryCur;
      var m = ym(o.start), lastM = ym(o.end);
      while (m <= lastM) {
        var mEnd = monthEnd(m) < o.end ? monthEnd(m) : o.end;
        if (mEnd > today) break;                                    // future months: the forecast
        var withdrawn = withdrawnAt && withdrawnAt <= mEnd;
        var inc = monthIncome(opts.income, m);
        var pct = withdrawn ? 0 : pctAt(s, monthStart(m) > o.start ? monthStart(m) : o.start, o.start);
        var calc = r2(eligibleOf(inc, s) * pct / 100);
        var actual = s.actuals[m];
        var amount = withdrawn ? 0 : actual != null ? actual : calc;
        var mc = inc.currency || plan.salaryCurrency;
        cur = cur || mc;
        // caps in the cap currency (default: the salary currency) at the month-end rate
        var toCap = function (a) { if (!capCur || capCur === mc) return a; var c = F.convert(a, mc, capCur, mEnd, fxCtx); return c ? c.value : a; };
        var fromCap = function (a) { if (!capCur || capCur === mc) return a; var c = F.convert(a, capCur, mc, mEnd, fxCtx); return c ? c.value : a; };
        var y = m.slice(0, 4), inCap = toCap(amount), excess = 0;
        var room = Infinity;
        if (s.caps.periodAmount) room = Math.min(room, s.caps.periodAmount - periodUsed);
        if (s.caps.yearAmount) room = Math.min(room, s.caps.yearAmount - (yearUsed[y] || 0));
        if (inCap > room + 1e-9) {
          excess = fromCap(inCap - Math.max(0, room));
          row.warnings.push({ month: m, kind: inc.byKind.bonus + inc.byKind['13th'] > 0 ? 'bonusOverCap' : 'overCap', excess: r2(excess), currency: mc });
          inCap = Math.max(0, room);
        }
        periodUsed += inCap; yearUsed[y] = (yearUsed[y] || 0) + inCap;
        var kept = amount - excess;
        cash += kept;
        if (excess > 0) { if (s.caps.excess === 'carry') row.carryOut += excess; else row.refund += excess; }
        row.months.push({ month: m, date: mEnd, income: inc, eligible: r2(eligibleOf(inc, s)), pct: pct, calculated: calc, actual: actual != null ? actual : null,
          amount: r2(amount), kept: r2(kept), confirmed: actual != null, withdrawn: !!withdrawn, currency: mc });
        m = nextMonth(m);
      }
      row.currency = cur || plan.salaryCurrency;
      row.headroom = {
        period: s.caps.periodAmount ? r2(s.caps.periodAmount - periodUsed) : null,
        year: s.caps.yearAmount ? r2(s.caps.yearAmount - (yearUsed[o.end.slice(0, 4)] || 0)) : null,
        currency: capCur || row.currency
      };
      row.contributed = r2(row.months.reduce(function (a, x) { return a + x.kept; }, 0));
      row.cash = r2(cash);
      if (row.status === 'open') { out.push(row); carry = 0; return; }
      // withdrawn in this period: no purchase, all cash back
      if (withdrawnAt && withdrawnAt <= o.end) {
        row.refund = r2(row.refund + cash); row.cash = 0; row.status = 'withdrawn';
        out.push(row); carry = 0; carryCur = null; stopped = true;
        return;
      }
      // the purchase: a manual / imported event for this offering wins
      var manual = events.filter(function (e) { return e.offeringStart === o.start && e.source !== 'auto'; })[0];
      var startPx = V.fmvOn(series, o.start, 'close'), endPx = V.fmvOn(series, o.end, 'close');
      if (manual) {
        row.purchase = { event: manual, units: manual.grossUnits, price: manual.purchasePrice, fmvStart: manual.fmvStart, fmvEnd: manual.fmv, manual: true };
        row.refund += num(manual.refund) || 0; row.carryOut += num(manual.carry) || 0;
      } else if (!endPx || (s.lookback && !startPx)) {
        missing.push({ start: o.start, end: o.end, reason: 'price' });
      } else {
        var fx = F.record(share, ['EUR', row.currency].concat(opts.targets || []), o.end, fxCtx);
        var shareCash;
        if (row.currency === share) shareCash = cash;
        else if (s.fxMode === 'monthly') {
          shareCash = (carry > 0 ? (F.convert(carry, row.currency, share, o.start, fxCtx) || { value: 0 }).value : 0)
            + row.months.reduce(function (a, x) { var c = F.convert(x.kept, x.currency, share, x.date, fxCtx); return a + (c ? c.value : 0); }, 0);
        } else {
          var c = F.convert(cash, row.currency, share, o.end, fxCtx);
          shareCash = c ? c.value : null;
        }
        var atEnd = row.currency === share ? cash : (F.convert(cash, row.currency, share, o.end, fxCtx) || { value: null }).value;
        if (shareCash == null || (share !== 'EUR' && !fx.EUR)) { missing.push({ start: o.start, end: o.end, reason: 'fx' }); out.push(row); carry = 0; return; }
        var pp = purchasePrice(s.discountPct, s.lookback, startPx ? startPx.fmv : null, endPx.fmv);
        var units = shareCash / pp.price;
        if (!s.fractional) units = Math.floor(units + 1e-9);
        else units = Math.floor(units * 1e4 + 1e-9) / 1e4;
        // share caps: per offering, per calendar year, and the offering-start FMV limit
        var y2 = o.end.slice(0, 4), capReason = null;
        if (s.caps.periodShares && units > s.caps.periodShares) { units = s.caps.periodShares; capReason = 'periodShares'; }
        if (s.caps.yearShares && units > s.caps.yearShares - (yearShares[y2] || 0)) { units = Math.max(0, s.caps.yearShares - (yearShares[y2] || 0)); capReason = 'yearShares'; }
        if (s.caps.offeringFmvYearAmount && startPx) {
          var lim = (s.caps.offeringFmvYearAmount - (yearFmvValue[y2] || 0)) / startPx.fmv;
          if (units > lim) { units = Math.max(0, s.fractional ? lim : Math.floor(lim + 1e-9)); capReason = 'offeringFmv'; }
        }
        yearShares[y2] = (yearShares[y2] || 0) + units;
        if (startPx) yearFmvValue[y2] = (yearFmvValue[y2] || 0) + units * startPx.fmv;
        var spent = units * pp.price;
        var leftShare = Math.max(0, shareCash - spent);
        var back = row.currency === share ? leftShare : (F.convert(leftShare, share, row.currency, o.end, fxCtx) || { value: 0 }).value;
        if (s.leftover === 'carry' && !capReason) row.carryOut += back; else row.refund += back;
        if (capReason) row.warnings.push({ month: ym(o.end), kind: capReason, excess: r2(back), currency: row.currency });
        var benefit = units * (endPx.fmv - pp.price);
        row.purchase = {
          units: units, price: pp.price, base: pp.base, fmvStart: startPx ? startPx.fmv : null, fmvEnd: endPx.fmv, fmvEndDate: endPx.date, fx: fx,
          spentShare: spent, discountAmount: units * (pp.base - pp.price), lookbackGain: units * (endPx.fmv - pp.base),
          benefit: benefit, effectiveDiscountPct: endPx.fmv > 0 ? (endPx.fmv - pp.price) / endPx.fmv * 100 : 0,
          // FX effect: monthly conversion vs. all at the purchase-date rate (share currency)
          fxEffect: s.fxMode === 'monthly' && atEnd != null ? shareCash - atEnd : 0,
          valueAtPurchase: units * endPx.fmv, salePrice: s.salePrices[o.end] || null, sellImmediately: s.sellImmediately
        };
      }
      row.refund = r2(row.refund); row.carryOut = r2(row.carryOut);
      out.push(row);
      carry = row.carryOut; carryCur = row.currency;
    });
    var open = out.filter(function (r) { return r.status === 'open'; })[0] || null;
    return { settings: s, offerings: out, open: open, cash: open ? open.cash : 0, cashCurrency: open ? open.currency : plan.salaryCurrency, missing: missing };
  }

  // The purchase event of a computed offering (auto, linked by offeringStart).
  function eventOf(grant, plan, row) {
    var p = row.purchase;
    return {
      id: grant.id + '-p' + (row.index + 1), kind: 'purchase', grantId: grant.id, date: row.end, offeringStart: row.start,
      fmv: p.fmvEnd, fmvSource: p.fmvEndDate === row.end ? 'close' : 'prevClose', fmvDate: p.fmvEndDate, fmvStart: p.fmvStart,
      shareCurrency: plan.shareCurrency, fx: p.fx, grossUnits: p.units, withheldUnits: 0, netUnits: p.units,
      purchasePrice: p.price, contributed: { amount: r2(row.contributed + row.carryIn - row.refund - row.carryOut), currency: row.currency },
      discountAmount: p.discountAmount, lookbackGain: p.lookbackGain, effectiveDiscountPct: p.effectiveDiscountPct,
      refund: row.refund, carry: row.carryOut, fxEffect: p.fxEffect,
      soldImmediately: !!p.sellImmediately, salePrice: p.salePrice, source: 'auto'
    };
  }

  function regenerate(state, opts) {
    var out = Object.assign({}, state), added = 0, missing = [];
    state.grants.forEach(function (g) {
      if (g.type !== 'ESPP' || !g.contribution) return;
      var plan = byId(state.plans, g.planId);
      if (!plan) return;
      var sc = schedule(out, g, opts);
      var keep = out.events.filter(function (e) { return !(e.grantId === g.id && e.kind === 'purchase' && e.source === 'auto'); });
      var auto = sc.offerings.filter(function (r) { return r.purchase && !r.purchase.manual && r.purchase.units > 0; }).map(function (r) { return eventOf(g, plan, r); });
      var before = out.events.filter(function (e) { return e.grantId === g.id && e.kind === 'purchase' && e.source === 'auto'; });
      added += auto.filter(function (a) { return !before.some(function (b) { return b.id === a.id; }); }).length;
      out.events = keep.concat(auto);
      missing = missing.concat(sc.missing.map(function (m) { return Object.assign({ grantId: g.id }, m); }));
    });
    return { state: out, added: added, missing: missing };
  }

  // Annualised return on the contributed cash: each month's deduction out, the
  // value of the shares at purchase plus refunds back in. In the salary
  // currency, and in `base` through the event-day rates.
  function returnOnCash(sched, plan, base, fxCtx) {
    var R = ret(), F = efx();
    if (!R) return null;
    var flowsS = [], flowsB = [];
    sched.offerings.forEach(function (row) {
      if (!row.purchase) return;
      row.months.forEach(function (x) {
        if (!(x.kept > 0)) return;
        flowsS.push({ date: x.date, amount: -x.kept });
        var b = x.currency === base ? x.kept : (F.convert(x.kept, x.currency, base, x.date, fxCtx || {}) || { value: null }).value;
        if (b != null) flowsB.push({ date: x.date, amount: -b });
      });
      var val = row.purchase.valueAtPurchase;
      var inSalary = row.currency === plan.shareCurrency ? val : (F.convert(val, plan.shareCurrency, row.currency, row.end, fxCtx || {}) || { value: null }).value;
      var inBase = base === plan.shareCurrency ? val : (F.convert(val, plan.shareCurrency, base, row.end, fxCtx || {}) || { value: null }).value;
      if (inSalary != null) flowsS.push({ date: row.end, amount: inSalary + row.refund });
      var refBase = row.refund > 0 ? (row.currency === base ? row.refund : (F.convert(row.refund, row.currency, base, row.end, fxCtx || {}) || { value: 0 }).value) : 0;
      if (inBase != null) flowsB.push({ date: row.end, amount: inBase + refBase });
    });
    return { salary: R.xirr(flowsS), base: R.xirr(flowsB) };
  }

  var api = {
    normalizeSettings: normalizeSettings, monthIncome: monthIncome, eligibleOf: eligibleOf, pctAt: pctAt,
    offerings: offerings, purchasePrice: purchasePrice, schedule: schedule, eventOf: eventOf, regenerate: regenerate,
    returnOnCash: returnOnCash, monthEnd: monthEnd, nextMonth: nextMonth
  };
  if (typeof window !== 'undefined') window.MaerminEquityEspp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
