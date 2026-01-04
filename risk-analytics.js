// ============================================================================
// MAERMIN v4.0 - Risk Analytics Engine
// ============================================================================
// Advanced risk management calculations for professional traders
// ============================================================================

// ============================================================================
// VALUE AT RISK (VaR) CALCULATIONS
// ============================================================================

/**
 * Calculate portfolio-level Value at Risk using Historical Simulation
 * @param {Array} positions - Array of portfolio positions with historical returns
 * @param {number} confidenceLevel - Confidence level (0.95 = 95%, 0.99 = 99%)
 * @param {number} timeHorizon - Time horizon in days (1, 7, 30)
 * @returns {Object} VaR metrics
 */
function calculateValueAtRisk(positions, confidenceLevel, timeHorizon) {
  confidenceLevel = confidenceLevel || 0.95;
  timeHorizon = timeHorizon || 1;
  
  if (!positions || positions.length === 0) {
    return {
      var: 0,
      cvar: 0,
      portfolioValue: 0,
      varPercent: 0,
      cvarPercent: 0
    };
  }
  
  // Calculate current portfolio value
  const portfolioValue = positions.reduce((sum, pos) => {
    const currentPrice = pos.currentPrice || pos.purchasePrice || 0;
    return sum + (pos.amount * currentPrice);
  }, 0);
  
  // Simulate daily returns (simplified - in production use historical data)
  const returns = [];
  const numSimulations = 100;
  
  for (let i = 0; i < numSimulations; i++) {
    let portfolioReturn = 0;
    
    positions.forEach(pos => {
      const positionValue = (pos.amount * (pos.currentPrice || pos.purchasePrice || 0));
      const weight = portfolioValue > 0 ? positionValue / portfolioValue : 0;
      
      // Estimate volatility based on asset category
      let dailyVolatility = 0.02; // 2% default
      if (pos.category === 'crypto') dailyVolatility = 0.05; // 5% for crypto
      if (pos.category === 'cs2Items') dailyVolatility = 0.03; // 3% for CS2
      if (pos.category === 'stocks') dailyVolatility = 0.015; // 1.5% for stocks
      
      // Generate random return (normal distribution approximation)
      const randomReturn = (Math.random() - 0.5) * 2 * dailyVolatility * Math.sqrt(timeHorizon);
      portfolioReturn += weight * randomReturn;
    });
    
    returns.push(portfolioReturn);
  }
  
  // Sort returns (worst to best)
  returns.sort((a, b) => a - b);
  
  // Calculate VaR at confidence level
  const varIndex = Math.floor((1 - confidenceLevel) * returns.length);
  const varReturn = returns[varIndex];
  const varAmount = Math.abs(varReturn * portfolioValue);
  
  // Calculate Conditional VaR (CVaR) - average of losses beyond VaR
  const cvarReturns = returns.slice(0, varIndex + 1);
  const avgCvarReturn = cvarReturns.reduce((sum, r) => sum + r, 0) / cvarReturns.length;
  const cvarAmount = Math.abs(avgCvarReturn * portfolioValue);
  
  return {
    var: varAmount,
    cvar: cvarAmount,
    portfolioValue: portfolioValue,
    varPercent: (varAmount / portfolioValue) * 100,
    cvarPercent: (cvarAmount / portfolioValue) * 100,
    confidenceLevel: confidenceLevel * 100,
    timeHorizon: timeHorizon
  };
}

// ============================================================================
// CONCENTRATION RISK ANALYSIS
// ============================================================================

/**
 * Analyze portfolio concentration across multiple dimensions
 * @param {Array} positions - Array of portfolio positions
 * @param {Object} thresholds - User-defined concentration thresholds
 * @returns {Object} Concentration analysis
 */
function analyzeConcentration(positions, thresholds) {
  thresholds = thresholds || {
    singlePosition: 25, // Max % for single position
    category: 40, // Max % for single category
    topThree: 60 // Max % for top 3 positions
  };
  
  if (!positions || positions.length === 0) {
    return {
      singlePosition: { max: 0, positions: [], risk: 'none' },
      category: { breakdown: {}, risk: 'none' },
      topThree: { total: 0, positions: [], risk: 'none' },
      diversificationScore: 100
    };
  }
  
  // Calculate total portfolio value
  const totalValue = positions.reduce((sum, pos) => {
    const value = pos.amount * (pos.currentPrice || pos.purchasePrice || 0);
    return sum + value;
  }, 0);
  
  // Analyze single position concentration
  const positionsWithPercent = positions.map(pos => {
    const value = pos.amount * (pos.currentPrice || pos.purchasePrice || 0);
    const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return { ...pos, value, percent };
  }).sort((a, b) => b.percent - a.percent);
  
  const maxPosition = positionsWithPercent[0] || { percent: 0 };
  const singlePositionRisk = maxPosition.percent > thresholds.singlePosition ? 'high' :
                              maxPosition.percent > thresholds.singlePosition * 0.7 ? 'medium' : 'low';
  
  // Analyze category concentration
  const categoryBreakdown = {};
  positions.forEach(pos => {
    const category = pos.category || 'unknown';
    const value = pos.amount * (pos.currentPrice || pos.purchasePrice || 0);
    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = { value: 0, percent: 0, count: 0 };
    }
    categoryBreakdown[category].value += value;
    categoryBreakdown[category].count += 1;
  });
  
  Object.keys(categoryBreakdown).forEach(cat => {
    categoryBreakdown[cat].percent = totalValue > 0 ? 
      (categoryBreakdown[cat].value / totalValue) * 100 : 0;
  });
  
  const maxCategoryPercent = Math.max(...Object.values(categoryBreakdown).map(c => c.percent));
  const categoryRisk = maxCategoryPercent > thresholds.category ? 'high' :
                       maxCategoryPercent > thresholds.category * 0.7 ? 'medium' : 'low';
  
  // Analyze top 3 concentration
  const topThree = positionsWithPercent.slice(0, 3);
  const topThreeTotal = topThree.reduce((sum, pos) => sum + pos.percent, 0);
  const topThreeRisk = topThreeTotal > thresholds.topThree ? 'high' :
                       topThreeTotal > thresholds.topThree * 0.7 ? 'medium' : 'low';
  
  // Calculate diversification score (0-100, higher is better)
  const numPositions = positions.length;
  const categoryCount = Object.keys(categoryBreakdown).length;
  
  let diversificationScore = 100;
  diversificationScore -= (maxPosition.percent / thresholds.singlePosition) * 30;
  diversificationScore -= (maxCategoryPercent / thresholds.category) * 30;
  diversificationScore -= (topThreeTotal / thresholds.topThree) * 20;
  diversificationScore += Math.min(numPositions * 2, 20); // Bonus for many positions
  diversificationScore = Math.max(0, Math.min(100, diversificationScore));
  
  return {
    singlePosition: {
      max: maxPosition.percent,
      position: maxPosition.symbol || maxPosition.name,
      risk: singlePositionRisk
    },
    category: {
      breakdown: categoryBreakdown,
      maxPercent: maxCategoryPercent,
      risk: categoryRisk
    },
    topThree: {
      total: topThreeTotal,
      positions: topThree.map(p => ({ symbol: p.symbol || p.name, percent: p.percent })),
      risk: topThreeRisk
    },
    diversificationScore: Math.round(diversificationScore)
  };
}

// ============================================================================
// VOLATILITY ANALYSIS
// ============================================================================

/**
 * Calculate volatility metrics for each position
 * @param {Array} positions - Array of portfolio positions
 * @param {Object} historicalData - Historical price data (optional)
 * @returns {Array} Positions with volatility metrics
 */
function calculateVolatilityMetrics(positions, historicalData) {
  if (!positions || positions.length === 0) return [];
  
  return positions.map(pos => {
    const currentPrice = pos.currentPrice || pos.purchasePrice || 0;
    const purchasePrice = pos.purchasePrice || currentPrice;
    
    // Estimate annualized volatility based on category and price movement
    let estimatedVolatility = 20; // 20% default
    
    if (pos.category === 'crypto') {
      estimatedVolatility = 80; // 80% for crypto
    } else if (pos.category === 'cs2Items') {
      estimatedVolatility = 50; // 50% for CS2
    } else if (pos.category === 'stocks') {
      estimatedVolatility = 25; // 25% for stocks
    }
    
    // Adjust based on actual price movement
    if (purchasePrice > 0) {
      const priceChange = Math.abs((currentPrice - purchasePrice) / purchasePrice);
      const holdingDays = pos.purchaseDate ? 
        (Date.now() - new Date(pos.purchaseDate).getTime()) / (1000 * 60 * 60 * 24) : 30;
      
      // Annualize the observed volatility
      if (holdingDays > 7) {
        const annualizedMove = priceChange * Math.sqrt(365 / holdingDays) * 100;
        estimatedVolatility = (estimatedVolatility + annualizedMove) / 2; // Blend estimate with actual
      }
    }
    
    // Determine volatility regime
    let regime = 'normal';
    if (estimatedVolatility > 60) regime = 'high';
    else if (estimatedVolatility > 40) regime = 'elevated';
    else if (estimatedVolatility < 15) regime = 'low';
    
    return {
      ...pos,
      volatility: {
        annualized: Math.round(estimatedVolatility),
        regime: regime,
        dailyExpectedMove: (estimatedVolatility / Math.sqrt(252)).toFixed(2) // 252 trading days
      }
    };
  });
}

// ============================================================================
// LIQUIDITY SCORING
// ============================================================================

/**
 * Calculate liquidity score for each position
 * @param {Array} positions - Array of portfolio positions
 * @returns {Array} Positions with liquidity scores
 */
function calculateLiquidityScores(positions) {
  if (!positions || positions.length === 0) return [];
  
  return positions.map(pos => {
    let liquidityScore = 50; // 0-100, higher is more liquid
    let daysToExit = 1;
    
    const positionValue = pos.amount * (pos.currentPrice || pos.purchasePrice || 0);
    
    // Base liquidity on category
    if (pos.category === 'stocks') {
      liquidityScore = 90; // Very liquid
      daysToExit = 0.1; // Can exit in hours
      
      // Adjust for position size (large positions less liquid)
      if (positionValue > 100000) {
        liquidityScore -= 10;
        daysToExit = 1;
      }
    } else if (pos.category === 'crypto') {
      liquidityScore = 80; // Highly liquid for major coins
      daysToExit = 0.5;
      
      // Major coins vs altcoins
      if (pos.symbol && !['BTC', 'ETH', 'BNB', 'SOL', 'ADA'].includes(pos.symbol.toUpperCase())) {
        liquidityScore = 60; // Altcoins less liquid
        daysToExit = 2;
      }
      
      // Very small coins
      if (positionValue < 1000) {
        liquidityScore = 40;
        daysToExit = 7;
      }
    } else if (pos.category === 'cs2Items') {
      // CS2 liquidity varies greatly
      liquidityScore = 40;
      daysToExit = 7;
      
      // Check for special attributes
      if (pos.metadata) {
        // High-value knives are less liquid
        if (pos.metadata.type === 'knife' && positionValue > 1000) {
          liquidityScore = 20;
          daysToExit = 30;
        }
        
        // Low float items less liquid
        if (pos.metadata.float && pos.metadata.float < 0.01) {
          liquidityScore -= 10;
          daysToExit += 7;
        }
        
        // Stickered items less liquid
        if (pos.metadata.stickers && pos.metadata.stickers.length > 0) {
          liquidityScore -= 15;
          daysToExit += 5;
        }
        
        // Common skins more liquid
        if (pos.metadata.rarity === 'consumer' || pos.metadata.rarity === 'industrial') {
          liquidityScore = 70;
          daysToExit = 1;
        }
      }
    }
    
    // Categorize liquidity
    let liquidityRating = 'medium';
    if (liquidityScore >= 80) liquidityRating = 'high';
    else if (liquidityScore >= 60) liquidityRating = 'good';
    else if (liquidityScore <= 30) liquidityRating = 'poor';
    else if (liquidityScore <= 40) liquidityRating = 'low';
    
    return {
      ...pos,
      liquidity: {
        score: liquidityScore,
        rating: liquidityRating,
        daysToExit: daysToExit,
        effectiveValue: positionValue * (liquidityScore / 100) // Discount for illiquidity
      }
    };
  });
}

// ============================================================================
// RISK SCORE AGGREGATION
// ============================================================================

/**
 * Calculate comprehensive risk score for the portfolio
 * @param {Object} concentrationAnalysis
 * @param {Object} varAnalysis
 * @param {Array} volatilityMetrics
 * @param {Array} liquidityScores
 * @returns {Object} Overall risk assessment
 */
function calculatePortfolioRiskScore(concentrationAnalysis, varAnalysis, volatilityMetrics, liquidityScores) {
  let riskScore = 50; // Start at neutral (0-100, higher = more risky)
  const factors = {};
  
  // Concentration risk (30% weight)
  const concentrationRisk = 100 - concentrationAnalysis.diversificationScore;
  riskScore += (concentrationRisk - 50) * 0.3;
  factors.concentration = concentrationRisk;
  
  // VaR risk (25% weight)
  const varRisk = varAnalysis.varPercent > 20 ? 80 : 
                  varAnalysis.varPercent > 10 ? 60 :
                  varAnalysis.varPercent > 5 ? 40 : 20;
  riskScore += (varRisk - 50) * 0.25;
  factors.var = varRisk;
  
  // Volatility risk (25% weight)
  const avgVolatility = volatilityMetrics.reduce((sum, p) => 
    sum + (p.volatility ? p.volatility.annualized : 0), 0) / Math.max(volatilityMetrics.length, 1);
  const volatilityRisk = avgVolatility > 60 ? 80 :
                         avgVolatility > 40 ? 60 :
                         avgVolatility > 25 ? 40 : 20;
  riskScore += (volatilityRisk - 50) * 0.25;
  factors.volatility = volatilityRisk;
  
  // Liquidity risk (20% weight)
  const avgLiquidity = liquidityScores.reduce((sum, p) => 
    sum + (p.liquidity ? p.liquidity.score : 50), 0) / Math.max(liquidityScores.length, 1);
  const liquidityRisk = 100 - avgLiquidity;
  riskScore += (liquidityRisk - 50) * 0.2;
  factors.liquidity = liquidityRisk;
  
  riskScore = Math.max(0, Math.min(100, riskScore));
  
  // Determine rating
  let rating = 'moderate';
  let color = '#f59e0b';
  if (riskScore >= 70) {
    rating = 'high';
    color = '#ef4444';
  } else if (riskScore >= 55) {
    rating = 'elevated';
    color = '#f97316';
  } else if (riskScore <= 35) {
    rating = 'low';
    color = '#10b981';
  } else if (riskScore <= 45) {
    rating = 'moderate-low';
    color = '#84cc16';
  }
  
  return {
    overallScore: Math.round(riskScore),
    rating: rating,
    color: color,
    factors: factors,
    recommendations: generateRiskRecommendations(riskScore, factors, concentrationAnalysis)
  };
}

/**
 * Generate risk management recommendations
 */
function generateRiskRecommendations(riskScore, factors, concentrationAnalysis) {
  const recommendations = [];
  
  if (factors.concentration > 60) {
    recommendations.push({
      type: 'concentration',
      severity: 'high',
      message: 'Portfolio is highly concentrated. Consider diversifying across more positions.',
      action: 'Add positions in different categories or reduce largest holdings.'
    });
  }
  
  if (factors.var > 60) {
    recommendations.push({
      type: 'var',
      severity: 'high',
      message: 'High Value at Risk detected. Potential for significant losses.',
      action: 'Consider hedging strategies or reducing position sizes in volatile assets.'
    });
  }
  
  if (factors.volatility > 65) {
    recommendations.push({
      type: 'volatility',
      severity: 'high',
      message: 'Portfolio volatility is elevated. Expect large price swings.',
      action: 'Consider adding stable assets (bonds, stablecoins) to reduce volatility.'
    });
  }
  
  if (factors.liquidity > 60) {
    recommendations.push({
      type: 'liquidity',
      severity: 'medium',
      message: 'Some positions have low liquidity. Exit may be difficult.',
      action: 'Maintain cash reserve. Avoid overleveraging illiquid positions.'
    });
  }
  
  if (concentrationAnalysis.topThree.risk === 'high') {
    recommendations.push({
      type: 'top-heavy',
      severity: 'medium',
      message: `Top 3 positions represent ${concentrationAnalysis.topThree.total.toFixed(1)}% of portfolio.`,
      action: 'Trim largest positions or add new positions to reduce concentration.'
    });
  }
  
  return recommendations;
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.calculateValueAtRisk = calculateValueAtRisk;
  window.analyzeConcentration = analyzeConcentration;
  window.calculateVolatilityMetrics = calculateVolatilityMetrics;
  window.calculateLiquidityScores = calculateLiquidityScores;
  window.calculatePortfolioRiskScore = calculatePortfolioRiskScore;
  
  console.log('[OK] Risk Analytics Engine loaded v4.0');
}
