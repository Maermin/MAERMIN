// ============================================================================
// MAERMIN — Employee equity: currencies and FX  (window.MaerminEquityFx)
// ----------------------------------------------------------------------------
// PLAN-EQUITY § 2. An equity plan has four currency roles: the share currency
// (the ticker's listing, GBX / ZAc / ILA kept as quoted), the salary currency
// (payroll), the base currency (the app's display currency) and the tax
// currency (from the tax country). Every event stores its amounts in the
// original currency plus the rates it used, so a value can be recomputed in
// any currency later without losing history.
//
// Rates come from the existing pipeline (fx-history.js): the USD->EUR daily
// history and the per-currency EUR history. A missing day takes the nearest
// PREVIOUS fixing up to 7 days back (source 'fallback', the fixing date is
// kept for the UI); further back or with no history at all, the newest table
// rate (open.er-api) is used and marked 'approx'. Any rate can be set by hand
// (source 'manual'), e.g. the rate on a payslip or broker statement.
//
//   majorOf(cur)                          { cur, div } (GBX -> GBP / 100)
//   taxCurrency(country)                  'EUR' (DE, AT) | 'CHF' (CH) | null
//   eurPer(cur, date, ctx)                { rate, date, source } EUR per 1 unit of cur
//   rate(from, to, date, ctx)             { rate, date, source } units of `to` per 1 `from`
//   convert(amount, from, to, date, ctx)  { value, rate, date, source } | null
//   record(from, targets, date, ctx)      { [to]: { rate, date, source } } for an event
//   overrideKey(from, to, date)           key of a manual rate in ctx.overrides
//   valueIn(amount, from, fxRecord, to)   amount through a stored record (no lookup)
//
// ctx (all optional; tests inject them): { series(cur) -> [{ d: ISO, r: EUR per
// unit }] sorted, usdHistory ({ ISO: EUR per USD }), histories ({ CUR: { ISO:
// EUR per unit } }, e.g. the demo's), usdRates, overrides:
// { key: { rate, note } }, maxGapDays }.
// Pure + Node-tested (test/equity-fx.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function fxh() {
    if (W.MaerminFxHistory) return W.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }

  var MAX_GAP_DAYS = 7;
  var DAY = 86400000;
  // Tax country -> tax currency. Only the countries with a tax module
  // (german-tax-view.js, at-tax.js, ch-tax.js); others have none yet.
  var TAX_CURRENCY = { DE: 'EUR', AT: 'EUR', CH: 'CHF' };
  var TAX_COUNTRIES = Object.keys(TAX_CURRENCY);
  var RANK = { exact: 0, history: 1, fallback: 2, approx: 3 };

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }

  function majorOf(cur) {
    var F = fxh();
    if (F && F.majorOf) return F.majorOf(cur);
    return { cur: String(cur || '').toUpperCase(), div: 1 };
  }
  function taxCurrency(country) { return TAX_CURRENCY[String(country || '').toUpperCase()] || null; }
  function overrideKey(from, to, date) { return majorOf(from).cur + '>' + majorOf(to).cur + '@' + ymd(date); }

  // Daily EUR rates of a major currency from the pipeline: [{ d, r }] sorted.
  // usdHistory: the app's USD->EUR map when it is not the stored one (the
  // demo's sample history, as the renderer's fxAt uses it).
  // histories: { CUR: { ISO: EUR per unit } } for other currencies the same way.
  function pipelineSeries(cur, usdHistory, histories) {
    var F = fxh();
    var given = histories && histories[cur];
    if (given) {
      return Object.keys(given).filter(function (k) { return ymd(k) && num(given[k]) > 0; }).sort()
        .map(function (k) { return { d: k, r: num(given[k]) }; });
    }
    if (!F && !usdHistory) return [];
    if (cur === 'USD') {
      var h = usdHistory || (F.load ? F.load() : {});
      return Object.keys(h).filter(function (k) { return ymd(k) && num(h[k]) > 0; }).sort()
        .map(function (k) { return { d: k, r: num(h[k]) }; });
    }
    var e = F.loadCurrencies ? F.loadCurrencies().cur[cur] : null;
    if (!e) return [];
    return e.d.map(function (n, i) { return { d: new Date(n * DAY).toISOString().slice(0, 10), r: e.r[i] }; });
  }
  function seriesOf(cur, ctx) {
    if (ctx && typeof ctx.series === 'function') return ctx.series(cur) || [];
    if (ctx) {
      ctx._cache = ctx._cache || {};
      return ctx._cache[cur] || (ctx._cache[cur] = pipelineSeries(cur, ctx.usdHistory, ctx.histories));
    }
    return pipelineSeries(cur);
  }
  function tableRates(ctx) {
    if (ctx && ctx.usdRates) return ctx.usdRates;
    var F = fxh();
    return F && F.usdRates ? F.usdRates() : {};
  }

  // EUR per 1 unit of `cur` on `date`, or null when nothing is known.
  function eurPer(cur, date, ctx) {
    ctx = ctx || {};
    var m = majorOf(cur), d = ymd(date);
    if (!m.cur || !d) return null;
    if (m.cur === 'EUR') return { rate: 1 / m.div, date: d, source: 'exact' };
    var ov = ctx.overrides && ctx.overrides[overrideKey(m.cur, 'EUR', d)];
    if (ov && num(ov.rate) > 0) return { rate: num(ov.rate) / m.div, date: d, source: 'manual' };
    var s = seriesOf(m.cur, ctx), lo = 0, hi = s.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (s[mid].d <= d) { ans = mid; lo = mid + 1; } else { hi = mid - 1; } }
    var gapMax = ctx.maxGapDays != null ? ctx.maxGapDays : MAX_GAP_DAYS;
    if (ans > -1) {
      var gap = days(s[ans].d, d);
      if (gap <= gapMax) return { rate: s[ans].r / m.div, date: s[ans].d, source: gap === 0 ? 'history' : 'fallback' };
    }
    // No fixing within the gap: today's table rate, marked approximate.
    var tbl = tableRates(ctx), perUsd = num(tbl[m.cur]), eurUsd = num(tbl.EUR);
    if (m.cur === 'USD' && eurUsd > 0) return { rate: eurUsd, date: d, source: 'approx' };
    if (perUsd > 0 && eurUsd > 0) return { rate: eurUsd / perUsd / m.div, date: d, source: 'approx' };
    if (ans > -1) return { rate: s[ans].r / m.div, date: s[ans].d, source: 'approx' };
    return null;
  }

  function worse(a, b) {
    if (a === 'manual' || b === 'manual') return 'manual';
    return (RANK[a] || 0) >= (RANK[b] || 0) ? a : b;
  }

  // Units of `to` per 1 unit of `from` on `date`: through EUR, unless the pair
  // itself has a manual rate. `date` of the result = the older fixing used.
  function rate(from, to, date, ctx) {
    ctx = ctx || {};
    var f = majorOf(from), g = majorOf(to), d = ymd(date);
    if (!f.cur || !g.cur || !d) return null;
    if (f.cur === g.cur) return { rate: g.div / f.div, date: d, source: 'exact' };
    var ov = ctx.overrides && ctx.overrides[overrideKey(f.cur, g.cur, d)];
    if (ov && num(ov.rate) > 0) return { rate: num(ov.rate) * g.div / f.div, date: d, source: 'manual' };
    var a = eurPer(from, d, ctx), b = eurPer(to, d, ctx);
    if (!a || !b) return null;
    return { rate: a.rate / b.rate, date: a.date < b.date ? a.date : b.date, source: worse(a.source, b.source) };
  }

  function convert(amount, from, to, date, ctx) {
    var r = rate(from, to, date, ctx), a = num(amount);
    if (!r || a == null) return null;
    return { value: a * r.rate, rate: r.rate, date: r.date, source: r.source };
  }

  // The rates an event keeps: one entry per target currency (duplicates and
  // empty targets dropped). A target without any rate is left out, and the
  // caller flags the event.
  function record(from, targets, date, ctx) {
    var out = {};
    (targets || []).forEach(function (to) {
      var c = majorOf(to).cur;
      if (!c || out[c]) return;
      var r = rate(from, c, date, ctx);
      if (r) out[c] = { rate: r.rate, date: r.date, source: r.source };
    });
    return out;
  }

  // An amount through a stored record (no lookup): the history never moves.
  function valueIn(amount, from, fxRecord, to) {
    var a = num(amount), c = majorOf(to).cur;
    if (a == null) return null;
    if (majorOf(from).cur === c) return a / majorOf(from).div;
    var e = fxRecord && fxRecord[c];
    return e && num(e.rate) > 0 ? a * num(e.rate) : null;
  }

  var api = {
    MAX_GAP_DAYS: MAX_GAP_DAYS, TAX_COUNTRIES: TAX_COUNTRIES,
    majorOf: majorOf, taxCurrency: taxCurrency, overrideKey: overrideKey,
    eurPer: eurPer, rate: rate, convert: convert, record: record, valueIn: valueIn
  };
  if (typeof window !== 'undefined') window.MaerminEquityFx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
