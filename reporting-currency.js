// ============================================================================
// MAERMIN — Reporting currency  (window.MaerminReporting)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 9; any ISO 4217 code since PLAN-EQUITY § 2. Every
// amount is stored in EUR; the app shows them in the currency picked in
// Settings → Currency. Tax views stay in their tax system's currency (owner
// decision): the renderer gives them EUR formatting.
//
// Conversion uses a real rate only, never a default:
//   USD    the USD->EUR rate fetched this session, else the daily FX history
//          when it covers today (fx-history.js `covers`, at most 7 days old)
//   other  the open.er-api table (units per USD, MaerminFxHistory.usdRates):
//          units per EUR = rates[cur] / rates.EUR, from the last successful fetch
// Without a rate the app shows EUR, says so in Settings, and the symbol is €,
// so a figure is never labelled with a currency it was not converted to.
//
//   QUICK                 the codes offered as buttons (others via a picker)
//   isValid(cur)          an ISO 4217 code the runtime knows
//   all()                 every such code, sorted (for the picker)
//   symbol(cur, locale?)  the narrow symbol from Intl ('€', '$', 'CHF', '¥')
//   decimals(cur)         minor-unit digits from Intl (JPY 0, EUR 2, KWD 3)
//   perEUR(cur, { usdToEur, usdRates }) -> units of cur per 1 EUR, or null
//   effective(cur, ctx) -> { cur, rate, fallback, wanted }
// Tested in test/reporting-currency.test.js.
// ============================================================================
(function () {
  'use strict';

  var QUICK = ['EUR', 'USD', 'CHF'];

  var _all;
  function all() {
    if (_all !== undefined) return _all;
    try { _all = Intl.supportedValuesOf('currency').slice().sort(); } catch (e) { _all = null; }
    return _all;
  }
  function isValid(cur) {
    if (!/^[A-Z]{3}$/.test(cur || '')) return false;
    var list = all();
    if (list) return list.indexOf(cur) > -1;
    try { new Intl.NumberFormat('en', { style: 'currency', currency: cur }); return true; } catch (e) { return false; }
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) && n > 0 ? n : null; }

  var _sym = {};
  function symbol(cur, locale) {
    var c = isValid(cur) ? cur : 'EUR', loc = locale || 'de-DE', k = loc + c;
    if (_sym[k]) return _sym[k];
    var s = c;
    try {
      var parts = new Intl.NumberFormat(loc, { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
      s = parts.filter(function (p) { return p.type === 'currency'; }).map(function (p) { return p.value; }).join('') || c;
    } catch (e) { s = c; }
    return (_sym[k] = s);
  }

  function decimals(cur) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: isValid(cur) ? cur : 'EUR' }).resolvedOptions().maximumFractionDigits; }
    catch (e) { return 2; }
  }

  function perEUR(cur, ctx) {
    ctx = ctx || {};
    if (cur === 'EUR') return 1;
    if (!isValid(cur)) return null;
    if (cur === 'USD') { var u = num(ctx.usdToEur); return u ? 1 / u : null; }   // usdToEur = EUR per USD
    var r = ctx.usdRates || {}, per = num(r[cur]), eur = num(r.EUR);
    return per && eur ? per / eur : null;
  }

  function effective(cur, ctx) {
    var c = isValid(cur) ? cur : 'EUR';
    var rate = perEUR(c, ctx);
    if (rate == null) return { cur: 'EUR', rate: 1, fallback: c !== 'EUR', wanted: c };
    return { cur: c, rate: rate, fallback: false, wanted: c };
  }

  var api = { QUICK: QUICK, all: all, isValid: isValid, symbol: symbol, decimals: decimals, perEUR: perEUR, effective: effective };
  if (typeof window !== 'undefined') window.MaerminReporting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
