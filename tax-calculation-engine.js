// ============================================================================
// MAERMIN v5.1 - Advanced Tax Calculation Engine
// Accurate calculations for German and US tax law
// ============================================================================

/**
 * Calculate realized gains from transactions using FIFO method
 * Matches sell transactions with corresponding buy transactions
 */
function calculateRealizedGainsAdvanced(transactions, year) {
  if (!transactions || !Array.isArray(transactions)) {
    return {
      transactions: [],
      totalShortTermGains: 0,
      totalLongTermGains: 0,
      cryptoShortTermGains: 0,
      cryptoLongTermGains: 0,
      stocksShortTermGains: 0,
      stocksLongTermGains: 0
    };
  }

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  // Group transactions by symbol. Accept BOTH shapes: the legacy
  // { asset: { symbol, category }, transactionDate } records this engine was
  // written for, and the app's actual transaction model { symbol, category,
  // date } — the renderer has always passed the latter, which made every
  // lookup miss and every tax figure compute as zero.
  const symbols = {};

  transactions.forEach(tx => {
    const symbol = tx.asset?.symbol || tx.symbol;
    if (!symbol) return;

    if (!symbols[symbol]) {
      symbols[symbol] = {
        buys: [],
        sells: [],
        category: tx.asset?.category || tx.category || 'crypto'
      };
    }

    // Clone buy rows: FIFO matching decrements lot quantities as it consumes
    // them, and doing that on the caller's transaction objects would silently
    // corrupt the app state the next time anything reads quantities.
    if (tx.type === 'buy') {
      symbols[symbol].buys.push({ ...tx });
    } else if (tx.type === 'sell') {
      symbols[symbol].sells.push(tx);
    }
  });

  const results = [];
  let totalShortTermGains = 0;
  let totalLongTermGains = 0;
  let cryptoShortTermGains = 0;
  let cryptoLongTermGains = 0;
  let stocksShortTermGains = 0;
  let stocksLongTermGains = 0;

  // Process each symbol
  Object.keys(symbols).forEach(symbol => {
    const data = symbols[symbol];
    
    // Sort buys by date (FIFO)
    data.buys.sort((a, b) => new Date(a.transactionDate || a.timestamp || a.date) - new Date(b.transactionDate || b.timestamp || b.date));
    
    // Sort sells by date
    data.sells.sort((a, b) => new Date(a.transactionDate || a.timestamp || a.date) - new Date(b.transactionDate || b.timestamp || b.date));
    
    // Process each sell transaction
    data.sells.forEach(sell => {
      const sellDate = new Date(sell.transactionDate || sell.timestamp || sell.date);
      
      // Only include sells in the selected year
      if (sellDate < yearStart || sellDate > yearEnd) return;
      
      let remainingQuantity = sell.quantity;
      let totalCostBasis = 0;
      let totalProceeds = sell.totalCost || (sell.price * sell.quantity);
      let weightedHoldingPeriod = 0;
      const matchedBuys = [];
      
      // Match with buys using FIFO
      for (let i = 0; i < data.buys.length && remainingQuantity > 0.0001; i++) {
        const buy = data.buys[i];
        const buyDate = new Date(buy.transactionDate || buy.timestamp || buy.date);
        
        // Skip buys after sell date
        if (buyDate > sellDate) continue;
        
        // Calculate available quantity from this buy
        const usedQuantity = Math.min(remainingQuantity, buy.quantity);
        
        // Calculate cost basis for this portion
        const costBasis = (buy.price * usedQuantity) + ((buy.fees || 0) * (usedQuantity / buy.quantity));
        totalCostBasis += costBasis;
        
        // Calculate holding period in days
        const holdingPeriodDays = Math.floor((sellDate - buyDate) / (1000 * 60 * 60 * 24));
        weightedHoldingPeriod += holdingPeriodDays * usedQuantity;
        
        matchedBuys.push({
          buyDate: buyDate,
          quantity: usedQuantity,
          price: buy.price,
          costBasis: costBasis,
          holdingPeriod: holdingPeriodDays
        });
        
        remainingQuantity -= usedQuantity;
        
        // Update remaining quantity in buy
        buy.quantity -= usedQuantity;
      }
      
      // Calculate average holding period
      const totalMatchedQuantity = sell.quantity - remainingQuantity;
      const avgHoldingPeriod = totalMatchedQuantity > 0 ? Math.floor(weightedHoldingPeriod / totalMatchedQuantity) : 0;
      
      // Calculate gain/loss
      const sellFees = sell.fees || 0;
      const proceeds = totalProceeds - sellFees;
      const gain = proceeds - totalCostBasis;
      
      // Determine if long-term or short-term
      const isLongTerm = avgHoldingPeriod >= 365;
      
      // Categorize by asset type and term
      if (data.category === 'crypto') {
        if (isLongTerm) {
          cryptoLongTermGains += gain;
          totalLongTermGains += gain;
        } else {
          cryptoShortTermGains += gain;
          totalShortTermGains += gain;
        }
      } else {
        // Stocks, CS2, etc.
        if (isLongTerm) {
          stocksLongTermGains += gain;
          totalLongTermGains += gain;
        } else {
          stocksShortTermGains += gain;
          totalShortTermGains += gain;
        }
      }
      
      // Add to results
      results.push({
        ...sell,
        realizedGain: {
          gain: gain,
          proceeds: proceeds,
          costBasis: totalCostBasis,
          holdingPeriod: avgHoldingPeriod,
          isLongTerm: isLongTerm,
          matchedBuys: matchedBuys
        }
      });
    });
  });

  return {
    transactions: results,
    totalShortTermGains: totalShortTermGains,
    totalLongTermGains: totalLongTermGains,
    totalGains: totalShortTermGains + totalLongTermGains,
    cryptoShortTermGains: cryptoShortTermGains,
    cryptoLongTermGains: cryptoLongTermGains,
    stocksShortTermGains: stocksShortTermGains,
    stocksLongTermGains: stocksLongTermGains
  };
}

/**
 * German Tax Calculation
 * Key differences:
 * - Crypto held > 1 year = TAX FREE (completely exempt!)
 * - Crypto held ≤ 1 year = 25% Abgeltungssteuer + 5.5% Soli
 * - Stocks = Always 25% + Soli (no holding period benefit)
 * - €1,000 Freistellungsauftrag applies to ALL gains
 */
function calculateGermanTax(transactions, year) {
  const gains = calculateRealizedGainsAdvanced(transactions, year);
  
  // GERMAN RULE: Crypto > 1 year is TAX FREE!
  const taxableCryptoGains = gains.cryptoShortTermGains; // Only short-term crypto is taxable
  const taxFreeCryptoGains = gains.cryptoLongTermGains;  // Long-term crypto is TAX FREE
  
  // GERMAN RULE: Stocks always taxed at 25%, regardless of holding period
  const taxableStocksGains = gains.stocksShortTermGains + gains.stocksLongTermGains;
  
  // Total taxable capital income
  const totalCapitalIncome = taxableCryptoGains + taxableStocksGains;
  
  // Apply Freistellungsauftrag (€1,000 tax-free allowance)
  const FREISTELLUNGSAUFTRAG = 1000;
  const taxableIncome = Math.max(0, totalCapitalIncome - FREISTELLUNGSAUFTRAG);
  
  // Calculate Abgeltungssteuer (25%)
  const ABGELTUNGSSTEUER_RATE = 0.25;
  const abgeltungssteuer = taxableIncome * ABGELTUNGSSTEUER_RATE;
  
  // Calculate Solidaritätszuschlag (5.5% of Abgeltungssteuer)
  const SOLIDARITY_RATE = 0.055;
  const solidarityTax = abgeltungssteuer * SOLIDARITY_RATE;
  
  // Total tax owed
  const totalTax = abgeltungssteuer + solidarityTax;
  
  // Effective tax rate
  const effectiveTaxRate = totalCapitalIncome > 0 ? (totalTax / totalCapitalIncome) * 100 : 0;
  
  // Tax savings from crypto 1-year rule
  const cryptoTaxSavings = taxFreeCryptoGains * ABGELTUNGSSTEUER_RATE * (1 + SOLIDARITY_RATE);
  
  return {
    jurisdiction: 'de',
    year: year,
    
    // Breakdown
    cryptoShortTermGains: gains.cryptoShortTermGains,
    cryptoLongTermGains: gains.cryptoLongTermGains,
    cryptoTaxableGains: taxableCryptoGains,
    cryptoTaxFreeGains: taxFreeCryptoGains,
    
    stocksGains: taxableStocksGains,
    
    // Summary
    totalCapitalIncome: totalCapitalIncome,
    freistellungsauftrag: FREISTELLUNGSAUFTRAG,
    freistellungsauftragUsed: Math.min(totalCapitalIncome, FREISTELLUNGSAUFTRAG),
    taxableIncome: taxableIncome,
    
    // Taxes
    abgeltungssteuer: abgeltungssteuer,
    solidarityTax: solidarityTax,
    totalTax: totalTax,
    effectiveTaxRate: effectiveTaxRate,
    
    // Savings
    cryptoTaxSavings: cryptoTaxSavings,
    
    // Transactions
    transactions: gains.transactions
  };
}

/**
 * US Tax Calculation
 * Key differences:
 * - ALL sales are taxable (crypto and stocks treated the same)
 * - Short-term (≤ 1 year) = Ordinary income rates (estimated at 24%)
 * - Long-term (> 1 year) = Preferential rates (15% for most taxpayers)
 * - No general exemption amount
 */
function calculateUSTax(transactions, year) {
  const gains = calculateRealizedGainsAdvanced(transactions, year);
  
  // US RULE: ALL gains are taxable (crypto and stocks same treatment)
  const shortTermGains = gains.totalShortTermGains;
  const longTermGains = gains.totalLongTermGains;
  
  // Tax rate estimates (vary by income bracket)
  const SHORT_TERM_RATE = 0.24;  // Ordinary income - using 24% bracket estimate
  const LONG_TERM_RATE = 0.15;   // Long-term capital gains - 15% for most taxpayers
  
  // Calculate taxes
  const shortTermTax = shortTermGains * SHORT_TERM_RATE;
  const longTermTax = longTermGains * LONG_TERM_RATE;
  const totalTax = shortTermTax + longTermTax;
  
  // Total gains
  const totalGains = shortTermGains + longTermGains;
  
  // Effective tax rate
  const effectiveTaxRate = totalGains > 0 ? (totalTax / totalGains) * 100 : 0;
  
  return {
    jurisdiction: 'us',
    year: year,
    
    // Breakdown
    shortTermGains: shortTermGains,
    longTermGains: longTermGains,
    
    cryptoShortTermGains: gains.cryptoShortTermGains,
    cryptoLongTermGains: gains.cryptoLongTermGains,
    stocksShortTermGains: gains.stocksShortTermGains,
    stocksLongTermGains: gains.stocksLongTermGains,
    
    // Summary
    totalGains: totalGains,
    
    // Taxes (estimates)
    shortTermTax: shortTermTax,
    longTermTax: longTermTax,
    totalTax: totalTax,
    effectiveTaxRate: effectiveTaxRate,
    
    // Rate information
    shortTermRate: SHORT_TERM_RATE * 100,
    longTermRate: LONG_TERM_RATE * 100,
    
    // Transactions
    transactions: gains.transactions
  };
}

/**
 * Generate comprehensive tax report for selected jurisdiction
 */
function generateTaxReportAdvanced(transactions, year, jurisdiction) {
  if (jurisdiction === 'de') {
    return calculateGermanTax(transactions, year);
  } else if (jurisdiction === 'us') {
    return calculateUSTax(transactions, year);
  } else {
    throw new Error('Unknown jurisdiction: ' + jurisdiction);
  }
}

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
    2022: -0.0005, 2023: 0.0255, 2024: 0.0229, 2025: 0.0253
  };

  function teilfreistellungRate(fundType) {
    return TEILFREISTELLUNG[fundType] != null ? TEILFREISTELLUNG[fundType] : 0;
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
    var d = new Date(purchaseDate);
    if (isNaN(d.getTime())) return 1;
    var py = d.getFullYear();
    if (py < year) return 1;
    if (py > year) return 0;
    return (12 - d.getMonth()) / 12; // getMonth() Jan=0 → bought in Jan = 12/12
  }

  // Vorabpauschale for ONE accumulating fund position and ONE year.
  //   Basisertrag   = value at year start x Basiszins x 0.7 x month factor
  //   capped by the actual value increase over the year,
  //   reduced by distributions paid out during the year, floored at 0.
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
    var vorabpauschale = Math.max(0, Math.min(basisertrag, wertzuwachs) - distributions);
    return { basisertrag: basisertrag, wertzuwachs: wertzuwachs, vorabpauschale: vorabpauschale };
  }

  // Credit of previously taxed Vorabpauschalen against a sale: the recorded
  // amounts for years BEFORE the sale year reduce the taxable gain, pro-rated
  // by the fraction of the position sold.
  function vapCreditForSale(records, symbol, sellYear, fractionSold) {
    var bySym = (records && records[String(symbol || '').toUpperCase()]) || {};
    var frac = Math.max(0, Math.min(1, num(fractionSold) || 1));
    var total = 0;
    Object.keys(bySym).forEach(function (y) {
      if (parseInt(y, 10) < sellYear) total += num(bySym[y]);
    });
    return total * frac;
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
    var spb = input.sparerpauschbetrag != null ? num(input.sparerpauschbetrag) : 1000;

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
    var taxes = abgeltungsteuer(afterAllowance, input.kirchensteuerRate);

    return {
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
    vapCreditForSale: vapCreditForSale,
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
  window.calculateRealizedGainsAdvanced = calculateRealizedGainsAdvanced;
  window.calculateGermanTax = calculateGermanTax;
  window.calculateUSTax = calculateUSTax;
  window.generateTaxReportAdvanced = generateTaxReportAdvanced;

  // Create TaxCalculationEngine object for easy access
  window.TaxCalculationEngine = {
    calculateRealizedGains: calculateRealizedGainsAdvanced,
    calculateGermanTax: calculateGermanTax,
    calculateUSTax: calculateUSTax,
    generateTaxReport: generateTaxReportAdvanced,
    GermanTax: GermanTax,
    calculateTaxes: function(transactions, jurisdiction, year) {
      var result = generateTaxReportAdvanced(transactions, year, jurisdiction);
      return {
        realizedGains: result.totalCapitalIncome || 0,
        shortTerm: result.cryptoShortTermGains || result.shortTermGains || 0,
        longTerm: result.cryptoLongTermGains || result.longTermGains || 0,
        taxLiability: result.totalTax || 0,
        taxFree: result.cryptoTaxFreeGains || 0,
        transactions: result.transactions || []
      };
    }
  };

  console.log('[TAX ENGINE] Advanced tax calculation loaded');
  console.log('[TAX ENGINE] Supports: Germany (crypto exemption, Vorabpauschale, Teilfreistellung) | USA (all taxable)');
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateRealizedGainsAdvanced: calculateRealizedGainsAdvanced,
    calculateGermanTax: calculateGermanTax,
    calculateUSTax: calculateUSTax,
    generateTaxReportAdvanced: generateTaxReportAdvanced,
    GermanTax: GermanTax
  };
}
