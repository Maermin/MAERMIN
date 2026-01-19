// ============================================================================
// MAERMIN v6.0 - Stress Testing & Scenario Analysis Engine
// Historical and custom scenario modeling for portfolio resilience
// NOTE: These scenarios apply historical market conditions to your current portfolio
// CS:GO skins started trading in 2013, CS2 released in 2023
// Pre-2013 scenarios use estimated impacts based on gaming market correlation
// ============================================================================

/**
 * Pre-built historical stress scenarios
 * NOTE: skins values for pre-2013 are estimated based on gaming/entertainment market correlation
 */
const HISTORICAL_SCENARIOS = {
  '2008-financial-crisis': {
    name: '2008 Financial Crisis',
    description: 'Global financial meltdown triggered by subprime mortgage crisis. Skins impact is estimated (CS:GO launched 2012).',
    period: '2008-09 to 2009-03',
    impacts: {
      stocks: -0.55,
      crypto: 0,        // Bitcoin launched 2009
      skins: -0.30,     // Estimated: gaming items would have declined with consumer spending
      bonds: 0.05,
      gold: 0.25
    },
    recoveryMonths: 48,
    peakToTrough: -57,
    note: 'CS:GO skins did not exist in 2008. Impact is estimated for portfolio stress testing.'
  },
  
  '2020-covid-crash': {
    name: 'COVID-19 Crash',
    description: 'Rapid market decline due to global pandemic, followed by gaming boom',
    period: '2020-02 to 2020-03',
    impacts: {
      stocks: -0.34,
      crypto: -0.50,
      skins: -0.15,     // Gaming surged during lockdowns, items recovered quickly
      bonds: 0.03,
      gold: -0.03
    },
    recoveryMonths: 5,
    peakToTrough: -34
  },
  
  '2022-rate-hikes': {
    name: '2022 Rate Hike Bear Market',
    description: 'Federal Reserve aggressive rate increases to combat inflation',
    period: '2022-01 to 2022-10',
    impacts: {
      stocks: -0.25,
      crypto: -0.75,
      skins: -0.20,     // CS:GO/CS2 skins declined with broader market
      bonds: -0.15,
      gold: -0.05
    },
    recoveryMonths: 14,
    peakToTrough: -27
  },
  
  'dotcom-bubble': {
    name: 'Dot-Com Bubble Burst',
    description: 'Technology stock collapse after speculative bubble. Skins impact is estimated.',
    period: '2000-03 to 2002-10',
    impacts: {
      stocks: -0.49,
      crypto: 0,        // Did not exist
      skins: -0.20,     // Estimated: gaming was growing but would have been affected
      tech_stocks: -0.78,
      bonds: 0.12
    },
    recoveryMonths: 84,
    peakToTrough: -78,
    note: 'CS:GO skins did not exist in 2000. Impact is estimated for portfolio stress testing.'
  },
  
  'crypto-winter-2022': {
    name: '2022 Crypto Winter',
    description: 'Crypto market collapse including Luna/FTX failures',
    period: '2022-04 to 2022-12',
    impacts: {
      stocks: -0.15,
      crypto: -0.70,
      skins: -0.10,     // CS2 skins had minor correlation
      stablecoins: -0.05 // Some depegged
    },
    recoveryMonths: 18,
    peakToTrough: -72
  },
  
  'black-monday-1987': {
    name: 'Black Monday 1987',
    description: 'Largest one-day percentage decline in stock market history',
    period: '1987-10',
    impacts: {
      stocks: -0.22,
      crypto: 0,
      skins: 0,
      bonds: 0.08
    },
    recoveryMonths: 24,
    peakToTrough: -22
  },

  'moderate-recession': {
    name: 'Moderate Recession',
    description: 'Typical economic recession scenario',
    period: 'Hypothetical',
    impacts: {
      stocks: -0.30,
      crypto: -0.45,
      skins: -0.20,
      bonds: 0.05
    },
    recoveryMonths: 18,
    peakToTrough: -30
  },

  'severe-recession': {
    name: 'Severe Recession',
    description: 'Deep economic downturn scenario',
    period: 'Hypothetical',
    impacts: {
      stocks: -0.50,
      crypto: -0.70,
      skins: -0.35,
      bonds: 0.03
    },
    recoveryMonths: 36,
    peakToTrough: -50
  },

  'crypto-collapse': {
    name: 'Crypto Market Collapse',
    description: 'Major cryptocurrency market failure',
    period: 'Hypothetical',
    impacts: {
      stocks: -0.10,
      crypto: -0.85,
      skins: -0.05,
      bonds: 0.02
    },
    recoveryMonths: 24,
    peakToTrough: -85
  },

  'gaming-market-crash': {
    name: 'Gaming/Esports Market Crash',
    description: 'Collapse in gaming and esports markets',
    period: 'Hypothetical',
    impacts: {
      stocks: -0.05,
      crypto: -0.10,
      skins: -0.60,
      gaming_stocks: -0.40
    },
    recoveryMonths: 24,
    peakToTrough: -60
  }
};

/**
 * Apply stress test scenario to portfolio
 * @param {Object} portfolio - Current portfolio
 * @param {Object} scenario - Scenario to apply
 * @param {Object} prices - Current prices
 * @returns {Object} Stressed portfolio values
 */
function applyStressTest(portfolio, scenario, prices) {
  const results = {
    scenario: scenario.name,
    description: scenario.description,
    originalValue: 0,
    stressedValue: 0,
    totalLoss: 0,
    lossPercent: 0,
    positions: [],
    categoryBreakdown: {}
  };

  const categoryMapping = {
    crypto: 'crypto',
    stocks: 'stocks',
    skins: 'skins'
  };

  // Process each category
  ['crypto', 'stocks', 'skins'].forEach(category => {
    const positions = portfolio[category] || [];
    const scenarioKey = categoryMapping[category];
    const impact = scenario.impacts[scenarioKey] || 0;

    let categoryOriginal = 0;
    let categoryStressed = 0;

    positions.forEach(position => {
      const symbol = position.symbol || position.name;
      const amount = position.amount || 1;
      const currentPrice = prices[symbol.toLowerCase()] || position.purchasePrice || 0;
      const currentValue = amount * currentPrice;
      const stressedValue = currentValue * (1 + impact);

      categoryOriginal += currentValue;
      categoryStressed += stressedValue;

      results.positions.push({
        symbol,
        category,
        amount,
        currentPrice,
        currentValue,
        stressedValue,
        loss: currentValue - stressedValue,
        lossPercent: impact * -100
      });
    });

    results.categoryBreakdown[category] = {
      originalValue: categoryOriginal,
      stressedValue: categoryStressed,
      loss: categoryOriginal - categoryStressed,
      lossPercent: categoryOriginal > 0 ? ((categoryOriginal - categoryStressed) / categoryOriginal) * 100 : 0
    };

    results.originalValue += categoryOriginal;
    results.stressedValue += categoryStressed;
  });

  results.totalLoss = results.originalValue - results.stressedValue;
  results.lossPercent = results.originalValue > 0 
    ? (results.totalLoss / results.originalValue) * 100 
    : 0;

  // Add recovery estimate
  results.recoveryEstimate = {
    months: scenario.recoveryMonths,
    years: (scenario.recoveryMonths / 12).toFixed(1)
  };

  return results;
}

/**
 * Create custom stress scenario
 */
function createCustomScenario(config) {
  return {
    name: config.name || 'Custom Scenario',
    description: config.description || 'User-defined stress scenario',
    period: 'Custom',
    impacts: {
      stocks: config.stocksDrop || 0,
      crypto: config.cryptoDrop || 0,
      skins: config.skinsDrop || 0
    },
    recoveryMonths: config.recoveryMonths || 12,
    peakToTrough: Math.min(config.stocksDrop || 0, config.cryptoDrop || 0, config.skinsDrop || 0) * 100
  };
}

/**
 * Run multiple scenarios and compare results
 */
function runScenarioComparison(portfolio, prices, scenarioIds) {
  const results = [];

  scenarioIds.forEach(id => {
    const scenario = HISTORICAL_SCENARIOS[id];
    if (scenario) {
      results.push({
        id,
        ...applyStressTest(portfolio, scenario, prices)
      });
    }
  });

  // Sort by severity
  results.sort((a, b) => b.lossPercent - a.lossPercent);

  // Calculate aggregate statistics
  const stats = {
    worstCase: results[0],
    bestCase: results[results.length - 1],
    averageLoss: results.reduce((sum, r) => sum + r.totalLoss, 0) / results.length,
    averageLossPercent: results.reduce((sum, r) => sum + r.lossPercent, 0) / results.length
  };

  return { scenarios: results, stats };
}

/**
 * Calculate recovery trajectory after stress event
 */
function calculateRecoveryTrajectory(stressedValue, originalValue, recoveryMonths, recoveryPattern = 'linear') {
  const trajectory = [];
  const monthlyRecovery = (originalValue - stressedValue) / recoveryMonths;

  for (let month = 0; month <= recoveryMonths; month++) {
    let value;
    
    switch (recoveryPattern) {
      case 'exponential':
        // Faster initial recovery, slowing down
        const progress = month / recoveryMonths;
        value = stressedValue + (originalValue - stressedValue) * (1 - Math.pow(1 - progress, 2));
        break;
      
      case 'logarithmic':
        // Slower initial recovery, speeding up
        const logProgress = month / recoveryMonths;
        value = stressedValue + (originalValue - stressedValue) * Math.pow(logProgress, 2);
        break;
      
      case 'v-shape':
        // Sharp initial recovery then steady
        if (month <= recoveryMonths * 0.3) {
          value = stressedValue + (originalValue - stressedValue) * 0.7 * (month / (recoveryMonths * 0.3));
        } else {
          value = stressedValue + (originalValue - stressedValue) * (0.7 + 0.3 * ((month - recoveryMonths * 0.3) / (recoveryMonths * 0.7)));
        }
        break;
      
      default: // linear
        value = stressedValue + monthlyRecovery * month;
    }

    trajectory.push({
      month,
      value,
      recoveryPercent: ((value - stressedValue) / (originalValue - stressedValue)) * 100
    });
  }

  return trajectory;
}

/**
 * Analyze portfolio vulnerability to stress scenarios
 */
function analyzePortfolioVulnerability(portfolio, prices) {
  const vulnerabilities = [];
  const allScenarioIds = Object.keys(HISTORICAL_SCENARIOS);
  
  // Run all scenarios
  const comparison = runScenarioComparison(portfolio, prices, allScenarioIds);

  // Analyze category concentration
  let totalValue = 0;
  const categoryValues = {};
  
  ['crypto', 'stocks', 'skins'].forEach(category => {
    const positions = portfolio[category] || [];
    const value = positions.reduce((sum, p) => {
      const symbol = (p.symbol || p.name).toLowerCase();
      const price = prices[symbol] || p.purchasePrice || 0;
      return sum + (p.amount || 1) * price;
    }, 0);
    categoryValues[category] = value;
    totalValue += value;
  });

  // Check for concentration risks
  Object.entries(categoryValues).forEach(([category, value]) => {
    const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;
    if (percentage > 50) {
      vulnerabilities.push({
        type: 'concentration',
        severity: 'high',
        category,
        percentage,
        message: `High concentration in ${category} (${percentage.toFixed(0)}% of portfolio)`
      });
    } else if (percentage > 35) {
      vulnerabilities.push({
        type: 'concentration',
        severity: 'medium',
        category,
        percentage,
        message: `Moderate concentration in ${category} (${percentage.toFixed(0)}% of portfolio)`
      });
    }
  });

  // Find most impactful scenarios
  comparison.scenarios.forEach(result => {
    if (result.lossPercent > 40) {
      vulnerabilities.push({
        type: 'scenario_exposure',
        severity: 'high',
        scenario: result.scenario,
        potentialLoss: result.totalLoss,
        lossPercent: result.lossPercent,
        message: `High vulnerability to ${result.scenario}: potential ${result.lossPercent.toFixed(0)}% loss`
      });
    }
  });

  // Calculate overall risk score (0-100)
  const riskScore = calculateStressRiskScore(comparison.stats, vulnerabilities);

  return {
    vulnerabilities,
    riskScore,
    scenarioResults: comparison,
    categoryExposure: categoryValues,
    recommendations: generateStressRecommendations(vulnerabilities, categoryValues, totalValue)
  };
}

/**
 * Calculate overall stress risk score
 */
function calculateStressRiskScore(stats, vulnerabilities) {
  let score = 50; // Start at neutral

  // Adjust based on average potential loss
  score += stats.averageLossPercent * 0.5; // Higher loss = higher risk

  // Adjust based on worst case
  if (stats.worstCase.lossPercent > 60) {
    score += 20;
  } else if (stats.worstCase.lossPercent > 40) {
    score += 10;
  }

  // Adjust based on vulnerabilities
  vulnerabilities.forEach(v => {
    if (v.severity === 'high') score += 10;
    else if (v.severity === 'medium') score += 5;
  });

  return Math.min(100, Math.max(0, score));
}

/**
 * Generate recommendations based on stress analysis
 */
function generateStressRecommendations(vulnerabilities, categoryValues, totalValue) {
  const recommendations = [];

  // Address concentration risks
  const highConcentration = vulnerabilities.filter(v => v.type === 'concentration' && v.severity === 'high');
  highConcentration.forEach(v => {
    recommendations.push({
      priority: 'high',
      type: 'rebalance',
      message: `Consider reducing ${v.category} allocation from ${v.percentage.toFixed(0)}% to below 40%`,
      action: `Rebalance ${v.category}`
    });
  });

  // Suggest hedging for scenario exposures
  const highExposures = vulnerabilities.filter(v => v.type === 'scenario_exposure' && v.severity === 'high');
  if (highExposures.length > 0) {
    recommendations.push({
      priority: 'medium',
      type: 'hedge',
      message: 'Consider adding uncorrelated assets or hedges to reduce scenario exposure',
      action: 'Add hedging positions'
    });
  }

  // Cash buffer recommendation
  if (totalValue > 0) {
    const worstLoss = vulnerabilities
      .filter(v => v.type === 'scenario_exposure')
      .reduce((max, v) => Math.max(max, v.potentialLoss || 0), 0);
    
    if (worstLoss > 0) {
      recommendations.push({
        priority: 'low',
        type: 'liquidity',
        message: `Consider maintaining ${(worstLoss * 0.3).toFixed(0)} EUR in cash reserves for opportunities during market stress`,
        action: 'Build cash reserves'
      });
    }
  }

  return recommendations;
}

/**
 * Run tail risk analysis
 */
function analyzeTailRisk(portfolio, prices, confidenceLevel = 0.99) {
  // Use historical scenarios to estimate tail risk
  const allScenarioIds = Object.keys(HISTORICAL_SCENARIOS);
  const comparison = runScenarioComparison(portfolio, prices, allScenarioIds);
  
  const losses = comparison.scenarios.map(s => s.totalLoss);
  losses.sort((a, b) => b - a);

  const tailIndex = Math.floor(losses.length * (1 - confidenceLevel));
  const tailRisk = losses[tailIndex] || losses[0];

  // Expected shortfall (average of worst losses)
  const worstLosses = losses.slice(0, Math.max(1, Math.ceil(losses.length * (1 - confidenceLevel))));
  const expectedShortfall = worstLosses.reduce((a, b) => a + b, 0) / worstLosses.length;

  return {
    confidenceLevel,
    tailRisk,
    expectedShortfall,
    worstCase: losses[0],
    interpretation: `With ${(confidenceLevel * 100).toFixed(0)}% confidence, maximum loss in stress scenarios is ${tailRisk.toFixed(0)} EUR`
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.StressTestEngine = {
    HISTORICAL_SCENARIOS,
    applyStressTest,
    createCustomScenario,
    runScenarioComparison,
    calculateRecoveryTrajectory,
    analyzePortfolioVulnerability,
    analyzeTailRisk,
    generateStressRecommendations
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HISTORICAL_SCENARIOS,
    applyStressTest,
    createCustomScenario,
    runScenarioComparison,
    calculateRecoveryTrajectory,
    analyzePortfolioVulnerability,
    analyzeTailRisk,
    generateStressRecommendations
  };
}
