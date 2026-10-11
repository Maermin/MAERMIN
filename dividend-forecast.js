// ============================================================================
// MAERMIN — Dividend forecast rates  (window.MaerminDividendForecast)
// ----------------------------------------------------------------------------
// The forward rate per payer behind Dividends → Forecast, from the dividends
// the user recorded. Pure and Node-tested (test/dividend-forecast.test.js).
//
// Trailing twelve months: the payments of the last 365 days, each converted to
// EUR at its own date, are the annual rate; their count gives the frequency and
// their months the months to expect. A payer with nothing in the last twelve
// months is reported as stale, so the caller can use the resolved per-share
// rate instead. (The forecast used to divide all recorded payments by the
// years between the first and the last one, clamped to 0.08: ONE payment was
// multiplied by 12.5, and its USD amount was counted as EUR - AUDIT BUG-032.)
// ============================================================================
(function () {
  'use strict';

  var DAY = 86400000;
  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function addDaysISO(iso, n) {
    var t = Date.parse(ymd(iso) + 'T00:00:00Z') + n * DAY;
    return new Date(t).toISOString().slice(0, 10);
  }
  function frequencyOf(count) {
    if (count >= 10) return { id: 'monthly', perYear: 12 };
    if (count >= 3) return { id: 'quarterly', perYear: 4 };
    if (count === 2) return { id: 'semi-annual', perYear: 2 };
    return { id: 'annual', perYear: 1 };
  }

  // dividendTxs: transactions of type 'dividend'.
  // opts.toEUR(tx) → EUR amount of the payment (default: quantity × price).
  // opts.today: 'YYYY-MM-DD' (default: local today).
  // → { rates: [{ sym, annualRate, perPayment, frequency, paymentsPerYear,
  //              months: [0-11], lastPayment, paymentsCount, source:'history' }],
  //     stale: [symbol of payers with history but nothing in the last 12 months] }
  function forecastRates(dividendTxs, opts) {
    opts = opts || {};
    var today = ymd(opts.today) || (function () { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
    var since = addDaysISO(today, -365);
    var toEUR = typeof opts.toEUR === 'function' ? opts.toEUR : function (tx) { return num(tx.quantity) * num(tx.price); };
    var bySym = {};
    (dividendTxs || []).forEach(function (tx) {
      if (!tx || !tx.symbol) return;
      var d = ymd(tx.date); if (!d) return;
      var key = String(tx.symbol).toLowerCase();
      var g = bySym[key] || (bySym[key] = { sym: tx.symbol, all: [], ttm: [] });
      var p = { date: d, amount: num(toEUR(tx)) };
      g.all.push(p);
      if (d > since && d <= today) g.ttm.push(p);
    });
    var rates = [], stale = [];
    Object.keys(bySym).forEach(function (key) {
      var g = bySym[key];
      if (!g.ttm.length) { stale.push(g.sym); return; }
      g.ttm.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var annual = g.ttm.reduce(function (s, p) { return s + p.amount; }, 0);
      if (!(annual > 0)) return;
      var f = frequencyOf(g.ttm.length);
      var months = [];
      g.ttm.forEach(function (p) { var m = parseInt(p.date.slice(5, 7), 10) - 1; if (months.indexOf(m) === -1) months.push(m); });
      months.sort(function (a, b) { return a - b; });
      rates.push({
        sym: g.sym, annualRate: annual, perPayment: annual / months.length,
        frequency: f.id, paymentsPerYear: f.perYear, months: months,
        lastPayment: g.ttm[g.ttm.length - 1].date, paymentsCount: g.ttm.length, source: 'history'
      });
    });
    rates.sort(function (a, b) { return b.annualRate - a.annualRate; });
    return { rates: rates, stale: stale };
  }

  var api = { forecastRates: forecastRates, frequencyOf: frequencyOf };
  if (typeof window !== 'undefined') window.MaerminDividendForecast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
