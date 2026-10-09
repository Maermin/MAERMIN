// ============================================================================
// MAERMIN — Daily value path  (window.MaerminValuePath)
// ----------------------------------------------------------------------------
// Portfolio value per day = Σ quantity held that day × that day's close, built
// from the transactions and the daily close history (close-history.js). With it
// the time-weighted return exists from the first trade instead of after days
// of manual price refreshes.
//
//   build(transactions, series, opts)  → Path
//     series: { 'category|SYMBOL': { closes: [[iso, eur]…] } }
//     opts:   { today, exchangeRate, fxAt, usdRates,
//               live:   { key: eur }            today's quote (replaces today's close)
//               splits: { key: [{ date, num, den }] }   the RECORDED corporate actions }
//   Quantities are split-adjusted with the recorded actions only - the same rule
//   as the positions list and the ledger. Splits a data source reports are not
//   applied on their own: whether a trade was entered in pre- or post-split
//   units is the user's call (the app proposes detected splits for recording).
//   Path = { twr, annualized, start, end, days,
//            points:  [{ d, v, flow, r, idx, carried }],
//            covered: [{ key, symbol, category }],
//            missing: [{ key, symbol, category }],   holdings without a series (left out)
//            carried: [{ key, symbol, until }] }     valued at trade price until the first close
//
// Return of a day (true time-weighted, chain-linked), in two links:
//   A  what was held yesterday, close to close:   V_old / V_{t-1}
//      (V_old = yesterday's quantities at today's close)
//   B  the day's trades and payouts:              1 + G / (V_old + buys)
//      G = buys: qty × (close − trade price) − fee
//        + sells: qty × (trade price − close) − fee
//        + dividends / interest of a covered holding (net)
// So fees lower and income raises the return, a trade away from the close
// counts once, and the SIZE and timing of deposits do not count at all.
//
//   fromValues(points, flows)   same chain-linking over recorded value points
//                               (the daily snapshots) - the fallback
//   index(path, opts)           flow-neutral index series for the analytics
//   alignedCloses(series, keys) per-holding closes on one common date grid
//
// Pure + dual-exported; tested in test/value-path.test.js.
// ============================================================================
(function () {
  'use strict';

  var EPS = 1e-9;
  var DAY = 86400000;

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) {
    if (!d) return '';
    var s = String(d);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = new Date(d);
    return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
  }
  function keyOf(tx) { return (tx.category || 'crypto') + '|' + String(tx.symbol || tx.name || '').trim().toUpperCase(); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }

  function fx() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }
  function toEUR(amount, tx, opts) {
    var F = fx();
    if (F && F.txToEUR) return F.txToEUR(amount, tx.currency, tx.date, num(opts.exchangeRate), opts.fxAt, opts.usdRates).value;
    return (tx.currency === 'USD' && opts.exchangeRate > 0) ? num(amount) * opts.exchangeRate : num(amount);
  }

  function annualize(growth, days) {
    return (days >= 365 && growth > 0) ? Math.pow(growth, 365.25 / days) - 1 : null;
  }

  function build(transactions, series, opts) {
    opts = opts || {};
    series = series || {};
    var today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
    var live = opts.live || {};
    var out = { twr: null, annualized: null, start: null, end: null, days: 0, points: [], covered: [], missing: [], carried: [] };

    // ---- group the trades, split covered / missing ------------------------
    var meta = {}, trades = [], income = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || !ymd(tx.date) || tx.category === 'options') return;
      var k = keyOf(tx);
      if (tx.type === 'buy' || tx.type === 'sell') {
        if (!(num(tx.quantity) > 0)) return;
        if (!meta[k]) meta[k] = { key: k, symbol: tx.symbol || tx.name || '', category: tx.category || 'crypto' };
        trades.push(tx);
      } else if (tx.type === 'dividend' || tx.type === 'interest') income.push(tx);
    });
    var covered = {};
    Object.keys(meta).forEach(function (k) {
      var s = series[k];
      if (s && Array.isArray(s.closes) && s.closes.length) { covered[k] = true; out.covered.push(meta[k]); }
      else out.missing.push(meta[k]);
    });
    if (!out.covered.length) return out;

    // ---- events per day ----------------------------------------------------
    function splitsOf(k) { return (opts.splits && opts.splits[k]) || []; }
    function factor(k, date) { // quantity multiplier from every split after `date`
      var f = 1;
      splitsOf(k).forEach(function (s) { if (s && s.den > 0 && s.num > 0 && date < s.date) f *= s.num / s.den; });
      return f;
    }
    var byDay = {};
    function day(d) { return byDay[d] || (byDay[d] = { trades: [], payout: 0 }); }
    trades.forEach(function (tx) {
      var k = keyOf(tx);
      if (!covered[k]) return;
      var d = ymd(tx.date); if (d > today) return;
      var f = factor(k, d), q = num(tx.quantity);
      day(d).trades.push({ k: k, buy: tx.type === 'buy', qty: q * f, unit: toEUR(tx.price, tx, opts) / f, fee: Math.max(0, toEUR(tx.fees, tx, opts)) });
    });
    income.forEach(function (tx) {
      if (!covered[keyOf(tx)]) return;
      var d = ymd(tx.date); if (d > today) return;
      var gross = num(tx.quantity) * num(tx.price);
      var amt = (gross || num(tx.amount)) - num(tx.withholdingTax);
      if (amt > 0) day(d).payout += toEUR(amt, tx, opts);
    });
    var tradeDays = Object.keys(byDay).filter(function (d) { return byDay[d].trades.length; }).sort();
    if (!tradeDays.length) return out;
    var start = tradeDays[0];

    // ---- date grid: every close, every event, today ------------------------
    var grid = {}, ptr = {}, price = {}, tradePx = {}, qty = {};
    Object.keys(covered).forEach(function (k) {
      ptr[k] = 0;
      series[k].closes.forEach(function (c) { if (c[0] >= start && c[0] <= today) grid[c[0]] = true; });
    });
    Object.keys(byDay).forEach(function (d) { if (d >= start) grid[d] = true; });
    Object.keys(covered).forEach(function (k) { if (live[k] > 0) grid[today] = true; });
    var dates = Object.keys(grid).sort();

    var growth = 1, prev = 0, carriedUntil = {};
    function px(k) { return price[k] > 0 ? price[k] : (tradePx[k] || 0); }
    dates.forEach(function (d) {
      // closes up to and including d (forward-fill)
      Object.keys(covered).forEach(function (k) {
        var cl = series[k].closes;
        while (ptr[k] < cl.length && cl[ptr[k]][0] <= d) { if (cl[ptr[k]][1] > 0) price[k] = cl[ptr[k]][1]; ptr[k]++; }
        if (d === today && live[k] > 0) price[k] = live[k];
      });
      var ev = byDay[d];
      // A holding without a close yet is valued at its latest trade price.
      if (ev) ev.trades.forEach(function (t) { if (!(price[t.k] > 0)) tradePx[t.k] = t.unit; });
      // Link A: yesterday's holdings at today's prices.
      var vOld = 0;
      Object.keys(qty).forEach(function (k) { if (qty[k] > EPS) vOld += qty[k] * px(k); });
      var r = prev > EPS ? vOld / prev - 1 : 0;
      // Link B: trades and payouts.
      var inflow = 0, outflow = 0, gain = 0;
      if (ev) {
        ev.trades.sort(function (a, b) { return (a.buy ? 0 : 1) - (b.buy ? 0 : 1); }); // same day: buys first
        ev.trades.forEach(function (t) {
          var held = qty[t.k] || 0, p = px(t.k);
          // A trade without a price (transfer in/out, airdrop, gift) moves units,
          // not money: book it at the day's price so it is neither gain nor loss.
          if (!(t.unit > 0)) t.unit = p;
          if (t.buy) { qty[t.k] = held + t.qty; inflow += t.qty * t.unit + t.fee; gain += t.qty * (p - t.unit) - t.fee; return; }
          var sold = Math.min(t.qty, held); // an oversell cannot pay out more than was held
          if (!(sold > EPS)) return;
          var fee = t.fee * (sold / t.qty);
          qty[t.k] = held - sold;
          outflow += sold * t.unit - fee;
          gain += sold * (t.unit - p) - fee;
        });
        if (vOld > EPS) { outflow += ev.payout; gain += ev.payout; }
        var base = vOld + inflow;
        if (base > EPS) r = (1 + r) * (1 + gain / base) - 1;
      }
      var value = 0, carried = false;
      Object.keys(qty).forEach(function (k) {
        if (!(qty[k] > EPS)) return;
        value += qty[k] * px(k);
        if (!(price[k] > 0)) { carried = true; carriedUntil[k] = d; }
      });
      growth *= (1 + r);
      out.points.push({ d: d, v: value, flow: inflow - outflow, r: r, idx: growth, carried: carried });
      prev = value;
    });

    Object.keys(carriedUntil).forEach(function (k) { out.carried.push({ key: k, symbol: meta[k].symbol, until: carriedUntil[k] }); });
    out.start = start;
    out.end = dates[dates.length - 1];
    out.days = daysBetween(out.start, out.end);
    if (out.points.length >= 2) {
      out.twr = growth - 1;
      out.annualized = annualize(growth, out.days);
    }
    return out;
  }

  // External flows of a transaction list as [{ d, amount }] in EUR (+ deposit,
  // − withdrawal): buys with fees, sells net of fees. For fromValues().
  function flowsOf(transactions, opts) {
    opts = opts || {};
    var out = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.category === 'options' || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      var d = ymd(tx.date); if (!d) return;
      var gross = num(tx.quantity) * num(tx.price), fee = Math.max(0, num(tx.fees));
      var amt = tx.type === 'buy' ? gross + fee : -(gross - fee);
      if (amt) out.push({ d: d, amount: toEUR(amt, tx, opts) });
    });
    return out;
  }

  // Chain-linked return over recorded value points [{ d, v }] (the daily
  // snapshots). Less exact than build(): only totals are known, not what was
  // traded at which price. Flows between two points are booked at the END of
  // the period (the snapshot of a day is taken after that day's trades), except
  // a deposit larger than everything held before, which is measured on its own
  // amount - otherwise its first-day move would be credited to the small
  // previous balance.
  //   → { twr, annualized, start, end, days, periods, steps: [{ d, r }] } | null (fewer than 2 points)
  //   steps: the return of each period, dated at its END point (returns heatmap)
  function fromValues(points, flows) {
    var pts = (points || []).filter(function (p) { return p && ymd(p.d) && isFinite(parseFloat(p.v)); })
      .map(function (p) { return { d: ymd(p.d), v: num(p.v) }; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    if (pts.length < 2) return null;
    var fl = (flows || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var growth = 1, periods = 0, j = 0, steps = [];
    while (j < fl.length && fl[j].d <= pts[0].d) j++; // already inside the first value
    for (var i = 1; i < pts.length; i++) {
      var f = 0;
      while (j < fl.length && fl[j].d <= pts[i].d) { f += num(fl[j].amount); j++; }
      var prev = pts[i - 1].v;
      var base = f > prev ? prev + f : prev;
      if (!(base > EPS)) continue;
      var factor = 1 + (pts[i].v - prev - f) / base;
      // A period WITH flows that halves or doubles means the snapshots and the
      // transaction list do not describe the same book (e.g. trades imported
      // later with an earlier date, which the old snapshots never contained):
      // no figure is better than a wrong one.
      if (!(factor > 0) || (f !== 0 && (factor < 0.5 || factor > 2))) return null;
      growth *= factor;
      periods++;
      steps.push({ d: pts[i].d, r: factor - 1 });
    }
    if (!periods) return null;
    var days = daysBetween(pts[0].d, pts[pts.length - 1].d);
    return { twr: growth - 1, annualized: annualize(growth, days), start: pts[0].d, end: pts[pts.length - 1].d, days: days, periods: periods, steps: steps };
  }

  // Flow-neutral index of the path as [{ d, v }] (v = cumulative growth × 100),
  // i.e. what 100 € invested at the start would be worth. Period returns of it
  // are the daily time-weighted returns - the input the volatility / benchmark
  // maths needs (the raw value path jumps on every deposit). Only the trailing
  // run of fully priced days is used (days where a holding was still carried at
  // its trade price would read as zero volatility).
  //   opts: { max }  keep at most the last `max` points
  function index(path, opts) {
    opts = opts || {};
    var pts = (path && path.points) || [];
    var from = 0;
    for (var i = pts.length - 2; i >= 0; i--) { if (pts[i].carried) { from = i + 1; break; } }
    var run = pts.slice(from);
    while (run.length && !(run[0].v > EPS)) run.shift();
    if (run.length < 2) return [];
    var base = run[0].idx;
    var out = run.map(function (p) { return { d: p.d, v: base > 0 ? (p.idx / base) * 100 : 100 }; });
    return (opts.max > 0 && out.length > opts.max) ? out.slice(out.length - opts.max) : out;
  }

  // Closes of several holdings on the dates ALL of them have a close (stocks do
  // not trade on weekends: filling those days would add zero returns and pull
  // correlations and volatility down), shaped like the live priceHistory so the
  // correlation / risk views take it as is:
  //   { label: [{ timestamp: iso, price }] }     label = labels[key] || key
  //   opts: { max, labels }
  function alignedCloses(series, keys, opts) {
    opts = opts || {};
    var use = (keys || []).filter(function (k) { return series && series[k] && Array.isArray(series[k].closes) && series[k].closes.length >= 2; });
    if (!use.length) return {};
    var maps = use.map(function (k) { var m = {}; series[k].closes.forEach(function (c) { if (c[1] > 0) m[c[0]] = c[1]; }); return m; });
    var dates = Object.keys(maps[0]).filter(function (d) { return maps.every(function (m) { return m[d] !== undefined; }); }).sort();
    if (dates.length < 2) return {};
    if (opts.max > 0 && dates.length > opts.max) dates = dates.slice(dates.length - opts.max);
    var out = {};
    use.forEach(function (k, i) {
      out[(opts.labels && opts.labels[k]) || k] = dates.map(function (d) { return { timestamp: d, price: maps[i][d] }; });
    });
    return out;
  }

  var api = { build: build, flowsOf: flowsOf, fromValues: fromValues, index: index, alignedCloses: alignedCloses, keyOf: keyOf };
  if (typeof window !== 'undefined') window.MaerminValuePath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
