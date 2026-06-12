// ============================================================================
// MAERMIN — Ticker Validation & Normalisation  (window.MaerminTickers)
// ----------------------------------------------------------------------------
// Feature #4: dividends were missed because stored symbols come in many forms
// (Yahoo suffixes "SAP.DE", class shares "BRK.B" vs "BRK-B", or human names),
// while the dividend provider expects a specific ticker format. This is the
// single validation layer that normalises a stored symbol to a canonical ticker
// and tells callers whether it can be resolved + on which exchange.
//
// Pure + unit-tested (test/tickers.test.js). The dividend service runs every
// stock symbol through normalizeForDividends() before lookup.
// ============================================================================
(function () {
  'use strict';

  // Yahoo/FMP exchange suffixes → human label. Used to tell an exchange suffix
  // ("SAP.DE") apart from a share-class letter ("BRK.B").
  var EXCHANGE_SUFFIXES = {
    DE: 'Xetra', F: 'Frankfurt', BE: 'Berlin', SG: 'Stuttgart', MU: 'Munich', HM: 'Hamburg', DU: 'Düsseldorf',
    L: 'London', PA: 'Paris', AS: 'Amsterdam', BR: 'Brussels', MI: 'Milan', MC: 'Madrid', LS: 'Lisbon',
    VI: 'Vienna', SW: 'SIX Swiss', ST: 'Stockholm', HE: 'Helsinki', CO: 'Copenhagen', OL: 'Oslo', IC: 'Iceland',
    TO: 'Toronto', V: 'TSX-V', HK: 'Hong Kong', T: 'Tokyo', AX: 'Australia', NZ: 'New Zealand',
    SI: 'Singapore', KS: 'Korea', TW: 'Taiwan', JO: 'Johannesburg', SA: 'São Paulo', MX: 'Mexico', NS: 'India NSE', BO: 'India BSE'
  };

  function isExchangeSuffix(s) { return Object.prototype.hasOwnProperty.call(EXCHANGE_SUFFIXES, s); }

  // Break a raw symbol into parts. Recognises exchange suffix vs share class.
  function parseSymbol(raw) {
    var s = String(raw || '').trim().toUpperCase();
    var result = { raw: raw, clean: s, base: s, exchangeSuffix: null, exchange: null, shareClass: null, hasSpace: /\s/.test(s) };
    if (!s) return result;

    // Split on the LAST '.' or '-' separator.
    var m = /^([A-Z0-9]+)[.\-]([A-Z0-9]{1,4})$/.exec(s);
    if (m) {
      var base = m[1], suffix = m[2];
      result.base = base;
      if (isExchangeSuffix(suffix)) {
        result.exchangeSuffix = suffix;
        result.exchange = EXCHANGE_SUFFIXES[suffix];
      } else if (suffix.length <= 2) {
        result.shareClass = suffix; // e.g. BRK.B / BRK-B
      } else {
        // Unknown longer suffix — keep base only, treat suffix as unknown exchange.
        result.exchangeSuffix = suffix;
      }
    }
    return result;
  }

  // Canonical ticker for the dividend provider:
  //   - US/plain:       AAPL            -> AAPL
  //   - exchange suffix: SAP.DE         -> SAP.DE   (kept; provider is exchange-aware)
  //   - share class:    BRK.B / BRK-B   -> BRK-B    (provider uses the dash form)
  function normalizeForDividends(raw) {
    var p = parseSymbol(raw);
    if (!p.clean) return '';
    if (p.shareClass) return p.base + '-' + p.shareClass;
    if (p.exchangeSuffix) return p.base + '.' + p.exchangeSuffix;
    return p.base;
  }

  // Only equities/ETFs pay dividends in this app's data model.
  function isDividendEligible(category) {
    return category === 'stocks' || category === undefined || category === null;
  }

  // Validate a symbol for dividend resolution. Returns a structured verdict the
  // UI can use to flag unrecognised holdings.
  function validate(raw, category) {
    var p = parseSymbol(raw);
    if (category && !isDividendEligible(category)) {
      return { valid: false, normalized: null, reason: 'not-an-equity', exchange: null };
    }
    if (!p.clean) return { valid: false, normalized: null, reason: 'empty', exchange: null };
    if (p.hasSpace) return { valid: false, normalized: null, reason: 'looks-like-name', exchange: null };
    if (!/^[A-Z0-9]{1,6}([.\-][A-Z0-9]{1,4})?$/.test(p.clean)) {
      return { valid: false, normalized: null, reason: 'not-ticker-format', exchange: null };
    }
    return { valid: true, normalized: normalizeForDividends(raw), reason: 'ok', exchange: p.exchange || 'US/Default' };
  }

  // Validate a whole portfolio's stock symbols; surfaces what won't resolve.
  function validatePortfolio(portfolio) {
    var stocks = (portfolio && portfolio.stocks) || [];
    var valid = [], invalid = [];
    stocks.forEach(function (s) {
      var v = validate(s.symbol || s.name, 'stocks');
      (v.valid ? valid : invalid).push({ symbol: s.symbol || s.name, name: s.name, verdict: v });
    });
    return { valid: valid, invalid: invalid, total: stocks.length, unresolved: invalid.length };
  }

  // ---- CS2 skin names --------------------------------------------------------
  // THE single normalising place for Steam market_hash_name lookups. Steam is
  // exact about the name: the "Souvenir " / "StatTrak™ " prefix with one
  // space, single spaces around the "|", and the wear in parentheses. The
  // picker delivers exact names; this guards manual entry and any later
  // whitespace damage so the price lookup, the history fetch and the picker
  // all hit the same listing. Applied at LOOKUP time - stored data stays as-is.
  var WEAR_NAMES = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
  function normalizeSkinName(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    // Prefix casing (Steam: "Souvenir AWP | ...", "StatTrak™ AK-47 | ...").
    s = s.replace(/^souvenir\s+/i, 'Souvenir ');
    s = s.replace(/^stattrak(?:™|\(tm\)|tm)?\s+/i, 'StatTrak™ ');
    // Exactly one space around the weapon/finish separator.
    s = s.replace(/\s*\|\s*/, ' | ');
    // Wear tier: canonical casing + exactly one space before the parenthesis.
    var wearMatch = s.match(/\(([^)]+)\)\s*$/);
    if (wearMatch) {
      var canonical = null;
      for (var i = 0; i < WEAR_NAMES.length; i++) {
        if (WEAR_NAMES[i].toLowerCase() === wearMatch[1].trim().toLowerCase()) { canonical = WEAR_NAMES[i]; break; }
      }
      if (canonical) s = s.replace(/\s*\([^)]+\)\s*$/, ' (' + canonical + ')');
    }
    return s;
  }

  var api = {
    EXCHANGE_SUFFIXES: EXCHANGE_SUFFIXES,
    parseSymbol: parseSymbol,
    normalizeForDividends: normalizeForDividends,
    isDividendEligible: isDividendEligible,
    normalizeSkinName: normalizeSkinName,
    validate: validate,
    validatePortfolio: validatePortfolio
  };
  if (typeof window !== 'undefined') window.MaerminTickers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
