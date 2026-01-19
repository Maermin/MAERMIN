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
 * Calculate rolling correlation between two assets
 * @param {Array} prices1 - Price history for asset 1
 * @param {Array} prices2 - Price history for asset 2
 * @param {number} windowSize - Rolling window size
 * @returns {Array} Array of { date, correlation } objects
 */
function calculateRollingCorrelation(prices1, prices2, windowSize = 30) {
  const returns1 = calculateReturns(prices1);
  const returns2 = calculateReturns(prices2);
  
  const minLength = Math.min(returns1.length, returns2.length);
  const alignedReturns1 = returns1.slice(-minLength);
  const alignedReturns2 = returns2.slice(-minLength);

  const rollingCorrelations = [];

  for (let i = windowSize; i <= minLength; i++) {
    const window1 = alignedReturns1.slice(i - windowSize, i);
    const window2 = alignedReturns2.slice(i - windowSize, i);
    
    rollingCorrelations.push({
      index: i,
      correlation: pearsonCorrelation(window1, window2)
    });
  }

  return rollingCorrelations;
}

/**
 * Analyze correlation changes and detect significant shifts
 */
function analyzeCorrelationChanges(historicalMatrices, threshold = 0.3) {
  if (historicalMatrices.length < 2) {
    return { alerts: [], changes: [] };
  }

  const latest = historicalMatrices[historicalMatrices.length - 1];
  const previous = historicalMatrices[historicalMatrices.length - 2];
  
  const changes = [];
  const alerts = [];

  for (let i = 0; i < latest.symbols.length; i++) {
    for (let j = i + 1; j < latest.symbols.length; j++) {
      const symbol1 = latest.symbols[i];
      const symbol2 = latest.symbols[j];
      
      // Find previous correlation
      const prevI = previous.symbols.indexOf(symbol1);
      const prevJ = previous.symbols.indexOf(symbol2);
      
      if (prevI >= 0 && prevJ >= 0) {
        const currentCorr = latest.matrix[i][j];
        const previousCorr = previous.matrix[prevI][prevJ];
        const change = currentCorr - previousCorr;
        
        changes.push({
          asset1: symbol1,
          asset2: symbol2,
          previousCorrelation: previousCorr,
          currentCorrelation: currentCorr,
          change: change,
          percentChange: previousCorr !== 0 ? (change / Math.abs(previousCorr)) * 100 : 0
        });

        // Generate alert for significant changes
        if (Math.abs(change) >= threshold) {
          alerts.push({
            type: change > 0 ? 'correlation_increase' : 'correlation_decrease',
            asset1: symbol1,
            asset2: symbol2,
            previousCorrelation: previousCorr,
            currentCorrelation: currentCorr,
            change: change,
            message: `${symbol1} and ${symbol2} correlation ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(2)}`
          });
        }

        // Alert for assets becoming highly correlated
        if (Math.abs(previousCorr) < 0.5 && Math.abs(currentCorr) >= 0.7) {
          alerts.push({
            type: 'high_correlation_alert',
            asset1: symbol1,
            asset2: symbol2,
            correlation: currentCorr,
            message: `Warning: ${symbol1} and ${symbol2} are now highly correlated (${currentCorr.toFixed(2)})`
          });
        }
      }
    }
  }

  return {
    alerts,
    changes: changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  };
}

/**
 * Calculate category/sector correlations
 */
function calculateCategoryCorrelations(portfolio, priceHistories) {
  const categories = {
    crypto: [],
    stocks: [],
    skins: []
  };

  // Group assets by category
  Object.keys(priceHistories).forEach(symbol => {
    const category = findAssetCategory(symbol, portfolio);
    if (category && categories[category]) {
      categories[category].push(symbol);
    }
  });

  // Calculate average price series for each category
  const categoryPrices = {};
  Object.entries(categories).forEach(([category, symbols]) => {
    if (symbols.length === 0) return;
    
    const maxLength = Math.max(...symbols.map(s => priceHistories[s].length));
    const avgPrices = [];
    
    for (let i = 0; i < maxLength; i++) {
      let sum = 0;
      let count = 0;
      symbols.forEach(symbol => {
        if (priceHistories[symbol][i] !== undefined) {
          sum += priceHistories[symbol][i];
          count++;
        }
      });
      if (count > 0) {
        avgPrices.push(sum / count);
      }
    }
    
    categoryPrices[category] = avgPrices;
  });

  // Calculate inter-category correlations
  const categoryNames = Object.keys(categoryPrices);
  const matrix = [];
  
  for (let i = 0; i < categoryNames.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < categoryNames.length; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else if (j < i) {
        matrix[i][j] = matrix[j][i];
      } else {
        const returns1 = calculateReturns(categoryPrices[categoryNames[i]]);
        const returns2 = calculateReturns(categoryPrices[categoryNames[j]]);
        const minLen = Math.min(returns1.length, returns2.length);
        matrix[i][j] = pearsonCorrelation(
          returns1.slice(-minLen),
          returns2.slice(-minLen)
        );
      }
    }
  }

  return {
    categories: categoryNames,
    matrix,
    assetCounts: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v.length])
    )
  };
}

/**
 * Find which category an asset belongs to
 */
function findAssetCategory(symbol, portfolio) {
  for (const category of ['crypto', 'stocks', 'skins']) {
    const positions = portfolio[category] || [];
    if (positions.some(p => (p.symbol || p.name) === symbol)) {
      return category;
    }
  }
  return null;
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

/**
 * Generate correlation-based recommendations
 */
function generateCorrelationRecommendations(correlationMatrix, portfolio) {
  const recommendations = [];
  const { score, avgCorrelation } = calculateDiversificationScore(correlationMatrix);
  const extremes = findExtremePairs(correlationMatrix);

  // High correlation warning
  extremes.mostCorrelated.forEach(pair => {
    if (pair.correlation > 0.8) {
      recommendations.push({
        type: 'warning',
        priority: 'high',
        message: `${pair.asset1} and ${pair.asset2} are highly correlated (${(pair.correlation * 100).toFixed(0)}%). Consider reducing one position.`,
        assets: [pair.asset1, pair.asset2]
      });
    }
  });

  // Diversification suggestions
  if (score < 50) {
    recommendations.push({
      type: 'suggestion',
      priority: 'medium',
      message: 'Portfolio diversification is low. Consider adding assets from different sectors or asset classes.',
      assets: []
    });
  }

  // Highlight negative correlations (hedges)
  extremes.negativeCorrelations.forEach(pair => {
    if (pair.correlation < -0.3) {
      recommendations.push({
        type: 'info',
        priority: 'low',
        message: `${pair.asset1} and ${pair.asset2} are negatively correlated (${(pair.correlation * 100).toFixed(0)}%), providing natural hedge.`,
        assets: [pair.asset1, pair.asset2]
      });
    }
  });

  return recommendations;
}

/**
 * Generate heatmap data for visualization
 */
function generateHeatmapData(correlationMatrix) {
  const { symbols, matrix } = correlationMatrix;
  const data = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < symbols.length; j++) {
      data.push({
        x: symbols[j],
        y: symbols[i],
        value: matrix[i][j],
        color: getCorrelationColor(matrix[i][j])
      });
    }
  }

  return {
    data,
    xLabels: symbols,
    yLabels: symbols
  };
}

/**
 * Get color for correlation value
 */
function getCorrelationColor(correlation) {
  // Red for positive, blue for negative, white for zero
  if (correlation >= 0) {
    const intensity = Math.floor(correlation * 255);
    return `rgb(${255}, ${255 - intensity}, ${255 - intensity})`;
  } else {
    const intensity = Math.floor(Math.abs(correlation) * 255);
    return `rgb(${255 - intensity}, ${255 - intensity}, ${255})`;
  }
}

// Export functions
if (typeof window !== 'undefined') {
  window.CorrelationEngine = {
    calculateCorrelationMatrix,
    calculateRollingCorrelation,
    analyzeCorrelationChanges,
    calculateCategoryCorrelations,
    calculateDiversificationScore,
    findExtremePairs,
    generateCorrelationRecommendations,
    generateHeatmapData,
    pearsonCorrelation,
    calculateReturns
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateCorrelationMatrix,
    calculateRollingCorrelation,
    analyzeCorrelationChanges,
    calculateCategoryCorrelations,
    calculateDiversificationScore,
    findExtremePairs,
    generateCorrelationRecommendations,
    generateHeatmapData,
    pearsonCorrelation,
    calculateReturns
  };
}
