// ============================================================================
// MAERMIN v6.0 - Factor Analysis & Exposure Engine
// Multi-factor analysis: Value, Momentum, Quality, Size, Volatility
// ============================================================================

/**
 * Factor definitions and characteristics
 */
const FACTORS = {
  value: {
    name: 'Value',
    description: 'Stocks trading below intrinsic value based on fundamentals',
    metrics: ['P/E Ratio', 'P/B Ratio', 'Dividend Yield'],
    historicalPremium: 0.03, // 3% annual premium
    volatility: 0.12
  },
  momentum: {
    name: 'Momentum',
    description: 'Stocks with strong recent performance tend to continue',
    metrics: ['12-month return', '6-month return', 'Relative strength'],
    historicalPremium: 0.04,
    volatility: 0.15
  },
  quality: {
    name: 'Quality',
    description: 'Companies with strong profitability and low debt',
    metrics: ['ROE', 'Debt/Equity', 'Earnings stability'],
    historicalPremium: 0.025,
    volatility: 0.10
  },
  size: {
    name: 'Size (Small Cap)',
    description: 'Smaller companies tend to outperform over long periods',
    metrics: ['Market Cap'],
    historicalPremium: 0.02,
    volatility: 0.18
  },
  lowVolatility: {
    name: 'Low Volatility',
    description: 'Less volatile stocks often provide better risk-adjusted returns',
    metrics: ['Beta', 'Standard Deviation'],
    historicalPremium: 0.015,
    volatility: 0.08
  },
  growth: {
    name: 'Growth',
    description: 'Companies with high earnings growth potential',
    metrics: ['EPS Growth', 'Revenue Growth', 'PEG Ratio'],
    historicalPremium: 0.02,
    volatility: 0.20
  }
};

/**
 * Asset class factor exposures (default assumptions)
 */
const ASSET_FACTOR_EXPOSURES = {
  // Large cap stocks
  'AAPL': { value: -0.3, momentum: 0.4, quality: 0.8, size: -0.5, lowVolatility: 0.2, growth: 0.6 },
  'MSFT': { value: -0.2, momentum: 0.5, quality: 0.9, size: -0.6, lowVolatility: 0.3, growth: 0.5 },
  'GOOGL': { value: -0.1, momentum: 0.3, quality: 0.7, size: -0.5, lowVolatility: 0.1, growth: 0.4 },
  'AMZN': { value: -0.5, momentum: 0.2, quality: 0.5, size: -0.6, lowVolatility: -0.2, growth: 0.8 },
  'TSLA': { value: -0.8, momentum: 0.6, quality: -0.1, size: -0.3, lowVolatility: -0.8, growth: 0.9 },
  'META': { value: 0.1, momentum: 0.3, quality: 0.6, size: -0.5, lowVolatility: -0.1, growth: 0.3 },
  'NVDA': { value: -0.7, momentum: 0.9, quality: 0.5, size: -0.4, lowVolatility: -0.7, growth: 0.9 },
  
  // Crypto (different factor behavior)
  'BTC': { value: 0, momentum: 0.7, quality: 0, size: 0, lowVolatility: -0.9, growth: 0 },
  'ETH': { value: 0, momentum: 0.8, quality: 0, size: 0.2, lowVolatility: -0.95, growth: 0.3 },
  'SOL': { value: 0, momentum: 0.9, quality: -0.2, size: 0.5, lowVolatility: -1.0, growth: 0.5 },
  
  // Default for unknown assets
  'DEFAULT': { value: 0, momentum: 0, quality: 0, size: 0, lowVolatility: 0, growth: 0 }
};

/**
 * Calculate factor exposures for a single position
 */
function getFactorExposure(symbol, priceHistory, fundamentals) {
  // Check if we have predefined exposures
  const upperSymbol = symbol.toUpperCase();
  let exposures = ASSET_FACTOR_EXPOSURES[upperSymbol] || ASSET_FACTOR_EXPOSURES['DEFAULT'];

  // If price history provided, calculate momentum
  if (priceHistory && priceHistory.length >= 252) {
    const momentum12m = (priceHistory[priceHistory.length - 1] - priceHistory[priceHistory.length - 252]) / 
                        priceHistory[priceHistory.length - 252];
    exposures = Object.assign({}, exposures, {
      momentum: Math.max(-1, Math.min(1, momentum12m * 2)) // Normalize
    });
  }

  // If fundamentals provided, adjust value and quality
  if (fundamentals) {
    if (fundamentals.peRatio) {
      // Lower P/E = higher value score
      const valueScore = fundamentals.peRatio < 15 ? 0.5 :
                        fundamentals.peRatio < 25 ? 0 : -0.5;
      exposures = Object.assign({}, exposures, { value: valueScore });
    }

    if (fundamentals.roe) {
      // Higher ROE = higher quality
      const qualityScore = fundamentals.roe > 20 ? 0.8 :
                          fundamentals.roe > 10 ? 0.4 : 0;
      exposures = Object.assign({}, exposures, { quality: qualityScore });
    }

    if (fundamentals.marketCap) {
      // Smaller market cap = higher size factor exposure
      const sizeScore = fundamentals.marketCap < 2e9 ? 0.8 :
                       fundamentals.marketCap < 10e9 ? 0.4 :
                       fundamentals.marketCap < 100e9 ? -0.2 : -0.6;
      exposures = Object.assign({}, exposures, { size: sizeScore });
    }
  }

  // Calculate volatility-based exposure
  if (priceHistory && priceHistory.length >= 30) {
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      if (priceHistory[i - 1] !== 0) {
        returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
      }
    }
    const volatility = Math.sqrt(
      returns.reduce(function(sum, r) {
        const mean = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
        return sum + Math.pow(r - mean, 2);
      }, 0) / returns.length
    ) * Math.sqrt(252);

    // Lower volatility = higher low volatility factor exposure
    const volScore = volatility < 0.15 ? 0.8 :
                    volatility < 0.25 ? 0.3 :
                    volatility < 0.40 ? -0.3 : -0.8;
    exposures = Object.assign({}, exposures, { lowVolatility: volScore });
  }

  return {
    symbol: symbol,
    exposures: exposures
  };
}

/**
 * Calculate portfolio-level factor exposures
 */
function calculatePortfolioFactorExposures(portfolio, priceHistories, fundamentalsData) {
  const positions = [];
  let totalValue = 0;

  // Collect all positions
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      totalValue += value;
      positions.push({
        symbol: symbol,
        value: value,
        category: category
      });
    });
  });

  // Calculate weighted factor exposures
  const portfolioExposures = {
    value: 0,
    momentum: 0,
    quality: 0,
    size: 0,
    lowVolatility: 0,
    growth: 0
  };

  const positionExposures = [];

  positions.forEach(function(pos) {
    const weight = totalValue > 0 ? pos.value / totalValue : 0;
    const priceHistory = priceHistories ? priceHistories[pos.symbol] : null;
    const fundamentals = fundamentalsData ? fundamentalsData[pos.symbol] : null;
    
    const exposure = getFactorExposure(pos.symbol, priceHistory, fundamentals);
    
    Object.keys(portfolioExposures).forEach(function(factor) {
      portfolioExposures[factor] += weight * (exposure.exposures[factor] || 0);
    });

    positionExposures.push({
      symbol: pos.symbol,
      weight: weight * 100,
      value: pos.value,
      exposures: exposure.exposures
    });
  });

  return {
    portfolioExposures: portfolioExposures,
    positionExposures: positionExposures,
    totalValue: totalValue,
    dominantFactors: findDominantFactors(portfolioExposures),
    factorTilts: analyzeFaktorTilts(portfolioExposures)
  };
}

/**
 * Find dominant factors in portfolio
 */
function findDominantFactors(exposures) {
  const sorted = Object.keys(exposures)
    .map(function(factor) {
      return { factor: factor, exposure: exposures[factor] };
    })
    .sort(function(a, b) {
      return Math.abs(b.exposure) - Math.abs(a.exposure);
    });

  return sorted.slice(0, 3).map(function(item) {
    return {
      factor: item.factor,
      name: FACTORS[item.factor] ? FACTORS[item.factor].name : item.factor,
      exposure: item.exposure,
      direction: item.exposure > 0 ? 'positive' : 'negative',
      strength: Math.abs(item.exposure) > 0.5 ? 'strong' :
               Math.abs(item.exposure) > 0.2 ? 'moderate' : 'weak'
    };
  });
}

/**
 * Analyze factor tilts and provide interpretation
 */
function analyzeFaktorTilts(exposures) {
  const tilts = [];

  Object.keys(exposures).forEach(function(factor) {
    const exposure = exposures[factor];
    const factorInfo = FACTORS[factor];
    
    if (Math.abs(exposure) > 0.1) {
      tilts.push({
        factor: factor,
        name: factorInfo ? factorInfo.name : factor,
        exposure: exposure,
        expectedPremium: factorInfo ? factorInfo.historicalPremium * exposure : 0,
        interpretation: getFactorInterpretation(factor, exposure)
      });
    }
  });

  return tilts.sort(function(a, b) {
    return Math.abs(b.exposure) - Math.abs(a.exposure);
  });
}

/**
 * Get interpretation for factor exposure
 */
function getFactorInterpretation(factor, exposure) {
  const interpretations = {
    value: exposure > 0 ? 
      'Portfolio tilts toward undervalued stocks' :
      'Portfolio tilts toward expensive/growth stocks',
    momentum: exposure > 0 ?
      'Portfolio holds recent winners' :
      'Portfolio holds recent underperformers',
    quality: exposure > 0 ?
      'Portfolio favors high-quality, profitable companies' :
      'Portfolio includes lower-quality or speculative names',
    size: exposure > 0 ?
      'Portfolio tilts toward smaller companies' :
      'Portfolio dominated by large caps',
    lowVolatility: exposure > 0 ?
      'Portfolio is defensively positioned with low-volatility assets' :
      'Portfolio holds volatile, high-risk assets',
    growth: exposure > 0 ?
      'Portfolio emphasizes high-growth companies' :
      'Portfolio lacks growth-oriented positions'
  };

  return interpretations[factor] || 'Factor exposure detected';
}

/**
 * Create Morningstar-style style box positioning
 */
function calculateStyleBox(portfolioExposures) {
  // X-axis: Value (-1) to Growth (+1)
  const valueGrowth = -portfolioExposures.value + portfolioExposures.growth;
  
  // Y-axis: Small (+1) to Large (-1)
  const sizeFactor = portfolioExposures.size;

  // Normalize to -1 to 1
  const x = Math.max(-1, Math.min(1, valueGrowth));
  const y = Math.max(-1, Math.min(1, sizeFactor));

  // Determine style box position (3x3 grid)
  let xPosition, yPosition;
  
  if (x < -0.33) xPosition = 'Value';
  else if (x > 0.33) xPosition = 'Growth';
  else xPosition = 'Blend';

  if (y > 0.33) yPosition = 'Small';
  else if (y < -0.33) yPosition = 'Large';
  else yPosition = 'Mid';

  return {
    x: x,
    y: y,
    xLabel: xPosition,
    yLabel: yPosition,
    position: yPosition + ' ' + xPosition,
    description: yPosition + ' Cap ' + xPosition
  };
}

/**
 * Estimate factor-based expected returns
 */
function estimateFactorReturns(portfolioExposures, marketReturn) {
  marketReturn = marketReturn || 0.08;
  
  let factorReturn = marketReturn;
  const factorContributions = {};

  Object.keys(portfolioExposures).forEach(function(factor) {
    const exposure = portfolioExposures[factor];
    const factorInfo = FACTORS[factor];
    
    if (factorInfo) {
      const contribution = exposure * factorInfo.historicalPremium;
      factorReturn += contribution;
      factorContributions[factor] = {
        exposure: exposure,
        premium: factorInfo.historicalPremium * 100,
        contribution: contribution * 100
      };
    }
  });

  return {
    expectedReturn: factorReturn * 100,
    marketReturn: marketReturn * 100,
    factorAlpha: (factorReturn - marketReturn) * 100,
    contributions: factorContributions
  };
}

/**
 * Analyze factor concentration risk
 */
function analyzeFactorRisk(portfolioExposures) {
  const risks = [];

  Object.keys(portfolioExposures).forEach(function(factor) {
    const exposure = Math.abs(portfolioExposures[factor]);
    const factorInfo = FACTORS[factor];

    if (exposure > 0.5) {
      risks.push({
        factor: factor,
        name: factorInfo ? factorInfo.name : factor,
        exposure: portfolioExposures[factor],
        risk: 'high',
        message: 'High exposure to ' + (factorInfo ? factorInfo.name : factor) + 
                ' factor could lead to significant drawdowns when this factor underperforms'
      });
    } else if (exposure > 0.3) {
      risks.push({
        factor: factor,
        name: factorInfo ? factorInfo.name : factor,
        exposure: portfolioExposures[factor],
        risk: 'medium',
        message: 'Moderate ' + (factorInfo ? factorInfo.name : factor) + 
                ' tilt - monitor for factor rotation'
      });
    }
  });

  // Calculate overall factor risk score
  const totalExposure = Object.keys(portfolioExposures).reduce(function(sum, f) {
    return sum + Math.pow(portfolioExposures[f], 2);
  }, 0);
  
  const riskScore = Math.sqrt(totalExposure) * 50; // Scale to 0-100

  return {
    risks: risks,
    riskScore: Math.min(100, riskScore),
    riskLevel: riskScore > 60 ? 'high' : riskScore > 30 ? 'medium' : 'low',
    recommendation: riskScore > 60 ? 
      'Consider balancing factor exposures for better diversification' :
      'Factor diversification is reasonable'
  };
}

/**
 * Generate factor-based rebalancing suggestions
 */
function generateFactorRebalancingSuggestions(portfolioExposures, targetExposures) {
  targetExposures = targetExposures || {
    value: 0.1,
    momentum: 0.1,
    quality: 0.2,
    size: 0,
    lowVolatility: 0.1,
    growth: 0.1
  };

  const suggestions = [];

  Object.keys(targetExposures).forEach(function(factor) {
    const current = portfolioExposures[factor] || 0;
    const target = targetExposures[factor];
    const diff = target - current;

    if (Math.abs(diff) > 0.15) {
      const factorInfo = FACTORS[factor];
      suggestions.push({
        factor: factor,
        name: factorInfo ? factorInfo.name : factor,
        currentExposure: current,
        targetExposure: target,
        change: diff,
        action: diff > 0 ? 'Increase' : 'Decrease',
        priority: Math.abs(diff) > 0.3 ? 'high' : 'medium',
        suggestion: diff > 0 ?
          'Add positions with high ' + (factorInfo ? factorInfo.name : factor) + ' characteristics' :
          'Reduce positions with high ' + (factorInfo ? factorInfo.name : factor) + ' characteristics'
      });
    }
  });

  return suggestions.sort(function(a, b) {
    return Math.abs(b.change) - Math.abs(a.change);
  });
}

/**
 * Full factor analysis report
 */
function generateFactorAnalysisReport(portfolio, priceHistories, fundamentalsData) {
  const analysis = calculatePortfolioFactorExposures(portfolio, priceHistories, fundamentalsData);
  const styleBox = calculateStyleBox(analysis.portfolioExposures);
  const expectedReturns = estimateFactorReturns(analysis.portfolioExposures);
  const riskAnalysis = analyzeFactorRisk(analysis.portfolioExposures);
  const rebalanceSuggestions = generateFactorRebalancingSuggestions(analysis.portfolioExposures);

  return {
    generated: new Date().toISOString(),
    summary: {
      dominantFactors: analysis.dominantFactors,
      styleBox: styleBox,
      riskLevel: riskAnalysis.riskLevel
    },
    exposures: analysis.portfolioExposures,
    positionDetails: analysis.positionExposures,
    factorTilts: analysis.factorTilts,
    expectedReturns: expectedReturns,
    riskAnalysis: riskAnalysis,
    rebalanceSuggestions: rebalanceSuggestions
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.FactorAnalysisEngine = {
    FACTORS: FACTORS,
    getFactorExposure: getFactorExposure,
    calculatePortfolioFactorExposures: calculatePortfolioFactorExposures,
    calculateStyleBox: calculateStyleBox,
    estimateFactorReturns: estimateFactorReturns,
    analyzeFactorRisk: analyzeFactorRisk,
    generateFactorRebalancingSuggestions: generateFactorRebalancingSuggestions,
    generateFactorAnalysisReport: generateFactorAnalysisReport
  };
  
  console.log('[OK] Factor Analysis Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FACTORS,
    getFactorExposure,
    calculatePortfolioFactorExposures,
    calculateStyleBox,
    estimateFactorReturns,
    analyzeFactorRisk,
    generateFactorRebalancingSuggestions,
    generateFactorAnalysisReport
  };
}
