// ============================================================================
// MAERMIN v6.0 - Risk Analytics Module
// VaR, Volatility, Sharpe Ratio, and Risk Metrics
// ============================================================================

/**
 * Calculate portfolio volatility (standard deviation of returns)
 */
function calculateVolatility(priceHistory, period) {
  period = period || 30;
  
  if (!priceHistory || priceHistory.length < 2) {
    return 0;
  }
  
  // Calculate daily returns
  var returns = [];
  for (var i = 1; i < priceHistory.length; i++) {
    if (priceHistory[i - 1] !== 0) {
      returns.push((priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
    }
  }
  
  if (returns.length === 0) return 0;
  
  // Use last N periods
  var recentReturns = returns.slice(-period);
  
  // Calculate mean
  var mean = recentReturns.reduce(function(a, b) { return a + b; }, 0) / recentReturns.length;
  
  // Calculate variance
  var variance = recentReturns.reduce(function(sum, r) {
    return sum + Math.pow(r - mean, 2);
  }, 0) / recentReturns.length;
  
  // Return annualized volatility
  return Math.sqrt(variance) * Math.sqrt(252);
}

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
 * Calculate Beta (systematic risk relative to market)
 */
function calculateBeta(assetReturns, marketReturns) {
  if (!assetReturns || !marketReturns || assetReturns.length < 2) {
    return 1;
  }
  
  var minLength = Math.min(assetReturns.length, marketReturns.length);
  var asset = assetReturns.slice(-minLength);
  var market = marketReturns.slice(-minLength);
  
  // Calculate means
  var assetMean = asset.reduce(function(a, b) { return a + b; }, 0) / asset.length;
  var marketMean = market.reduce(function(a, b) { return a + b; }, 0) / market.length;
  
  // Calculate covariance and market variance
  var covariance = 0;
  var marketVariance = 0;
  
  for (var i = 0; i < asset.length; i++) {
    covariance += (asset[i] - assetMean) * (market[i] - marketMean);
    marketVariance += Math.pow(market[i] - marketMean, 2);
  }
  
  covariance /= asset.length;
  marketVariance /= market.length;
  
  if (marketVariance === 0) return 1;
  
  return covariance / marketVariance;
}

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
      message: 'Portfolio volatility is high (' + riskMetrics.volatility.toFixed(1) + '%). Consider adding stable assets.',
      metric: 'volatility'
    });
  }
  
  if (riskMetrics.maxDrawdownPercent > 20) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: 'Maximum drawdown of ' + riskMetrics.maxDrawdownPercent.toFixed(1) + '% indicates significant downside risk.',
      metric: 'drawdown'
    });
  }
  
  if (riskMetrics.sharpeRatio < 0.5) {
    recommendations.push({
      type: 'info',
      priority: 'medium',
      message: 'Sharpe ratio is low (' + riskMetrics.sharpeRatio.toFixed(2) + '). Risk-adjusted returns could be improved.',
      metric: 'sharpe'
    });
  }
  
  if (riskMetrics.riskScore > 75) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: 'Overall risk score is very high. Consider rebalancing to reduce exposure.',
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
      message: maxWeightAsset.toUpperCase() + ' represents ' + (maxWeight * 100).toFixed(0) + '% of portfolio. Consider diversifying.',
      metric: 'concentration'
    });
  }
  
  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.calculateVolatility = calculateVolatility;
  window.calculateVaR = calculateVaR;
  window.calculateCVaR = calculateCVaR;
  window.calculateSharpeRatio = calculateSharpeRatio;
  window.calculateSortinoRatio = calculateSortinoRatio;
  window.calculateMaxDrawdown = calculateMaxDrawdown;
  window.calculateBeta = calculateBeta;
  window.calculatePortfolioRiskMetrics = calculatePortfolioRiskMetrics;
  window.calculateRiskScore = calculateRiskScore;
  window.getRiskLevel = getRiskLevel;
  window.generateRiskRecommendations = generateRiskRecommendations;
  
  console.log('[RISK] Risk Analytics Module loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateVolatility: calculateVolatility,
    calculateVaR: calculateVaR,
    calculateCVaR: calculateCVaR,
    calculateSharpeRatio: calculateSharpeRatio,
    calculateSortinoRatio: calculateSortinoRatio,
    calculateMaxDrawdown: calculateMaxDrawdown,
    calculateBeta: calculateBeta,
    calculatePortfolioRiskMetrics: calculatePortfolioRiskMetrics,
    generateRiskRecommendations: generateRiskRecommendations
  };
}
