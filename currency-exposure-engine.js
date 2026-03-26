// ============================================================================
// MAERMIN v6.0 - Currency Exposure Analysis Engine
// FX exposure calculator, currency impact attribution, hedging recommendations
// ============================================================================

/**
 * Major currencies with metadata
 */
const CURRENCIES = {
  EUR: { name: 'Euro', symbol: '€', region: 'Europe' },
  USD: { name: 'US Dollar', symbol: '$', region: 'North America' },
  GBP: { name: 'British Pound', symbol: '£', region: 'Europe' },
  JPY: { name: 'Japanese Yen', symbol: '¥', region: 'Asia' },
  CHF: { name: 'Swiss Franc', symbol: 'CHF', region: 'Europe' },
  CAD: { name: 'Canadian Dollar', symbol: 'C$', region: 'North America' },
  AUD: { name: 'Australian Dollar', symbol: 'A$', region: 'Oceania' },
  CNY: { name: 'Chinese Yuan', symbol: '¥', region: 'Asia' },
  HKD: { name: 'Hong Kong Dollar', symbol: 'HK$', region: 'Asia' },
  SGD: { name: 'Singapore Dollar', symbol: 'S$', region: 'Asia' },
  KRW: { name: 'South Korean Won', symbol: '₩', region: 'Asia' },
  INR: { name: 'Indian Rupee', symbol: '₹', region: 'Asia' },
  BRL: { name: 'Brazilian Real', symbol: 'R$', region: 'South America' },
  MXN: { name: 'Mexican Peso', symbol: 'Mex$', region: 'North America' },
  SEK: { name: 'Swedish Krona', symbol: 'kr', region: 'Europe' },
  NOK: { name: 'Norwegian Krone', symbol: 'kr', region: 'Europe' },
  DKK: { name: 'Danish Krone', symbol: 'kr', region: 'Europe' },
  PLN: { name: 'Polish Zloty', symbol: 'zł', region: 'Europe' },
  TRY: { name: 'Turkish Lira', symbol: '₺', region: 'Europe/Asia' },
  ZAR: { name: 'South African Rand', symbol: 'R', region: 'Africa' }
};

/**
 * Asset currency mapping (common assets)
 */
const ASSET_CURRENCY_MAP = {
  // US Stocks (USD)
  'AAPL': 'USD', 'MSFT': 'USD', 'GOOGL': 'USD', 'AMZN': 'USD', 
  'TSLA': 'USD', 'META': 'USD', 'NVDA': 'USD', 'JPM': 'USD',
  'V': 'USD', 'JNJ': 'USD', 'WMT': 'USD', 'PG': 'USD',
  
  // German Stocks (EUR)
  'SAP': 'EUR', 'SIE': 'EUR', 'ALV': 'EUR', 'BAS': 'EUR',
  'BMW': 'EUR', 'VOW3': 'EUR', 'DTE': 'EUR', 'MRK': 'EUR',
  
  // UK Stocks (GBP)
  'HSBA': 'GBP', 'BP': 'GBP', 'SHEL': 'GBP', 'AZN': 'GBP',
  'GSK': 'GBP', 'ULVR': 'GBP', 'RIO': 'GBP',
  
  // Japanese Stocks (JPY)
  'TM': 'JPY', 'SONY': 'JPY', '7203': 'JPY', '6758': 'JPY',
  
  // Crypto (USD denominated typically)
  'BTC': 'USD', 'ETH': 'USD', 'SOL': 'USD', 'ADA': 'USD',
  'DOT': 'USD', 'AVAX': 'USD', 'MATIC': 'USD', 'LINK': 'USD',
  
  // CS2 Skins (USD)
  'DEFAULT_SKIN': 'USD'
};

/**
 * Get currency for an asset
 */
function getAssetCurrency(symbol, explicitCurrency) {
  if (explicitCurrency) return explicitCurrency;
  
  const upperSymbol = (symbol || '').toUpperCase();
  return ASSET_CURRENCY_MAP[upperSymbol] || 'USD';
}

/**
 * Calculate currency exposure for portfolio
 * @param {Object} portfolio - Portfolio with positions
 * @param {string} baseCurrency - Base currency for calculations
 * @param {Object} fxRates - Current FX rates (to base currency)
 */
function calculateCurrencyExposure(portfolio, baseCurrency, fxRates) {
  baseCurrency = baseCurrency || 'EUR';
  fxRates = fxRates || {};

  const exposure = {};
  let totalValueBase = 0;

  // Initialize all currencies
  Object.keys(CURRENCIES).forEach(function(currency) {
    exposure[currency] = {
      valueInCurrency: 0,
      valueInBase: 0,
      weight: 0,
      positions: []
    };
  });

  // Process each category
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const currency = pos.currency || getAssetCurrency(symbol);
      const valueInCurrency = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      
      // Convert to base currency
      const fxRate = currency === baseCurrency ? 1 : (fxRates[currency] || 1);
      const valueInBase = valueInCurrency * fxRate;

      if (!exposure[currency]) {
        exposure[currency] = {
          valueInCurrency: 0,
          valueInBase: 0,
          weight: 0,
          positions: []
        };
      }

      exposure[currency].valueInCurrency += valueInCurrency;
      exposure[currency].valueInBase += valueInBase;
      exposure[currency].positions.push({
        symbol: symbol,
        valueInCurrency: valueInCurrency,
        valueInBase: valueInBase,
        category: category
      });

      totalValueBase += valueInBase;
    });
  });

  // Calculate weights
  Object.keys(exposure).forEach(function(currency) {
    exposure[currency].weight = totalValueBase > 0 ?
      (exposure[currency].valueInBase / totalValueBase) * 100 : 0;
    exposure[currency].currencyInfo = CURRENCIES[currency];
  });

  // Filter to only currencies with exposure
  const activeExposure = {};
  Object.keys(exposure).forEach(function(currency) {
    if (exposure[currency].valueInBase > 0) {
      activeExposure[currency] = exposure[currency];
    }
  });

  return {
    baseCurrency: baseCurrency,
    totalValueBase: totalValueBase,
    exposure: activeExposure,
    currencyCount: Object.keys(activeExposure).length
  };
}

/**
 * Analyze currency concentration risk
 */
function analyzeCurrencyConcentration(portfolio, baseCurrency, fxRates) {
  const exposureData = calculateCurrencyExposure(portfolio, baseCurrency, fxRates);
  const exposure = exposureData.exposure;

  const risks = [];
  let herfindahlIndex = 0;

  // Sort by weight
  const sortedCurrencies = Object.keys(exposure)
    .sort(function(a, b) { return exposure[b].weight - exposure[a].weight; });

  sortedCurrencies.forEach(function(currency) {
    const weight = exposure[currency].weight;
    herfindahlIndex += Math.pow(weight / 100, 2);

    if (currency !== baseCurrency && weight > 30) {
      risks.push({
        currency: currency,
        name: CURRENCIES[currency] ? CURRENCIES[currency].name : currency,
        weight: weight,
        severity: weight > 50 ? 'high' : 'medium',
        message: 'High exposure to ' + currency + ' (' + weight.toFixed(1) + 
                '%) creates significant FX risk'
      });
    }
  });

  // Foreign currency exposure (non-base)
  const foreignExposure = sortedCurrencies
    .filter(function(c) { return c !== baseCurrency; })
    .reduce(function(sum, c) { return sum + exposure[c].weight; }, 0);

  return {
    concentrationRisks: risks,
    herfindahlIndex: herfindahlIndex,
    foreignCurrencyExposure: foreignExposure,
    diversificationLevel: herfindahlIndex < 0.3 ? 'good' :
                         herfindahlIndex < 0.5 ? 'moderate' : 'concentrated',
    dominantCurrency: sortedCurrencies[0] ? {
      currency: sortedCurrencies[0],
      weight: exposure[sortedCurrencies[0]].weight
    } : null
  };
}

/**
 * Calculate currency impact on returns
 * @param {Object} portfolio - Portfolio
 * @param {Object} startFxRates - FX rates at start
 * @param {Object} endFxRates - FX rates at end
 * @param {string} baseCurrency - Base currency
 */
function calculateCurrencyImpact(portfolio, startFxRates, endFxRates, baseCurrency) {
  baseCurrency = baseCurrency || 'EUR';

  const exposureData = calculateCurrencyExposure(portfolio, baseCurrency, startFxRates);
  const exposure = exposureData.exposure;

  let totalFxImpact = 0;
  const impactByCurrency = {};

  Object.keys(exposure).forEach(function(currency) {
    if (currency === baseCurrency) {
      impactByCurrency[currency] = {
        fxChange: 0,
        impact: 0,
        impactPercent: 0
      };
      return;
    }

    const startRate = startFxRates[currency] || 1;
    const endRate = endFxRates[currency] || startRate;
    const fxChange = ((endRate - startRate) / startRate) * 100;

    // Impact = exposure weight * FX change
    const impact = (exposure[currency].weight / 100) * fxChange;
    totalFxImpact += impact;

    impactByCurrency[currency] = {
      startRate: startRate,
      endRate: endRate,
      fxChange: fxChange,
      weight: exposure[currency].weight,
      impact: impact,
      impactPercent: impact
    };
  });

  return {
    baseCurrency: baseCurrency,
    totalFxImpact: totalFxImpact,
    impactByCurrency: impactByCurrency,
    interpretation: totalFxImpact > 2 ? 'Currency movements boosted returns' :
                   totalFxImpact < -2 ? 'Currency movements hurt returns' :
                   'Minimal currency impact on returns'
  };
}

/**
 * Generate hedging recommendations
 */
function generateHedgingRecommendations(portfolio, baseCurrency, fxRates, config) {
  config = config || {};
  const hedgingThreshold = config.hedgingThreshold || 20; // % exposure to trigger recommendation
  const riskTolerance = config.riskTolerance || 'moderate';

  const exposureData = calculateCurrencyExposure(portfolio, baseCurrency, fxRates);
  const exposure = exposureData.exposure;
  const concentration = analyzeCurrencyConcentration(portfolio, baseCurrency, fxRates);

  const recommendations = [];

  Object.keys(exposure).forEach(function(currency) {
    if (currency === baseCurrency) return;

    const weight = exposure[currency].weight;
    const value = exposure[currency].valueInBase;

    if (weight > hedgingThreshold) {
      const urgency = weight > 40 ? 'high' : weight > 30 ? 'medium' : 'low';
      
      recommendations.push({
        currency: currency,
        currencyName: CURRENCIES[currency] ? CURRENCIES[currency].name : currency,
        exposure: weight,
        valueAtRisk: value,
        urgency: urgency,
        hedgingOptions: getHedgingOptions(currency, value, baseCurrency),
        recommendation: getHedgingRecommendation(weight, riskTolerance)
      });
    }
  });

  // Sort by exposure
  recommendations.sort(function(a, b) { return b.exposure - a.exposure; });

  // Overall hedging strategy
  let overallStrategy;
  if (concentration.foreignCurrencyExposure > 60) {
    overallStrategy = 'Consider systematic currency hedging for major exposures';
  } else if (concentration.foreignCurrencyExposure > 30) {
    overallStrategy = 'Selective hedging recommended for largest currency exposures';
  } else {
    overallStrategy = 'Currency exposure is manageable - hedging optional';
  }

  return {
    recommendations: recommendations,
    overallStrategy: overallStrategy,
    totalForeignExposure: concentration.foreignCurrencyExposure,
    hedgingCost: estimateHedgingCost(recommendations)
  };
}

/**
 * Get hedging options for a currency
 */
function getHedgingOptions(currency, value, baseCurrency) {
  const options = [];

  // Currency-hedged ETFs
  options.push({
    type: 'Currency-Hedged ETF',
    description: 'Replace unhedged positions with currency-hedged versions',
    pros: ['Simple', 'Low maintenance'],
    cons: ['Higher expense ratio', 'Limited availability']
  });

  // Forward contracts (for larger portfolios)
  if (value > 50000) {
    options.push({
      type: 'Forward Contract',
      description: 'Lock in exchange rate for future date',
      pros: ['Precise hedging', 'No upfront cost'],
      cons: ['Requires commitment', 'Counterparty risk']
    });
  }

  // Currency ETFs
  options.push({
    type: 'Currency Short ETF',
    description: 'Use inverse currency ETF to offset exposure',
    pros: ['Liquid', 'Easy to implement'],
    cons: ['Decay over time', 'Not perfect hedge']
  });

  // Options
  if (value > 100000) {
    options.push({
      type: 'Currency Options',
      description: 'Buy puts on the foreign currency',
      pros: ['Asymmetric protection', 'Keep upside'],
      cons: ['Premium cost', 'Complexity']
    });
  }

  return options;
}

/**
 * Get hedging recommendation based on exposure and risk tolerance
 */
function getHedgingRecommendation(exposurePercent, riskTolerance) {
  const hedgeRatios = {
    conservative: { low: 75, medium: 85, high: 95 },
    moderate: { low: 50, medium: 65, high: 80 },
    aggressive: { low: 25, medium: 40, high: 60 }
  };

  const ratios = hedgeRatios[riskTolerance] || hedgeRatios.moderate;
  
  let hedgeRatio;
  if (exposurePercent > 40) hedgeRatio = ratios.high;
  else if (exposurePercent > 25) hedgeRatio = ratios.medium;
  else hedgeRatio = ratios.low;

  return {
    suggestedHedgeRatio: hedgeRatio,
    reasoning: 'Based on ' + riskTolerance + ' risk tolerance and ' + 
              exposurePercent.toFixed(0) + '% exposure'
  };
}

/**
 * Estimate hedging cost
 */
function estimateHedgingCost(recommendations) {
  // Rough estimate: hedging costs ~0.5-2% annually
  const avgCostRate = 0.01; // 1% annual cost
  
  const totalValueToHedge = recommendations.reduce(function(sum, rec) {
    const hedgeRatio = rec.recommendation ? rec.recommendation.suggestedHedgeRatio / 100 : 0.5;
    return sum + (rec.valueAtRisk * hedgeRatio);
  }, 0);

  return {
    estimatedAnnualCost: totalValueToHedge * avgCostRate,
    costAsPercent: avgCostRate * 100,
    note: 'Actual costs vary based on currency pair and method'
  };
}

/**
 * Calculate portfolio value in multiple currencies
 */
function calculateMultiCurrencyValue(portfolio, baseCurrency, fxRates) {
  const exposureData = calculateCurrencyExposure(portfolio, baseCurrency, fxRates);
  const totalValueBase = exposureData.totalValueBase;

  const values = {};
  
  Object.keys(CURRENCIES).forEach(function(currency) {
    if (currency === baseCurrency) {
      values[currency] = totalValueBase;
    } else {
      const rate = fxRates[currency] || 1;
      values[currency] = totalValueBase / rate;
    }
  });

  return {
    baseCurrency: baseCurrency,
    baseValue: totalValueBase,
    values: values
  };
}

/**
 * Analyze regional currency exposure
 */
function analyzeRegionalExposure(portfolio, baseCurrency, fxRates) {
  const exposureData = calculateCurrencyExposure(portfolio, baseCurrency, fxRates);
  const exposure = exposureData.exposure;

  const regionalExposure = {};

  Object.keys(exposure).forEach(function(currency) {
    const currencyInfo = CURRENCIES[currency];
    const region = currencyInfo ? currencyInfo.region : 'Other';

    if (!regionalExposure[region]) {
      regionalExposure[region] = {
        weight: 0,
        currencies: []
      };
    }

    regionalExposure[region].weight += exposure[currency].weight;
    regionalExposure[region].currencies.push({
      currency: currency,
      weight: exposure[currency].weight
    });
  });

  return {
    byRegion: regionalExposure,
    dominantRegion: Object.keys(regionalExposure)
      .sort(function(a, b) { 
        return regionalExposure[b].weight - regionalExposure[a].weight; 
      })[0]
  };
}

/**
 * Generate currency exposure report
 */
function generateCurrencyReport(portfolio, baseCurrency, fxRates, config) {
  const exposure = calculateCurrencyExposure(portfolio, baseCurrency, fxRates);
  const concentration = analyzeCurrencyConcentration(portfolio, baseCurrency, fxRates);
  const hedging = generateHedgingRecommendations(portfolio, baseCurrency, fxRates, config);
  const regional = analyzeRegionalExposure(portfolio, baseCurrency, fxRates);
  const multiValue = calculateMultiCurrencyValue(portfolio, baseCurrency, fxRates);

  return {
    generated: new Date().toISOString(),
    baseCurrency: baseCurrency,
    exposure: exposure,
    concentration: concentration,
    hedgingRecommendations: hedging,
    regionalExposure: regional,
    multiCurrencyValue: multiValue,
    summary: {
      totalValue: exposure.totalValueBase,
      currencyCount: exposure.currencyCount,
      foreignExposure: concentration.foreignCurrencyExposure,
      diversificationLevel: concentration.diversificationLevel,
      needsHedging: hedging.recommendations.length > 0
    }
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.CurrencyExposureEngine = {
    CURRENCIES: CURRENCIES,
    getAssetCurrency: getAssetCurrency,
    calculateCurrencyExposure: calculateCurrencyExposure,
    analyzeCurrencyConcentration: analyzeCurrencyConcentration,
    calculateCurrencyImpact: calculateCurrencyImpact,
    generateHedgingRecommendations: generateHedgingRecommendations,
    calculateMultiCurrencyValue: calculateMultiCurrencyValue,
    analyzeRegionalExposure: analyzeRegionalExposure,
    generateCurrencyReport: generateCurrencyReport
  };
  
  console.log('[OK] Currency Exposure Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CURRENCIES,
    getAssetCurrency,
    calculateCurrencyExposure,
    analyzeCurrencyConcentration,
    calculateCurrencyImpact,
    generateHedgingRecommendations,
    calculateMultiCurrencyValue,
    analyzeRegionalExposure,
    generateCurrencyReport
  };
}
