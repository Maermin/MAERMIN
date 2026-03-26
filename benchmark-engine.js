// ============================================================================
// MAERMIN v6.0 - Benchmark Comparison Engine
// Compare portfolio performance against market indices
// ============================================================================

/**
 * Standard benchmarks with default expected returns
 */
const BENCHMARKS = {
  'SP500': {
    name: 'S&P 500',
    symbol: '^GSPC',
    expectedReturn: 0.10,
    volatility: 0.15,
    description: 'US Large Cap Stocks'
  },
  'NASDAQ': {
    name: 'NASDAQ Composite',
    symbol: '^IXIC',
    expectedReturn: 0.12,
    volatility: 0.20,
    description: 'US Tech-Heavy Index'
  },
  'MSCI_WORLD': {
    name: 'MSCI World',
    symbol: 'URTH',
    expectedReturn: 0.08,
    volatility: 0.14,
    description: 'Global Developed Markets'
  },
  'MSCI_EM': {
    name: 'MSCI Emerging Markets',
    symbol: 'EEM',
    expectedReturn: 0.09,
    volatility: 0.22,
    description: 'Emerging Markets'
  },
  'DAX': {
    name: 'DAX 40',
    symbol: '^GDAXI',
    expectedReturn: 0.08,
    volatility: 0.18,
    description: 'German Blue Chips'
  },
  'BTC': {
    name: 'Bitcoin',
    symbol: 'BTC-USD',
    expectedReturn: 0.50,
    volatility: 0.80,
    description: 'Crypto Benchmark'
  },
  'AGG': {
    name: 'US Aggregate Bonds',
    symbol: 'AGG',
    expectedReturn: 0.04,
    volatility: 0.05,
    description: 'US Bond Index'
  },
  'GOLD': {
    name: 'Gold',
    symbol: 'GLD',
    expectedReturn: 0.05,
    volatility: 0.15,
    description: 'Gold ETF'
  }
};

/**
 * Calculate portfolio returns from value history
 */
function calculateReturnsFromValues(values) {
  const returns = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }
  return returns;
}

/**
 * Compare portfolio performance against a benchmark
 * @param {Array} portfolioValues - Portfolio value history
 * @param {Array} benchmarkValues - Benchmark value history
 * @param {string} benchmarkName - Name of benchmark
 * @param {number} riskFreeRate - Annual risk-free rate
 */
function comparePerformance(portfolioValues, benchmarkValues, benchmarkName, riskFreeRate) {
  riskFreeRate = riskFreeRate || 0.02;

  if (!portfolioValues || !benchmarkValues || portfolioValues.length < 2) {
    return { error: 'Insufficient data for comparison' };
  }

  // Align lengths
  const minLength = Math.min(portfolioValues.length, benchmarkValues.length);
  const pValues = portfolioValues.slice(-minLength);
  const bValues = benchmarkValues.slice(-minLength);

  // Calculate returns
  const portfolioReturns = calculateReturnsFromValues(pValues);
  const benchmarkReturns = calculateReturnsFromValues(bValues);

  // Total returns
  const portfolioTotalReturn = (pValues[pValues.length - 1] - pValues[0]) / pValues[0];
  const benchmarkTotalReturn = (bValues[bValues.length - 1] - bValues[0]) / bValues[0];

  // Annualize (assuming daily data)
  const tradingDays = portfolioReturns.length;
  const years = tradingDays / 252;
  
  const portfolioAnnualReturn = Math.pow(1 + portfolioTotalReturn, 1 / years) - 1;
  const benchmarkAnnualReturn = Math.pow(1 + benchmarkTotalReturn, 1 / years) - 1;

  // Calculate volatilities
  const portfolioVol = calculateVolatility(portfolioReturns);
  const benchmarkVol = calculateVolatility(benchmarkReturns);

  // Calculate Sharpe ratios
  const portfolioSharpe = (portfolioAnnualReturn - riskFreeRate) / portfolioVol;
  const benchmarkSharpe = (benchmarkAnnualReturn - riskFreeRate) / benchmarkVol;

  // Calculate Beta and Alpha
  const { beta, alpha } = calculateBetaAlpha(portfolioReturns, benchmarkReturns, riskFreeRate);

  // Calculate Tracking Error
  const trackingError = calculateTrackingError(portfolioReturns, benchmarkReturns);

  // Calculate Information Ratio
  const informationRatio = trackingError > 0 ? 
    (portfolioAnnualReturn - benchmarkAnnualReturn) / trackingError : 0;

  // Calculate max drawdowns
  const portfolioMaxDD = calculateMaxDrawdown(pValues);
  const benchmarkMaxDD = calculateMaxDrawdown(bValues);

  // Calculate correlation
  const correlation = calculateCorrelation(portfolioReturns, benchmarkReturns);

  // Relative performance
  const outperformance = portfolioTotalReturn - benchmarkTotalReturn;
  const outperformanceAnnual = portfolioAnnualReturn - benchmarkAnnualReturn;

  return {
    benchmark: benchmarkName,
    period: {
      days: tradingDays,
      years: years
    },
    portfolio: {
      totalReturn: portfolioTotalReturn * 100,
      annualReturn: portfolioAnnualReturn * 100,
      volatility: portfolioVol * 100,
      sharpeRatio: portfolioSharpe,
      maxDrawdown: portfolioMaxDD.maxDrawdownPercent
    },
    benchmarkStats: {
      totalReturn: benchmarkTotalReturn * 100,
      annualReturn: benchmarkAnnualReturn * 100,
      volatility: benchmarkVol * 100,
      sharpeRatio: benchmarkSharpe,
      maxDrawdown: benchmarkMaxDD.maxDrawdownPercent
    },
    comparison: {
      outperformance: outperformance * 100,
      outperformanceAnnual: outperformanceAnnual * 100,
      beta: beta,
      alpha: alpha * 100,
      trackingError: trackingError * 100,
      informationRatio: informationRatio,
      correlation: correlation
    },
    interpretation: generateComparisonInterpretation(
      outperformanceAnnual, alpha, portfolioSharpe, benchmarkSharpe, beta
    )
  };
}

/**
 * Calculate volatility from returns
 */
function calculateVolatility(returns) {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
  const variance = returns.reduce(function(sum, r) {
    return sum + Math.pow(r - mean, 2);
  }, 0) / returns.length;
  
  return Math.sqrt(variance * 252); // Annualized
}

/**
 * Calculate Beta and Alpha (CAPM)
 */
function calculateBetaAlpha(portfolioReturns, benchmarkReturns, riskFreeRate) {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return { beta: 1, alpha: 0 };

  const pReturns = portfolioReturns.slice(-n);
  const bReturns = benchmarkReturns.slice(-n);

  // Calculate means
  const pMean = pReturns.reduce(function(a, b) { return a + b; }, 0) / n;
  const bMean = bReturns.reduce(function(a, b) { return a + b; }, 0) / n;

  // Calculate covariance and variance
  let covariance = 0;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    covariance += (pReturns[i] - pMean) * (bReturns[i] - bMean);
    variance += Math.pow(bReturns[i] - bMean, 2);
  }

  covariance /= n;
  variance /= n;

  const beta = variance !== 0 ? covariance / variance : 1;

  // Alpha = Portfolio Return - (Risk Free + Beta * (Market Return - Risk Free))
  const dailyRf = riskFreeRate / 252;
  const expectedReturn = dailyRf + beta * (bMean - dailyRf);
  const alpha = (pMean - expectedReturn) * 252; // Annualized

  return { beta: beta, alpha: alpha };
}

/**
 * Calculate Tracking Error
 */
function calculateTrackingError(portfolioReturns, benchmarkReturns) {
  const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (n < 2) return 0;

  const differences = [];
  for (let i = 0; i < n; i++) {
    differences.push(portfolioReturns[i] - benchmarkReturns[i]);
  }

  const mean = differences.reduce(function(a, b) { return a + b; }, 0) / n;
  const variance = differences.reduce(function(sum, d) {
    return sum + Math.pow(d - mean, 2);
  }, 0) / n;

  return Math.sqrt(variance * 252); // Annualized
}

/**
 * Calculate correlation between two return series
 */
function calculateCorrelation(returns1, returns2) {
  const n = Math.min(returns1.length, returns2.length);
  if (n < 2) return 0;

  const r1 = returns1.slice(-n);
  const r2 = returns2.slice(-n);

  const mean1 = r1.reduce(function(a, b) { return a + b; }, 0) / n;
  const mean2 = r2.reduce(function(a, b) { return a + b; }, 0) / n;

  let covariance = 0;
  let var1 = 0;
  let var2 = 0;

  for (let i = 0; i < n; i++) {
    covariance += (r1[i] - mean1) * (r2[i] - mean2);
    var1 += Math.pow(r1[i] - mean1, 2);
    var2 += Math.pow(r2[i] - mean2, 2);
  }

  const denominator = Math.sqrt(var1 * var2);
  return denominator !== 0 ? covariance / denominator : 0;
}

/**
 * Calculate max drawdown from values
 */
function calculateMaxDrawdown(values) {
  let peak = values[0];
  let maxDD = 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
    }
    const drawdown = (peak - values[i]) / peak;
    if (drawdown > maxDD) {
      maxDD = drawdown;
    }
  }

  return {
    maxDrawdown: maxDD,
    maxDrawdownPercent: maxDD * 100
  };
}

/**
 * Generate interpretation of comparison results
 */
function generateComparisonInterpretation(outperformance, alpha, portfolioSharpe, benchmarkSharpe, beta) {
  const interpretations = [];

  // Performance
  if (outperformance > 0.05) {
    interpretations.push({
      type: 'positive',
      message: 'Portfolio significantly outperformed benchmark by ' + (outperformance * 100).toFixed(1) + '% annually'
    });
  } else if (outperformance > 0) {
    interpretations.push({
      type: 'neutral',
      message: 'Portfolio slightly outperformed benchmark'
    });
  } else if (outperformance > -0.05) {
    interpretations.push({
      type: 'neutral',
      message: 'Portfolio slightly underperformed benchmark'
    });
  } else {
    interpretations.push({
      type: 'negative',
      message: 'Portfolio significantly underperformed benchmark by ' + Math.abs(outperformance * 100).toFixed(1) + '% annually'
    });
  }

  // Alpha
  if (alpha > 0.02) {
    interpretations.push({
      type: 'positive',
      message: 'Positive alpha of ' + (alpha * 100).toFixed(2) + '% indicates skill-based outperformance'
    });
  } else if (alpha < -0.02) {
    interpretations.push({
      type: 'negative',
      message: 'Negative alpha suggests underperformance not explained by market risk'
    });
  }

  // Risk-adjusted (Sharpe)
  if (portfolioSharpe > benchmarkSharpe + 0.2) {
    interpretations.push({
      type: 'positive',
      message: 'Superior risk-adjusted returns (higher Sharpe ratio)'
    });
  } else if (portfolioSharpe < benchmarkSharpe - 0.2) {
    interpretations.push({
      type: 'negative',
      message: 'Inferior risk-adjusted returns compared to benchmark'
    });
  }

  // Beta interpretation
  if (beta > 1.2) {
    interpretations.push({
      type: 'info',
      message: 'High beta (' + beta.toFixed(2) + ') - portfolio is more volatile than market'
    });
  } else if (beta < 0.8) {
    interpretations.push({
      type: 'info',
      message: 'Low beta (' + beta.toFixed(2) + ') - portfolio is less volatile than market'
    });
  }

  return interpretations;
}

/**
 * Compare portfolio against multiple benchmarks
 */
function compareMultipleBenchmarks(portfolioValues, benchmarkDataMap, riskFreeRate) {
  const results = [];

  Object.keys(benchmarkDataMap).forEach(function(key) {
    const benchmark = BENCHMARKS[key] || { name: key };
    const benchmarkValues = benchmarkDataMap[key];

    if (benchmarkValues && benchmarkValues.length > 0) {
      const comparison = comparePerformance(
        portfolioValues,
        benchmarkValues,
        benchmark.name,
        riskFreeRate
      );

      if (!comparison.error) {
        results.push({
          benchmarkKey: key,
          benchmarkName: benchmark.name,
          ...comparison
        });
      }
    }
  });

  // Sort by outperformance
  results.sort(function(a, b) {
    return b.comparison.outperformanceAnnual - a.comparison.outperformanceAnnual;
  });

  // Find best and worst performing vs benchmarks
  const summary = {
    totalBenchmarks: results.length,
    outperforming: results.filter(function(r) { 
      return r.comparison.outperformanceAnnual > 0; 
    }).length,
    avgOutperformance: results.length > 0 ?
      results.reduce(function(sum, r) { 
        return sum + r.comparison.outperformanceAnnual; 
      }, 0) / results.length : 0,
    bestVs: results[0] ? results[0].benchmarkName : null,
    worstVs: results[results.length - 1] ? results[results.length - 1].benchmarkName : null
  };

  return {
    comparisons: results,
    summary: summary
  };
}

/**
 * Calculate rolling outperformance over time
 */
function calculateRollingOutperformance(portfolioValues, benchmarkValues, windowSize) {
  windowSize = windowSize || 90; // Default 90 days

  const minLength = Math.min(portfolioValues.length, benchmarkValues.length);
  const pValues = portfolioValues.slice(-minLength);
  const bValues = benchmarkValues.slice(-minLength);

  const rolling = [];

  for (let i = windowSize; i < minLength; i++) {
    const pStart = pValues[i - windowSize];
    const pEnd = pValues[i];
    const bStart = bValues[i - windowSize];
    const bEnd = bValues[i];

    if (pStart > 0 && bStart > 0) {
      const pReturn = (pEnd - pStart) / pStart;
      const bReturn = (bEnd - bStart) / bStart;

      rolling.push({
        index: i,
        portfolioReturn: pReturn * 100,
        benchmarkReturn: bReturn * 100,
        outperformance: (pReturn - bReturn) * 100,
        outperforming: pReturn > bReturn
      });
    }
  }

  // Calculate statistics
  const outperformingPeriods = rolling.filter(function(r) { return r.outperforming; }).length;
  const hitRate = rolling.length > 0 ? (outperformingPeriods / rolling.length) * 100 : 0;

  const avgOutperformance = rolling.length > 0 ?
    rolling.reduce(function(sum, r) { return sum + r.outperformance; }, 0) / rolling.length : 0;

  return {
    windowSize: windowSize,
    dataPoints: rolling.length,
    rolling: rolling,
    statistics: {
      hitRate: hitRate,
      avgOutperformance: avgOutperformance,
      maxOutperformance: rolling.length > 0 ? 
        Math.max.apply(null, rolling.map(function(r) { return r.outperformance; })) : 0,
      maxUnderperformance: rolling.length > 0 ?
        Math.min.apply(null, rolling.map(function(r) { return r.outperformance; })) : 0
    }
  };
}

/**
 * Generate benchmark comparison report
 */
function generateBenchmarkReport(portfolioValues, benchmarkDataMap, config) {
  const {
    riskFreeRate = 0.02,
    rollingWindows = [30, 90, 180, 365]
  } = config || {};

  const multiComparison = compareMultipleBenchmarks(portfolioValues, benchmarkDataMap, riskFreeRate);

  // Calculate rolling for primary benchmark (S&P 500 or first available)
  const primaryBenchmarkKey = benchmarkDataMap['SP500'] ? 'SP500' : Object.keys(benchmarkDataMap)[0];
  const primaryBenchmarkValues = benchmarkDataMap[primaryBenchmarkKey];

  const rollingAnalysis = {};
  if (primaryBenchmarkValues) {
    rollingWindows.forEach(function(window) {
      rollingAnalysis[window + 'd'] = calculateRollingOutperformance(
        portfolioValues, primaryBenchmarkValues, window
      );
    });
  }

  // Overall assessment
  const assessment = generateOverallAssessment(multiComparison, rollingAnalysis);

  return {
    generated: new Date().toISOString(),
    benchmarkComparisons: multiComparison,
    rollingAnalysis: rollingAnalysis,
    assessment: assessment
  };
}

/**
 * Generate overall assessment
 */
function generateOverallAssessment(multiComparison, rollingAnalysis) {
  const summary = multiComparison.summary;
  
  let rating;
  let message;

  if (summary.outperforming === summary.totalBenchmarks) {
    rating = 'excellent';
    message = 'Portfolio outperformed all benchmarks';
  } else if (summary.outperforming > summary.totalBenchmarks / 2) {
    rating = 'good';
    message = 'Portfolio outperformed most benchmarks';
  } else if (summary.outperforming > 0) {
    rating = 'fair';
    message = 'Portfolio outperformed some benchmarks';
  } else {
    rating = 'poor';
    message = 'Portfolio underperformed all benchmarks';
  }

  // Check rolling consistency
  const rolling90 = rollingAnalysis['90d'];
  let consistency = 'unknown';
  if (rolling90 && rolling90.statistics) {
    if (rolling90.statistics.hitRate > 60) {
      consistency = 'consistent';
    } else if (rolling90.statistics.hitRate > 40) {
      consistency = 'moderate';
    } else {
      consistency = 'inconsistent';
    }
  }

  return {
    rating: rating,
    message: message,
    outperformingCount: summary.outperforming + '/' + summary.totalBenchmarks,
    avgOutperformance: summary.avgOutperformance.toFixed(2) + '%',
    consistency: consistency,
    recommendations: generateBenchmarkRecommendations(multiComparison, rollingAnalysis)
  };
}

/**
 * Generate recommendations based on benchmark comparison
 */
function generateBenchmarkRecommendations(multiComparison, rollingAnalysis) {
  const recommendations = [];

  const summary = multiComparison.summary;

  if (summary.avgOutperformance < -5) {
    recommendations.push({
      type: 'warning',
      message: 'Significant underperformance vs benchmarks. Consider reviewing investment strategy.'
    });
  }

  // Check if taking too much risk for returns
  const sp500Comparison = multiComparison.comparisons.find(function(c) {
    return c.benchmarkKey === 'SP500';
  });

  if (sp500Comparison) {
    if (sp500Comparison.portfolio.volatility > sp500Comparison.benchmarkStats.volatility * 1.5 &&
        sp500Comparison.comparison.outperformanceAnnual < 0) {
      recommendations.push({
        type: 'warning',
        message: 'Portfolio has higher volatility but lower returns than S&P 500. Consider reducing risk.'
      });
    }

    if (sp500Comparison.comparison.alpha < -0.02) {
      recommendations.push({
        type: 'info',
        message: 'Negative alpha suggests active decisions are not adding value. Consider index investing.'
      });
    }
  }

  const rolling90 = rollingAnalysis['90d'];
  if (rolling90 && rolling90.statistics && rolling90.statistics.hitRate < 40) {
    recommendations.push({
      type: 'info',
      message: 'Portfolio underperforms in most 90-day periods. Review timing and selection.'
    });
  }

  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.BenchmarkEngine = {
    BENCHMARKS: BENCHMARKS,
    comparePerformance: comparePerformance,
    compareMultipleBenchmarks: compareMultipleBenchmarks,
    calculateRollingOutperformance: calculateRollingOutperformance,
    generateBenchmarkReport: generateBenchmarkReport,
    calculateBetaAlpha: calculateBetaAlpha,
    calculateTrackingError: calculateTrackingError,
    calculateCorrelation: calculateCorrelation
  };
  
  console.log('[OK] Benchmark Comparison Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BENCHMARKS,
    comparePerformance,
    compareMultipleBenchmarks,
    calculateRollingOutperformance,
    generateBenchmarkReport,
    calculateBetaAlpha,
    calculateTrackingError,
    calculateCorrelation
  };
}
