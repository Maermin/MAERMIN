// ============================================================================
// MAERMIN v6.0 - Monte Carlo Simulation Engine
// Advanced portfolio projection with configurable parameters
// ============================================================================

/**
 * Run Monte Carlo simulation for portfolio projections
 * @param {Object} portfolio - Current portfolio with positions
 * @param {Object} config - Simulation configuration
 * @returns {Object} Simulation results with percentiles and distribution
 */
function runMonteCarloSimulation(portfolio, config) {
  const {
    iterations = 10000,
    years = 10,
    monthlyContribution = 0,
    expectedReturn = null,
    volatility = null,
    inflationRate = 0.02,
    withdrawalAmount = 0,
    withdrawalStartYear = 0
  } = config;

  // Calculate portfolio metrics if not provided
  const portfolioValue = calculateTotalValue(portfolio);
  const portfolioReturn = expectedReturn || estimateExpectedReturn(portfolio);
  const portfolioVolatility = volatility || estimateVolatility(portfolio);

  const results = [];
  const yearlySnapshots = {};

  // Initialize yearly snapshots
  for (let year = 1; year <= years; year++) {
    yearlySnapshots[year] = [];
  }

  // Run simulations
  for (let i = 0; i < iterations; i++) {
    let value = portfolioValue;
    const path = [value];

    for (let month = 1; month <= years * 12; month++) {
      const year = Math.ceil(month / 12);
      
      // Generate random monthly return using geometric Brownian motion
      const monthlyReturn = generateRandomReturn(
        portfolioReturn / 12,
        portfolioVolatility / Math.sqrt(12)
      );

      // Apply return
      value = value * (1 + monthlyReturn);

      // Add contribution
      value += monthlyContribution;

      // Handle withdrawals
      if (year >= withdrawalStartYear && withdrawalAmount > 0) {
        value -= withdrawalAmount / 12;
      }

      // Record yearly snapshot
      if (month % 12 === 0) {
        yearlySnapshots[year].push(value);
      }

      path.push(value);
    }

    results.push({
      finalValue: value,
      path: path
    });
  }

  // Calculate statistics
  const finalValues = results.map(r => r.finalValue).sort((a, b) => a - b);
  const percentiles = calculatePercentiles(finalValues, [1, 5, 10, 25, 50, 75, 90, 95, 99]);

  // Calculate yearly percentiles
  const yearlyPercentiles = {};
  Object.keys(yearlySnapshots).forEach(year => {
    const values = yearlySnapshots[year].sort((a, b) => a - b);
    yearlyPercentiles[year] = calculatePercentiles(values, [5, 25, 50, 75, 95]);
  });

  // Calculate probability metrics
  const statistics = {
    mean: finalValues.reduce((a, b) => a + b, 0) / finalValues.length,
    median: percentiles[50],
    min: finalValues[0],
    max: finalValues[finalValues.length - 1],
    standardDeviation: calculateStandardDeviation(finalValues)
  };

  // Calculate goal probabilities
  const goalProbabilities = calculateGoalProbabilities(finalValues, portfolioValue);

  return {
    iterations,
    years,
    initialValue: portfolioValue,
    monthlyContribution,
    expectedReturn: portfolioReturn,
    volatility: portfolioVolatility,
    percentiles,
    yearlyPercentiles,
    statistics,
    goalProbabilities,
    distribution: createDistributionBuckets(finalValues, 50),
    samplePaths: results.slice(0, 100).map(r => r.path) // First 100 paths for visualization
  };
}

/**
 * Generate random return using normal distribution
 */
function generateRandomReturn(mean, stdDev) {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z;
}

/**
 * Calculate percentiles from sorted array
 */
function calculatePercentiles(sortedArray, percentileList) {
  const result = {};
  percentileList.forEach(p => {
    const index = Math.floor((p / 100) * sortedArray.length);
    result[p] = sortedArray[Math.min(index, sortedArray.length - 1)];
  });
  return result;
}

/**
 * Calculate standard deviation
 */
function calculateStandardDeviation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Create distribution buckets for histogram
 */
function createDistributionBuckets(values, numBuckets) {
  const min = values[0];
  const max = values[values.length - 1];
  const bucketSize = (max - min) / numBuckets;

  const buckets = [];
  for (let i = 0; i < numBuckets; i++) {
    const low = min + i * bucketSize;
    const high = min + (i + 1) * bucketSize;
    const count = values.filter(v => v >= low && v < high).length;
    buckets.push({
      low,
      high,
      midpoint: (low + high) / 2,
      count,
      percentage: (count / values.length) * 100
    });
  }

  return buckets;
}

/**
 * Calculate probability of reaching various goals
 */
function calculateGoalProbabilities(finalValues, initialValue) {
  const goals = [
    { label: 'Double', multiplier: 2 },
    { label: 'Triple', multiplier: 3 },
    { label: '5x', multiplier: 5 },
    { label: '10x', multiplier: 10 }
  ];

  return goals.map(goal => {
    const target = initialValue * goal.multiplier;
    const count = finalValues.filter(v => v >= target).length;
    return {
      label: goal.label,
      target,
      probability: (count / finalValues.length) * 100
    };
  });
}

/**
 * Estimate expected return based on asset allocation
 */
function estimateExpectedReturn(portfolio) {
  // Historical average returns (annual)
  const assetReturns = {
    crypto: 0.25,    // Very volatile, high expected return
    stocks: 0.08,    // Long-term equity return
    skins: 0.05      // CS2 items, moderate appreciation
  };

  let totalValue = 0;
  let weightedReturn = 0;

  ['crypto', 'stocks', 'skins'].forEach(category => {
    const positions = portfolio[category] || [];
    const categoryValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    totalValue += categoryValue;
    weightedReturn += categoryValue * assetReturns[category];
  });

  return totalValue > 0 ? weightedReturn / totalValue : 0.08;
}

/**
 * Estimate portfolio volatility based on asset allocation
 */
function estimateVolatility(portfolio) {
  // Historical volatilities (annual standard deviation)
  const assetVolatility = {
    crypto: 0.80,    // Very high volatility
    stocks: 0.18,    // Moderate volatility
    skins: 0.25      // CS2 items, moderate-high volatility
  };

  let totalValue = 0;
  let weightedVariance = 0;

  ['crypto', 'stocks', 'skins'].forEach(category => {
    const positions = portfolio[category] || [];
    const categoryValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
    totalValue += categoryValue;
    weightedVariance += categoryValue * Math.pow(assetVolatility[category], 2);
  });

  // Simplified: assumes no correlation benefit
  return totalValue > 0 ? Math.sqrt(weightedVariance / totalValue) : 0.18;
}

/**
 * Calculate total portfolio value
 */
function calculateTotalValue(portfolio) {
  let total = 0;
  ['crypto', 'stocks', 'skins'].forEach(category => {
    const positions = portfolio[category] || [];
    total += positions.reduce((sum, p) => sum + (p.currentValue || p.amount * p.purchasePrice || 0), 0);
  });
  return total;
}

/**
 * Run retirement projection simulation
 */
function runRetirementSimulation(portfolio, config) {
  const {
    currentAge,
    retirementAge,
    lifeExpectancy = 90,
    monthlyContribution,
    desiredMonthlyIncome,
    socialSecurityAge = 67,
    socialSecurityAmount = 0
  } = config;

  const yearsToRetirement = retirementAge - currentAge;
  const yearsInRetirement = lifeExpectancy - retirementAge;

  // Phase 1: Accumulation
  const accumulationResults = runMonteCarloSimulation(portfolio, {
    iterations: 5000,
    years: yearsToRetirement,
    monthlyContribution
  });

  // Phase 2: Distribution (using median from accumulation)
  const retirementPortfolio = {
    crypto: [],
    stocks: [{ currentValue: accumulationResults.percentiles[50] }],
    skins: []
  };

  const withdrawalStart = socialSecurityAge > retirementAge 
    ? socialSecurityAge - retirementAge 
    : 0;

  const adjustedWithdrawal = desiredMonthlyIncome - 
    (socialSecurityAge <= retirementAge ? socialSecurityAmount : 0);

  const distributionResults = runMonteCarloSimulation(retirementPortfolio, {
    iterations: 5000,
    years: yearsInRetirement,
    monthlyContribution: 0,
    withdrawalAmount: adjustedWithdrawal * 12,
    withdrawalStartYear: 1
  });

  // Calculate success rate (not running out of money)
  const successRate = distributionResults.statistics.min > 0 
    ? 100 
    : (distributionResults.percentiles[10] > 0 ? 90 : 
       distributionResults.percentiles[25] > 0 ? 75 : 50);

  return {
    accumulation: accumulationResults,
    distribution: distributionResults,
    projectedRetirementValue: accumulationResults.percentiles[50],
    successRate,
    yearsToRetirement,
    yearsInRetirement
  };
}

/**
 * Sensitivity analysis - vary parameters and see impact
 */
function runSensitivityAnalysis(portfolio, baseConfig) {
  const baseResult = runMonteCarloSimulation(portfolio, { ...baseConfig, iterations: 1000 });
  const baseMedian = baseResult.percentiles[50];

  const analyses = [];

  // Vary expected return
  [-0.02, -0.01, 0.01, 0.02].forEach(delta => {
    const result = runMonteCarloSimulation(portfolio, {
      ...baseConfig,
      iterations: 1000,
      expectedReturn: (baseConfig.expectedReturn || 0.08) + delta
    });
    analyses.push({
      parameter: 'Expected Return',
      change: `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`,
      medianOutcome: result.percentiles[50],
      impactPercent: ((result.percentiles[50] - baseMedian) / baseMedian) * 100
    });
  });

  // Vary volatility
  [-0.05, -0.02, 0.02, 0.05].forEach(delta => {
    const result = runMonteCarloSimulation(portfolio, {
      ...baseConfig,
      iterations: 1000,
      volatility: Math.max(0.05, (baseConfig.volatility || 0.20) + delta)
    });
    analyses.push({
      parameter: 'Volatility',
      change: `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`,
      medianOutcome: result.percentiles[50],
      impactPercent: ((result.percentiles[50] - baseMedian) / baseMedian) * 100
    });
  });

  // Vary contribution
  const baseMonthlyCont = baseConfig.monthlyContribution || 0;
  if (baseMonthlyCont > 0) {
    [0.5, 0.75, 1.25, 1.5].forEach(multiplier => {
      const result = runMonteCarloSimulation(portfolio, {
        ...baseConfig,
        iterations: 1000,
        monthlyContribution: baseMonthlyCont * multiplier
      });
      analyses.push({
        parameter: 'Monthly Contribution',
        change: `${multiplier}x`,
        medianOutcome: result.percentiles[50],
        impactPercent: ((result.percentiles[50] - baseMedian) / baseMedian) * 100
      });
    });
  }

  return {
    baseMedian,
    analyses: analyses.sort((a, b) => Math.abs(b.impactPercent) - Math.abs(a.impactPercent))
  };
}

// Export functions for use in renderer
if (typeof window !== 'undefined') {
  window.MonteCarloEngine = {
    runSimulation: runMonteCarloSimulation,
    runRetirementSimulation,
    runSensitivityAnalysis,
    estimateExpectedReturn,
    estimateVolatility
  };
}

// For Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runMonteCarloSimulation,
    runRetirementSimulation,
    runSensitivityAnalysis,
    estimateExpectedReturn,
    estimateVolatility
  };
}
