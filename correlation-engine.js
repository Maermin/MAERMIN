// ============================================================================
// MAERMIN v6.0 - Correlation Matrix & Analysis Engine
// Advanced correlation analysis with rolling windows and alerts
// ============================================================================

/**
 * Calculate Pearson correlation coefficient between two arrays
 */
function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
  const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Calculate returns from price history
 */
function calculateReturns(prices) {
  if (prices.length < 2) return [];
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

/**
 * Calculate full correlation matrix for all assets
 * @param {Object} priceHistories - Object mapping symbol to array of prices
 * @returns {Object} Correlation matrix with symbols and values
 */
function calculateCorrelationMatrix(priceHistories) {
  const symbols = Object.keys(priceHistories);
  const n = symbols.length;
  
  // Convert prices to returns
  const returns = {};
  symbols.forEach(symbol => {
    returns[symbol] = calculateReturns(priceHistories[symbol]);
  });

  // Find minimum length for alignment
  const minLength = Math.min(...Object.values(returns).map(r => r.length));
  
  // Align all return series to same length
  symbols.forEach(symbol => {
    if (returns[symbol].length > minLength) {
      returns[symbol] = returns[symbol].slice(-minLength);
    }
  });

  // Calculate correlation matrix
  const matrix = [];
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else if (j < i) {
        matrix[i][j] = matrix[j][i]; // Symmetric
      } else {
        matrix[i][j] = pearsonCorrelation(returns[symbols[i]], returns[symbols[j]]);
      }
    }
  }

  return {
    symbols,
    matrix,
    timestamp: new Date().toISOString()
  };
}

/**
 * Calculate diversification score based on correlations
 */
function calculateDiversificationScore(correlationMatrix) {
  const { symbols, matrix } = correlationMatrix;
  const n = symbols.length;
  
  if (n < 2) return { score: 100, interpretation: 'Need more assets' };

  // Average absolute correlation (excluding diagonal)
  let totalCorr = 0;
  let count = 0;
  
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      totalCorr += Math.abs(matrix[i][j]);
      count++;
    }
  }

  const avgCorrelation = count > 0 ? totalCorr / count : 0;
  
  // Score: lower average correlation = higher diversification
  // 0 avg correlation = 100 score, 1 avg correlation = 0 score
  const score = Math.max(0, Math.min(100, (1 - avgCorrelation) * 100));

  let interpretation;
  if (score >= 80) {
    interpretation = 'Excellent diversification';
  } else if (score >= 60) {
    interpretation = 'Good diversification';
  } else if (score >= 40) {
    interpretation = 'Moderate diversification';
  } else {
    interpretation = 'Poor diversification - assets are highly correlated';
  }

  return {
    score,
    avgCorrelation,
    interpretation,
    pairCount: count
  };
}

/**
 * Find most and least correlated pairs
 */
function findExtremePairs(correlationMatrix, topN = 5) {
  const { symbols, matrix } = correlationMatrix;
  const pairs = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      pairs.push({
        asset1: symbols[i],
        asset2: symbols[j],
        correlation: matrix[i][j]
      });
    }
  }

  const sorted = pairs.sort((a, b) => b.correlation - a.correlation);

  return {
    mostCorrelated: sorted.slice(0, topN),
    leastCorrelated: sorted.slice(-topN).reverse(),
    negativeCorrelations: pairs.filter(p => p.correlation < 0)
      .sort((a, b) => a.correlation - b.correlation)
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.CorrelationEngine = {
    calculateCorrelationMatrix,
    calculateDiversificationScore,
    findExtremePairs,
    pearsonCorrelation,
    calculateReturns
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateCorrelationMatrix,
    calculateDiversificationScore,
    findExtremePairs,
    pearsonCorrelation,
    calculateReturns
  };
}
