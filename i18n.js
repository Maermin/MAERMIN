// ============================================================================
// MAERMIN — Language + locale formatting  (window.MaerminI18n)
// ----------------------------------------------------------------------------
// One place for "which language" and "how numbers look" (PLAN P2-2):
//   - t(key, fallback, vars)   dictionary lookup: selected language, then
//                              English, then the fallback; `{name}` slots are
//                              filled from `vars`.
//   - num / money / pct / date follow the language through Intl:
//       de → 1.234,56 € · 12,5 % · 05.10.2026
//       en → €1,234.56  · 12.5%  · Oct 5, 2026
//
// Modules that do not get the renderer's `t` prop call MaerminI18n.t() at
// render time; the renderer re-renders the tree when the language changes.
// The language itself lives in MaerminPrefs ('language'); the dictionaries in
// translations-complete.js (window.completeTranslations), read lazily so this
// file can load before them.
// ============================================================================
(function () {
  'use strict';

  var LANGS = ['en', 'de'];
  var LOCALES = { en: 'en-US', de: 'de-DE' };

  var _override = null; // set by tests / the renderer before prefs settle

  function normalize(l) { return LANGS.indexOf(l) > -1 ? l : 'en'; }

  function lang() {
    if (_override) return _override;
    try {
      var P = (typeof window !== 'undefined' && window.MaerminPrefs) || null;
      return normalize(P ? P.get('language') : 'en');
    } catch (e) { return 'en'; }
  }
  function setLang(l) { _override = l ? normalize(l) : null; }

  function locale(l) { return LOCALES[normalize(l || lang())]; }

  function dicts() {
    if (typeof window !== 'undefined' && window.completeTranslations) return window.completeTranslations;
    try { return require('./translations-complete.js'); } catch (e) { return { en: {} }; }
  }

  // Merged dictionary for a language (English as the base), cached per
  // dictionary object so a hot reload of the translations is picked up.
  var _cache = { src: null, by: {} };
  function dict(l) {
    var T = dicts();
    if (_cache.src !== T) { _cache = { src: T, by: {} }; }
    var k = normalize(l || lang());
    if (!_cache.by[k]) _cache.by[k] = Object.assign({}, T.en || {}, T[k] || {});
    return _cache.by[k];
  }

  // "{n} tools hidden" + { n: 3 } -> "3 tools hidden". Unknown slots stay.
  // Plurals: "{n} {n:issue|issues}" picks the first form when n is 1.
  function fill(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    str = str.replace(/\{(\w+):([^{}|]*)\|([^{}]*)\}/g, function (m, name, one, other) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
      return Number(vars[name]) === 1 ? one : other;
    });
    return str.replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : m;
    });
  }

  function t(key, fb, vars) {
    var d = dict();
    var s = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : (fb != null ? fb : key);
    return fill(s, vars);
  }

  // ---- numbers ---------------------------------------------------------------
  var _nf = {};
  function nf(loc, opts) {
    var id = loc + JSON.stringify(opts);
    if (!_nf[id]) _nf[id] = new Intl.NumberFormat(loc, opts);
    return _nf[id];
  }
  function finite(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // num(1234.5) -> "1.234,50" (de) / "1,234.50" (en). `dec` = fixed decimals;
  // pass { min, max } for a range.
  function num(v, dec, l) {
    var o = (dec && typeof dec === 'object') ? dec : { min: dec == null ? 2 : dec, max: dec == null ? 2 : dec };
    return nf(locale(l), { minimumFractionDigits: o.min, maximumFractionDigits: o.max }).format(finite(v));
  }

  // money(1234.5, 'EUR') -> "1.234,50 €" (de) / "€1,234.50" (en).
  function money(v, currency, dec, l) {
    var d = dec == null ? 2 : dec;
    return nf(locale(l), { style: 'currency', currency: currency || 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(finite(v));
  }

  // pct(12.5) -> "12,50 %" (de) / "12.50%" (en). Input is in percent units.
  // signed: a leading "+" for positive values.
  function pct(v, dec, signed, l) {
    var d = dec == null ? 2 : dec;
    return nf(locale(l), { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: signed ? 'exceptZero' : 'auto' }).format(finite(v) / 100);
  }

  // ---- dates -----------------------------------------------------------------
  var DATE_STYLES = {
    short: { day: '2-digit', month: '2-digit', year: 'numeric' },   // 05.10.2026 / 10/05/2026
    medium: { day: 'numeric', month: 'short', year: 'numeric' },    // 5. Okt. 2026 / Oct 5, 2026
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    month: { month: 'short', year: 'numeric' },                     // Okt. 2026 / Oct 2026
    monthLong: { month: 'long', year: 'numeric' },
    dayMonth: { day: 'numeric', month: 'short' },
    time: { hour: '2-digit', minute: '2-digit' },
    dateTime: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  };
  function toDate(d) {
    if (d instanceof Date) return d;
    // A bare YYYY-MM-DD is a calendar day: read it as local noon so no time
    // zone moves it to the day before.
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T12:00:00');
    return new Date(d);
  }
  function date(d, style, l) {
    if (d == null || d === '') return '';
    var x = toDate(d);
    if (isNaN(x.getTime())) return '';
    var o = typeof style === 'object' ? style : (DATE_STYLES[style || 'short'] || DATE_STYLES.short);
    return x.toLocaleString(locale(l), o);
  }

  // Month names for charts / calendars: monthNames('short') -> ['Jan', …].
  function monthNames(width, l) {
    var out = [];
    for (var m = 0; m < 12; m++) out.push(new Date(2020, m, 15).toLocaleString(locale(l), { month: width || 'short' }));
    return out;
  }

  // <html lang> follows the language (screen readers, hyphenation, spellcheck).
  function applyHtmlLang(l) {
    try { if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', normalize(l || lang())); } catch (e) {}
  }

  var api = {
    LANGS: LANGS, LOCALES: LOCALES, lang: lang, setLang: setLang, locale: locale,
    dict: dict, t: t, fill: fill,
    num: num, money: money, pct: pct, date: date, monthNames: monthNames,
    applyHtmlLang: applyHtmlLang
  };
  if (typeof window !== 'undefined') { window.MaerminI18n = api; applyHtmlLang(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
