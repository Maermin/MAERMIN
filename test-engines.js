// ============================================================================
// MAERMIN v6.0 - Test Suite for All Investment Engines (Updated)
// ============================================================================

console.log('\n========================================');
console.log('MAERMIN v6.0 - Engine Test Suite');
console.log('========================================\n');

var testsPassed = 0;
var testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('[PASS] ' + name);
    testsPassed++;
  } catch (e) {
    console.log('[FAIL] ' + name);
    console.log('       Error: ' + e.message);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// Sample portfolio for testing
var samplePortfolio = {
  crypto: [
    { symbol: 'BTC', amount: 0.5, purchasePrice: 30000, currentPrice: 45000, purchaseDate: '2023-01-15' },
    { symbol: 'ETH', amount: 5, purchasePrice: 1800, currentPrice: 2500, purchaseDate: '2024-06-01' }
  ],
  stocks: [
    { symbol: 'AAPL', amount: 50, purchasePrice: 150, currentPrice: 180 },
    { symbol: 'MSFT', amount: 30, purchasePrice: 280, currentPrice: 420 },
    { symbol: 'SAP', amount: 20, purchasePrice: 120, currentPrice: 180 }
  ],
  skins: [
    { name: 'AWP Dragon Lore', amount: 1, purchasePrice: 5000, currentPrice: 7500 }
  ]
};

// ============================================================================
// Test 1: DCA Analyzer Engine
// ============================================================================
console.log('\n--- DCA Analyzer Engine ---');
var DCAAnalyzer = require('./dca-analyzer-engine.js');

test('DCA Engine loads', function() {
  assert(DCAAnalyzer.compareDCAvsLumpSum, 'compareDCAvsLumpSum exists');
  assert(DCAAnalyzer.createDCASchedule, 'createDCASchedule exists');
});

test('DCA vs Lump Sum comparison', function() {
  var priceHistory = [100, 95, 105, 110, 100, 108, 115, 120, 118, 125, 130, 128];
  var result = DCAAnalyzer.compareDCAvsLumpSum(1200, priceHistory, 'monthly');
  assert(result, 'Returns result');
  console.log('       Result: ' + JSON.stringify(result).substring(0, 80) + '...');
});

test('Create DCA schedule', function() {
  var schedule = DCAAnalyzer.createDCASchedule(10000, 'monthly', 12, '2024-01-01');
  assert(schedule, 'Returns schedule');
  console.log('       Schedule created with ' + (schedule.schedule ? schedule.schedule.length : schedule.length || 0) + ' periods');
});

// ============================================================================
// Test 2: Dividend Tracker Engine
// ============================================================================
console.log('\n--- Dividend Tracker Engine ---');
var DividendTracker = require('./dividend-tracker-engine.js');

test('Dividend Engine loads', function() {
  assert(DividendTracker.trackDividendIncome, 'trackDividendIncome exists');
  assert(DividendTracker.simulateDRIP, 'simulateDRIP exists');
});

test('Track dividend income', function() {
  var positions = [
    { symbol: 'AAPL', shares: 100, currentPrice: 180, annualDividend: 0.96, purchasePrice: 150 }
  ];
  var result = DividendTracker.trackDividendIncome(positions);
  assert(result, 'Returns result');
  console.log('       Result: ' + JSON.stringify(result).substring(0, 80) + '...');
});

test('DRIP simulation', function() {
  var result = DividendTracker.simulateDRIP(10000, 180, 0.02, 0.05, 10);
  assert(result, 'Returns result');
  console.log('       Result: ' + JSON.stringify(result).substring(0, 80) + '...');
});

// ============================================================================
// Test 3: Benchmark Comparison Engine
// ============================================================================
console.log('\n--- Benchmark Comparison Engine ---');
var BenchmarkEngine = require('./benchmark-engine.js');

test('Benchmark Engine loads', function() {
  assert(BenchmarkEngine.BENCHMARKS, 'BENCHMARKS exists');
  assert(BenchmarkEngine.comparePerformance, 'comparePerformance exists');
});

test('Compare to benchmark', function() {
  var portfolioReturns = [0.02, -0.01, 0.03, 0.015, -0.02, 0.025];
  var benchmarkReturns = [0.015, -0.005, 0.02, 0.01, -0.015, 0.02];
  var result = BenchmarkEngine.comparePerformance(portfolioReturns, benchmarkReturns);
  assert(result, 'Returns result');
  console.log('       Result: ' + JSON.stringify(result).substring(0, 100) + '...');
});

// ============================================================================
// Test 4: Goal-Based Investing Engine
// ============================================================================
console.log('\n--- Goal-Based Investing Engine ---');
var GoalEngine = require('./goal-investing-engine.js');

test('Goal Engine loads', function() {
  assert(GoalEngine.GOAL_TYPES, 'GOAL_TYPES exists');
  assert(GoalEngine.createGoal, 'createGoal exists');
});

test('Create investment goal', function() {
  var goal = GoalEngine.createGoal({
    name: 'House Down Payment',
    type: 'house',
    targetAmount: 50000,
    targetDate: '2028-01-01',
    currentSavings: 10000
  });
  assert(goal, 'Returns goal');
  console.log('       Goal created: ' + (goal.name || goal.id || 'OK'));
});

test('Calculate goal progress', function() {
  var goal = {
    targetAmount: 50000,
    currentSavings: 20000,
    targetDate: '2028-01-01'
  };
  var result = GoalEngine.calculateGoalProgress(goal);
  assert(result, 'Returns progress');
  console.log('       Progress: ' + JSON.stringify(result).substring(0, 80) + '...');
});

// ============================================================================
// Test 5: Portfolio Optimizer Engine
// ============================================================================
console.log('\n--- Portfolio Optimizer Engine ---');
var Optimizer = require('./portfolio-optimizer-engine.js');

test('Optimizer Engine loads', function() {
  assert(Optimizer.calculateExpectedReturns, 'calculateExpectedReturns exists');
});

test('Calculate expected returns', function() {
  var returns = {
    AAPL: [0.02, 0.01, -0.01, 0.03, 0.02],
    MSFT: [0.015, 0.02, -0.005, 0.025, 0.015]
  };
  var result = Optimizer.calculateExpectedReturns(returns, 'historical');
  assert(result, 'Returns result');
  console.log('       Expected returns: ' + JSON.stringify(result));
});

// ============================================================================
// Test 6: Factor Analysis Engine
// ============================================================================
console.log('\n--- Factor Analysis Engine ---');
var FactorEngine = require('./factor-analysis-engine.js');

test('Factor Engine loads', function() {
  assert(FactorEngine.FACTORS, 'FACTORS exists');
  assert(FactorEngine.getFactorExposure, 'getFactorExposure exists');
});

test('Get factor exposure', function() {
  var result = FactorEngine.getFactorExposure('AAPL');
  assert(result, 'Returns result');
  console.log('       AAPL factors: ' + JSON.stringify(result).substring(0, 80) + '...');
});

test('Calculate style box', function() {
  var result = FactorEngine.calculateStyleBox({ value: 0.2, size: 0.3 });
  assert(result, 'Returns style box');
  console.log('       Style box: ' + JSON.stringify(result));
});

// ============================================================================
// Test 7: Sector Allocation Engine
// ============================================================================
console.log('\n--- Sector Allocation Engine ---');
var SectorEngine = require('./sector-allocation-engine.js');

test('Sector Engine loads', function() {
  assert(SectorEngine.SECTORS, 'SECTORS exists');
  assert(SectorEngine.calculateSectorAllocation, 'calculateSectorAllocation exists');
});

test('Calculate sector allocation', function() {
  var result = SectorEngine.calculateSectorAllocation(samplePortfolio);
  assert(result, 'Returns result');
  console.log('       Sectors: ' + JSON.stringify(result).substring(0, 100) + '...');
});

test('Analyze cyclicality', function() {
  var allocation = SectorEngine.calculateSectorAllocation(samplePortfolio);
  var result = SectorEngine.analyzeCyclicality(allocation);
  assert(result, 'Returns cyclicality');
  console.log('       Cyclicality: ' + JSON.stringify(result).substring(0, 80) + '...');
});

// ============================================================================
// Test 8: Currency Exposure Engine
// ============================================================================
console.log('\n--- Currency Exposure Engine ---');
var CurrencyEngine = require('./currency-exposure-engine.js');

test('Currency Engine loads', function() {
  assert(CurrencyEngine.CURRENCIES, 'CURRENCIES exists');
  assert(CurrencyEngine.calculateCurrencyExposure, 'calculateCurrencyExposure exists');
});

test('Calculate currency exposure', function() {
  var result = CurrencyEngine.calculateCurrencyExposure(samplePortfolio, 'EUR');
  assert(result, 'Returns result');
  console.log('       Exposure: ' + JSON.stringify(result).substring(0, 100) + '...');
});

test('Generate hedging recommendations', function() {
  var result = CurrencyEngine.generateHedgingRecommendations(samplePortfolio, 'EUR', 'moderate');
  assert(result, 'Returns recommendations');
  console.log('       Hedging: ' + JSON.stringify(result).substring(0, 80) + '...');
});

// ============================================================================
// Test 9: Liquidity Analysis Engine
// ============================================================================
console.log('\n--- Liquidity Analysis Engine ---');
var LiquidityEngine = require('./liquidity-analysis-engine.js');

test('Liquidity Engine loads', function() {
  assert(LiquidityEngine.calculatePositionLiquidity, 'calculatePositionLiquidity exists');
  assert(LiquidityEngine.calculatePortfolioLiquidity, 'calculatePortfolioLiquidity exists');
});

test('Calculate position liquidity', function() {
  var position = { symbol: 'AAPL', amount: 100, currentPrice: 180, category: 'stocks' };
  var result = LiquidityEngine.calculatePositionLiquidity(position);
  assert(result.liquidityScore > 0, 'Has liquidity score');
  console.log('       AAPL liquidity: ' + result.liquidityScore.toFixed(0) + ' (' + result.liquidityRating + ')');
});

test('Calculate portfolio liquidity', function() {
  var result = LiquidityEngine.calculatePortfolioLiquidity(samplePortfolio);
  assert(result.portfolioLiquidityScore > 0, 'Has portfolio score');
  console.log('       Portfolio score: ' + result.portfolioLiquidityScore.toFixed(0));
});

// ============================================================================
// Test 10: Economic Indicator Engine
// ============================================================================
console.log('\n--- Economic Indicator Engine ---');
var EconomicEngine = require('./economic-indicator-engine.js');

test('Economic Engine loads', function() {
  assert(EconomicEngine.ECONOMIC_INDICATORS, 'ECONOMIC_INDICATORS exists');
  assert(EconomicEngine.calculateRecessionProbability, 'calculateRecessionProbability exists');
});

test('Calculate recession probability', function() {
  var data = {
    yieldCurveSpread: -25,
    unemploymentRate: 4.2,
    pmi: 48,
    consumerConfidence: 95
  };
  var result = EconomicEngine.calculateRecessionProbability(data);
  assert(result.probability !== undefined, 'Has probability');
  console.log('       Recession probability: ' + result.probability + '% (' + result.riskLevel + ')');
});

test('Identify economic regime', function() {
  var data = { gdpGrowth: 2.5, cpi: 2.1, unemploymentRate: 4.0, pmi: 54 };
  var result = EconomicEngine.identifyEconomicRegime(data);
  assert(result.regime, 'Has regime');
  console.log('       Regime: ' + result.regime);
});

// ============================================================================
// Test 11: Options & Derivatives Engine
// ============================================================================
console.log('\n--- Options & Derivatives Engine ---');
var OptionsEngine = require('./options-derivatives-engine.js');

test('Options Engine loads', function() {
  assert(OptionsEngine.blackScholes, 'blackScholes exists');
  assert(OptionsEngine.calculateGreeks, 'calculateGreeks exists');
});

test('Black-Scholes pricing', function() {
  var price = OptionsEngine.blackScholes('call', 100, 100, 0.25, 0.05, 0.20);
  assert(price > 0, 'Price is positive');
  console.log('       ATM Call: $' + price.toFixed(2));
});

test('Calculate Greeks', function() {
  var greeks = OptionsEngine.calculateGreeks('call', 100, 100, 0.25, 0.05, 0.20);
  assert(greeks.delta > 0 && greeks.delta < 1, 'Delta in range');
  console.log('       Delta: ' + greeks.delta.toFixed(3) + ', Gamma: ' + greeks.gamma.toFixed(4));
});

// ============================================================================
// Test 12: Performance Attribution Engine
// ============================================================================
console.log('\n--- Performance Attribution Engine ---');
var AttributionEngine = require('./attribution-engine.js');

test('Attribution Engine loads', function() {
  assert(AttributionEngine.calculateBrinsonAttribution, 'calculateBrinsonAttribution exists');
});

test('Brinson attribution', function() {
  var portfolioWeights = { Technology: 0.4, Healthcare: 0.3, Finance: 0.3 };
  var benchmarkWeights = { Technology: 0.3, Healthcare: 0.3, Finance: 0.4 };
  var portfolioReturns = { Technology: 0.15, Healthcare: 0.08, Finance: 0.05 };
  var benchmarkReturns = { Technology: 0.12, Healthcare: 0.07, Finance: 0.06 };
  
  var result = AttributionEngine.calculateBrinsonAttribution(
    portfolioWeights, benchmarkWeights, portfolioReturns, benchmarkReturns
  );
  assert(result.activeReturn !== undefined, 'Has active return');
  console.log('       Active return: ' + result.activeReturn.toFixed(2) + '%');
});

// ============================================================================
// Test 13: Tax Withdrawal Engine
// ============================================================================
console.log('\n--- Tax Withdrawal Engine ---');
var TaxEngine = require('./tax-withdrawal-engine.js');

test('Tax Engine loads', function() {
  assert(TaxEngine.GERMAN_TAX_RATES, 'GERMAN_TAX_RATES exists');
  assert(TaxEngine.calculateCapitalGainsTax, 'calculateCapitalGainsTax exists');
});

test('Calculate capital gains tax', function() {
  var result = TaxEngine.calculateCapitalGainsTax(5000, { isMarried: false });
  assert(result.tax >= 0, 'Tax calculated');
  console.log('       Tax on €5000 gain: €' + result.tax.toFixed(2));
});

test('Crypto tax strategy', function() {
  var result = TaxEngine.analyzeCryptoTaxStrategy(samplePortfolio.crypto);
  assert(result, 'Returns analysis');
  console.log('       Analysis: ' + JSON.stringify(result.summary || result).substring(0, 60) + '...');
});

// ============================================================================
// Test 14: Margin & Leverage Engine
// ============================================================================
console.log('\n--- Margin & Leverage Engine ---');
var MarginEngine = require('./margin-leverage-engine.js');

test('Margin Engine loads', function() {
  assert(MarginEngine.MARGIN_REQUIREMENTS, 'MARGIN_REQUIREMENTS exists');
  assert(MarginEngine.calculateMarginMetrics, 'calculateMarginMetrics exists');
});

test('Calculate margin metrics', function() {
  var account = {
    accountValue: 100000,
    cashBalance: 20000,
    marginDebt: 30000,
    marginRate: 0.08,
    positions: [
      { symbol: 'AAPL', amount: 100, currentPrice: 180, assetType: 'stocks' },
      { symbol: 'MSFT', amount: 50, currentPrice: 420, assetType: 'stocks' }
    ]
  };
  var result = MarginEngine.calculateMarginMetrics(account);
  assert(result.leverageRatio !== undefined, 'Has leverage ratio');
  console.log('       Leverage: ' + result.leverageRatio.toFixed(2) + 'x');
});

test('Simulate margin call', function() {
  var account = {
    accountValue: 100000,
    marginDebt: 40000,
    positions: [
      { symbol: 'AAPL', amount: 200, currentPrice: 180, assetType: 'stocks' }
    ]
  };
  var result = MarginEngine.simulateMarginCall(account, 20);
  assert(result.newPositionValue !== undefined, 'Has new value');
  console.log('       After 20% drop: $' + result.newPositionValue.toFixed(0));
});

// ============================================================================
// Test 15: Sentiment & News Engine
// ============================================================================
console.log('\n--- Sentiment & News Engine ---');
var SentimentEngine = require('./sentiment-news-engine.js');

test('Sentiment Engine loads', function() {
  assert(SentimentEngine.analyzeSentiment, 'analyzeSentiment exists');
  assert(SentimentEngine.calculateMarketMood, 'calculateMarketMood exists');
});

test('Analyze sentiment', function() {
  var bullish = SentimentEngine.analyzeSentiment('Stock surges to record high on strong earnings');
  var bearish = SentimentEngine.analyzeSentiment('Market crashes amid recession fears');
  
  assert(bullish.score > 0, 'Bullish detected');
  assert(bearish.score < 0, 'Bearish detected');
  console.log('       Bullish: ' + bullish.score.toFixed(2) + ' | Bearish: ' + bearish.score.toFixed(2));
});

test('Create and aggregate news', function() {
  var news1 = SentimentEngine.createNewsItem({
    title: 'Apple beats earnings expectations',
    source: 'bloomberg',
    symbols: ['AAPL']
  });
  var news2 = SentimentEngine.createNewsItem({
    title: 'Tech stocks rally on positive outlook',
    source: 'reuters',
    symbols: ['AAPL', 'MSFT']
  });
  
  var aggregate = SentimentEngine.aggregateSentiment([news1, news2], 'AAPL');
  assert(aggregate.aggregateSentiment !== undefined, 'Has aggregate');
  console.log('       AAPL sentiment: ' + aggregate.aggregateSentiment.toFixed(2) + ' (' + aggregate.label + ')');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n========================================');
console.log('TEST SUMMARY');
console.log('========================================');
console.log('Passed: ' + testsPassed);
console.log('Failed: ' + testsFailed);
console.log('Total:  ' + (testsPassed + testsFailed));
console.log('========================================\n');

if (testsFailed === 0) {
  console.log('✅ ALL TESTS PASSED!\n');
} else {
  console.log('❌ SOME TESTS FAILED - See details above\n');
}
