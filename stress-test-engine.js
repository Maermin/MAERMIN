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
    description: 'Global financial meltdown triggered by subprime mortgage crisis.',
    period: '2008-09 to 2009-03',
    impacts: {
      stocks: -0.55,
      crypto: 0,        // Bitcoin launched 2009
      skins: 0,         // CS:GO/CS2 skins did not exist (marketplace launched 2013)
      bonds: 0.05,
      gold: 0.25
    },
    recoveryMonths: 48,
    peakToTrough: -57,
    note: 'CS:GO skins marketplace launched in August 2013. Skins are not affected in this historical scenario.'
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
    description: 'Technology stock collapse after speculative bubble.',
    period: '2000-03 to 2002-10',
    impacts: {
      stocks: -0.49,
      crypto: 0,        // Did not exist
      skins: 0,         // CS:GO/CS2 skins did not exist (marketplace launched 2013)
      tech_stocks: -0.78,
      bonds: 0.12
    },
    recoveryMonths: 84,
    peakToTrough: -78,
    note: 'CS:GO skins marketplace launched in August 2013. Skins are not affected in this historical scenario.'
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

// Export functions
if (typeof window !== 'undefined') {
  window.StressTestEngine = {
    HISTORICAL_SCENARIOS,
    applyStressTest,
    runScenarioComparison
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HISTORICAL_SCENARIOS,
    applyStressTest,
    runScenarioComparison
  };
}
