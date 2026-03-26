// ============================================================================
// MAERMIN v6.0 - Liquidity Analysis Engine
// Position liquidity scoring, days to liquidate, bid-ask spread tracking
// ============================================================================

/**
 * Asset liquidity profiles
 */
const LIQUIDITY_PROFILES = {
  // Highly liquid
  megaCap: {
    avgDailyVolume: 10000000000,
    bidAskSpread: 0.01,
    marketImpact: 0.001,
    liquidityScore: 95
  },
  // Large cap stocks
  largeCap: {
    avgDailyVolume: 1000000000,
    bidAskSpread: 0.02,
    marketImpact: 0.005,
    liquidityScore: 85
  },
  // Mid cap stocks
  midCap: {
    avgDailyVolume: 100000000,
    bidAskSpread: 0.05,
    marketImpact: 0.02,
    liquidityScore: 70
  },
  // Small cap stocks
  smallCap: {
    avgDailyVolume: 10000000,
    bidAskSpread: 0.15,
    marketImpact: 0.05,
    liquidityScore: 50
  },
  // Major crypto
  majorCrypto: {
    avgDailyVolume: 50000000000,
    bidAskSpread: 0.05,
    marketImpact: 0.01,
    liquidityScore: 80
  },
  // Altcoins
  altcoin: {
    avgDailyVolume: 100000000,
    bidAskSpread: 0.20,
    marketImpact: 0.10,
    liquidityScore: 40
  },
  // CS2 rare skins
  rareSkin: {
    avgDailyVolume: 10000,
    bidAskSpread: 5.00,
    marketImpact: 0.30,
    liquidityScore: 20
  },
  // CS2 common skins
  commonSkin: {
    avgDailyVolume: 100000,
    bidAskSpread: 1.00,
    marketImpact: 0.15,
    liquidityScore: 35
  }
};

/**
 * Asset to liquidity profile mapping
 */
const ASSET_LIQUIDITY_MAP = {
  // Mega cap stocks
  'AAPL': 'megaCap', 'MSFT': 'megaCap', 'GOOGL': 'megaCap', 
  'AMZN': 'megaCap', 'NVDA': 'megaCap', 'META': 'megaCap',
  'TSLA': 'megaCap', 'BRK.B': 'megaCap',
  
  // Large cap
  'JPM': 'largeCap', 'V': 'largeCap', 'JNJ': 'largeCap',
  'WMT': 'largeCap', 'PG': 'largeCap', 'MA': 'largeCap',
  'HD': 'largeCap', 'DIS': 'largeCap', 'NFLX': 'largeCap',
  
  // Major crypto
  'BTC': 'majorCrypto', 'ETH': 'majorCrypto',
  
  // Alt crypto
  'SOL': 'altcoin', 'ADA': 'altcoin', 'DOT': 'altcoin',
  'AVAX': 'altcoin', 'MATIC': 'altcoin', 'LINK': 'altcoin'
};

/**
 * Get liquidity profile for an asset
 */
function getLiquidityProfile(symbol, category, marketCap) {
  const upperSymbol = (symbol || '').toUpperCase();
  
  // Check direct mapping
  if (ASSET_LIQUIDITY_MAP[upperSymbol]) {
    return LIQUIDITY_PROFILES[ASSET_LIQUIDITY_MAP[upperSymbol]];
  }
  
  // Determine by category and market cap
  if (category === 'crypto') {
    return LIQUIDITY_PROFILES.altcoin;
  }
  
  if (category === 'skins') {
    return LIQUIDITY_PROFILES.rareSkin;
  }
  
  // Stocks - determine by market cap
  if (marketCap) {
    if (marketCap > 200e9) return LIQUIDITY_PROFILES.megaCap;
    if (marketCap > 10e9) return LIQUIDITY_PROFILES.largeCap;
    if (marketCap > 2e9) return LIQUIDITY_PROFILES.midCap;
    return LIQUIDITY_PROFILES.smallCap;
  }
  
  return LIQUIDITY_PROFILES.midCap; // Default
}

/**
 * Calculate liquidity score for a position
 * @param {Object} position - Position object
 * @param {Object} marketData - Market data (volume, spread, etc.)
 */
function calculatePositionLiquidity(position, marketData) {
  const symbol = position.symbol || position.name;
  const category = position.category;
  const value = (position.amount || 0) * (position.currentPrice || position.purchasePrice || 0);
  
  // Get base profile
  const profile = getLiquidityProfile(symbol, category, marketData ? marketData.marketCap : null);
  
  // Adjust based on actual market data if available
  let liquidityScore = profile.liquidityScore;
  let bidAskSpread = profile.bidAskSpread;
  let avgDailyVolume = profile.avgDailyVolume;
  
  if (marketData) {
    if (marketData.avgDailyVolume) {
      avgDailyVolume = marketData.avgDailyVolume;
      // Adjust score based on actual volume
      if (avgDailyVolume > 1e10) liquidityScore = Math.max(liquidityScore, 90);
      else if (avgDailyVolume < 1e6) liquidityScore = Math.min(liquidityScore, 30);
    }
    
    if (marketData.bidAskSpread) {
      bidAskSpread = marketData.bidAskSpread;
      // Penalize wide spreads
      if (bidAskSpread > 0.5) liquidityScore -= 20;
      else if (bidAskSpread > 0.1) liquidityScore -= 10;
    }
  }
  
  // Calculate days to liquidate
  const daysToLiquidate = calculateDaysToLiquidate(value, avgDailyVolume, 0.1);
  
  // Calculate market impact
  const marketImpact = estimateMarketImpact(value, avgDailyVolume);
  
  // Calculate effective cost (spread + impact)
  const effectiveCost = bidAskSpread + marketImpact;
  
  return {
    symbol: symbol,
    positionValue: value,
    liquidityScore: Math.max(0, Math.min(100, liquidityScore)),
    liquidityRating: getLiquidityRating(liquidityScore),
    bidAskSpread: bidAskSpread * 100, // As percentage
    avgDailyVolume: avgDailyVolume,
    daysToLiquidate: daysToLiquidate,
    marketImpact: marketImpact * 100, // As percentage
    effectiveCost: effectiveCost * 100, // As percentage
    costToLiquidate: value * effectiveCost
  };
}

/**
 * Get liquidity rating from score
 */
function getLiquidityRating(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Poor';
  return 'Very Poor';
}

/**
 * Calculate days to liquidate a position
 * @param {number} positionValue - Value of position
 * @param {number} avgDailyVolume - Average daily trading volume
 * @param {number} maxParticipation - Max percentage of daily volume (0.1 = 10%)
 */
function calculateDaysToLiquidate(positionValue, avgDailyVolume, maxParticipation) {
  maxParticipation = maxParticipation || 0.1;
  
  if (avgDailyVolume <= 0) return Infinity;
  
  const maxDailyLiquidation = avgDailyVolume * maxParticipation;
  
  if (maxDailyLiquidation <= 0) return Infinity;
  
  return Math.ceil(positionValue / maxDailyLiquidation);
}

/**
 * Estimate market impact using square root model
 * Impact ≈ k * sqrt(Q/V) where Q = order size, V = daily volume
 */
function estimateMarketImpact(orderValue, avgDailyVolume, impactCoefficient) {
  impactCoefficient = impactCoefficient || 0.1;
  
  if (avgDailyVolume <= 0) return 0.5; // 50% impact for illiquid
  
  const participation = orderValue / avgDailyVolume;
  const impact = impactCoefficient * Math.sqrt(participation);
  
  return Math.min(0.5, impact); // Cap at 50%
}

/**
 * Calculate portfolio-level liquidity metrics
 */
function calculatePortfolioLiquidity(portfolio, marketDataMap) {
  const positions = [];
  let totalValue = 0;
  let weightedLiquidityScore = 0;
  let totalCostToLiquidate = 0;
  let maxDaysToLiquidate = 0;

  // Process all positions
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const posWithCategory = Object.assign({}, pos, { category: category });
      const marketData = marketDataMap ? marketDataMap[symbol] : null;
      
      const liquidity = calculatePositionLiquidity(posWithCategory, marketData);
      
      positions.push(liquidity);
      totalValue += liquidity.positionValue;
      totalCostToLiquidate += liquidity.costToLiquidate;
      
      if (liquidity.daysToLiquidate > maxDaysToLiquidate && 
          liquidity.daysToLiquidate !== Infinity) {
        maxDaysToLiquidate = liquidity.daysToLiquidate;
      }
    });
  });

  // Calculate weighted liquidity score
  positions.forEach(function(pos) {
    const weight = totalValue > 0 ? pos.positionValue / totalValue : 0;
    weightedLiquidityScore += weight * pos.liquidityScore;
  });

  // Sort positions by liquidity score
  positions.sort(function(a, b) {
    return a.liquidityScore - b.liquidityScore;
  });

  // Calculate liquidity tier breakdown
  const tierBreakdown = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
    veryPoor: 0
  };

  positions.forEach(function(pos) {
    const weight = totalValue > 0 ? (pos.positionValue / totalValue) * 100 : 0;
    if (pos.liquidityScore >= 80) tierBreakdown.excellent += weight;
    else if (pos.liquidityScore >= 60) tierBreakdown.good += weight;
    else if (pos.liquidityScore >= 40) tierBreakdown.fair += weight;
    else if (pos.liquidityScore >= 20) tierBreakdown.poor += weight;
    else tierBreakdown.veryPoor += weight;
  });

  return {
    totalValue: totalValue,
    portfolioLiquidityScore: weightedLiquidityScore,
    portfolioLiquidityRating: getLiquidityRating(weightedLiquidityScore),
    totalCostToLiquidate: totalCostToLiquidate,
    costToLiquidatePercent: totalValue > 0 ? (totalCostToLiquidate / totalValue) * 100 : 0,
    maxDaysToLiquidate: maxDaysToLiquidate,
    positions: positions,
    tierBreakdown: tierBreakdown,
    leastLiquid: positions.slice(0, 5),
    mostLiquid: positions.slice(-5).reverse()
  };
}

/**
 * Analyze liquidity risk scenarios
 */
function analyzeLiquidityRisk(portfolioLiquidity, stressScenarios) {
  const defaultScenarios = [
    { name: 'Normal Markets', volumeMultiplier: 1.0, spreadMultiplier: 1.0 },
    { name: 'Mild Stress', volumeMultiplier: 0.7, spreadMultiplier: 1.5 },
    { name: 'Moderate Stress', volumeMultiplier: 0.5, spreadMultiplier: 2.5 },
    { name: 'Severe Stress', volumeMultiplier: 0.2, spreadMultiplier: 5.0 },
    { name: 'Market Crisis', volumeMultiplier: 0.1, spreadMultiplier: 10.0 }
  ];

  const scenarios = stressScenarios || defaultScenarios;
  const results = [];

  scenarios.forEach(function(scenario) {
    let stressedCost = 0;
    let stressedDays = 0;

    portfolioLiquidity.positions.forEach(function(pos) {
      // Adjust for stress scenario
      const adjustedSpread = (pos.bidAskSpread / 100) * scenario.spreadMultiplier;
      const adjustedVolume = pos.avgDailyVolume * scenario.volumeMultiplier;
      
      const stressedImpact = estimateMarketImpact(pos.positionValue, adjustedVolume);
      const stressedEffectiveCost = adjustedSpread + stressedImpact;
      
      stressedCost += pos.positionValue * stressedEffectiveCost;
      
      const days = calculateDaysToLiquidate(pos.positionValue, adjustedVolume, 0.1);
      if (days > stressedDays && days !== Infinity) {
        stressedDays = days;
      }
    });

    results.push({
      scenario: scenario.name,
      volumeMultiplier: scenario.volumeMultiplier,
      spreadMultiplier: scenario.spreadMultiplier,
      costToLiquidate: stressedCost,
      costPercent: portfolioLiquidity.totalValue > 0 ?
        (stressedCost / portfolioLiquidity.totalValue) * 100 : 0,
      daysToLiquidate: stressedDays
    });
  });

  return {
    scenarios: results,
    normalCost: results[0] ? results[0].costPercent : 0,
    stressedCost: results[3] ? results[3].costPercent : 0,
    crisisCost: results[4] ? results[4].costPercent : 0,
    liquidityAtRisk: results[3] ? results[3].costToLiquidate - results[0].costToLiquidate : 0
  };
}

/**
 * Track bid-ask spread history
 */
function trackSpreadHistory(symbol, currentSpread, spreadHistory) {
  spreadHistory = spreadHistory || [];
  
  // Add current spread
  spreadHistory.push({
    timestamp: new Date().toISOString(),
    spread: currentSpread
  });

  // Keep last 100 data points
  if (spreadHistory.length > 100) {
    spreadHistory = spreadHistory.slice(-100);
  }

  // Calculate statistics
  const spreads = spreadHistory.map(function(s) { return s.spread; });
  const avgSpread = spreads.reduce(function(a, b) { return a + b; }, 0) / spreads.length;
  const maxSpread = Math.max.apply(null, spreads);
  const minSpread = Math.min.apply(null, spreads);

  // Calculate volatility of spread
  const spreadVariance = spreads.reduce(function(sum, s) {
    return sum + Math.pow(s - avgSpread, 2);
  }, 0) / spreads.length;
  const spreadVolatility = Math.sqrt(spreadVariance);

  // Detect spread widening
  const recentSpreads = spreads.slice(-10);
  const recentAvg = recentSpreads.reduce(function(a, b) { return a + b; }, 0) / recentSpreads.length;
  const spreadTrend = recentAvg > avgSpread * 1.2 ? 'widening' :
                     recentAvg < avgSpread * 0.8 ? 'narrowing' : 'stable';

  return {
    symbol: symbol,
    currentSpread: currentSpread,
    avgSpread: avgSpread,
    maxSpread: maxSpread,
    minSpread: minSpread,
    spreadVolatility: spreadVolatility,
    spreadTrend: spreadTrend,
    dataPoints: spreadHistory.length,
    history: spreadHistory,
    alert: recentAvg > avgSpread * 1.5 ? 
      'Warning: Spread significantly wider than average' : null
  };
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 */
function calculateVWAP(trades) {
  if (!trades || trades.length === 0) {
    return { error: 'No trade data' };
  }

  let totalVolume = 0;
  let totalVolumePrice = 0;

  trades.forEach(function(trade) {
    const volume = trade.volume || trade.quantity || 0;
    const price = trade.price || 0;
    
    totalVolume += volume;
    totalVolumePrice += volume * price;
  });

  const vwap = totalVolume > 0 ? totalVolumePrice / totalVolume : 0;

  // Calculate VWAP bands (standard deviation)
  let sumSquaredDiff = 0;
  trades.forEach(function(trade) {
    const volume = trade.volume || trade.quantity || 0;
    const price = trade.price || 0;
    sumSquaredDiff += volume * Math.pow(price - vwap, 2);
  });

  const variance = totalVolume > 0 ? sumSquaredDiff / totalVolume : 0;
  const stdDev = Math.sqrt(variance);

  return {
    vwap: vwap,
    totalVolume: totalVolume,
    upperBand1: vwap + stdDev,
    lowerBand1: vwap - stdDev,
    upperBand2: vwap + 2 * stdDev,
    lowerBand2: vwap - 2 * stdDev,
    stdDev: stdDev
  };
}

/**
 * Generate liquidity recommendations
 */
function generateLiquidityRecommendations(portfolioLiquidity) {
  const recommendations = [];

  // Check overall liquidity
  if (portfolioLiquidity.portfolioLiquidityScore < 40) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: 'Portfolio has low overall liquidity. May face significant costs or delays when liquidating.',
      action: 'Consider increasing allocation to more liquid assets'
    });
  }

  // Check for illiquid positions
  const illiquidPositions = portfolioLiquidity.positions.filter(function(p) {
    return p.liquidityScore < 30;
  });

  if (illiquidPositions.length > 0) {
    const illiquidValue = illiquidPositions.reduce(function(sum, p) {
      return sum + p.positionValue;
    }, 0);
    const illiquidPercent = (illiquidValue / portfolioLiquidity.totalValue) * 100;

    if (illiquidPercent > 20) {
      recommendations.push({
        type: 'warning',
        priority: 'high',
        message: illiquidPercent.toFixed(1) + '% of portfolio is in illiquid assets',
        action: 'Review positions: ' + illiquidPositions.map(function(p) {
          return p.symbol;
        }).join(', ')
      });
    }
  }

  // Check liquidation time
  if (portfolioLiquidity.maxDaysToLiquidate > 10) {
    recommendations.push({
      type: 'info',
      priority: 'medium',
      message: 'Some positions may take ' + portfolioLiquidity.maxDaysToLiquidate + 
        ' days to liquidate without significant market impact',
      action: 'Plan exits in advance for large positions'
    });
  }

  // Check liquidation cost
  if (portfolioLiquidity.costToLiquidatePercent > 2) {
    recommendations.push({
      type: 'warning',
      priority: 'medium',
      message: 'Estimated cost to liquidate entire portfolio: ' + 
        portfolioLiquidity.costToLiquidatePercent.toFixed(2) + '%',
      action: 'Consider this cost when planning withdrawals'
    });
  }

  // CS2 specific recommendation
  const skinPositions = portfolioLiquidity.positions.filter(function(p) {
    return p.liquidityScore < 40 && p.symbol;
  });
  
  if (skinPositions.length > 0 && skinPositions.some(function(p) {
    return p.bidAskSpread > 2;
  })) {
    recommendations.push({
      type: 'info',
      priority: 'low',
      message: 'CS2 items typically have wide bid-ask spreads (2-10%+)',
      action: 'Use limit orders and be patient when selling rare items'
    });
  }

  return recommendations;
}

/**
 * Generate liquidity report
 */
function generateLiquidityReport(portfolio, marketDataMap) {
  const portfolioLiquidity = calculatePortfolioLiquidity(portfolio, marketDataMap);
  const riskAnalysis = analyzeLiquidityRisk(portfolioLiquidity);
  const recommendations = generateLiquidityRecommendations(portfolioLiquidity);

  return {
    generated: new Date().toISOString(),
    summary: {
      totalValue: portfolioLiquidity.totalValue,
      liquidityScore: portfolioLiquidity.portfolioLiquidityScore,
      liquidityRating: portfolioLiquidity.portfolioLiquidityRating,
      costToLiquidate: portfolioLiquidity.costToLiquidatePercent,
      maxDaysToLiquidate: portfolioLiquidity.maxDaysToLiquidate
    },
    positions: portfolioLiquidity.positions,
    tierBreakdown: portfolioLiquidity.tierBreakdown,
    leastLiquid: portfolioLiquidity.leastLiquid,
    mostLiquid: portfolioLiquidity.mostLiquid,
    stressTest: riskAnalysis,
    recommendations: recommendations
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.LiquidityAnalysisEngine = {
    getLiquidityProfile: getLiquidityProfile,
    calculatePositionLiquidity: calculatePositionLiquidity,
    calculatePortfolioLiquidity: calculatePortfolioLiquidity,
    analyzeLiquidityRisk: analyzeLiquidityRisk,
    trackSpreadHistory: trackSpreadHistory,
    calculateVWAP: calculateVWAP,
    calculateDaysToLiquidate: calculateDaysToLiquidate,
    estimateMarketImpact: estimateMarketImpact,
    generateLiquidityRecommendations: generateLiquidityRecommendations,
    generateLiquidityReport: generateLiquidityReport
  };
  
  console.log('[OK] Liquidity Analysis Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getLiquidityProfile,
    calculatePositionLiquidity,
    calculatePortfolioLiquidity,
    analyzeLiquidityRisk,
    trackSpreadHistory,
    calculateVWAP,
    calculateDaysToLiquidate,
    estimateMarketImpact,
    generateLiquidityRecommendations,
    generateLiquidityReport
  };
}
