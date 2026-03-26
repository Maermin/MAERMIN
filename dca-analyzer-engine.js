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

/**
 * Backtest DCA strategy over multiple historical periods
 * @param {Array} priceHistory - Full price history
 * @param {Object} config - Backtest configuration
 * @returns {Object} Backtest results with statistics
 */
function backtestDCA(priceHistory, config = {}) {
  const {
    investmentAmount = 10000,
    dcaPeriods = 12,
    dcaFrequency = 'monthly',
    rollingWindows = 10    // Number of different start points to test
  } = config;

  const intervalMap = { 'weekly': 7, 'biweekly': 14, 'monthly': 30 };
  const interval = intervalMap[dcaFrequency] || 30;
  const requiredLength = dcaPeriods * interval;

  if (priceHistory.length < requiredLength) {
    return { error: 'Insufficient price history for backtest' };
  }

  const results = [];
  const windowStep = Math.floor((priceHistory.length - requiredLength) / rollingWindows);

  for (let i = 0; i < rollingWindows; i++) {
    const startIndex = i * windowStep;
    const endIndex = startIndex + requiredLength;
    const windowPrices = priceHistory.slice(startIndex, endIndex);

    const comparison = compareDCAvsLumpSum(investmentAmount, windowPrices, {
      dcaPeriods,
      dcaFrequency,
      startIndex: 0
    });

    if (!comparison.error) {
      results.push({
        windowStart: startIndex,
        windowEnd: endIndex,
        lumpSumReturn: comparison.lumpSum.return,
        dcaReturn: comparison.dca.return,
        winner: comparison.comparison.winner,
        difference: comparison.comparison.difference
      });
    }
  }

  // Calculate statistics
  const lumpSumWins = results.filter(r => r.winner === 'lumpsum').length;
  const dcaWins = results.filter(r => r.winner === 'dca').length;
  
  const avgLumpSumReturn = results.reduce((sum, r) => sum + r.lumpSumReturn, 0) / results.length;
  const avgDCAReturn = results.reduce((sum, r) => sum + r.dcaReturn, 0) / results.length;

  return {
    totalTests: results.length,
    lumpSumWins,
    dcaWins,
    lumpSumWinRate: (lumpSumWins / results.length) * 100,
    dcaWinRate: (dcaWins / results.length) * 100,
    avgLumpSumReturn,
    avgDCAReturn,
    avgDifference: avgLumpSumReturn - avgDCAReturn,
    results,
    recommendation: lumpSumWins > dcaWins 
      ? 'Historical data suggests lump sum tends to outperform for this asset'
      : 'Historical data suggests DCA may reduce risk for this volatile asset'
  };
}

/**
 * Calculate optimal DCA schedule based on volatility
 * @param {Array} priceHistory - Price history
 * @param {number} totalInvestment - Amount to invest
 * @returns {Object} Optimal schedule recommendation
 */
function calculateOptimalDCASchedule(priceHistory, totalInvestment) {
  if (!priceHistory || priceHistory.length < 60) {
    return { error: 'Need at least 60 data points for analysis' };
  }

  // Calculate volatility
  const returns = [];
  for (let i = 1; i < priceHistory.length; i++) {
    returns.push((priceHistory[i] - priceHistory[i-1]) / priceHistory[i-1]);
  }
  
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const annualizedVolatility = Math.sqrt(variance * 252) * 100;

  // Test different frequencies
  const frequencies = ['weekly', 'biweekly', 'monthly'];
  const periodOptions = [4, 6, 12, 24, 52];
  const testResults = [];

  frequencies.forEach(freq => {
    periodOptions.forEach(periods => {
      const backtest = backtestDCA(priceHistory, {
        investmentAmount: totalInvestment,
        dcaPeriods: periods,
        dcaFrequency: freq,
        rollingWindows: 5
      });

      if (!backtest.error) {
        testResults.push({
          frequency: freq,
          periods,
          dcaWinRate: backtest.dcaWinRate,
          avgDCAReturn: backtest.avgDCAReturn,
          volatilityAdjustedScore: backtest.avgDCAReturn / (100 - backtest.dcaWinRate + 1)
        });
      }
    });
  });

  // Sort by volatility-adjusted score
  testResults.sort((a, b) => b.volatilityAdjustedScore - a.volatilityAdjustedScore);
  const optimal = testResults[0];

  // Recommendations based on volatility
  let recommendation;
  if (annualizedVolatility > 50) {
    recommendation = {
      strategy: 'extended-dca',
      message: 'High volatility detected. Recommend spreading investments over longer period.',
      suggestedPeriods: 24,
      suggestedFrequency: 'weekly'
    };
  } else if (annualizedVolatility > 25) {
    recommendation = {
      strategy: 'standard-dca',
      message: 'Moderate volatility. Standard monthly DCA recommended.',
      suggestedPeriods: 12,
      suggestedFrequency: 'monthly'
    };
  } else {
    recommendation = {
      strategy: 'lump-sum-preferred',
      message: 'Low volatility. Lump sum may be more efficient, but DCA still valid.',
      suggestedPeriods: 6,
      suggestedFrequency: 'monthly'
    };
  }

  return {
    annualizedVolatility,
    optimal,
    allResults: testResults.slice(0, 10),
    recommendation,
    investmentPerPeriod: totalInvestment / (optimal?.periods || 12)
  };
}

/**
 * Project future DCA outcomes using Monte Carlo
 * @param {Object} config - Projection configuration
 * @returns {Object} Projected outcomes
 */
function projectDCAOutcomes(config) {
  const {
    monthlyContribution = 500,
    years = 10,
    expectedReturn = 0.08,
    volatility = 0.20,
    iterations = 1000
  } = config;

  const months = years * 12;
  const monthlyReturn = expectedReturn / 12;
  const monthlyVol = volatility / Math.sqrt(12);

  const finalValues = [];
  const paths = [];

  for (let i = 0; i < iterations; i++) {
    let value = 0;
    const path = [0];

    for (let m = 1; m <= months; m++) {
      // Add contribution
      value += monthlyContribution;
      
      // Apply random return (geometric Brownian motion)
      const randomReturn = monthlyReturn + monthlyVol * gaussianRandom();
      value *= (1 + randomReturn);
      
      if (i < 100) path.push(value); // Store first 100 paths
    }

    finalValues.push(value);
    if (i < 100) paths.push(path);
  }

  // Sort for percentile calculation
  finalValues.sort((a, b) => a - b);

  const totalContributions = monthlyContribution * months;
  const percentileIndex = (p) => Math.floor((p / 100) * finalValues.length);

  return {
    config: { monthlyContribution, years, expectedReturn, volatility },
    totalContributions,
    projections: {
      pessimistic: finalValues[percentileIndex(10)],
      conservative: finalValues[percentileIndex(25)],
      median: finalValues[percentileIndex(50)],
      optimistic: finalValues[percentileIndex(75)],
      best: finalValues[percentileIndex(90)]
    },
    statistics: {
      mean: finalValues.reduce((a, b) => a + b, 0) / finalValues.length,
      min: finalValues[0],
      max: finalValues[finalValues.length - 1],
      stdDev: calculateStdDev(finalValues)
    },
    expectedGain: {
      median: finalValues[percentileIndex(50)] - totalContributions,
      medianPercent: ((finalValues[percentileIndex(50)] - totalContributions) / totalContributions) * 100
    },
    samplePaths: paths
  };
}

/**
 * Generate Gaussian random number using Box-Muller transform
 */
function gaussianRandom() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Create DCA schedule/plan
 * @param {Object} config - Schedule configuration
 * @returns {Object} Detailed DCA schedule
 */
function createDCASchedule(config) {
  const {
    totalInvestment,
    startDate = new Date(),
    periods = 12,
    frequency = 'monthly',
    targetAssets = []
  } = config;

  const frequencyDays = {
    'weekly': 7,
    'biweekly': 14,
    'monthly': 30,
    'quarterly': 90
  };

  const dayInterval = frequencyDays[frequency] || 30;
  const amountPerPeriod = totalInvestment / periods;
  
  // Distribute among target assets if specified
  const assetAllocations = targetAssets.length > 0 
    ? targetAssets 
    : [{ symbol: 'UNSPECIFIED', allocation: 100 }];

  const schedule = [];
  let currentDate = new Date(startDate);

  for (let i = 0; i < periods; i++) {
    const periodInvestments = assetAllocations.map(asset => ({
      symbol: asset.symbol,
      amount: amountPerPeriod * (asset.allocation / 100),
      allocation: asset.allocation
    }));

    schedule.push({
      period: i + 1,
      date: new Date(currentDate),
      dateString: currentDate.toISOString().split('T')[0],
      totalAmount: amountPerPeriod,
      investments: periodInvestments,
      cumulativeInvested: amountPerPeriod * (i + 1),
      remainingToInvest: totalInvestment - (amountPerPeriod * (i + 1))
    });

    currentDate.setDate(currentDate.getDate() + dayInterval);
  }

  return {
    totalInvestment,
    periods,
    frequency,
    amountPerPeriod,
    startDate: startDate.toISOString().split('T')[0],
    endDate: schedule[schedule.length - 1].dateString,
    durationDays: (periods - 1) * dayInterval,
    schedule,
    assetAllocations
  };
}

/**
 * Track DCA execution progress
 * @param {Object} schedule - DCA schedule
 * @param {Array} executedPurchases - Completed purchases
 * @returns {Object} Progress tracking
 */
function trackDCAProgress(schedule, executedPurchases = []) {
  const totalPeriods = schedule.periods;
  const completedPeriods = executedPurchases.length;
  const progress = (completedPeriods / totalPeriods) * 100;

  // Calculate actual vs planned
  const plannedInvested = schedule.amountPerPeriod * completedPeriods;
  const actualInvested = executedPurchases.reduce((sum, p) => sum + p.amount, 0);
  
  // Calculate average cost if we have purchases
  let totalShares = 0;
  let weightedCost = 0;
  
  executedPurchases.forEach(purchase => {
    totalShares += purchase.shares || (purchase.amount / purchase.price);
    weightedCost += purchase.amount;
  });

  const averageCost = totalShares > 0 ? weightedCost / totalShares : 0;

  // Find next scheduled purchase
  const today = new Date();
  const nextPurchase = schedule.schedule.find(s => new Date(s.date) > today);

  return {
    progress,
    completedPeriods,
    totalPeriods,
    remainingPeriods: totalPeriods - completedPeriods,
    plannedInvested,
    actualInvested,
    variance: actualInvested - plannedInvested,
    totalShares,
    averageCost,
    nextPurchase,
    isComplete: completedPeriods >= totalPeriods,
    executedPurchases
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.DCAAnalyzerEngine = {
    compareDCAvsLumpSum,
    backtestDCA,
    calculateOptimalDCASchedule,
    projectDCAOutcomes,
    createDCASchedule,
    trackDCAProgress
  };
  console.log('[DCA] Dollar Cost Averaging Analyzer Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compareDCAvsLumpSum,
    backtestDCA,
    calculateOptimalDCASchedule,
    projectDCAOutcomes,
    createDCASchedule,
    trackDCAProgress
  };
}
