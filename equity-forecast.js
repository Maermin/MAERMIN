// ============================================================================
// MAERMIN — Employee equity: forecasts  (window.MaerminEquityForecast)
// ----------------------------------------------------------------------------
// PLAN-EQUITY Package 4 (ESPP forecast), reused by Package 6. Every figure is
// an ESTIMATE: nothing here is stored, nothing becomes a lot.
//
//   mulberry32(seed)                       seeded PRNG (reproducible)
//   logReturns(series, years)              daily log returns of the last years
//   monteCarlo(series, dates, opts)        block bootstrap of the stock's own
//       daily returns: { dates, p10, p50, p90 } prices per date; null with
//       less than opts.minYears (2) of history
//   priceAt(p0, today, date, scenario)     flat | cagr
//   projectIncome(entries, today, toISO, { raisePct, repeatOneOffs })
//       future pay: the current base salary with a yearly raise (every
//       1 January), the bonus / 13th salary months of the last 12 months
//       repeated each year, plus one-offs already entered for the future
//   espp(state, grant, opts)               per scenario the future purchases:
//       contribution, price, shares, value at purchase, discount gain;
//       cumulative invested vs value; FX band; what-if inputs
//
// The purchase engine is the one of equity-espp.js (caps, lookback, carry):
// it runs on the real history plus synthetic future prices and rates.
// Pure + Node-tested (test/equity-forecast.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function load(f) { try { return require(f); } catch (e) { return null; } }
  function efx() { return W.MaerminEquityFx || load('./equity-fx.js'); }
  function esppMod() { return W.MaerminEquityEspp || load('./equity-espp.js'); }
  function vest() { return W.MaerminEquityVesting || load('./equity-vesting.js'); }

  var DAY = 86400000;
  var TRADING_DAYS = 252;
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function isoOf(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function years(a, b) { return (dayNo(b) - dayNo(a)) / 365.25; }

  // Mulberry32: small, fast, good enough for a simulation, and the same
  // sequence for the same seed on every device.
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function logReturns(series, yrs, today) {
    if (!series || !Array.isArray(series.d) || series.d.length < 3) return [];
    var end = today ? dayNo(today) : series.d[series.d.length - 1];
    var start = end - Math.round((yrs || 5) * 365.25);
    var out = [];
    for (var i = 1; i < series.d.length; i++) {
      if (series.d[i] < start || series.d[i] > end) continue;
      var a = series.p[i - 1], b = series.p[i];
      if (a > 0 && b > 0) out.push(Math.log(b / a));
    }
    return out;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Block bootstrap (blocks of ~a month keep volatility clusters and fat
  // tails) from the last price. dates: future ISO days.
  function monteCarlo(series, dates, opts) {
    opts = opts || {};
    var today = ymd(opts.today);
    var minYears = opts.minYears != null ? opts.minYears : 2;
    var rets = logReturns(series, opts.historyYears || 5, today);
    if (rets.length < minYears * TRADING_DAYS * 0.9) return null;
    var p0 = num(opts.p0) || series.p[series.p.length - 1];
    var n = opts.paths || 1000, block = opts.block || 20, rng = mulberry32(opts.seed != null ? opts.seed : 42);
    var steps = dates.map(function (d) { return Math.max(0, Math.round((dayNo(d) - dayNo(today)) * TRADING_DAYS / 365.25)); });
    var maxStep = Math.max.apply(null, steps.concat([0]));
    var at = dates.map(function () { return []; });
    for (var p = 0; p < n; p++) {
      var lp = 0, s = 0;
      var order = steps.map(function (x, i) { return i; }).sort(function (a, b) { return steps[a] - steps[b]; });
      var k = 0;
      while (k < order.length && steps[order[k]] === 0) { at[order[k]].push(p0); k++; }
      while (s < maxStep) {
        var startAt = Math.floor(rng() * Math.max(1, rets.length - block));
        for (var j = 0; j < block && s < maxStep; j++) {
          lp += rets[(startAt + j) % rets.length]; s++;
          while (k < order.length && steps[order[k]] === s) { at[order[k]].push(p0 * Math.exp(lp)); k++; }
        }
      }
    }
    var out = { dates: dates.slice(), p10: [], p50: [], p90: [], paths: n, seed: opts.seed != null ? opts.seed : 42 };
    at.forEach(function (list) {
      var sorted = list.slice().sort(function (a, b) { return a - b; });
      out.p10.push(quantile(sorted, 0.1)); out.p50.push(quantile(sorted, 0.5)); out.p90.push(quantile(sorted, 0.9));
    });
    return out;
  }

  function priceAt(p0, today, date, scenario) {
    if (!scenario || scenario.type === 'flat') return p0;
    return p0 * Math.pow(1 + (num(scenario.rate) || 0) / 100, Math.max(0, years(today, date)));
  }

  // ---- income projection --------------------------------------------------------
  function projectIncome(entries, today, toISO, o) {
    o = o || {};
    var list = (entries || []).slice();
    var raise = (num(o.raisePct) || 0) / 100;
    var base = list.filter(function (e) { return e.kind === 'base' && e.from <= today && (!e.to || e.to >= today); })
      .sort(function (a, b) { return a.from < b.from ? 1 : -1; })[0];
    var out = list.filter(function (e) { return !(e.kind === 'base' && (!e.to || e.to > today)); });
    if (base) {
      // close the current base at today, then one entry per year with the raise
      out.push(Object.assign({}, base, { id: base.id + '-now', to: today }));
      var y0 = +today.slice(0, 4), yEnd = +toISO.slice(0, 4);
      for (var y = y0; y <= yEnd; y++) {
        var from = y === y0 ? isoOf(dayNo(today) + 1) : y + '-01-01';
        var to = y === yEnd ? toISO : y + '-12-31';
        if (from > to) continue;
        out.push(Object.assign({}, base, { id: base.id + '-f' + y, from: from, to: to, amount: base.amount * Math.pow(1 + raise, y - y0) }));
      }
    }
    if (o.repeatOneOffs !== false) {
      // the bonus / 13th salary / other one-offs of the last 12 months, again each year
      var lastYear = isoOf(dayNo(today) - 365);
      list.filter(function (e) { return e.kind !== 'base' && e.period === 'once' && e.from > lastYear && e.from <= today; }).forEach(function (e) {
        for (var k = 1; k <= 10; k++) {
          var d = (+e.from.slice(0, 4) + k) + e.from.slice(4);
          if (d > toISO) break;
          if (d <= today) continue;
          // a one-off already entered for that month wins
          if (list.some(function (x) { return x.kind === e.kind && x.from.slice(0, 7) === d.slice(0, 7); })) continue;
          out.push(Object.assign({}, e, { id: e.id + '-r' + k, from: d, amount: e.amount * Math.pow(1 + raise, k) }));
        }
      });
    }
    return out;
  }

  function horizonEnd(today, horizon, openEnd) {
    var V = vest();
    if (horizon === 'period') return openEnd || today;
    var yrs = horizon === '5y' ? 5 : horizon === '3y' ? 3 : 1;
    return V.addMonths(today, yrs * 12);
  }

  // ---- ESPP forecast ---------------------------------------------------------------
  // opts: { today, income, closes, fxCtx, base, horizon: 'period'|'1y'|'3y'|'5y',
  //         raisePct, pct (what-if contribution %), priceShiftPct (instant move),
  //         fxShiftPct (instant move of the share currency), fxBandPct (± p.a.),
  //         cagrs [-20, 0, 10, 20], seed, paths }
  function forecastEspp(state, grant, opts) {
    opts = opts || {};
    var F = efx(), ES = esppMod(), V = vest();
    var today = ymd(opts.today) || isoOf(Math.floor(Date.now() / DAY));
    var plan = state.plans.filter(function (p) { return p.id === grant.planId; })[0];
    if (!plan || !grant.contribution) return null;
    var real = ES.schedule(state, grant, { today: today, income: opts.income, closes: opts.closes, fxCtx: opts.fxCtx, targets: opts.targets });
    var s = real.settings;
    var lastReal = real.offerings[real.offerings.length - 1];
    var openRow = real.open;
    var end = horizonEnd(today, opts.horizon || '1y', openRow ? openRow.end : null);
    // offerings that end after today and up to the horizon
    var future = ES.offerings(s, end).filter(function (o) { return o.end > today && o.end <= end; });
    if (!future.length) return { scenarios: [], purchases: [], settings: s, end: end, open: openRow };
    var series = opts.closes ? opts.closes(plan.ticker) : null;
    var px0 = V.fmvOn(series, today, 'close');
    if (!px0) return { scenarios: [], missing: 'price', settings: s, end: end, open: openRow };
    var p0 = px0.fmv * (1 + (num(opts.priceShiftPct) || 0) / 100);
    var dates = [];
    future.forEach(function (o) { if (o.start > today) dates.push(o.start); dates.push(o.end); });
    if (dates.indexOf(end) === -1) dates.push(end);   // the value of all shares at the horizon
    // contribution % what-if: from the next offering on (an offering keeps its %)
    var g = grant;
    if (num(opts.pct) != null) {
      var next = future.filter(function (o) { return o.start > today; })[0];
      var hist = (grant.contribution.pctHistory || []).concat(next ? [{ from: next.start, pct: num(opts.pct) }] : []);
      g = Object.assign({}, grant, { contribution: Object.assign({}, grant.contribution, { pctHistory: hist }) });
    }
    var income = projectIncome(opts.income || [], today, end, { raisePct: opts.raisePct, repeatOneOffs: opts.repeatOneOffs });
    // FX: today's rates, shifted, then ± band per year
    var curs = [plan.shareCurrency, plan.salaryCurrency, opts.base || 'EUR'].filter(function (c, i, a) { return c && c !== 'EUR' && a.indexOf(c) === i; });
    var rate0 = {};
    curs.forEach(function (c) { var r = F.eurPer(c, today, opts.fxCtx || {}); rate0[c] = r ? r.rate : null; });
    var monthEnds = [];
    for (var m = today.slice(0, 7); m <= end.slice(0, 7); m = ES.nextMonth(m)) monthEnds.push(ES.monthEnd(m));
    var fxDates = monthEnds.concat(dates).sort();
    function fxCtxFor(bandPct) {
      var shift = (num(opts.fxShiftPct) || 0) / 100, ctx = {}, base = opts.fxCtx || {};
      ctx.series = function (c) {
        var past = F.seriesOf(c, base).filter(function (x) { return x.d <= today; });
        if (!(rate0[c] > 0)) return past;
        var k = c === plan.shareCurrency ? (1 + shift) : 1;
        return past.concat(fxDates.filter(function (d) { return d > today; }).map(function (d) {
          return { d: d, r: rate0[c] * k * Math.pow(1 + bandPct / 100, years(today, d)) };
        }));
      };
      return ctx;
    }
    function closesFor(priceOf) {
      var ext = { cur: series.cur, d: series.d.filter(function (x) { return x <= dayNo(today); }), p: [] };
      ext.p = series.p.slice(0, ext.d.length);
      var div = F.majorOf(series.cur).div;
      dates.forEach(function (d) { ext.d.push(dayNo(d)); ext.p.push(priceOf(d) * div); });
      return function () { return ext; };
    }
    function run(name, priceOf, bandPct) {
      var sc = ES.schedule(state, g, { today: end, from: openRow ? openRow.start : today, carryIn: openRow ? { amount: openRow.carryIn, currency: openRow.carryInCurrency } : null,
        income: income, closes: closesFor(priceOf), fxCtx: fxCtxFor(bandPct || 0), targets: [opts.base || 'EUR'] });
      var rows = sc.offerings.filter(function (r) { return r.purchase && r.end > today; }).map(function (r) {
        var p = r.purchase, baseCur = opts.base || 'EUR';
        var toBase = function (v, c) { if (c === baseCur) return v; var x = F.convert(v, c, baseCur, r.end, fxCtxFor(bandPct || 0)); return x ? x.value : null; };
        return { date: r.end, start: r.start, contributed: r.contributed + r.carryIn - r.carryOut - r.refund, currency: r.currency, price: p.price, fmvStart: p.fmvStart, fmvEnd: p.fmvEnd,
          units: p.units, value: p.valueAtPurchase, valueBase: toBase(p.valueAtPurchase, plan.shareCurrency), contributedBase: toBase(r.contributed + r.carryIn - r.carryOut - r.refund, r.currency),
          discountGain: p.benefit, discountGainBase: toBase(p.benefit, plan.shareCurrency), warnings: r.warnings, effectiveDiscountPct: p.effectiveDiscountPct };
      });
      // cumulative: cash put in vs ALL shares bought so far at that day's price
      // (so a falling price after the purchase shows), in the base currency
      var cumInv = 0, cumUnits = 0, ctxB = fxCtxFor(bandPct || 0), baseCur = opts.base || 'EUR';
      var inBase = function (v, d) { if (plan.shareCurrency === baseCur) return v; var x = F.convert(v, plan.shareCurrency, baseCur, d, ctxB); return x ? x.value : null; };
      rows.forEach(function (r) { cumInv += r.contributedBase || 0; cumUnits += r.units; r.cumInvested = cumInv; r.cumUnits = cumUnits; r.cumValue = inBase(cumUnits * priceOf(r.date), r.date); });
      var valueEnd = inBase(cumUnits * priceOf(end), end);
      return { name: name, rows: rows, invested: cumInv, value: valueEnd, units: cumUnits,
        warnings: rows.reduce(function (a, r) { return a + r.warnings.length; }, 0) };
    }
    var scenarios = [];
    scenarios.push(Object.assign(run('flat', function () { return p0; }), { label: 'flat' }));
    (opts.cagrs || [-20, 0, 10, 20]).forEach(function (rate) {
      if (rate === 0) return;   // = flat
      scenarios.push(Object.assign(run('cagr' + rate, function (d) { return priceAt(p0, today, d, { type: 'cagr', rate: rate }); }), { label: 'cagr', rate: rate }));
    });
    var mc = series ? monteCarlo(series, dates, { today: today, p0: p0, seed: opts.seed, paths: opts.paths }) : null;
    if (mc) ['p10', 'p50', 'p90'].forEach(function (q) {
      scenarios.push(Object.assign(run(q, function (d) { return mc[q][mc.dates.indexOf(d)]; }), { label: 'mc', q: q }));
    });
    var band = num(opts.fxBandPct) || 0;
    var fx = band ? { low: run('fxLow', function () { return p0; }, -band), high: run('fxHigh', function () { return p0; }, band), pct: band } : null;
    return { scenarios: scenarios, mc: mc ? { seed: mc.seed, paths: mc.paths } : null, fx: fx, settings: s, end: end, open: openRow, last: lastReal, p0: p0, income: income };
  }

  var api = { mulberry32: mulberry32, logReturns: logReturns, quantile: quantile, monteCarlo: monteCarlo, priceAt: priceAt, projectIncome: projectIncome, horizonEnd: horizonEnd, espp: forecastEspp };
  if (typeof window !== 'undefined') window.MaerminEquityForecast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
