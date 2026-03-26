// ============================================================================
// MAERMIN v6.0 - Portfolio Optimization Engine
// Mean-Variance Optimization, Efficient Frontier, Risk Parity
// ============================================================================

/**
 * Calculate expected returns from historical data
 * @param {Object} priceHistories - Price histories by symbol
 * @param {string} method - 'historical', 'ewma', or 'capm'
 */
function calculateExpectedReturns(priceHistories, method) {
  method = method || 'historical';
  const returns = {};

  Object.keys(priceHistories).forEach(function(symbol) {
    const prices = priceHistories[symbol];
    if (prices.length < 2) {
      returns[symbol] = 0;
      return;
    }

    // Calculate daily returns
    const dailyReturns = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] !== 0) {
        dailyReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }

    if (method === 'ewma') {
      // Exponentially weighted moving average
      const lambda = 0.94;
      let ewmaReturn = dailyReturns[0];
      for (let i = 1; i < dailyReturns.length; i++) {
        ewmaReturn = lambda * ewmaReturn + (1 - lambda) * dailyReturns[i];
      }
      returns[symbol] = ewmaReturn * 252; // Annualized
    } else {
      // Simple historical mean
      const mean = dailyReturns.reduce(function(a, b) { return a + b; }, 0) / dailyReturns.length;
      returns[symbol] = mean * 252; // Annualized
    }
  });

  return returns;
}

/**
 * Calculate covariance matrix from price histories
 * @param {Object} priceHistories - Price histories by symbol
 */
function calculateCovarianceMatrix(priceHistories) {
  const symbols = Object.keys(priceHistories);
  const n = symbols.length;

  // Calculate returns for each asset
  const allReturns = {};
  let minLength = Infinity;

  symbols.forEach(function(symbol) {
    const prices = priceHistories[symbol];
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] !== 0) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
    }
    allReturns[symbol] = returns;
    if (returns.length < minLength) minLength = returns.length;
  });

  // Align all return series
  symbols.forEach(function(symbol) {
    allReturns[symbol] = allReturns[symbol].slice(-minLength);
  });

  // Calculate means
  const means = {};
  symbols.forEach(function(symbol) {
    means[symbol] = allReturns[symbol].reduce(function(a, b) { 
      return a + b; 
    }, 0) / minLength;
  });

  // Calculate covariance matrix
  const covMatrix = [];
  for (let i = 0; i < n; i++) {
    covMatrix[i] = [];
    for (let j = 0; j < n; j++) {
      let cov = 0;
      for (let k = 0; k < minLength; k++) {
        cov += (allReturns[symbols[i]][k] - means[symbols[i]]) * 
               (allReturns[symbols[j]][k] - means[symbols[j]]);
      }
      covMatrix[i][j] = (cov / minLength) * 252; // Annualized
    }
  }

  return {
    symbols: symbols,
    matrix: covMatrix,
    means: means
  };
}

/**
 * Calculate portfolio return and volatility for given weights
 */
function calculatePortfolioMetrics(weights, expectedReturns, covMatrix, symbols) {
  let portfolioReturn = 0;
  let portfolioVariance = 0;

  // Portfolio return
  symbols.forEach(function(symbol, i) {
    portfolioReturn += weights[i] * expectedReturns[symbol];
  });

  // Portfolio variance
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      portfolioVariance += weights[i] * weights[j] * covMatrix[i][j];
    }
  }

  return {
    return: portfolioReturn,
    volatility: Math.sqrt(portfolioVariance),
    variance: portfolioVariance,
    sharpeRatio: portfolioReturn / Math.sqrt(portfolioVariance)
  };
}

/**
 * Generate random portfolio weights that sum to 1
 */
function generateRandomWeights(n, constraints) {
  constraints = constraints || {};
  const minWeight = constraints.minWeight || 0;
  const maxWeight = constraints.maxWeight || 1;

  const weights = [];
  let sum = 0;

  for (let i = 0; i < n; i++) {
    const w = Math.random();
    weights.push(w);
    sum += w;
  }

  // Normalize to sum to 1 and apply constraints
  for (let i = 0; i < n; i++) {
    weights[i] = weights[i] / sum;
    weights[i] = Math.max(minWeight, Math.min(maxWeight, weights[i]));
  }

  // Re-normalize after constraints
  sum = weights.reduce(function(a, b) { return a + b; }, 0);
  for (let i = 0; i < n; i++) {
    weights[i] = weights[i] / sum;
  }

  return weights;
}

/**
 * Find minimum variance portfolio
 */
function findMinimumVariancePortfolio(priceHistories, constraints) {
  const covData = calculateCovarianceMatrix(priceHistories);
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Monte Carlo search for minimum variance
  const iterations = 10000;
  let bestWeights = null;
  let bestVariance = Infinity;

  for (let i = 0; i < iterations; i++) {
    const weights = generateRandomWeights(n, constraints);
    const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);

    if (metrics.variance < bestVariance) {
      bestVariance = metrics.variance;
      bestWeights = weights.slice();
    }
  }

  const finalMetrics = calculatePortfolioMetrics(bestWeights, expectedReturns, covData.matrix, symbols);

  return {
    type: 'Minimum Variance',
    weights: createWeightsObject(symbols, bestWeights),
    expectedReturn: finalMetrics.return * 100,
    volatility: finalMetrics.volatility * 100,
    sharpeRatio: finalMetrics.sharpeRatio
  };
}

/**
 * Find maximum Sharpe ratio portfolio
 */
function findMaxSharpePortfolio(priceHistories, riskFreeRate, constraints) {
  riskFreeRate = riskFreeRate || 0.02;
  const covData = calculateCovarianceMatrix(priceHistories);
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Monte Carlo search for max Sharpe
  const iterations = 10000;
  let bestWeights = null;
  let bestSharpe = -Infinity;

  for (let i = 0; i < iterations; i++) {
    const weights = generateRandomWeights(n, constraints);
    const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);
    const sharpe = (metrics.return - riskFreeRate) / metrics.volatility;

    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = weights.slice();
    }
  }

  const finalMetrics = calculatePortfolioMetrics(bestWeights, expectedReturns, covData.matrix, symbols);

  return {
    type: 'Maximum Sharpe Ratio',
    weights: createWeightsObject(symbols, bestWeights),
    expectedReturn: finalMetrics.return * 100,
    volatility: finalMetrics.volatility * 100,
    sharpeRatio: (finalMetrics.return - riskFreeRate) / finalMetrics.volatility,
    riskFreeRate: riskFreeRate * 100
  };
}

/**
 * Find portfolio for target return
 */
function findTargetReturnPortfolio(priceHistories, targetReturn, constraints) {
  const covData = calculateCovarianceMatrix(priceHistories);
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Monte Carlo search for target return with minimum variance
  const iterations = 10000;
  let bestWeights = null;
  let bestVariance = Infinity;
  const tolerance = 0.01; // 1% tolerance

  for (let i = 0; i < iterations; i++) {
    const weights = generateRandomWeights(n, constraints);
    const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);

    // Check if return is close to target
    if (Math.abs(metrics.return - targetReturn) < tolerance && metrics.variance < bestVariance) {
      bestVariance = metrics.variance;
      bestWeights = weights.slice();
    }
  }

  if (!bestWeights) {
    return { error: 'Could not find portfolio with target return. Try adjusting target.' };
  }

  const finalMetrics = calculatePortfolioMetrics(bestWeights, expectedReturns, covData.matrix, symbols);

  return {
    type: 'Target Return',
    targetReturn: targetReturn * 100,
    weights: createWeightsObject(symbols, bestWeights),
    expectedReturn: finalMetrics.return * 100,
    volatility: finalMetrics.volatility * 100,
    sharpeRatio: finalMetrics.sharpeRatio
  };
}

/**
 * Calculate efficient frontier
 */
function calculateEfficientFrontier(priceHistories, points, constraints) {
  points = points || 50;
  const covData = calculateCovarianceMatrix(priceHistories);
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Find return range
  const returns = symbols.map(function(s) { return expectedReturns[s]; });
  const minReturn = Math.min.apply(null, returns);
  const maxReturn = Math.max.apply(null, returns);

  // Generate frontier points
  const frontier = [];
  const step = (maxReturn - minReturn) / points;

  for (let targetReturn = minReturn; targetReturn <= maxReturn; targetReturn += step) {
    // Find minimum variance portfolio for this return
    const iterations = 5000;
    let bestWeights = null;
    let bestVariance = Infinity;
    const tolerance = 0.02;

    for (let i = 0; i < iterations; i++) {
      const weights = generateRandomWeights(n, constraints);
      const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);

      if (Math.abs(metrics.return - targetReturn) < tolerance && metrics.variance < bestVariance) {
        bestVariance = metrics.variance;
        bestWeights = weights.slice();
      }
    }

    if (bestWeights) {
      const metrics = calculatePortfolioMetrics(bestWeights, expectedReturns, covData.matrix, symbols);
      frontier.push({
        return: metrics.return * 100,
        volatility: metrics.volatility * 100,
        sharpeRatio: metrics.sharpeRatio,
        weights: createWeightsObject(symbols, bestWeights)
      });
    }
  }

  // Sort by volatility
  frontier.sort(function(a, b) { return a.volatility - b.volatility; });

  return {
    frontier: frontier,
    symbols: symbols,
    assetReturns: expectedReturns,
    numPoints: frontier.length
  };
}

/**
 * Risk Parity portfolio allocation
 * Each asset contributes equally to portfolio risk
 */
function calculateRiskParityPortfolio(priceHistories, constraints) {
  const covData = calculateCovarianceMatrix(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Initial equal weights
  let weights = [];
  for (let i = 0; i < n; i++) {
    weights.push(1 / n);
  }

  // Iteratively adjust weights for risk parity
  const iterations = 1000;
  const learningRate = 0.1;

  for (let iter = 0; iter < iterations; iter++) {
    // Calculate marginal risk contributions
    const portfolioVariance = calculatePortfolioVariance(weights, covData.matrix);
    const portfolioVol = Math.sqrt(portfolioVariance);
    const targetRiskContribution = portfolioVol / n;

    const riskContributions = [];
    for (let i = 0; i < n; i++) {
      let marginalRisk = 0;
      for (let j = 0; j < n; j++) {
        marginalRisk += weights[j] * covData.matrix[i][j];
      }
      marginalRisk = weights[i] * marginalRisk / portfolioVol;
      riskContributions.push(marginalRisk);
    }

    // Adjust weights
    for (let i = 0; i < n; i++) {
      const adjustment = (targetRiskContribution - riskContributions[i]) / targetRiskContribution;
      weights[i] *= (1 + learningRate * adjustment);
    }

    // Normalize
    const sum = weights.reduce(function(a, b) { return a + b; }, 0);
    weights = weights.map(function(w) { return w / sum; });

    // Apply constraints
    if (constraints) {
      const minW = constraints.minWeight || 0;
      const maxW = constraints.maxWeight || 1;
      weights = weights.map(function(w) { 
        return Math.max(minW, Math.min(maxW, w)); 
      });
      const newSum = weights.reduce(function(a, b) { return a + b; }, 0);
      weights = weights.map(function(w) { return w / newSum; });
    }
  }

  // Calculate final metrics
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);

  // Calculate risk contributions
  const portfolioVol = metrics.volatility;
  const riskContributions = {};
  for (let i = 0; i < n; i++) {
    let marginalRisk = 0;
    for (let j = 0; j < n; j++) {
      marginalRisk += weights[j] * covData.matrix[i][j];
    }
    riskContributions[symbols[i]] = (weights[i] * marginalRisk / (portfolioVol * portfolioVol)) * 100;
  }

  return {
    type: 'Risk Parity',
    weights: createWeightsObject(symbols, weights),
    expectedReturn: metrics.return * 100,
    volatility: metrics.volatility * 100,
    sharpeRatio: metrics.sharpeRatio,
    riskContributions: riskContributions
  };
}

/**
 * Calculate portfolio variance
 */
function calculatePortfolioVariance(weights, covMatrix) {
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      variance += weights[i] * weights[j] * covMatrix[i][j];
    }
  }
  return variance;
}

/**
 * Helper: Create weights object from arrays
 */
function createWeightsObject(symbols, weights) {
  const result = {};
  symbols.forEach(function(symbol, i) {
    result[symbol] = weights[i] * 100; // As percentage
  });
  return result;
}

/**
 * Compare current portfolio to optimized portfolios
 */
function comparePortfolioToOptimal(portfolio, priceHistories, riskFreeRate) {
  riskFreeRate = riskFreeRate || 0.02;

  // Get current weights
  const symbols = Object.keys(priceHistories);
  const currentWeights = [];
  let totalValue = 0;

  // Calculate total portfolio value
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      totalValue += value;
    });
  });

  // Calculate current weights
  symbols.forEach(function(symbol) {
    let symbolValue = 0;
    ['crypto', 'stocks', 'skins'].forEach(function(category) {
      (portfolio[category] || []).forEach(function(pos) {
        if ((pos.symbol || pos.name) === symbol) {
          symbolValue = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
        }
      });
    });
    currentWeights.push(totalValue > 0 ? symbolValue / totalValue : 0);
  });

  // Calculate current portfolio metrics
  const covData = calculateCovarianceMatrix(priceHistories);
  const expectedReturns = calculateExpectedReturns(priceHistories);
  const currentMetrics = calculatePortfolioMetrics(currentWeights, expectedReturns, covData.matrix, symbols);

  // Get optimal portfolios
  const minVar = findMinimumVariancePortfolio(priceHistories);
  const maxSharpe = findMaxSharpePortfolio(priceHistories, riskFreeRate);
  const riskParity = calculateRiskParityPortfolio(priceHistories);

  return {
    current: {
      weights: createWeightsObject(symbols, currentWeights),
      expectedReturn: currentMetrics.return * 100,
      volatility: currentMetrics.volatility * 100,
      sharpeRatio: (currentMetrics.return - riskFreeRate) / currentMetrics.volatility
    },
    minimumVariance: minVar,
    maximumSharpe: maxSharpe,
    riskParity: riskParity,
    recommendations: generateOptimizationRecommendations(
      currentMetrics, minVar, maxSharpe, currentWeights, symbols
    )
  };
}

/**
 * Generate optimization recommendations
 */
function generateOptimizationRecommendations(currentMetrics, minVar, maxSharpe, currentWeights, symbols) {
  const recommendations = [];

  // Compare Sharpe ratios
  if (maxSharpe.sharpeRatio > currentMetrics.sharpeRatio * 1.2) {
    recommendations.push({
      type: 'improvement',
      priority: 'high',
      message: 'Max Sharpe portfolio has ' + 
        ((maxSharpe.sharpeRatio / currentMetrics.sharpeRatio - 1) * 100).toFixed(0) + 
        '% better risk-adjusted returns'
    });
  }

  // Check if current portfolio is too risky
  if (currentMetrics.volatility > maxSharpe.volatility / 100 * 1.5) {
    recommendations.push({
      type: 'risk',
      priority: 'medium',
      message: 'Current portfolio has significantly higher risk than optimal. Consider rebalancing.'
    });
  }

  // Check for concentration
  const maxCurrentWeight = Math.max.apply(null, currentWeights);
  if (maxCurrentWeight > 0.5) {
    const concentratedAsset = symbols[currentWeights.indexOf(maxCurrentWeight)];
    recommendations.push({
      type: 'concentration',
      priority: 'medium',
      message: concentratedAsset + ' represents ' + (maxCurrentWeight * 100).toFixed(0) + 
        '% of portfolio. Consider diversifying.'
    });
  }

  // Suggest trades to move toward optimal
  const trades = [];
  symbols.forEach(function(symbol, i) {
    const currentWeight = currentWeights[i] * 100;
    const optimalWeight = maxSharpe.weights[symbol];
    const diff = optimalWeight - currentWeight;

    if (Math.abs(diff) > 5) {
      trades.push({
        symbol: symbol,
        action: diff > 0 ? 'BUY' : 'SELL',
        currentWeight: currentWeight.toFixed(1) + '%',
        optimalWeight: optimalWeight.toFixed(1) + '%',
        change: (diff > 0 ? '+' : '') + diff.toFixed(1) + '%'
      });
    }
  });

  if (trades.length > 0) {
    recommendations.push({
      type: 'rebalance',
      priority: 'info',
      message: 'Suggested trades to approach optimal portfolio',
      trades: trades
    });
  }

  return recommendations;
}

/**
 * Black-Litterman model implementation
 * Combines market equilibrium with investor views
 */
function blackLittermanOptimization(priceHistories, marketCaps, investorViews, config) {
  config = config || {};
  const tau = config.tau || 0.05; // Confidence in prior
  const riskAversion = config.riskAversion || 2.5;

  const covData = calculateCovarianceMatrix(priceHistories);
  const symbols = covData.symbols;
  const n = symbols.length;

  // Calculate market cap weights
  let totalMarketCap = 0;
  symbols.forEach(function(s) {
    totalMarketCap += marketCaps[s] || 0;
  });

  const marketWeights = symbols.map(function(s) {
    return totalMarketCap > 0 ? (marketCaps[s] || 0) / totalMarketCap : 1 / n;
  });

  // Calculate equilibrium returns (reverse optimization)
  const equilibriumReturns = [];
  for (let i = 0; i < n; i++) {
    let ret = 0;
    for (let j = 0; j < n; j++) {
      ret += riskAversion * covData.matrix[i][j] * marketWeights[j];
    }
    equilibriumReturns.push(ret);
  }

  // If no views, return equilibrium portfolio
  if (!investorViews || investorViews.length === 0) {
    const expectedReturns = {};
    symbols.forEach(function(s, i) {
      expectedReturns[s] = equilibriumReturns[i];
    });

    const metrics = calculatePortfolioMetrics(marketWeights, expectedReturns, covData.matrix, symbols);

    return {
      type: 'Black-Litterman (Equilibrium)',
      weights: createWeightsObject(symbols, marketWeights),
      expectedReturns: expectedReturns,
      expectedReturn: metrics.return * 100,
      volatility: metrics.volatility * 100,
      sharpeRatio: metrics.sharpeRatio
    };
  }

  // Process investor views
  // Views format: { symbol: 'BTC', expectedReturn: 0.30, confidence: 0.8 }
  const P = []; // Pick matrix
  const Q = []; // View returns
  const Omega = []; // View uncertainty

  investorViews.forEach(function(view) {
    const symbolIndex = symbols.indexOf(view.symbol);
    if (symbolIndex === -1) return;

    const pickRow = symbols.map(function(_, i) { return i === symbolIndex ? 1 : 0; });
    P.push(pickRow);
    Q.push(view.expectedReturn);
    
    // Uncertainty based on confidence (lower confidence = higher uncertainty)
    const uncertainty = tau * covData.matrix[symbolIndex][symbolIndex] * (1 / (view.confidence || 0.5));
    Omega.push(uncertainty);
  });

  // Simplified Black-Litterman formula
  // Blend equilibrium with views weighted by confidence
  const blendedReturns = equilibriumReturns.slice();
  investorViews.forEach(function(view) {
    const idx = symbols.indexOf(view.symbol);
    if (idx !== -1) {
      const confidence = view.confidence || 0.5;
      blendedReturns[idx] = (1 - confidence) * equilibriumReturns[idx] + 
                           confidence * view.expectedReturn;
    }
  });

  // Re-optimize with blended returns
  const expectedReturns = {};
  symbols.forEach(function(s, i) {
    expectedReturns[s] = blendedReturns[i];
  });

  // Find optimal weights using Monte Carlo
  let bestWeights = marketWeights.slice();
  let bestSharpe = -Infinity;

  for (let iter = 0; iter < 5000; iter++) {
    const weights = generateRandomWeights(n);
    const metrics = calculatePortfolioMetrics(weights, expectedReturns, covData.matrix, symbols);
    if (metrics.sharpeRatio > bestSharpe) {
      bestSharpe = metrics.sharpeRatio;
      bestWeights = weights.slice();
    }
  }

  const finalMetrics = calculatePortfolioMetrics(bestWeights, expectedReturns, covData.matrix, symbols);

  return {
    type: 'Black-Litterman (With Views)',
    weights: createWeightsObject(symbols, bestWeights),
    equilibriumWeights: createWeightsObject(symbols, marketWeights),
    expectedReturns: expectedReturns,
    equilibriumReturns: equilibriumReturns,
    views: investorViews,
    expectedReturn: finalMetrics.return * 100,
    volatility: finalMetrics.volatility * 100,
    sharpeRatio: finalMetrics.sharpeRatio
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.PortfolioOptimizer = {
    calculateExpectedReturns: calculateExpectedReturns,
    calculateCovarianceMatrix: calculateCovarianceMatrix,
    calculatePortfolioMetrics: calculatePortfolioMetrics,
    findMinimumVariancePortfolio: findMinimumVariancePortfolio,
    findMaxSharpePortfolio: findMaxSharpePortfolio,
    findTargetReturnPortfolio: findTargetReturnPortfolio,
    calculateEfficientFrontier: calculateEfficientFrontier,
    calculateRiskParityPortfolio: calculateRiskParityPortfolio,
    comparePortfolioToOptimal: comparePortfolioToOptimal,
    blackLittermanOptimization: blackLittermanOptimization
  };
  
  console.log('[OK] Portfolio Optimization Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateExpectedReturns,
    calculateCovarianceMatrix,
    calculatePortfolioMetrics,
    findMinimumVariancePortfolio,
    findMaxSharpePortfolio,
    findTargetReturnPortfolio,
    calculateEfficientFrontier,
    calculateRiskParityPortfolio,
    comparePortfolioToOptimal,
    blackLittermanOptimization
  };
}
