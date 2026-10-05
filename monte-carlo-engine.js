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
  // `!= null` (not ||): an explicit 0% return / volatility is a valid input.
  const portfolioReturn = expectedReturn != null ? expectedReturn : estimateExpectedReturn(portfolio);
  const portfolioVolatility = volatility != null ? volatility : estimateVolatility(portfolio);

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

  // FIRE / custom target (V7): when a targetValue is supplied (e.g. the FIRE
  // number), report the chance of reaching it and the first year the median
  // path crosses it. Reuses the values/snapshots already computed above.
  let fireTarget = null;
  if (config.targetValue && config.targetValue > 0) {
    const tv = config.targetValue;
    const reached = finalValues.filter(v => v >= tv).length;
    let reachedYear = null;
    Object.keys(yearlyPercentiles)
      .map(Number).sort((a, b) => a - b)
      .forEach(y => { if (reachedYear === null && yearlyPercentiles[y][50] >= tv) reachedYear = y; });
    fireTarget = {
      value: tv,
      probability: (reached / finalValues.length) * 100,
      reachedYear: reachedYear
    };
  }

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
    fireTarget,
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
// Long-run class assumptions (annual). Unknown / custom classes fall back to
// the equity assumptions. Deliberately round numbers — they are the default
// when the user doesn't enter their own expected return / volatility.
const CLASS_ASSUMPTIONS = {
  crypto:      { ret: 0.25, vol: 0.80 },
  stocks:      { ret: 0.08, vol: 0.18 },
  skins:       { ret: 0.05, vol: 0.25 },
  commodities: { ret: 0.04, vol: 0.15 }
};
// Assumed pairwise correlation between asset classes for the default volatility.
const CROSS_CLASS_CORRELATION = 0.3;

function assumptionFor(cls) { return CLASS_ASSUMPTIONS[cls] || CLASS_ASSUMPTIONS.stocks; }

// Market value of one position: an explicit currentValue wins; otherwise
// amount x currentPrice; cost basis only as the last resort.
function positionValue(p) {
  if (!p) return 0;
  if (p.currentValue > 0) return p.currentValue;
  const amount = parseFloat(p.amount) || 0;
  if (p.currentPrice > 0) return amount * p.currentPrice;
  return amount * (parseFloat(p.purchasePrice) || 0);
}

// EUR value per class over EVERY array-valued class in the portfolio (the four
// built-ins plus custom categories). Options are excluded (not in the value).
function classValues(portfolio) {
  const out = {};
  Object.keys(portfolio || {}).forEach(cls => {
    if (cls === 'options' || !Array.isArray(portfolio[cls])) return;
    const v = portfolio[cls].reduce((sum, p) => sum + positionValue(p), 0);
    if (v > 0) out[cls] = v;
  });
  return out;
}

/**
 * Estimate expected return based on asset allocation (value-weighted).
 */
function estimateExpectedReturn(portfolio) {
  const vals = classValues(portfolio);
  const total = Object.values(vals).reduce((a, b) => a + b, 0);
  if (!(total > 0)) return 0.08;
  return Object.keys(vals).reduce((s, c) => s + (vals[c] / total) * assumptionFor(c).ret, 0);
}

/**
 * Estimate portfolio volatility from class weights with a constant cross-class
 * correlation: sigma^2 = sum_i sum_j w_i w_j s_i s_j rho_ij (rho_ii = 1).
 */
function estimateVolatility(portfolio) {
  const vals = classValues(portfolio);
  const cls = Object.keys(vals);
  const total = cls.reduce((a, c) => a + vals[c], 0);
  if (!(total > 0)) return 0.18;
  let variance = 0;
  cls.forEach(a => cls.forEach(b => {
    const rho = a === b ? 1 : CROSS_CLASS_CORRELATION;
    variance += (vals[a] / total) * (vals[b] / total) * assumptionFor(a).vol * assumptionFor(b).vol * rho;
  }));
  return Math.sqrt(variance);
}

/**
 * Calculate total portfolio value
 */
function calculateTotalValue(portfolio) {
  const vals = classValues(portfolio);
  return Object.values(vals).reduce((a, b) => a + b, 0);
}

// Export functions for use in renderer
if (typeof window !== 'undefined') {
  window.MonteCarloEngine = {
    runSimulation: runMonteCarloSimulation,
    estimateExpectedReturn,
    estimateVolatility
  };
}

// For Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runMonteCarloSimulation,
    estimateExpectedReturn,
    estimateVolatility
  };
}
