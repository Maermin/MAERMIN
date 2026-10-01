// ============================================================================
// MAERMIN - German tax engine (window.TaxCalculationEngine.GermanTax)
// ----------------------------------------------------------------------------
// Only the German computation lives here now. The legacy jurisdiction engine
// (calculateRealizedGainsAdvanced / calculateGermanTax / calculateUSTax /
// generateTaxReportAdvanced / calculateTaxes) had its own FIFO without FX,
// fees or the Freigrenze and no caller left: the Tax view, PDF and Excel all
// use MaerminTaxReport (tax-report-builder.js), whose disposals come from
// the one FIFO ledger (ledger.js) and whose US estimate is usEstimate().
// ============================================================================

// ============================================================================
// German fund taxation depth (Investmentsteuergesetz): Vorabpauschale and
// Teilfreistellung, plus the statutory computation order and the church-tax
// formula. Pure functions, dual-exported for the Node harness
// (test/german-tax.test.js). All amounts EUR. This is a HELPER COMPUTATION,
// not tax advice — the UI says so wherever these numbers surface.
// ============================================================================
var GermanTax = (function () {
  'use strict';

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // Teilfreistellung rates per fund type (InvStG 2018, sec. 20): the exempt
  // fraction applied to distributions, Vorabpauschale and realized gains AND
  // symmetrically to losses. 'none' covers direct stocks / non-fund assets.
  var TEILFREISTELLUNG = {
    aktienfonds: 0.30,        // equity fund (>= 51% equities)
    mischfonds: 0.15,         // mixed fund (>= 25% equities)
    immobilienfonds: 0.60,    // real-estate fund
    auslandsimmobilienfonds: 0.80, // foreign real-estate fund
    none: 0
  };

  // BMF base rates (Basiszins) per year for the Basisertrag. Negative or zero
  // rate (2022) means no Vorabpauschale accrues for that year. User overrides
  // come on top; unknown future years fall back to the latest known value.
  var BASISZINS = {
    2018: 0.0087, 2019: 0.0052, 2020: 0.0007, 2021: 0.00045,
    2022: -0.0005, 2023: 0.0255, 2024: 0.0229, 2025: 0.0253,
    2026: 0.0320 // BMF 13.01.2026 (IV C 1 - S 1980/00230/012/001)
  };

  function teilfreistellungRate(fundType) {
    var statutory = TEILFREISTELLUNG[fundType] != null ? TEILFREISTELLUNG[fundType] : 0;
    // A user override (MaerminTaxSettings) wins over the statutory rate.
    if (typeof window !== 'undefined' && window.MaerminTaxSettings) {
      return window.MaerminTaxSettings.teilfreistellungRate(fundType, statutory, window.MaerminTaxSettings.load());
    }
    return statutory;
  }

  // Split an amount into taxable and exempt parts. Applies symmetrically to
  // losses (a 30%-exempt fund loss is also only 70% deductible).
  function applyTeilfreistellung(amount, fundType) {
    var rate = teilfreistellungRate(fundType);
    var a = num(amount);
    return { taxable: a * (1 - rate), exempt: a * rate, rate: rate };
  }

  function basiszinsFor(year, overrides) {
    if (overrides && overrides[year] != null && isFinite(parseFloat(overrides[year]))) {
      return parseFloat(overrides[year]);
    }
    if (BASISZINS[year] != null) return BASISZINS[year];
    // Unknown (future) year: latest known table value as a sensible default.
    var years = Object.keys(BASISZINS).map(Number).sort(function (a, b) { return a - b; });
    return BASISZINS[years[years.length - 1]];
  }

  // Statutory month factor: the Basisertrag is reduced by 1/12 for each full
  // month preceding the month of acquisition (purchase in March → 10/12).
  function monthsFactorForPurchase(purchaseDate, year) {
    if (!purchaseDate) return 1;
    // Year/month of the stored 'YYYY-MM-DD' string itself: new Date() parses it
    // as UTC midnight and getMonth() would shift a 1st-of-month purchase into
    // the previous month west of UTC.
    var m = /^(\d{4})-(\d{2})/.exec(String(purchaseDate));
    var py, pm;
    if (m) { py = parseInt(m[1], 10); pm = parseInt(m[2], 10) - 1; }
    else {
      var d = new Date(purchaseDate);
      if (isNaN(d.getTime())) return 1;
      py = d.getFullYear(); pm = d.getMonth();
    }
    if (py < year) return 1;
    if (py > year) return 0;
    return (12 - pm) / 12; // Jan = 0 → bought in Jan = 12/12
  }

  // Vorabpauschale for ONE accumulating fund position and ONE year
  // (sec. 18 (1) InvStG):
  //   Basisertrag   = value at year start x Basiszins x 0.7 x month factor,
  //   capped by the "Mehrbetrag": the value increase over the year PLUS the
  //   distributions paid during the year,
  //   then reduced by those distributions, floored at 0.
  // (The cap used to ignore the distributions, which understated the
  // Vorabpauschale of distributing funds in years with a small price gain.)
  // A non-positive Basiszins (2022) yields zero across the board.
  function computeVorabpauschale(input) {
    input = input || {};
    var valueStart = num(input.valueStart);
    var valueEnd = num(input.valueEnd);
    var distributions = Math.max(0, num(input.distributions));
    var basiszins = num(input.basiszins);
    var monthsFactor = input.monthsFactor != null ? Math.max(0, Math.min(1, num(input.monthsFactor))) : 1;

    if (basiszins <= 0 || valueStart <= 0 || monthsFactor === 0) {
      return { basisertrag: 0, wertzuwachs: Math.max(0, valueEnd - valueStart), vorabpauschale: 0 };
    }
    var basisertrag = valueStart * basiszins * 0.7 * monthsFactor;
    var wertzuwachs = Math.max(0, valueEnd - valueStart);
    var mehrbetrag = Math.max(0, valueEnd - valueStart + distributions);
    var vorabpauschale = Math.max(0, Math.min(basisertrag, mehrbetrag) - distributions);
    return { basisertrag: basisertrag, wertzuwachs: wertzuwachs, vorabpauschale: vorabpauschale };
  }


  // Abgeltungsteuer with optional church tax. With church tax the statutory
  // formula reduces the base rate (sec. 32d EStG): tax = income / (4 + k)
  // where k is the church-tax rate (0.08 or 0.09); without it tax = 25%.
  // Soli is 5.5% of the tax, church tax k x tax.
  function abgeltungsteuer(taxableIncome, kirchensteuerRate) {
    var income = Math.max(0, num(taxableIncome));
    var k = num(kirchensteuerRate);
    var tax = k > 0 ? income / (4 + k) : income * 0.25;
    var soli = tax * 0.055;
    var kist = tax * k;
    return { tax: tax, soli: soli, kirchensteuer: kist, total: tax + soli + kist };
  }

  // Full German computation in the statutory order:
  //   1. per-item Teilfreistellung (gains net of VAP credit, losses, fund
  //      distributions, current-year Vorabpauschale),
  //   2. Verrechnung (net everything),
  //   3. Sparerpauschbetrag,
  //   4. Abgeltungsteuer + Soli + optional Kirchensteuer.
  // Crypto stays outside this block (private sale rules, handled by the
  // existing engine); pass only capital-income items here.
  //   input = {
  //     disposals:  [{ symbol, gain, vapCredit? }],
  //     dividends:  [{ symbol, gross }],
  //     interestIncome?,
  //     vorabpauschalen?: [{ symbol, amount }],
  //     fundTypes?: { SYMBOL: fundType },
  //     sparerpauschbetrag? (default 1000),
  //     kirchensteuerRate? (default 0)
  //   }
  function computeGermanTaxDetailed(input) {
    input = input || {};
    var fundTypes = input.fundTypes || {};
    var typeOf = function (sym) { return fundTypes[String(sym || '').toUpperCase()] || 'none'; };
    // settings (optional, injectable for Node tests): supplies the default
    // allowance and the Abgeltung/Soli/Kirchensteuer computation.
    var settings = input.settings || null;
    var defaultSpb = (settings && settings.freistellungsauftrag != null) ? num(settings.freistellungsauftrag) : 1000;
    var spb = input.sparerpauschbetrag != null ? num(input.sparerpauschbetrag) : defaultSpb;

    var exemptTotal = 0, vapCreditTotal = 0;
    var gainsTaxable = 0, lossesTaxable = 0;
    (input.disposals || []).forEach(function (d) {
      var credit = Math.max(0, num(d.vapCredit));
      var gain = num(d.gain) - credit; // credited Vorabpauschalen reduce the gain
      vapCreditTotal += credit;
      var tf = applyTeilfreistellung(gain, typeOf(d.symbol));
      exemptTotal += tf.exempt;
      if (tf.taxable >= 0) gainsTaxable += tf.taxable; else lossesTaxable += tf.taxable;
    });

    var dividendsTaxable = 0;
    (input.dividends || []).forEach(function (d) {
      var tf = applyTeilfreistellung(Math.max(0, num(d.gross)), typeOf(d.symbol));
      exemptTotal += tf.exempt;
      dividendsTaxable += tf.taxable;
    });

    var vapTaxable = 0, vapGross = 0;
    (input.vorabpauschalen || []).forEach(function (v) {
      var amount = Math.max(0, num(v.amount));
      vapGross += amount;
      var tf = applyTeilfreistellung(amount, typeOf(v.symbol));
      exemptTotal += tf.exempt;
      vapTaxable += tf.taxable;
    });

    var interest = Math.max(0, num(input.interestIncome));

    // Verrechnung: one common pot (the engine does not model the separate
    // stock-loss bucket of sec. 20 (6) — documented simplification).
    var netted = gainsTaxable + lossesTaxable + dividendsTaxable + vapTaxable + interest;
    var afterAllowance = Math.max(0, netted - spb);
    var spbUsed = Math.max(0, Math.min(spb, netted));
    // Tax: prefer the central settings resolver (honours a custom Abgeltung
    // rate + the Soli toggle); fall back to the statutory helper otherwise.
    var taxes;
    if (settings && typeof window !== 'undefined' && window.MaerminTaxSettings) {
      taxes = window.MaerminTaxSettings.computeAbgeltung(afterAllowance, settings);
    } else if (settings && settings.__computeAbgeltung) {
      taxes = settings.__computeAbgeltung(afterAllowance, settings); // Node-injected
    } else {
      taxes = abgeltungsteuer(afterAllowance, settings ? settings.kirchensteuer : input.kirchensteuerRate);
    }

    // Foreign withholding tax credit (sec. 32d (5) EStG): per payout at most
    // the DTA rate of 15% of the gross, never more than the German tax that
    // falls on the dividends that are actually taxed (income sheltered by the
    // Sparerpauschbetrag carries no tax to credit against). With church tax the
    // statutory formula (e - 4q) / (4 + k) reduces the tax by 4q / (4 + k).
    var creditable = 0;
    (input.dividends || []).forEach(function (d) {
      var w = Math.max(0, num(d.withholding));
      if (w > 0) creditable += Math.min(w, 0.15 * Math.max(0, num(d.gross)));
    });
    var k = num(settings ? settings.kirchensteuer : input.kirchensteuerRate);
    if (!(k === 0.08 || k === 0.09)) k = 0;
    var rateBase = (settings && settings.abgeltungRate != null) ? num(settings.abgeltungRate) : 0.25;
    creditable = Math.min(creditable, rateBase * Math.max(0, Math.min(dividendsTaxable, afterAllowance)));
    var withholdingCredit = 0;
    if (creditable > 0 && taxes.tax > 0) {
      var reduction = Math.min(taxes.tax, k > 0 ? (4 * creditable) / (4 + k) : creditable);
      var scale = (taxes.tax - reduction) / taxes.tax;
      withholdingCredit = reduction;
      taxes = { tax: taxes.tax - reduction, soli: taxes.soli * scale, kirchensteuer: taxes.kirchensteuer * scale,
        total: (taxes.tax - reduction) + taxes.soli * scale + taxes.kirchensteuer * scale };
    }

    return {
      withholdingCredit: withholdingCredit,
      gainsTaxable: gainsTaxable,
      lossesTaxable: lossesTaxable,
      dividendsTaxable: dividendsTaxable,
      vorabpauschaleGross: vapGross,
      vorabpauschaleTaxable: vapTaxable,
      vapCreditTotal: vapCreditTotal,
      interestIncome: interest,
      teilfreistellungExempt: exemptTotal,
      nettedIncome: netted,
      sparerpauschbetrag: spb,
      sparerpauschbetragUsed: spbUsed,
      taxableIncome: afterAllowance,
      abgeltungsteuer: taxes.tax,
      soli: taxes.soli,
      kirchensteuer: taxes.kirchensteuer,
      totalTax: taxes.total
    };
  }

  // ---- local settings (browser convenience; pure callers pass maps in) -----
  // maermin_fund_types and maermin_vap_records reveal held symbols / amounts,
  // so both are registered in storage.js SENSITIVE_KEYS (encrypted at rest).
  // Basiszins overrides are public BMF rates - plain.
  var FUND_TYPES_KEY = 'maermin_fund_types';
  var VAP_RECORDS_KEY = 'maermin_vap_records';
  var BASISZINS_KEY = 'maermin_basiszins_overrides';

  function readJson(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* non-fatal */ }
    return obj;
  }

  function loadFundTypes() { return readJson(FUND_TYPES_KEY, {}); }
  function saveFundType(symbol, type) {
    var map = loadFundTypes();
    var sym = String(symbol || '').toUpperCase();
    if (!sym) return map;
    if (TEILFREISTELLUNG[type] != null && type !== 'none') map[sym] = type; else delete map[sym];
    return writeJson(FUND_TYPES_KEY, map);
  }
  function loadBasiszinsOverrides() { return readJson(BASISZINS_KEY, {}); }
  function saveBasiszinsOverride(year, rate) {
    var map = loadBasiszinsOverrides();
    var n = parseFloat(rate);
    if (isFinite(n) && Math.abs(n) < 0.2) map[year] = n; else delete map[year];
    return writeJson(BASISZINS_KEY, map);
  }
  // Church-tax rate (0, 0.08 or 0.09). Reveals a religious affiliation, so it
  // is registered in SENSITIVE_KEYS like the other personal tax inputs.
  var KIRCHENSTEUER_KEY = 'maermin_kirchensteuer';
  function loadKirchensteuerRate() {
    try {
      var n = parseFloat(localStorage.getItem(KIRCHENSTEUER_KEY));
      return (n === 0.08 || n === 0.09) ? n : 0;
    } catch (e) { return 0; }
  }
  function saveKirchensteuerRate(rate) {
    var n = parseFloat(rate);
    try {
      if (n === 0.08 || n === 0.09) localStorage.setItem(KIRCHENSTEUER_KEY, String(n));
      else localStorage.removeItem(KIRCHENSTEUER_KEY);
    } catch (e) { /* non-fatal */ }
    return (n === 0.08 || n === 0.09) ? n : 0;
  }

  // records: { SYMBOL: { year: amountEUR } } - confirmed Vorabpauschalen, so
  // later sales can credit them.
  function loadVapRecords() { return readJson(VAP_RECORDS_KEY, {}); }
  function saveVapRecord(symbol, year, amount) {
    var map = loadVapRecords();
    var sym = String(symbol || '').toUpperCase();
    if (!sym || !year) return map;
    var n = parseFloat(amount);
    if (!map[sym]) map[sym] = {};
    if (isFinite(n) && n > 0) map[sym][year] = n; else delete map[sym][year];
    if (!Object.keys(map[sym]).length) delete map[sym];
    return writeJson(VAP_RECORDS_KEY, map);
  }

  return {
    TEILFREISTELLUNG: TEILFREISTELLUNG,
    BASISZINS: BASISZINS,
    teilfreistellungRate: teilfreistellungRate,
    applyTeilfreistellung: applyTeilfreistellung,
    basiszinsFor: basiszinsFor,
    monthsFactorForPurchase: monthsFactorForPurchase,
    computeVorabpauschale: computeVorabpauschale,
    abgeltungsteuer: abgeltungsteuer,
    computeGermanTaxDetailed: computeGermanTaxDetailed,
    FUND_TYPES_KEY: FUND_TYPES_KEY,
    VAP_RECORDS_KEY: VAP_RECORDS_KEY,
    BASISZINS_KEY: BASISZINS_KEY,
    KIRCHENSTEUER_KEY: KIRCHENSTEUER_KEY,
    loadKirchensteuerRate: loadKirchensteuerRate,
    saveKirchensteuerRate: saveKirchensteuerRate,
    loadFundTypes: loadFundTypes,
    saveFundType: saveFundType,
    loadBasiszinsOverrides: loadBasiszinsOverrides,
    saveBasiszinsOverride: saveBasiszinsOverride,
    loadVapRecords: loadVapRecords,
    saveVapRecord: saveVapRecord
  };
})();

// Make functions globally available (browser); dual-export for Node tests.
if (typeof window !== 'undefined') {
  window.TaxCalculationEngine = { GermanTax: GermanTax };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GermanTax: GermanTax };
}
