// ============================================================================
// MAERMIN — Reporting currency  (window.MaerminReporting)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 9. Every amount is stored in EUR; the app can show
// them in EUR, USD or CHF (Settings → Currency). Tax views stay in their tax
// system's currency (owner decision): the renderer gives them EUR formatting.
//
// Conversion uses a real rate only, never a default:
//   USD  the USD->EUR rate fetched this session, else the daily FX history
//        when it covers today (fx-history.js `covers`, at most 7 days old)
//   CHF  the open.er-api table (units per USD, MaerminFxHistory.usdRates):
//        CHF per EUR = rates.CHF / rates.EUR, from the last successful fetch
// Without a rate the app shows EUR, says so in Settings, and the symbol is €,
// so a figure is never labelled with a currency it was not converted to.
//
//   CURRENCIES, symbol(cur)
//   perEUR(cur, { usdToEur, usdRates }) -> units of cur per 1 EUR, or null
//   effective(cur, ctx) -> { cur, rate, fallback }
// Tested in test/reporting-currency.test.js.
// ============================================================================
(function () {
  'use strict';

  var CURRENCIES = ['EUR', 'USD', 'CHF'];
  var SYMBOLS = { EUR: '€', USD: '$', CHF: 'CHF' };

  function num(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : null; }
  function symbol(cur) { return SYMBOLS[cur] || '€'; }

  function perEUR(cur, ctx) {
    ctx = ctx || {};
    if (cur === 'EUR') return 1;
    if (cur === 'USD') { var u = num(ctx.usdToEur); return u ? 1 / u : null; }   // usdToEur = EUR per USD
    if (cur === 'CHF') {
      var r = ctx.usdRates || {}, chf = num(r.CHF), eur = num(r.EUR);
      return chf && eur ? chf / eur : null;
    }
    return null;
  }

  function effective(cur, ctx) {
    var c = CURRENCIES.indexOf(cur) > -1 ? cur : 'EUR';
    var rate = perEUR(c, ctx);
    if (rate == null) return { cur: 'EUR', rate: 1, fallback: c !== 'EUR', wanted: c };
    return { cur: c, rate: rate, fallback: false, wanted: c };
  }

  var api = { CURRENCIES: CURRENCIES, symbol: symbol, perEUR: perEUR, effective: effective };
  if (typeof window !== 'undefined') window.MaerminReporting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
