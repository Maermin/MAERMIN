// ============================================================================
// MAERMIN v6.0 - Economic Indicator Dashboard Engine
// Key macro data, asset class sensitivity, recession probability
// ============================================================================

/**
 * Economic indicators with metadata
 */
const ECONOMIC_INDICATORS = {
  // Growth indicators
  gdpGrowth: {
    name: 'GDP Growth Rate',
    category: 'growth',
    unit: '%',
    frequency: 'quarterly',
    leadingIndicator: false,
    description: 'Year-over-year GDP growth'
  },
  industrialProduction: {
    name: 'Industrial Production',
    category: 'growth',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: true,
    description: 'Monthly change in industrial output'
  },
  pmi: {
    name: 'Manufacturing PMI',
    category: 'growth',
    unit: 'index',
    frequency: 'monthly',
    leadingIndicator: true,
    threshold: 50,
    description: 'Purchasing Managers Index (>50 = expansion)'
  },
  servicePmi: {
    name: 'Services PMI',
    category: 'growth',
    unit: 'index',
    frequency: 'monthly',
    leadingIndicator: true,
    threshold: 50,
    description: 'Services sector activity index'
  },

  // Inflation indicators
  cpi: {
    name: 'CPI Inflation',
    category: 'inflation',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    target: 2.0,
    description: 'Consumer Price Index year-over-year'
  },
  coreCpi: {
    name: 'Core CPI',
    category: 'inflation',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    target: 2.0,
    description: 'CPI excluding food and energy'
  },
  pce: {
    name: 'PCE Inflation',
    category: 'inflation',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    target: 2.0,
    description: 'Fed preferred inflation measure'
  },
  ppi: {
    name: 'Producer Price Index',
    category: 'inflation',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: true,
    description: 'Wholesale price inflation'
  },

  // Employment indicators
  unemploymentRate: {
    name: 'Unemployment Rate',
    category: 'employment',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Percentage of labor force unemployed'
  },
  nonfarmPayrolls: {
    name: 'Nonfarm Payrolls',
    category: 'employment',
    unit: 'thousands',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Monthly job gains/losses'
  },
  initialClaims: {
    name: 'Initial Jobless Claims',
    category: 'employment',
    unit: 'thousands',
    frequency: 'weekly',
    leadingIndicator: true,
    description: 'New unemployment claims'
  },
  laborForceParticipation: {
    name: 'Labor Force Participation',
    category: 'employment',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Percentage of working-age population in labor force'
  },

  // Interest rates
  fedFundsRate: {
    name: 'Fed Funds Rate',
    category: 'rates',
    unit: '%',
    frequency: 'as needed',
    leadingIndicator: false,
    description: 'Federal Reserve target rate'
  },
  treasury10y: {
    name: '10-Year Treasury Yield',
    category: 'rates',
    unit: '%',
    frequency: 'daily',
    leadingIndicator: true,
    description: 'Benchmark long-term rate'
  },
  treasury2y: {
    name: '2-Year Treasury Yield',
    category: 'rates',
    unit: '%',
    frequency: 'daily',
    leadingIndicator: true,
    description: 'Short-term rate expectations'
  },
  yieldCurveSpread: {
    name: '10Y-2Y Yield Spread',
    category: 'rates',
    unit: 'bps',
    frequency: 'daily',
    leadingIndicator: true,
    description: 'Yield curve slope (negative = inverted)'
  },

  // Consumer indicators
  consumerConfidence: {
    name: 'Consumer Confidence',
    category: 'consumer',
    unit: 'index',
    frequency: 'monthly',
    leadingIndicator: true,
    description: 'Conference Board Consumer Confidence'
  },
  retailSales: {
    name: 'Retail Sales',
    category: 'consumer',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Monthly change in retail sales'
  },
  personalSavingsRate: {
    name: 'Personal Savings Rate',
    category: 'consumer',
    unit: '%',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Savings as percentage of income'
  },

  // Housing
  housingStarts: {
    name: 'Housing Starts',
    category: 'housing',
    unit: 'thousands',
    frequency: 'monthly',
    leadingIndicator: true,
    description: 'New residential construction'
  },
  existingHomeSales: {
    name: 'Existing Home Sales',
    category: 'housing',
    unit: 'millions',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'Annualized existing home sales'
  },
  caseShillerIndex: {
    name: 'Case-Shiller Home Price Index',
    category: 'housing',
    unit: 'index',
    frequency: 'monthly',
    leadingIndicator: false,
    description: 'National home price index'
  },

  // Market indicators
  vix: {
    name: 'VIX (Fear Index)',
    category: 'market',
    unit: 'index',
    frequency: 'daily',
    leadingIndicator: true,
    threshold: 20,
    description: 'Market volatility expectation'
  },
  creditSpread: {
    name: 'High Yield Credit Spread',
    category: 'market',
    unit: 'bps',
    frequency: 'daily',
    leadingIndicator: true,
    description: 'Spread between junk bonds and treasuries'
  }
};

/**
 * Asset class sensitivity to economic indicators
 */
const ASSET_SENSITIVITIES = {
  stocks: {
    gdpGrowth: 0.8,
    cpi: -0.3,
    fedFundsRate: -0.5,
    unemploymentRate: -0.4,
    consumerConfidence: 0.6,
    pmi: 0.7,
    vix: -0.9
  },
  bonds: {
    gdpGrowth: -0.3,
    cpi: -0.7,
    fedFundsRate: -0.8,
    treasury10y: -0.9,
    unemploymentRate: 0.3,
    vix: 0.4
  },
  crypto: {
    gdpGrowth: 0.3,
    cpi: 0.2,
    fedFundsRate: -0.6,
    vix: -0.5,
    creditSpread: -0.4
  },
  gold: {
    gdpGrowth: -0.2,
    cpi: 0.6,
    fedFundsRate: -0.4,
    vix: 0.5,
    treasury10y: -0.3
  },
  realEstate: {
    gdpGrowth: 0.5,
    fedFundsRate: -0.7,
    treasury10y: -0.6,
    housingStarts: 0.8,
    unemploymentRate: -0.4
  }
};

/**
 * Create economic dashboard with current data
 * @param {Object} currentData - Current economic data
 */
function createEconomicDashboard(currentData) {
  const dashboard = {
    growth: [],
    inflation: [],
    employment: [],
    rates: [],
    consumer: [],
    housing: [],
    market: []
  };

  Object.keys(ECONOMIC_INDICATORS).forEach(function(key) {
    const indicator = ECONOMIC_INDICATORS[key];
    const value = currentData ? currentData[key] : null;
    
    const entry = {
      key: key,
      name: indicator.name,
      value: value,
      unit: indicator.unit,
      frequency: indicator.frequency,
      isLeadingIndicator: indicator.leadingIndicator,
      status: assessIndicatorStatus(key, value, indicator),
      description: indicator.description
    };

    if (dashboard[indicator.category]) {
      dashboard[indicator.category].push(entry);
    }
  });

  return dashboard;
}

/**
 * Assess indicator status (positive/negative/neutral)
 */
function assessIndicatorStatus(key, value, indicator) {
  if (value === null || value === undefined) {
    return { status: 'unknown', message: 'No data' };
  }

  // PMI indicators
  if (key === 'pmi' || key === 'servicePmi') {
    if (value > 55) return { status: 'positive', message: 'Strong expansion' };
    if (value > 50) return { status: 'positive', message: 'Expanding' };
    if (value > 45) return { status: 'negative', message: 'Contracting' };
    return { status: 'negative', message: 'Sharp contraction' };
  }

  // Inflation
  if (key === 'cpi' || key === 'coreCpi' || key === 'pce') {
    const target = indicator.target || 2.0;
    if (value > target + 2) return { status: 'negative', message: 'High inflation' };
    if (value > target + 0.5) return { status: 'warning', message: 'Above target' };
    if (value >= target - 0.5) return { status: 'positive', message: 'Near target' };
    return { status: 'warning', message: 'Below target' };
  }

  // Unemployment
  if (key === 'unemploymentRate') {
    if (value < 4) return { status: 'positive', message: 'Low unemployment' };
    if (value < 5) return { status: 'positive', message: 'Healthy labor market' };
    if (value < 7) return { status: 'warning', message: 'Elevated unemployment' };
    return { status: 'negative', message: 'High unemployment' };
  }

  // VIX
  if (key === 'vix') {
    if (value < 15) return { status: 'positive', message: 'Low volatility' };
    if (value < 20) return { status: 'positive', message: 'Normal volatility' };
    if (value < 30) return { status: 'warning', message: 'Elevated volatility' };
    return { status: 'negative', message: 'High fear' };
  }

  // Yield curve
  if (key === 'yieldCurveSpread') {
    if (value < -50) return { status: 'negative', message: 'Deeply inverted - recession signal' };
    if (value < 0) return { status: 'warning', message: 'Inverted yield curve' };
    if (value < 50) return { status: 'warning', message: 'Flat yield curve' };
    return { status: 'positive', message: 'Normal yield curve' };
  }

  // GDP Growth
  if (key === 'gdpGrowth') {
    if (value > 3) return { status: 'positive', message: 'Strong growth' };
    if (value > 1) return { status: 'positive', message: 'Moderate growth' };
    if (value > 0) return { status: 'warning', message: 'Weak growth' };
    return { status: 'negative', message: 'Contraction' };
  }

  return { status: 'neutral', message: 'Normal' };
}

/**
 * Calculate recession probability based on indicators
 * Uses yield curve, employment, and leading indicators
 */
function calculateRecessionProbability(currentData) {
  let probability = 0;
  const factors = [];

  // Yield curve inversion (strong predictor)
  if (currentData.yieldCurveSpread !== undefined) {
    const spread = currentData.yieldCurveSpread;
    if (spread < -50) {
      probability += 35;
      factors.push({ factor: 'Deeply inverted yield curve', impact: 35 });
    } else if (spread < 0) {
      probability += 25;
      factors.push({ factor: 'Inverted yield curve', impact: 25 });
    } else if (spread < 50) {
      probability += 10;
      factors.push({ factor: 'Flat yield curve', impact: 10 });
    }
  }

  // Rising unemployment
  if (currentData.unemploymentRate !== undefined && currentData.unemploymentRatePrior !== undefined) {
    const change = currentData.unemploymentRate - currentData.unemploymentRatePrior;
    if (change > 0.5) {
      probability += 20;
      factors.push({ factor: 'Rising unemployment', impact: 20 });
    } else if (change > 0.2) {
      probability += 10;
      factors.push({ factor: 'Moderately rising unemployment', impact: 10 });
    }
  }

  // PMI below 50
  if (currentData.pmi !== undefined) {
    if (currentData.pmi < 45) {
      probability += 25;
      factors.push({ factor: 'Manufacturing contraction', impact: 25 });
    } else if (currentData.pmi < 50) {
      probability += 15;
      factors.push({ factor: 'Manufacturing weakness', impact: 15 });
    }
  }

  // Consumer confidence declining
  if (currentData.consumerConfidence !== undefined && 
      currentData.consumerConfidencePrior !== undefined) {
    const change = currentData.consumerConfidence - currentData.consumerConfidencePrior;
    if (change < -15) {
      probability += 15;
      factors.push({ factor: 'Sharply declining consumer confidence', impact: 15 });
    } else if (change < -5) {
      probability += 8;
      factors.push({ factor: 'Declining consumer confidence', impact: 8 });
    }
  }

  // Credit spreads widening
  if (currentData.creditSpread !== undefined) {
    if (currentData.creditSpread > 600) {
      probability += 20;
      factors.push({ factor: 'Very wide credit spreads', impact: 20 });
    } else if (currentData.creditSpread > 400) {
      probability += 10;
      factors.push({ factor: 'Elevated credit spreads', impact: 10 });
    }
  }

  // Initial claims rising
  if (currentData.initialClaims !== undefined) {
    if (currentData.initialClaims > 400) {
      probability += 15;
      factors.push({ factor: 'High jobless claims', impact: 15 });
    } else if (currentData.initialClaims > 300) {
      probability += 8;
      factors.push({ factor: 'Rising jobless claims', impact: 8 });
    }
  }

  // Cap at 95%
  probability = Math.min(95, probability);

  let riskLevel;
  if (probability > 60) riskLevel = 'high';
  else if (probability > 35) riskLevel = 'elevated';
  else if (probability > 15) riskLevel = 'moderate';
  else riskLevel = 'low';

  return {
    probability: probability,
    riskLevel: riskLevel,
    factors: factors,
    interpretation: getRecessionInterpretation(probability),
    recommendation: getRecessionRecommendation(probability)
  };
}

/**
 * Get recession interpretation
 */
function getRecessionInterpretation(probability) {
  if (probability > 60) {
    return 'Recession risk is high. Multiple warning signs are flashing.';
  } else if (probability > 35) {
    return 'Recession risk is elevated. Watch economic data closely.';
  } else if (probability > 15) {
    return 'Some recession warning signs, but risk remains moderate.';
  }
  return 'Recession risk is low. Economic indicators are generally positive.';
}

/**
 * Get recession recommendation
 */
function getRecessionRecommendation(probability) {
  if (probability > 60) {
    return 'Consider increasing defensive allocations (bonds, utilities, consumer staples)';
  } else if (probability > 35) {
    return 'Review portfolio for excessive cyclical exposure';
  } else if (probability > 15) {
    return 'Maintain diversified portfolio with some defensive holdings';
  }
  return 'Current allocation appropriate for economic conditions';
}

/**
 * Analyze impact of economic indicators on portfolio
 */
function analyzeEconomicImpact(portfolio, currentData, expectedChanges) {
  const assetAllocations = calculateAssetAllocations(portfolio);
  const impacts = [];

  Object.keys(expectedChanges).forEach(function(indicator) {
    const change = expectedChanges[indicator];
    let portfolioImpact = 0;

    Object.keys(assetAllocations).forEach(function(assetClass) {
      const sensitivity = ASSET_SENSITIVITIES[assetClass];
      if (sensitivity && sensitivity[indicator] !== undefined) {
        const weight = assetAllocations[assetClass];
        const impact = weight * sensitivity[indicator] * change;
        portfolioImpact += impact;
      }
    });

    if (portfolioImpact !== 0) {
      impacts.push({
        indicator: indicator,
        indicatorName: ECONOMIC_INDICATORS[indicator] ? 
          ECONOMIC_INDICATORS[indicator].name : indicator,
        expectedChange: change,
        portfolioImpact: portfolioImpact * 100,
        direction: portfolioImpact > 0 ? 'positive' : 'negative'
      });
    }
  });

  // Sort by absolute impact
  impacts.sort(function(a, b) {
    return Math.abs(b.portfolioImpact) - Math.abs(a.portfolioImpact);
  });

  const totalImpact = impacts.reduce(function(sum, i) {
    return sum + i.portfolioImpact;
  }, 0);

  return {
    impacts: impacts,
    totalImpact: totalImpact,
    largestPositive: impacts.filter(function(i) { return i.portfolioImpact > 0; })[0] || null,
    largestNegative: impacts.filter(function(i) { return i.portfolioImpact < 0; })[0] || null
  };
}

/**
 * Calculate asset allocations from portfolio
 */
function calculateAssetAllocations(portfolio) {
  let totalValue = 0;
  const values = {
    stocks: 0,
    crypto: 0,
    bonds: 0,
    gold: 0,
    realEstate: 0,
    other: 0
  };

  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      totalValue += value;

      if (category === 'crypto') {
        values.crypto += value;
      } else if (category === 'stocks') {
        values.stocks += value;
      } else {
        values.other += value;
      }
    });
  });

  // Convert to weights
  const weights = {};
  Object.keys(values).forEach(function(key) {
    weights[key] = totalValue > 0 ? values[key] / totalValue : 0;
  });

  return weights;
}

/**
 * Identify economic regime
 */
function identifyEconomicRegime(currentData) {
  const gdp = currentData.gdpGrowth || 0;
  const inflation = currentData.cpi || 0;
  const unemployment = currentData.unemploymentRate || 5;
  const pmi = currentData.pmi || 50;

  let regime;
  let description;
  let recommendations = [];

  // Growth + Inflation matrix
  const highGrowth = gdp > 2 || pmi > 55;
  const lowGrowth = gdp < 1 || pmi < 48;
  const highInflation = inflation > 3;
  const lowInflation = inflation < 1.5;

  if (highGrowth && lowInflation) {
    regime = 'goldilocks';
    description = 'Strong growth with low inflation - ideal conditions';
    recommendations = ['Favor equities', 'Moderate bond allocation', 'Growth stocks attractive'];
  } else if (highGrowth && highInflation) {
    regime = 'overheating';
    description = 'Strong growth but rising inflation concerns';
    recommendations = ['Consider inflation hedges', 'Shorter duration bonds', 'Commodity exposure'];
  } else if (lowGrowth && highInflation) {
    regime = 'stagflation';
    description = 'Weak growth with high inflation - challenging environment';
    recommendations = ['Defensive positioning', 'Real assets', 'Reduce equity exposure'];
  } else if (lowGrowth && lowInflation) {
    regime = 'deflation_risk';
    description = 'Weak growth and low inflation - potential deflation risk';
    recommendations = ['Long duration bonds', 'Quality stocks', 'Cash holdings'];
  } else {
    regime = 'expansion';
    description = 'Normal economic expansion';
    recommendations = ['Balanced allocation', 'Diversified portfolio'];
  }

  return {
    regime: regime,
    description: description,
    recommendations: recommendations,
    indicators: {
      gdpGrowth: gdp,
      inflation: inflation,
      unemployment: unemployment,
      pmi: pmi
    }
  };
}

/**
 * Generate economic indicator report
 */
function generateEconomicReport(currentData, portfolio) {
  const dashboard = createEconomicDashboard(currentData);
  const recessionProb = calculateRecessionProbability(currentData);
  const regime = identifyEconomicRegime(currentData);
  
  let economicImpact = null;
  if (portfolio) {
    // Assume some expected changes for demonstration
    const expectedChanges = {};
    if (currentData.fedFundsRate) {
      expectedChanges.fedFundsRate = 0.25; // Expect 25bp rate hike
    }
    economicImpact = analyzeEconomicImpact(portfolio, currentData, expectedChanges);
  }

  // Count leading indicators
  const leadingIndicators = [];
  Object.keys(ECONOMIC_INDICATORS).forEach(function(key) {
    if (ECONOMIC_INDICATORS[key].leadingIndicator && currentData[key] !== undefined) {
      leadingIndicators.push({
        key: key,
        name: ECONOMIC_INDICATORS[key].name,
        value: currentData[key],
        status: assessIndicatorStatus(key, currentData[key], ECONOMIC_INDICATORS[key])
      });
    }
  });

  return {
    generated: new Date().toISOString(),
    dashboard: dashboard,
    regime: regime,
    recessionProbability: recessionProb,
    leadingIndicators: leadingIndicators,
    portfolioImpact: economicImpact,
    summary: {
      economicRegime: regime.regime,
      recessionRisk: recessionProb.riskLevel,
      keyMessage: regime.description
    }
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.EconomicIndicatorEngine = {
    ECONOMIC_INDICATORS: ECONOMIC_INDICATORS,
    ASSET_SENSITIVITIES: ASSET_SENSITIVITIES,
    createEconomicDashboard: createEconomicDashboard,
    calculateRecessionProbability: calculateRecessionProbability,
    analyzeEconomicImpact: analyzeEconomicImpact,
    identifyEconomicRegime: identifyEconomicRegime,
    generateEconomicReport: generateEconomicReport
  };
  
  console.log('[OK] Economic Indicator Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ECONOMIC_INDICATORS,
    ASSET_SENSITIVITIES,
    createEconomicDashboard,
    calculateRecessionProbability,
    analyzeEconomicImpact,
    identifyEconomicRegime,
    generateEconomicReport
  };
}
