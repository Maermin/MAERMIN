// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
// ============================================================================
// MAERMIN v6.0 - Risk Analytics Module
// VaR, Volatility, Sharpe Ratio, and Risk Metrics
// ============================================================================

/**
 * Calculate Value at Risk (VaR) using historical simulation
 */
function calculateVaR(priceHistory, portfolioValue, confidenceLevel, holdingPeriod) {
  confidenceLevel = confidenceLevel || 0.95;
  holdingPeriod = holdingPeriod || 1;
  
  if (!priceHistory || priceHistory.length < 10) {
    return {
      var: 0,
      percentile: 0,
      confidenceLevel: confidenceLevel
    };
  }
  
  // Calculate daily returns
  var returns = [];
  for (var i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i - 1] !== 0) {
      returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
    }
  }
  
  if (returns.length === 0) {
    return { var: 0, percentile: 0, confidenceLevel: confidenceLevel };
  }
  
  // Sort returns ascending
  returns.sort(function(a, b) { return a - b; });
  
  // Find percentile index
  var percentileIndex = Math.floor((1 - confidenceLevel) * returns.length);
  var percentileReturn = returns[percentileIndex];
  
  // Scale for holding period
  var scaledReturn = percentileReturn * Math.sqrt(holdingPeriod);
  
  // Calculate VaR in currency terms
  var varValue = Math.abs(portfolioValue * scaledReturn);
  
  return {
    var: varValue,
    percentile: percentileReturn * 100,
    confidenceLevel: confidenceLevel,
    holdingPeriod: holdingPeriod
  };
}

/**
 * Calculate Conditional VaR (Expected Shortfall)
 */
function calculateCVaR(priceHistory, portfolioValue, confidenceLevel) {
  confidenceLevel = confidenceLevel || 0.95;
  
  if (!priceHistory || priceHistory.length < 10) {
    return { cvar: 0, confidenceLevel: confidenceLevel };
  }
  
  // Calculate daily returns
  var returns = [];
  for (var i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i - 1] !== 0) {
      returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
    }
  }
  
  // Sort returns ascending
  returns.sort(function(a, b) { return a - b; });
  
  // Find all returns below VaR threshold
  var percentileIndex = Math.floor((1 - confidenceLevel) * returns.length);
  var tailReturns = returns.slice(0, percentileIndex + 1);
  
  if (tailReturns.length === 0) {
    return { cvar: 0, confidenceLevel: confidenceLevel };
  }
  
  // Calculate average of tail returns
  var avgTailReturn = tailReturns.reduce(function(a, b) { return a + b; }, 0) / tailReturns.length;
  
  return {
    cvar: Math.abs(portfolioValue * avgTailReturn),
    avgTailReturn: avgTailReturn * 100,
    confidenceLevel: confidenceLevel
  };
}

/**
 * Calculate Sharpe Ratio
 */
function calculateSharpeRatio(returns, riskFreeRate) {
  riskFreeRate = riskFreeRate || 0.02; // 2% annual risk-free rate
  
  if (!returns || returns.length < 2) {
    return 0;
  }
  
  // Calculate mean return (annualized)
  var meanReturn = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
  var annualizedReturn = meanReturn * 252;
  
  // Calculate volatility (annualized)
  var variance = returns.reduce(function(sum, r) {
    return sum + Math.pow(r - meanReturn, 2);
  }, 0) / returns.length;
  var volatility = Math.sqrt(variance) * Math.sqrt(252);
  
  if (volatility === 0) return 0;
  
  return (annualizedReturn - riskFreeRate) / volatility;
}

/**
 * Calculate Sortino Ratio (only considers downside volatility)
 */
function calculateSortinoRatio(returns, riskFreeRate, targetReturn) {
  riskFreeRate = riskFreeRate || 0.02;
  targetReturn = targetReturn || 0;
  
  if (!returns || returns.length < 2) {
    return 0;
  }
  
  // Calculate mean return (annualized)
  var meanReturn = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
  var annualizedReturn = meanReturn * 252;
  
  // Calculate downside deviation
  var downsideReturns = returns.filter(function(r) { return r < targetReturn; });
  
  if (downsideReturns.length === 0) {
    return Infinity; // No downside risk
  }
  
  var downsideVariance = downsideReturns.reduce(function(sum, r) {
    return sum + Math.pow(r - targetReturn, 2);
  }, 0) / downsideReturns.length;
  
  var downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
  
  if (downsideDeviation === 0) return Infinity;
  
  return (annualizedReturn - riskFreeRate) / downsideDeviation;
}

/**
 * Calculate Maximum Drawdown
 */
function calculateMaxDrawdown(priceHistory) {
  if (!priceHistory || priceHistory.length < 2) {
    return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  }
  
  var maxDrawdown = 0;
  var maxDrawdownPercent = 0;
  var peak = priceHistory[0];
  var peakIndex = 0;
  var troughIndex = 0;
  
  for (var i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i] > peak) {
      peak = priceHistory[i];
      peakIndex = i;
    }
    
    var drawdown = peak - priceHistory[i];
    var drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    
    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
      maxDrawdown = drawdown;
      troughIndex = i;
    }
  }
  
  return {
    maxDrawdown: maxDrawdown,
    maxDrawdownPercent: maxDrawdownPercent,
    peakIndex: peakIndex,
    troughIndex: troughIndex
  };
}

/**
 * How many return observations the price history can yield (longest series
 * minus one). Volatility, VaR, Sharpe and drawdown are meaningless below
 * MIN_RISK_OBSERVATIONS - the engine then returns zeros, which the view used
 * to print as measured values ("Volatility 0.0%", "Risk level: Low").
 * Accepts series of numbers or of {price} points.
 */
var MIN_RISK_OBSERVATIONS = 5;
function riskObservations(priceHistory) {
  var max = 0;
  Object.keys(priceHistory || {}).forEach(function (k) {
    var h = priceHistory[k];
    if (!Array.isArray(h)) return;
    var n = h.filter(function (pt) { var v = (pt && typeof pt === 'object') ? pt.price : pt; return typeof v === 'number' && isFinite(v) && v > 0; }).length;
    if (n - 1 > max) max = n - 1;
  });
  return max;
}
function hasMeasurableRisk(priceHistory) { return riskObservations(priceHistory) >= MIN_RISK_OBSERVATIONS; }

/**
 * Calculate comprehensive risk metrics for portfolio
 */
function calculatePortfolioRiskMetrics(portfolio, priceHistory, portfolioValue) {
  var combinedHistory = [];
  var weights = {};
  var totalValue = portfolioValue || 0;
  
  // Calculate weights and combine price histories
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    var positions = portfolio[category] || [];
    positions.forEach(function(pos) {
      var symbol = (pos.symbol || pos.name || '').toLowerCase();
      var currentPrice = pos.currentPrice || pos.purchasePrice || 0;
      var value = (pos.amount || 1) * currentPrice;
      
      if (totalValue > 0) {
        weights[symbol] = value / totalValue;
      }
    });
  });
  
  // If we have price history, calculate weighted returns
  var portfolioReturns = [];
  
  if (priceHistory && Object.keys(priceHistory).length > 0) {
    var maxLength = 0;
    Object.values(priceHistory).forEach(function(history) {
      if (history.length > maxLength) maxLength = history.length;
    });
    
    for (var i = 1; i < maxLength; i++) {
      var dayReturn = 0;
      Object.keys(weights).forEach(function(symbol) {
        var history = priceHistory[symbol];
        if (history && history[i] && history[i - 1] && history[i - 1] !== 0) {
          var assetReturn = (history[i] - history[i - 1]) / history[i - 1];
          dayReturn += assetReturn * weights[symbol];
        }
      });
      portfolioReturns.push(dayReturn);
    }
    
    // Create combined price history for drawdown calculation
    var startValue = 10000;
    combinedHistory = [startValue];
    portfolioReturns.forEach(function(r) {
      combinedHistory.push(combinedHistory[combinedHistory.length - 1] * (1 + r));
    });
  }
  
  // Calculate all metrics
  var volatility = portfolioReturns.length > 0 ? 
    Math.sqrt(portfolioReturns.reduce(function(sum, r) {
      var mean = portfolioReturns.reduce(function(a, b) { return a + b; }, 0) / portfolioReturns.length;
      return sum + Math.pow(r - mean, 2);
    }, 0) / portfolioReturns.length) * Math.sqrt(252) : 0;
  
  var varResult = calculateVaR(combinedHistory, totalValue, 0.95, 1);
  var cvarResult = calculateCVaR(combinedHistory, totalValue, 0.95);
  var sharpeRatio = calculateSharpeRatio(portfolioReturns, 0.02);
  var sortinoRatio = calculateSortinoRatio(portfolioReturns, 0.02, 0);
  var maxDrawdown = calculateMaxDrawdown(combinedHistory);
  
  // Calculate risk score (0-100)
  var riskScore = calculateRiskScore(volatility, varResult.var / totalValue, maxDrawdown.maxDrawdownPercent);
  
  return {
    volatility: volatility * 100,
    var95: varResult.var,
    var95Percent: varResult.percentile,
    cvar95: cvarResult.cvar,
    sharpeRatio: sharpeRatio,
    sortinoRatio: sortinoRatio,
    maxDrawdown: maxDrawdown.maxDrawdown,
    maxDrawdownPercent: maxDrawdown.maxDrawdownPercent,
    riskScore: riskScore,
    riskLevel: getRiskLevel(riskScore),
    weights: weights,
    portfolioValue: totalValue
  };
}

/**
 * Calculate overall risk score (0-100)
 */
function calculateRiskScore(volatility, varPercent, maxDrawdownPercent) {
  // Higher values = higher risk
  var volScore = Math.min(40, volatility * 100); // 0-40 points
  var varScore = Math.min(30, Math.abs(varPercent) * 300); // 0-30 points
  var ddScore = Math.min(30, maxDrawdownPercent); // 0-30 points
  
  return Math.min(100, volScore + varScore + ddScore);
}

/**
 * Get risk level label from score
 */
function getRiskLevel(score) {
  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'very-high';
}

/**
 * Generate risk recommendations
 */
function generateRiskRecommendations(riskMetrics, portfolio) {
  var recommendations = [];
  
  if (riskMetrics.volatility > 30) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: __('rarVol', 'Portfolio volatility is high ({pct}). Consider adding stable assets.', { pct: (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).pct(riskMetrics.volatility, 1) }),
      metric: 'volatility'
    });
  }
  
  if (riskMetrics.maxDrawdownPercent > 20) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: __('rarDd', 'Maximum drawdown of {pct} indicates significant downside risk.', { pct: (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).pct(riskMetrics.maxDrawdownPercent, 1) }),
      metric: 'drawdown'
    });
  }
  
  if (riskMetrics.sharpeRatio < 0.5) {
    recommendations.push({
      type: 'info',
      priority: 'medium',
      message: __('rarSharpe', 'Sharpe ratio is low ({v}). Risk-adjusted returns could be improved.', { v: (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).num(riskMetrics.sharpeRatio, 2) }),
      metric: 'sharpe'
    });
  }
  
  if (riskMetrics.riskScore > 75) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: __('rarOverall', 'Overall risk score is very high. Consider rebalancing to reduce exposure.'),
      metric: 'overall'
    });
  }
  
  // Check concentration
  var maxWeight = 0;
  var maxWeightAsset = '';
  Object.keys(riskMetrics.weights || {}).forEach(function(symbol) {
    if (riskMetrics.weights[symbol] > maxWeight) {
      maxWeight = riskMetrics.weights[symbol];
      maxWeightAsset = symbol;
    }
  });
  
  if (maxWeight > 0.4) {
    recommendations.push({
      type: 'warning',
      priority: 'medium',
      message: __('rarConc', '{sym} represents {pct} of portfolio. Consider diversifying.', { sym: maxWeightAsset.toUpperCase(), pct: (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).pct(maxWeight * 100, 0) }),
      metric: 'concentration'
    });
  }
  
  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.calculateVaR = calculateVaR;
  window.calculateCVaR = calculateCVaR;
  window.calculateSharpeRatio = calculateSharpeRatio;
  window.calculateSortinoRatio = calculateSortinoRatio;
  window.calculateMaxDrawdown = calculateMaxDrawdown;
  window.calculatePortfolioRiskMetrics = calculatePortfolioRiskMetrics;
  window.riskObservations = riskObservations;
  window.hasMeasurableRisk = hasMeasurableRisk;
  window.MIN_RISK_OBSERVATIONS = MIN_RISK_OBSERVATIONS;
  window.calculateRiskScore = calculateRiskScore;
  window.getRiskLevel = getRiskLevel;
  window.generateRiskRecommendations = generateRiskRecommendations;
  
  console.log('[RISK] Risk Analytics Module loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateVaR: calculateVaR,
    calculateCVaR: calculateCVaR,
    calculateSharpeRatio: calculateSharpeRatio,
    calculateSortinoRatio: calculateSortinoRatio,
    calculateMaxDrawdown: calculateMaxDrawdown,
    calculatePortfolioRiskMetrics: calculatePortfolioRiskMetrics,
    riskObservations: riskObservations,
    hasMeasurableRisk: hasMeasurableRisk,
    MIN_RISK_OBSERVATIONS: MIN_RISK_OBSERVATIONS,
    generateRiskRecommendations: generateRiskRecommendations
  };
}
