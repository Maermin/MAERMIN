// ============================================================================
// MAERMIN — Tax settings & overrides  (window.MaerminTaxSettings)
// ----------------------------------------------------------------------------
// User-editable tax parameters with sensible German defaults. The calculation
// engines (tax-calculation-engine.js) READ these overrides and fall back to
// the statutory defaults when a value is unset, so nothing changes for users
// who never open the settings.
//
//   Global knobs (NON-sensitive - rates/flags only, no holdings):
//     maermin_tax_settings = {
//       abgeltungRate, soli (bool),
//       freistellungsauftrag, cryptoExemption (bool),
//       teilfreistellung: { fundType: rate }   // per-fund-type overrides
//     }
//   The church-tax rate (0|0.08|0.09) is part of the settings object but is
//   stored under the SENSITIVE maermin_kirchensteuer key (see load/save).
//
//   Per-position manual taxable-amount overrides reveal held symbols + amounts,
//   so they live under a SEPARATE key registered in SENSITIVE_KEYS:
//     maermin_tax_overrides = { "SYMBOL|year": taxableAmountEUR }
//
// The pure resolvers (sanitize, computeAbgeltung, teilfreistellungRate,
// positionOverride) are dual-exported and Node-tested
// (test/tax-settings.test.js). Basiszins-per-year and fund-type classification
// keep their existing GermanTax stores + GermanTaxView editors (single source
// of truth); this module owns the rate/flag layer on top.
// ============================================================================
(function () {
  'use strict';

  var SETTINGS_KEY = 'maermin_tax_settings';
  var OVERRIDES_KEY = 'maermin_tax_overrides';

  var DEFAULTS = {
    abgeltungRate: 0.25,         // Abgeltungsteuer base rate
    soli: true,                  // apply 5.5% Solidaritaetszuschlag
    kirchensteuer: 0,            // 0 | 0.08 | 0.09
    freistellungsauftrag: 1000,  // Sparerpauschbetrag (EUR), single 2023+
    cryptoExemption: true,       // 1-year private-sale exemption for crypto
    teilfreistellung: {}         // per-fund-type rate overrides (fraction)
  };

  function numOr(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }

  // Clamp arbitrary input to a safe settings object. Unknown keys are dropped.
  function sanitize(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    var s = {
      abgeltungRate: numOr(raw.abgeltungRate, DEFAULTS.abgeltungRate),
      soli: raw.soli != null ? !!raw.soli : DEFAULTS.soli,
      kirchensteuer: (raw.kirchensteuer === 0.08 || raw.kirchensteuer === 0.09) ? raw.kirchensteuer : 0,
      freistellungsauftrag: numOr(raw.freistellungsauftrag, DEFAULTS.freistellungsauftrag),
      cryptoExemption: raw.cryptoExemption != null ? !!raw.cryptoExemption : DEFAULTS.cryptoExemption,
      teilfreistellung: {}
    };
    // Rate sanity: 0..0.5 for Abgeltung, allowance 0..100000.
    if (!(s.abgeltungRate >= 0 && s.abgeltungRate <= 0.5)) s.abgeltungRate = DEFAULTS.abgeltungRate;
    if (!(s.freistellungsauftrag >= 0 && s.freistellungsauftrag <= 100000)) s.freistellungsauftrag = DEFAULTS.freistellungsauftrag;
    var tf = raw.teilfreistellung;
    if (tf && typeof tf === 'object') {
      Object.keys(tf).forEach(function (k) {
        var r = numOr(tf[k], null);
        if (r != null && r >= 0 && r <= 1) s.teilfreistellung[k] = r;
      });
    }
    return s;
  }

  // The church-tax rate reveals a religious affiliation, so it is NOT kept in
  // the plain settings key: its one store is maermin_kirchensteuer (shared with
  // GermanTax.load/saveKirchensteuerRate, registered in SENSITIVE_KEYS). Older
  // builds wrote it into maermin_tax_settings; load() moves such a value over
  // once (unless the sensitive key already holds a rate) and strips it.
  var KIST_KEY = 'maermin_kirchensteuer';
  function readKist() {
    try {
      var n = parseFloat(localStorage.getItem(KIST_KEY));
      return (n === 0.08 || n === 0.09) ? n : 0;
    } catch (e) { return 0; }
  }
  function writeKist(k) {
    try {
      if (k === 0.08 || k === 0.09) localStorage.setItem(KIST_KEY, String(k));
      else localStorage.removeItem(KIST_KEY);
    } catch (e) { /* non-fatal */ }
  }
  function storePlain(s) {
    var plain = Object.assign({}, s);
    delete plain.kirchensteuer;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(plain)); } catch (e) { /* non-fatal */ }
  }

  function load() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { raw = {}; }
    raw = (raw && typeof raw === 'object') ? raw : {};
    if (Object.prototype.hasOwnProperty.call(raw, 'kirchensteuer')) {
      var legacy = sanitize(raw).kirchensteuer;
      if (legacy && !readKist()) writeKist(legacy);
      storePlain(sanitize(raw));
    }
    var s = sanitize(raw);
    s.kirchensteuer = readKist();
    return s;
  }
  function save(partial) {
    var merged = sanitize(Object.assign({}, load(), partial || {}));
    writeKist(merged.kirchensteuer);
    storePlain(merged);
    return merged;
  }
  function reset() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
    writeKist(0);
    return sanitize({});
  }

  // ---- pure resolvers --------------------------------------------------------
  // Abgeltungsteuer honoring the configured rate, the Soli toggle and church
  // tax. Without church tax: tax = income x rate. With church tax the statutory
  // sec. 32d formula reduces the base: tax = income / (4 + k) only holds for
  // the 25% default; for a custom rate r we apply the general reduction
  // tax = income x r / (1 + soli_factor + k) is NOT statutory, so we keep the
  // documented behaviour: church tax uses income/(4+k) (implies 25%), a custom
  // non-25% rate ignores the church-tax base reduction and just adds k x tax.
  function computeAbgeltung(taxableIncome, settings) {
    settings = settings || DEFAULTS;
    var income = Math.max(0, numOr(taxableIncome, 0));
    var rate = numOr(settings.abgeltungRate, 0.25);
    var k = (settings.kirchensteuer === 0.08 || settings.kirchensteuer === 0.09) ? settings.kirchensteuer : 0;
    var tax;
    if (k > 0 && Math.abs(rate - 0.25) < 1e-9) {
      tax = income / (4 + k);             // statutory reduced base at 25%
    } else {
      tax = income * rate;                // custom rate or no church tax
    }
    var soli = settings.soli ? tax * 0.055 : 0;
    var kist = tax * k;
    return { tax: tax, soli: soli, kirchensteuer: kist, total: tax + soli + kist };
  }

  // Teilfreistellung rate: a user override wins over the statutory default
  // (which the caller supplies, since the canonical table lives in GermanTax).
  function teilfreistellungRate(fundType, statutoryDefault, settings) {
    settings = settings || DEFAULTS;
    var ov = settings.teilfreistellung && settings.teilfreistellung[fundType];
    if (ov != null && ov >= 0 && ov <= 1) return ov;
    return numOr(statutoryDefault, 0);
  }

  // ---- per-position manual taxable override (SENSITIVE store) ----------------
  function overrideKey(symbol, year) { return String(symbol || '').toUpperCase() + '|' + year; }
  function loadOverrides() {
    try {
      var o = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }
  function saveOverride(symbol, year, amount) {
    var map = loadOverrides();
    var key = overrideKey(symbol, year);
    var n = numOr(amount, null);
    if (n != null) map[key] = n; else delete map[key];
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map)); } catch (e) {}
    return map;
  }
  // Look up an override for one symbol/year. Returns a number or null.
  function positionOverride(overrides, symbol, year) {
    if (!overrides) return null;
    var v = overrides[overrideKey(symbol, year)];
    return numOr(v, null);
  }

  // Per-position tax class in the same sensitive store, key "SYMBOL|class":
  // 'private' (sec. 23 private sale) or 'capital' (sec. 20 security, e.g. a
  // gold ETC). Used to move a commodity out of the sec. 23 default.
  function taxClassOf(overrides, symbol) {
    var v = overrides && overrides[String(symbol || '').toUpperCase() + '|class'];
    return (v === 'private' || v === 'capital') ? v : null;
  }
  function saveTaxClass(symbol, cls) {
    var map = loadOverrides();
    var key = String(symbol || '').toUpperCase() + '|class';
    if (cls === 'private' || cls === 'capital') map[key] = cls; else delete map[key];
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map)); } catch (e) {}
    return map;
  }

  var api = {
    SETTINGS_KEY: SETTINGS_KEY,
    OVERRIDES_KEY: OVERRIDES_KEY,
    DEFAULTS: DEFAULTS,
    sanitize: sanitize,
    load: load,
    save: save,
    reset: reset,
    computeAbgeltung: computeAbgeltung,
    teilfreistellungRate: teilfreistellungRate,
    loadOverrides: loadOverrides,
    saveOverride: saveOverride,
    positionOverride: positionOverride,
    taxClassOf: taxClassOf,
    saveTaxClass: saveTaxClass
  };
  if (typeof window !== 'undefined') window.MaerminTaxSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
