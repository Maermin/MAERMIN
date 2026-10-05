// ============================================================================
// MAERMIN v6.0 - Dollar Cost Averaging (DCA) Analyzer Engine
// Compare lump sum vs DCA, optimize contribution schedules, backtest strategies
// ============================================================================

/**
 * Analyze DCA vs Lump Sum investment strategy
 * @param {number} totalInvestment - Total amount to invest
 * @param {Array} priceHistory - Historical prices array
 * @param {Object} config - Configuration options
 * @returns {Object} Comparison results
 */
function compareDCAvsLumpSum(totalInvestment, priceHistory, config = {}) {
  const {
    dcaPeriods = 12,           // Number of DCA purchases
    dcaFrequency = 'monthly',  // weekly, biweekly, monthly
    startIndex = 0             // Where to start in price history
  } = config;

  if (!priceHistory || priceHistory.length < dcaPeriods) {
    return { error: 'Insufficient price history for analysis' };
  }

  // Calculate frequency interval
  const intervalMap = {
    'daily': 1,
    'weekly': 7,
    'biweekly': 14,
    'monthly': 30
  };
  const interval = intervalMap[dcaFrequency] || 30;

  // Lump Sum: Buy everything at start
  const lumpSumPrice = priceHistory[startIndex];
  const lumpSumShares = totalInvestment / lumpSumPrice;
  const lumpSumFinalValue = lumpSumShares * priceHistory[priceHistory.length - 1];

  // DCA: Spread purchases over time
  const dcaAmount = totalInvestment / dcaPeriods;
  let dcaShares = 0;
  const dcaPurchases = [];
  let dcaTotalCost = 0;

  for (let i = 0; i < dcaPeriods; i++) {
    const priceIndex = Math.min(startIndex + (i * interval), priceHistory.length - 1);
    const price = priceHistory[priceIndex];
    const shares = dcaAmount / price;
    
    dcaShares += shares;
    dcaTotalCost += dcaAmount;
    
    dcaPurchases.push({
      period: i + 1,
      priceIndex,
      price,
      amount: dcaAmount,
      shares,
      cumulativeShares: dcaShares,
      cumulativeCost: dcaTotalCost,
      averageCost: dcaTotalCost / dcaShares
    });
  }

  const dcaFinalValue = dcaShares * priceHistory[priceHistory.length - 1];
  const dcaAverageCost = totalInvestment / dcaShares;

  // Calculate returns
  const lumpSumReturn = ((lumpSumFinalValue - totalInvestment) / totalInvestment) * 100;
  const dcaReturn = ((dcaFinalValue - totalInvestment) / totalInvestment) * 100;

  // Determine winner
  const winner = lumpSumReturn > dcaReturn ? 'lumpsum' : 'dca';
  const difference = Math.abs(lumpSumReturn - dcaReturn);

  return {
    totalInvestment,
    periods: dcaPeriods,
    frequency: dcaFrequency,
    
    lumpSum: {
      purchasePrice: lumpSumPrice,
      shares: lumpSumShares,
      finalValue: lumpSumFinalValue,
      return: lumpSumReturn,
      returnAmount: lumpSumFinalValue - totalInvestment
    },
    
    dca: {
      averageCost: dcaAverageCost,
      shares: dcaShares,
      finalValue: dcaFinalValue,
      return: dcaReturn,
      returnAmount: dcaFinalValue - totalInvestment,
      purchases: dcaPurchases,
      lowestPrice: Math.min(...dcaPurchases.map(p => p.price)),
      highestPrice: Math.max(...dcaPurchases.map(p => p.price))
    },
    
    comparison: {
      winner,
      difference,
      lumpSumAdvantage: lumpSumReturn - dcaReturn,
      dcaVolatilityReduction: calculateVolatilityReduction(dcaPurchases)
    }
  };
}

/**
 * Calculate volatility reduction from DCA
 */
function calculateVolatilityReduction(purchases) {
  if (purchases.length < 2) return 0;
  
  const prices = purchases.map(p => p.price);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  
  // Coefficient of variation as volatility measure
  return (stdDev / avgPrice) * 100;
}

// Export functions
if (typeof window !== 'undefined') {
  window.DCAAnalyzerEngine = {
    compareDCAvsLumpSum
  };
  console.log('[DCA] Dollar Cost Averaging Analyzer Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compareDCAvsLumpSum
  };
}
