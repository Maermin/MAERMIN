// ============================================================================
// MAERMIN — Chart engine  (window.MaerminChartEngine)
// ----------------------------------------------------------------------------
// CH-2 (Phase 7 "Atlas Charts"). The maths behind the Charts view and the
// Research chart: pure, no DOM, dual-exported, Node-tested in
// test/chart-engine.test.js (and test/chart-engine-research.test.js, which
// proves Research's numbers did not change when its indicators moved here).
//
// Bars
//   parseBars(payload)            the Worker's `?action=yf` answer →
//                                 { bars: [{ t, o, h, l, c, v }], ohlc, currency, exchangeTz, splits }
//                                 t = epoch seconds; sorted, one bar per t (the
//                                 later entry wins); a missing open / high / low
//                                 falls back to the close; `ohlc: false` when the
//                                 Worker sent closes only (older than 2026.10.15)
//   toEUR(bars, currency, convert)  each bar at the rate of its own day;
//                                 convert(amount, currency, 'YYYY-MM-DD') → number
//                                 or { value } (MaerminFxHistory.txToEUR)
//   heikinAshi(bars)              standard Heikin Ashi candles
//   resample(bars, factor, { tz, intervalSec })  e.g. 4h from 1h: groups start
//                                 at the first bar of each exchange day and never
//                                 cross it; the last group is `partial` when it
//                                 has fewer than `factor` bars
//   percentSeries(bars, startT)   [{ t, p }], change from the first bar >= startT
//
// Indicators - arrays aligned with the input, null where not defined yet.
//   On close arrays (missing closes are skipped, as Research always did):
//   sma, ema, macd, bollinger (moved unchanged from research.js), rsi (Wilder).
//   On bars: stochastic, atr (Wilder), vwap (intraday, resets each exchange
//   day), obv, ichimoku, donchian.
//
// Technical rating - MAERMIN's own method, deterministic:
//   rate(bars) → { score: -1..1, label, votes: [{ group, name, value, vote }] } | null
//   label and vote names are keys (strongSell … strongBuy; sma20, rsi14, …) that
//   the view translates.
//   Trend votes (+1 close above, -1 below, 0 equal): SMA 20, 50, 100, 200,
//     EMA 20, 50 and the Ichimoku base line (26).
//   Momentum votes:
//     RSI 14       below 30 and rising +1, above 70 and falling -1, else 0
//     Stochastic   (14, 3, 3) %K below 20 and above %D +1,
//                  %K above 80 and below %D -1, else 0
//     MACD         (12, 26, 9) line above signal +1, below -1
//     Donchian 20  close above the middle +1, below -1
//   "Equal" means within 1e-9 of the price (rounding). A vote without enough
//   history is left out; with no trend or no momentum vote left the rating is
//   null. score = (mean of trend votes + mean of momentum votes) / 2.
//   ratingLabel(score): <= -0.6 strongSell, <= -0.2 sell, < 0.2 neutral,
//   < 0.6 buy, else strongBuy. Not investment advice.
//
// Your trades (computed on the device, never sent anywhere)
//   tradeMarks(transactions, symbol, opts)  buys, sells, dividends:
//     [{ t, date, kind, qty, price, priceEUR, splitAdjusted }] (+ amountEUR
//     for dividends). `price` is in opts.chartCurrency so the mark sits on
//     the candles.
//   avgCostLine(transactions, symbol, opts) → [{ t, date, qty, avgEUR }]
//     one step per trade date: MaerminLedger.build's open cost / open quantity
//     (FIFO, fees, FX at the trade date - the app's one ledger).
//   avgCostSeries(steps, bars, currency, convert) → per bar, in `currency`:
//     the EUR average cost at that day's rate (the EUR break-even price).
//   opts: chartCurrency, convert (as toEUR), exchangeRate / fxAt (ledger),
//   corporateActions (default window.MaerminCorporateActions, null = none),
//   caState / caEvents (default: the stored ones), chartSplits (the Worker's
//   `splits`). Recorded splits are applied as the ledger applies them; a split
//   in the price data that is not recorded (within 3 days) is applied for the
//   chart only, because Yahoo's prices are already split-adjusted. Stored
//   transactions are never changed.
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function toNum(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function isoOf(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
  function dayStart(iso) { var t = Date.parse(iso + 'T00:00:00Z'); return isFinite(t) ? Math.floor(t / 1000) : null; }
  function rateOf(r) { var v = r && typeof r === 'object' ? r.value : r; return isNum(v) ? v : null; }

  // The exchange's calendar day of an epoch second (Intl, cached per zone; the
  // en-ca locale formats as YYYY-MM-DD, locale tags are case-insensitive).
  var dayFmt = {};
  function localDay(t, tz) {
    var zone = tz || 'UTC';
    if (!(zone in dayFmt)) {
      dayFmt[zone] = req(function () { return new Intl.DateTimeFormat('en-ca', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }); });
    }
    var f = dayFmt[zone];
    return f ? f.format(new Date(t * 1000)) : isoOf(t);
  }

  // ---- bars ------------------------------------------------------------------------
  function parseBars(payload) {
    var p = payload && typeof payload === 'object' ? payload : {};
    var list = Array.isArray(p.prices) ? p.prices : [];
    var byT = {}, ohlc = false;
    list.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var c = toNum(row.price);
      if (c == null) return;
      var t = toNum(row.ts);
      if (t == null) t = dayStart(ymd(row.date));
      if (t == null) return;
      var o = toNum(row.o), h = toNum(row.h), l = toNum(row.l), v = toNum(row.v);
      if (o != null || h != null || l != null) ohlc = true;
      if (o == null) o = c;
      if (h == null) h = Math.max(o, c);
      if (l == null) l = Math.min(o, c);
      byT[t] = { t: t, o: o, h: h, l: l, c: c, v: v };
    });
    var bars = Object.keys(byT).map(function (k) { return byT[k]; }).sort(function (a, b) { return a.t - b.t; });
    return { bars: bars, ohlc: ohlc, currency: p.currency || null, exchangeTz: p.exchangeTz || null, splits: Array.isArray(p.splits) ? p.splits : [] };
  }

  function toEUR(bars, currency, convert) {
    var cur = String(currency || 'EUR').toUpperCase();
    return (bars || []).map(function (b) {
      if (cur === 'EUR') return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      var r = rateOf(convert(1, cur, isoOf(b.t)));
      if (r == null) return null;
      return { t: b.t, o: b.o * r, h: b.h * r, l: b.l * r, c: b.c * r, v: b.v };
    }).filter(Boolean);
  }

  function heikinAshi(bars) {
    var out = [], prev = null;
    (bars || []).forEach(function (b) {
      var c = (b.o + b.h + b.l + b.c) / 4;
      var o = prev ? (prev.o + prev.c) / 2 : (b.o + b.c) / 2;
      var cur = { t: b.t, o: o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c: c, v: b.v };
      out.push(cur); prev = cur;
    });
    return out;
  }

  function inferInterval(bars) {
    var best = null;
    for (var i = 1; i < bars.length; i++) {
      var d = bars[i].t - bars[i - 1].t;
      if (d > 0 && (best == null || d < best)) best = d;
    }
    return best;
  }

  function resample(bars, factor, opts) {
    opts = opts || {};
    var list = bars || [];
    if (!(factor > 1)) return list.map(function (b) { return Object.assign({}, b); });
    var step = (opts.intervalSec > 0 ? opts.intervalSec : inferInterval(list) || 1) * factor;
    var groups = [], cur = null, day = null, dayFirst = null;
    list.forEach(function (b) {
      var d = localDay(b.t, opts.tz);
      if (d !== day) { day = d; dayFirst = b.t; }
      var key = d + '|' + Math.floor((b.t - dayFirst) / step);
      if (!cur || cur.key !== key) {
        cur = { key: key, bar: { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }, n: 1 };
        groups.push(cur);
        return;
      }
      var g = cur.bar;
      g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c;
      g.v = b.v == null ? g.v : (g.v == null ? b.v : g.v + b.v);
      cur.n++;
    });
    return groups.map(function (g, i) {
      return Object.assign(g.bar, { partial: i === groups.length - 1 && g.n < factor });
    });
  }

  function percentSeries(bars, startT) {
    var out = [], base = null;
    (bars || []).forEach(function (b) {
      if (b.t < startT || !isNum(b.c)) return;
      if (base == null) { if (!(b.c !== 0)) return; base = b.c; }
      out.push({ t: b.t, p: b.c / base - 1 });
    });
    return out;
  }

  // ---- indicators on closes (sma, ema, macd, bollinger: moved from research.js) -----
  // Simple moving average over the last n valid closes.
  function sma(values, n) {
    var out = [], win = [], sum = 0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { out.push(null); continue; }
      win.push(x); sum += x;
      if (win.length > n) sum -= win.shift();
      out.push(win.length === n ? sum / n : null);
    }
    return out;
  }
  // Exponential moving average, seeded with the SMA of the first n valid closes.
  function ema(values, n) {
    var out = [], k = 2 / (n + 1), prev = null, seen = 0, seed = 0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { out.push(null); continue; }
      seen++;
      if (prev == null) {
        seed += x;
        if (seen === n) { prev = seed / n; out.push(prev); } else out.push(null);
        continue;
      }
      prev = x * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function macd(values, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    var f = ema(values, fast), s = ema(values, slow);
    var line = values.map(function (_, i) { return f[i] != null && s[i] != null ? f[i] - s[i] : null; });
    var sig = ema(line, signal);
    return { macd: line, signal: sig, hist: line.map(function (m, i) { return m != null && sig[i] != null ? m - sig[i] : null; }) };
  }
  // Bollinger bands: SMA n ± k population standard deviations.
  function bollinger(values, n, k) {
    n = n || 20; k = k == null ? 2 : k;
    var mid = [], upper = [], lower = [], win = [];
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { mid.push(null); upper.push(null); lower.push(null); continue; }
      win.push(x);
      if (win.length > n) win.shift();
      if (win.length < n) { mid.push(null); upper.push(null); lower.push(null); continue; }
      var m = win.reduce(function (a, b) { return a + b; }, 0) / n;
      var sd = Math.sqrt(win.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / n);
      mid.push(m); upper.push(m + k * sd); lower.push(m - k * sd);
    }
    return { mid: mid, upper: upper, lower: lower };
  }
  // RSI with Wilder's smoothing: the first average over n changes, then
  // avg = (avg · (n − 1) + change) / n. No movement at all is 50.
  function rsi(values, n) {
    n = n || 14;
    var out = [], prev = null, count = 0, g = 0, l = 0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { out.push(null); continue; }
      if (prev == null) { prev = x; out.push(null); continue; }
      var ch = x - prev, up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
      prev = x; count++;
      if (count < n) { g += up; l += dn; out.push(null); continue; }
      if (count === n) { g = (g + up) / n; l = (l + dn) / n; }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
      out.push(l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    }
    return out;
  }

  // ---- indicators on bars ------------------------------------------------------------
  function highest(bars, i, n) { var m = -Infinity; for (var j = i - n + 1; j <= i; j++) m = Math.max(m, bars[j].h); return m; }
  function lowest(bars, i, n) { var m = Infinity; for (var j = i - n + 1; j <= i; j++) m = Math.min(m, bars[j].l); return m; }
  function closes(bars) { return (bars || []).map(function (b) { return b.c; }); }

  // Stochastic: raw %K over k bars, %K = SMA(raw, smooth), %D = SMA(%K, d).
  function stochastic(bars, k, smooth, d) {
    k = k || 14; smooth = smooth || 3; d = d || 3;
    var raw = (bars || []).map(function (b, i) {
      if (i < k - 1) return null;
      var hh = highest(bars, i, k), ll = lowest(bars, i, k);
      return hh === ll ? 50 : 100 * (b.c - ll) / (hh - ll);
    });
    var K = sma(raw, smooth);
    return { k: K, d: sma(K, d) };
  }
  // Average true range (Wilder). The first bar's true range is its high − low.
  function atr(bars, n) {
    n = n || 14;
    var out = [], sum = 0, prev = null;
    (bars || []).forEach(function (b, i) {
      var tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
      if (i < n - 1) { sum += tr; out.push(null); return; }
      prev = i === n - 1 ? (sum + tr) / n : (prev * (n - 1) + tr) / n;
      out.push(prev);
    });
    return out;
  }
  function isIntraday(bars) { var s = inferInterval(bars || []); return s != null && s < 72000; }
  // Volume-weighted average price of the typical price (h + l + c) / 3, from
  // the first bar of each exchange day. Daily and longer bars: all null.
  function vwap(bars, opts) {
    opts = opts || {};
    var list = bars || [];
    if (!isIntraday(list)) return list.map(function () { return null; });
    var day = null, pv = 0, vol = 0;
    return list.map(function (b) {
      var d = localDay(b.t, opts.tz);
      if (d !== day) { day = d; pv = 0; vol = 0; }
      var v = isNum(b.v) ? b.v : 0;
      pv += (b.h + b.l + b.c) / 3 * v; vol += v;
      return vol > 0 ? pv / vol : null;
    });
  }
  // On-balance volume, starting at 0; a missing volume counts as 0.
  function obv(bars) {
    var out = [], acc = 0;
    (bars || []).forEach(function (b, i) {
      if (i > 0) {
        var v = isNum(b.v) ? b.v : 0, pc = bars[i - 1].c;
        acc += b.c > pc ? v : b.c < pc ? -v : 0;
      }
      out.push(acc);
    });
    return out;
  }
  function midline(bars, n) {
    return (bars || []).map(function (_, i) { return i < n - 1 ? null : (highest(bars, i, n) + lowest(bars, i, n)) / 2; });
  }
  // Ichimoku: conversion (tenkan), base (kijun), the two cloud spans drawn
  // `shift` bars ahead (aligned arrays + `ahead` for the bars after the last
  // one) and the lagging line (chikou[i] = the close `shift` bars later).
  function ichimoku(bars, conv, base, spanB, shift) {
    conv = conv || 9; base = base || 26; spanB = spanB || 52; shift = shift || 26;
    var list = bars || [];
    var tenkan = midline(list, conv), kijun = midline(list, base), b = midline(list, spanB);
    var a = tenkan.map(function (x, i) { return x != null && kijun[i] != null ? (x + kijun[i]) / 2 : null; });
    var at = function (arr, i) { return i >= 0 && i < arr.length ? arr[i] : null; };
    var n = list.length, aheadA = [], aheadB = [];
    for (var j = n - shift; j < n; j++) { aheadA.push(at(a, j)); aheadB.push(at(b, j)); }
    return {
      tenkan: tenkan, kijun: kijun,
      spanA: list.map(function (_, i) { return at(a, i - shift); }),
      spanB: list.map(function (_, i) { return at(b, i - shift); }),
      chikou: list.map(function (_, i) { return i + shift < n ? list[i + shift].c : null; }),
      ahead: { spanA: aheadA, spanB: aheadB }
    };
  }
  function donchian(bars, n) {
    n = n || 20;
    var list = bars || [], upper = [], lower = [], mid = [];
    list.forEach(function (_, i) {
      if (i < n - 1) { upper.push(null); lower.push(null); mid.push(null); return; }
      var hh = highest(list, i, n), ll = lowest(list, i, n);
      upper.push(hh); lower.push(ll); mid.push((hh + ll) / 2);
    });
    return { upper: upper, lower: lower, mid: mid };
  }

  // ---- technical rating ----------------------------------------------------------------
  function ratingLabel(score) {
    if (score <= -0.6) return 'strongSell';
    if (score <= -0.2) return 'sell';
    if (score < 0.2) return 'neutral';
    if (score < 0.6) return 'buy';
    return 'strongBuy';
  }
  function rate(bars) {
    var list = bars || [];
    if (!list.length) return null;
    var L = list.length - 1, c = list[L].c, eps = 1e-9 * Math.max(1, Math.abs(c));
    var cmp = function (a, b) { return a - b > eps ? 1 : b - a > eps ? -1 : 0; };
    var cl = closes(list), votes = [];
    var trend = function (name, arr) { var v = arr[L]; if (v != null) votes.push({ group: 'trend', name: name, value: v, vote: cmp(c, v) }); };
    [20, 50, 100, 200].forEach(function (n) { trend('sma' + n, sma(cl, n)); });
    [20, 50].forEach(function (n) { trend('ema' + n, ema(cl, n)); });
    trend('ichimokuBase', midline(list, 26));
    var mom = function (name, value, vote) { votes.push({ group: 'momentum', name: name, value: value, vote: vote }); };
    var r = rsi(cl, 14);
    if (r[L] != null && L > 0 && r[L - 1] != null) {
      mom('rsi14', r[L], r[L] < 30 && r[L] > r[L - 1] ? 1 : r[L] > 70 && r[L] < r[L - 1] ? -1 : 0);
    }
    var st = stochastic(list, 14, 3, 3);
    if (st.k[L] != null && st.d[L] != null) {
      var kd = cmp(st.k[L], st.d[L]);
      mom('stochastic', st.k[L], st.k[L] < 20 && kd > 0 ? 1 : st.k[L] > 80 && kd < 0 ? -1 : 0);
    }
    var m = macd(cl, 12, 26, 9);
    if (m.macd[L] != null && m.signal[L] != null) mom('macd', m.macd[L] - m.signal[L], cmp(m.macd[L], m.signal[L]));
    var dc = donchian(list, 20);
    if (dc.mid[L] != null) mom('donchian20', dc.mid[L], cmp(c, dc.mid[L]));
    var mean = function (g) {
      var vs = votes.filter(function (v) { return v.group === g; });
      return vs.length ? vs.reduce(function (a, v) { return a + v.vote; }, 0) / vs.length : null;
    };
    var t = mean('trend'), mo = mean('momentum');
    if (t == null || mo == null) return null;
    var score = (t + mo) / 2;
    return { score: score, label: ratingLabel(score), votes: votes };
  }

  // ---- the user's trades on the chart ----------------------------------------------------
  function corporateActions(opts) {
    if (opts && opts.corporateActions !== undefined) return opts.corporateActions;
    return W.MaerminCorporateActions || null;
  }
  // Trades of one symbol with recorded splits applied (as the ledger does) and,
  // for the chart only, splits from the price data that are not recorded.
  function adjustedRows(transactions, symbol, opts, types) {
    opts = opts || {};
    var sym = String(symbol || '').toUpperCase();
    var rows = (transactions || []).filter(function (t) {
      return t && types.indexOf(t.type) !== -1 && String(t.symbol || '').toUpperCase() === sym;
    }).map(function (t) { return Object.assign({}, t, { _rawQty: toNum(t.quantity) }); });
    var CA = corporateActions(opts);
    if (CA && CA.adjust) rows = CA.adjust(rows, opts.caState, opts.caEvents);
    var recorded = [];
    if (CA) {
      var st = opts.caState !== undefined ? opts.caState : (CA.load ? req(CA.load) : null);
      recorded = ((st && st.actions) || []).filter(function (a) { return a && String(a.symbol || '').toUpperCase() === sym; });
    }
    (opts.chartSplits || []).forEach(function (s) {
      var num = toNum(s && s.numerator), den = toNum(s && s.denominator), date = ymd(s && s.date);
      if (!(num > 0) || !(den > 0) || !date) return;
      var known = recorded.some(function (a) { return Math.abs(Date.parse(a.date) - Date.parse(date)) <= 3 * 86400000; });
      if (known) return;
      var f = num / den;
      rows = rows.map(function (t) {
        if ((t.type !== 'buy' && t.type !== 'sell') || !(ymd(t.date) < date)) return t;
        var q = toNum(t.quantity), p = toNum(t.price), next = Object.assign({}, t);
        if (q != null) next.quantity = q * f;
        if (p != null) next.price = p / f;
        return next;
      });
    });
    return rows.sort(function (a, b) { return ymd(a.date) < ymd(b.date) ? -1 : ymd(a.date) > ymd(b.date) ? 1 : 0; });
  }

  function tradeMarks(transactions, symbol, opts) {
    opts = opts || {};
    var chartCur = String(opts.chartCurrency || 'EUR').toUpperCase();
    var convert = typeof opts.convert === 'function' ? opts.convert : function (a, cur) { return String(cur || 'EUR').toUpperCase() === 'EUR' ? a : null; };
    var toE = function (amount, cur, iso) { return amount == null ? null : rateOf(convert(amount, String(cur || 'EUR').toUpperCase(), iso)); };
    return adjustedRows(transactions, symbol, opts, ['buy', 'sell', 'dividend']).map(function (t) {
      var date = ymd(t.date), cur = String(t.currency || 'EUR').toUpperCase();
      var qty = toNum(t.quantity), price = toNum(t.price);
      var priceEUR = toE(price, cur, date);
      var shown = price;
      if (cur !== chartCur) {
        var unit = chartCur === 'EUR' ? 1 : toE(1, chartCur, date);
        shown = priceEUR != null && unit ? priceEUR / unit : null;
      }
      var mark = { t: dayStart(date), date: date, kind: t.type, qty: qty, price: shown, priceEUR: priceEUR, splitAdjusted: t.type !== 'dividend' && qty !== t._rawQty };
      if (t.type === 'dividend') {
        var gross = qty != null && price != null && qty * price ? qty * price : toNum(t.amount);
        mark.amountEUR = toE(gross, cur, date);
      }
      return mark;
    });
  }

  function avgCostLine(transactions, symbol, opts) {
    opts = opts || {};
    var L = W.MaerminLedger || req(function () { return require('./ledger.js'); });
    if (!L) return [];
    var rows = adjustedRows(transactions, symbol, opts, ['buy', 'sell']).map(function (t) {
      var c = Object.assign({}, t); delete c._rawQty; return c;
    });
    var dates = [];
    rows.forEach(function (t) { var d = ymd(t.date); if (dates.indexOf(d) === -1) dates.push(d); });
    return dates.map(function (d) {
      var built = L.build(rows.filter(function (t) { return ymd(t.date) <= d; }), { exchangeRate: opts.exchangeRate, fxAt: opts.fxAt, applyCorporateActions: false });
      var qty = 0, cost = 0;
      built.list.forEach(function (g) { qty += g.openQty; cost += g.openCostEUR; });
      if (Math.abs(qty) < 1e-12) qty = 0;
      return { t: dayStart(d), date: d, qty: qty, avgEUR: qty > 0 ? cost / qty : null };
    });
  }

  function avgCostSeries(steps, bars, currency, convert) {
    var cur = String(currency || 'EUR').toUpperCase(), s = steps || [], j = -1;
    return (bars || []).map(function (b) {
      while (j + 1 < s.length && s[j + 1].t <= b.t) j++;
      var step = j >= 0 ? s[j] : null;
      if (!step || step.avgEUR == null) return null;
      if (cur === 'EUR') return step.avgEUR;
      var r = rateOf(convert(1, cur, isoOf(b.t)));
      return r ? step.avgEUR / r : null;
    });
  }

  var api = {
    parseBars: parseBars, toEUR: toEUR, heikinAshi: heikinAshi, resample: resample, percentSeries: percentSeries,
    sma: sma, ema: ema, macd: macd, bollinger: bollinger, rsi: rsi,
    stochastic: stochastic, atr: atr, vwap: vwap, obv: obv, ichimoku: ichimoku, donchian: donchian,
    rate: rate, ratingLabel: ratingLabel,
    tradeMarks: tradeMarks, avgCostLine: avgCostLine, avgCostSeries: avgCostSeries
  };
  if (typeof window !== 'undefined') window.MaerminChartEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
