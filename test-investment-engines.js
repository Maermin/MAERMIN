// ============================================================================
// MAERMIN v6.0 - Investment Analysis Engines Test Suite
// Tests all 15 new investment analysis engines
// ============================================================================

console.log('========================================');
console.log('MAERMIN v6.0 - Engine Test Suite');
console.log('========================================\n');

// Sample portfolio for testing
var samplePortfolio = {
  crypto: [
    { symbol: 'BTC', name: 'Bitcoin', amount: 0.5, purchasePrice: 30000, currentPrice: 45000, purchaseDate: '2023-06-15' },
    { symbol: 'ETH', name: 'Ethereum', amount: 5, purchasePrice: 1800, currentPrice: 2500, purchaseDate: '2023-08-01' },
    { symbol: 'SOL', name: 'Solana', amount: 50, purchasePrice: 25, currentPrice: 100, purchaseDate: '2024-01-15' }
  ],
  stocks: [
    { symbol: 'AAPL', name: 'Apple', amount: 20, purchasePrice: 150, currentPrice: 180 },
    { symbol: 'MSFT', name: 'Microsoft', amount: 15, purchasePrice: 300, currentPrice: 380 },
    { symbol: 'GOOGL', name: 'Google', amount: 10, purchasePrice: 120, currentPrice: 145 },
    { symbol: 'NVDA', name: 'NVIDIA', amount: 8, purchasePrice: 250, currentPrice: 480 },
    { symbol: 'TSLA', name: 'Tesla', amount: 12, purchasePrice: 200, currentPrice: 245 }
  ],
  skins: [
    { name: 'AWP Dragon Lore', amount: 1, purchasePrice: 5000, currentPrice: 7500 },
    { name: 'AK-47 Fire Serpent', amount: 2, purchasePrice: 800, currentPrice: 1200 }
  ]
};

// Sample price history for testing
var priceHistory = [];
for (var i = 365; i >= 0; i--) {
  var date = new Date();
  date.setDate(date.getDate() - i);
  priceHistory.push({
    date: date.toISOString().split('T')[0],
    price: 100 + Math.sin(i / 30) * 20 + (365 - i) * 0.1 + Math.random() * 5
  });
}

var testResults = [];
var passCount = 0;
var failCount = 0;

function runTest(name, testFn) {
  try {
    var result = testFn();
    if (result && result.success !== false) {
      console.log('[PASS] ' + name);
      passCount++;
      testResults.push({ name: name, status: 'PASS' });
    } else {
      console.log('[FAIL] ' + name + ': ' + (result.error || 'Unknown error'));
      failCount++;
      testResults.push({ name: name, status: 'FAIL', error: result.error });
    }
  } catch (e) {
    console.log('[FAIL] ' + name + ': ' + e.message);
    failCount++;
    testResults.push({ name: name, status: 'FAIL', error: e.message });
  }
}

// ============================================================================
// TEST 1: DCA Analyzer Engine
// ============================================================================
runTest('DCA Analyzer - analyzeDCAvsLumpSum', function() {
  var result = DCAAnalyzerEngine.analyzeDCAvsLumpSum(10000, priceHistory, 'monthly');
  return result && result.winner && typeof result.dcaReturn === 'number';
});

runTest('DCA Analyzer - simulateDCAPerformance', function() {
  var result = DCAAnalyzerEngine.simulateDCAPerformance(500, 12, priceHistory);
  return result && typeof result.totalInvested === 'number';
});

runTest('DCA Analyzer - findOptimalDCAFrequency', function() {
  var result = DCAAnalyzerEngine.findOptimalDCAFrequency(10000, priceHistory);
  return result && result.optimal;
});

// ============================================================================
// TEST 2: Dividend Tracker Engine
// ============================================================================
runTest('Dividend Tracker - trackDividendIncome', function() {
  var positions = [
    { symbol: 'AAPL', shares: 100, dividendPerShare: 0.96, frequency: 'quarterly' },
    { symbol: 'JNJ', shares: 50, dividendPerShare: 4.76, frequency: 'quarterly' }
  ];
  var result = DividendTrackerEngine.trackDividendIncome(positions);
  return result && typeof result.totalAnnualDividend === 'number';
});

runTest('Dividend Tracker - simulateDRIP', function() {
  var position = { symbol: 'AAPL', shares: 100, dividendPerShare: 0.96, stockPrice: 180 };
  var result = DividendTrackerEngine.simulateDRIP(position, 10);
  return result && result.projections && result.projections.length === 10;
});

// ============================================================================
// TEST 3: Benchmark Engine
// ============================================================================
runTest('Benchmark - comparePerformance', function() {
  var portfolioReturns = priceHistory.map(function(p) { return p.price; });
  var benchmarkReturns = priceHistory.map(function(p) { return p.price * 0.95; });
  var result = BenchmarkEngine.comparePerformance(portfolioReturns, benchmarkReturns);
  return result && typeof result.alpha === 'number' && typeof result.beta === 'number';
});

runTest('Benchmark - calculateBetaAlpha', function() {
  var portfolioReturns = [0.05, 0.03, -0.02, 0.04, 0.01];
  var benchmarkReturns = [0.04, 0.02, -0.01, 0.03, 0.02];
  var result = BenchmarkEngine.calculateBetaAlpha(portfolioReturns, benchmarkReturns);
  return result && typeof result.beta === 'number';
});

// ============================================================================
// TEST 4: Goal-Based Investing Engine
// ============================================================================
runTest('Goal Investing - createGoal', function() {
  var goal = GoalInvestingEngine.createGoal({
    name: 'House Down Payment',
    type: 'house',
    targetAmount: 50000,
    currentAmount: 15000,
    targetDate: '2027-01-01',
    monthlyContribution: 1000
  });
  return goal && goal.id && goal.targetAmount === 50000;
});

runTest('Goal Investing - calculateGoalProgress', function() {
  var goal = {
    targetAmount: 50000,
    currentAmount: 15000,
    targetDate: '2027-01-01',
    monthlyContribution: 1000
  };
  var result = GoalInvestingEngine.calculateGoalProgress(goal);
  return result && typeof result.progressPercent === 'number';
});

runTest('Goal Investing - simulateGoalProbability', function() {
  var goal = {
    targetAmount: 50000,
    currentAmount: 15000,
    targetDate: '2027-01-01',
    monthlyContribution: 1000
  };
  var result = GoalInvestingEngine.simulateGoalProbability(goal, { expectedReturn: 0.07, volatility: 0.15 });
  return result && typeof result.probabilityOfSuccess === 'number';
});

// ============================================================================
// TEST 5: Portfolio Optimizer Engine
// ============================================================================
runTest('Portfolio Optimizer - findMinimumVariancePortfolio', function() {
  var assets = ['AAPL', 'MSFT', 'GOOGL'];
  var returns = {
    AAPL: [0.02, 0.03, -0.01, 0.04],
    MSFT: [0.03, 0.02, 0.01, 0.03],
    GOOGL: [0.01, 0.04, -0.02, 0.05]
  };
  var result = PortfolioOptimizerEngine.findMinimumVariancePortfolio(assets, returns);
  return result && result.weights;
});

runTest('Portfolio Optimizer - calculateEfficientFrontier', function() {
  var assets = ['AAPL', 'MSFT'];
  var returns = { AAPL: [0.02, 0.03], MSFT: [0.03, 0.02] };
  var result = PortfolioOptimizerEngine.calculateEfficientFrontier(assets, returns, 10);
  return result && result.frontier && result.frontier.length > 0;
});

// ============================================================================
// TEST 6: Factor Analysis Engine
// ============================================================================
runTest('Factor Analysis - getFactorExposure', function() {
  var result = FactorAnalysisEngine.getFactorExposure('AAPL');
  return result && typeof result.value === 'number';
});

runTest('Factor Analysis - calculatePortfolioFactorExposures', function() {
  var result = FactorAnalysisEngine.calculatePortfolioFactorExposures(samplePortfolio);
  return result && result.factors;
});

runTest('Factor Analysis - calculateStyleBox', function() {
  var result = FactorAnalysisEngine.calculateStyleBox(samplePortfolio);
  return result && result.style && result.size;
});

// ============================================================================
// TEST 7: Sector Allocation Engine
// ============================================================================
runTest('Sector Allocation - calculateSectorAllocation', function() {
  var result = SectorAllocationEngine.calculateSectorAllocation(samplePortfolio);
  return result && result.sectors && result.totalValue > 0;
});

runTest('Sector Allocation - analyzeSectorConcentration', function() {
  var allocation = SectorAllocationEngine.calculateSectorAllocation(samplePortfolio);
  var result = SectorAllocationEngine.analyzeSectorConcentration(allocation);
  return result && typeof result.herfindahlIndex === 'number';
});

runTest('Sector Allocation - generateSectorRotationSignals', function() {
  var allocation = SectorAllocationEngine.calculateSectorAllocation(samplePortfolio);
  var result = SectorAllocationEngine.generateSectorRotationSignals(allocation, 'expansion');
  return result && result.signals;
});

// ============================================================================
// TEST 8: Currency Exposure Engine
// ============================================================================
runTest('Currency Exposure - calculateCurrencyExposure', function() {
  var result = CurrencyExposureEngine.calculateCurrencyExposure(samplePortfolio, 'EUR');
  return result && result.exposure && typeof result.foreignExposure === 'number';
});

runTest('Currency Exposure - generateHedgingRecommendations', function() {
  var exposure = CurrencyExposureEngine.calculateCurrencyExposure(samplePortfolio, 'EUR');
  var result = CurrencyExposureEngine.generateHedgingRecommendations(exposure, 'EUR', 'moderate');
  return result && result.recommendations;
});

runTest('Currency Exposure - simulateCurrencyScenarios', function() {
  var exposure = CurrencyExposureEngine.calculateCurrencyExposure(samplePortfolio, 'EUR');
  var result = CurrencyExposureEngine.simulateCurrencyScenarios(exposure, null, 'EUR');
  return result && result.scenarios && result.scenarios.length > 0;
});

// ============================================================================
// TEST 9: Liquidity Analysis Engine
// ============================================================================
runTest('Liquidity Analysis - calculatePositionLiquidity', function() {
  var position = { symbol: 'AAPL', amount: 100, currentPrice: 180, category: 'stocks' };
  var result = LiquidityAnalysisEngine.calculatePositionLiquidity(position, null);
  return result && typeof result.liquidityScore === 'number';
});

runTest('Liquidity Analysis - calculatePortfolioLiquidity', function() {
  var result = LiquidityAnalysisEngine.calculatePortfolioLiquidity(samplePortfolio, null);
  return result && typeof result.portfolioLiquidityScore === 'number';
});

runTest('Liquidity Analysis - analyzeLiquidityRisk', function() {
  var liquidity = LiquidityAnalysisEngine.calculatePortfolioLiquidity(samplePortfolio, null);
  var result = LiquidityAnalysisEngine.analyzeLiquidityRisk(liquidity, null);
  return result && result.scenarios && result.scenarios.length > 0;
});

// ============================================================================
// TEST 10: Economic Indicator Engine
// ============================================================================
runTest('Economic Indicator - createEconomicDashboard', function() {
  var currentData = { gdpGrowth: 2.5, cpi: 3.2, unemploymentRate: 3.8, pmi: 52 };
  var result = EconomicIndicatorEngine.createEconomicDashboard(currentData);
  return result && result.growth && result.inflation;
});

runTest('Economic Indicator - calculateRecessionProbability', function() {
  var currentData = { yieldCurveSpread: -20, pmi: 48, unemploymentRate: 4.5 };
  var result = EconomicIndicatorEngine.calculateRecessionProbability(currentData);
  return result && typeof result.probability === 'number';
});

runTest('Economic Indicator - identifyEconomicRegime', function() {
  var currentData = { gdpGrowth: 2.5, cpi: 2.0, pmi: 55 };
  var result = EconomicIndicatorEngine.identifyEconomicRegime(currentData);
  return result && result.regime;
});

// ============================================================================
// TEST 11: Options & Derivatives Engine
// ============================================================================
runTest('Options Engine - blackScholes', function() {
  var result = OptionsEngine.blackScholes('call', 100, 100, 0.25, 0.05, 0.20);
  return typeof result === 'number' && result > 0;
});

runTest('Options Engine - calculateGreeks', function() {
  var result = OptionsEngine.calculateGreeks('call', 100, 100, 0.25, 0.05, 0.20);
  return result && typeof result.delta === 'number' && typeof result.gamma === 'number';
});

runTest('Options Engine - createOptionPosition', function() {
  var result = OptionsEngine.createOptionPosition({
    symbol: 'AAPL_C_200',
    underlying: 'AAPL',
    type: 'call',
    strike: 200,
    expiration: '2025-03-21',
    quantity: 5,
    premium: 8.50,
    position: 'long'
  });
  return result && result.id && result.strike === 200;
});

runTest('Options Engine - analyzeOptionsPortfolio', function() {
  var options = [
    { symbol: 'AAPL_C', underlying: 'AAPL', type: 'call', strike: 200, yearsToExpiration: 0.25, 
      quantity: 5, premium: 8.5, position: 'long', multiplier: 100, totalPremium: 4250 }
  ];
  var result = OptionsEngine.analyzeOptionsPortfolio(options, { AAPL: 180 });
  return result && result.portfolioGreeks;
});

// ============================================================================
// TEST 12: Attribution Engine
// ============================================================================
runTest('Attribution - calculateBrinsonAttribution', function() {
  var portfolioWeights = { Technology: 0.4, Healthcare: 0.3, Finance: 0.3 };
  var benchmarkWeights = { Technology: 0.3, Healthcare: 0.35, Finance: 0.35 };
  var portfolioReturns = { Technology: 0.15, Healthcare: 0.08, Finance: 0.05 };
  var benchmarkReturns = { Technology: 0.12, Healthcare: 0.10, Finance: 0.06 };
  var result = AttributionEngine.calculateBrinsonAttribution(
    portfolioWeights, benchmarkWeights, portfolioReturns, benchmarkReturns
  );
  return result && typeof result.activeReturn === 'number';
});

runTest('Attribution - calculateHoldingsAttribution', function() {
  var holdings = { AAPL: 0.25, MSFT: 0.25, GOOGL: 0.5 };
  var returns = { AAPL: 0.10, MSFT: 0.08, GOOGL: 0.15 };
  var result = AttributionEngine.calculateHoldingsAttribution(holdings, null, returns, null);
  return result && result.holdings && result.holdings.length > 0;
});

runTest('Attribution - calculateRiskAdjustedAttribution', function() {
  var portfolioData = { return: 0.12, volatility: 0.15, beta: 1.1 };
  var benchmarkData = { return: 0.10, volatility: 0.12 };
  var result = AttributionEngine.calculateRiskAdjustedAttribution(portfolioData, benchmarkData, 0.02);
  return result && result.riskMetrics && typeof result.riskMetrics.portfolioSharpe === 'number';
});

// ============================================================================
// TEST 13: Tax Withdrawal Engine
// ============================================================================
runTest('Tax Withdrawal - calculateCapitalGainsTax', function() {
  var result = TaxWithdrawalEngine.calculateCapitalGainsTax(5000, { isMarried: false });
  return result && typeof result.tax === 'number';
});

runTest('Tax Withdrawal - calculateCryptoTax', function() {
  var result = TaxWithdrawalEngine.calculateCryptoTax(null, {
    purchaseDate: '2023-01-01',
    saleDate: '2024-06-01',
    gains: 10000
  });
  return result && typeof result.tax === 'number' && result.isLongTerm === true;
});

runTest('Tax Withdrawal - analyzeCryptoTaxStrategy', function() {
  var result = TaxWithdrawalEngine.analyzeCryptoTaxStrategy(samplePortfolio.crypto);
  return result && result.summary && result.taxFree;
});

runTest('Tax Withdrawal - findTaxLossHarvesting', function() {
  var positions = [
    { symbol: 'AAPL', currentPrice: 150, purchasePrice: 180, amount: 10, unrealizedGain: -300 }
  ];
  var result = TaxWithdrawalEngine.findTaxLossHarvesting(positions, {});
  return result && result.opportunities;
});

// ============================================================================
// TEST 14: Margin & Leverage Engine
// ============================================================================
runTest('Margin Leverage - createMarginAccount', function() {
  var result = MarginLeverageEngine.createMarginAccount({
    accountValue: 50000,
    cashBalance: 10000,
    marginDebt: 15000,
    positions: samplePortfolio.stocks
  });
  return result && result.id;
});

runTest('Margin Leverage - calculateMarginMetrics', function() {
  var account = {
    accountValue: 50000,
    marginDebt: 15000,
    marginRate: 0.08,
    positions: samplePortfolio.stocks.map(function(p) {
      return Object.assign({}, p, { assetType: 'stocks' });
    })
  };
  var result = MarginLeverageEngine.calculateMarginMetrics(account);
  return result && typeof result.leverageRatio === 'number';
});

runTest('Margin Leverage - simulateMarginCall', function() {
  var account = {
    accountValue: 50000,
    marginDebt: 25000,
    marginRate: 0.08,
    positions: [
      { symbol: 'AAPL', amount: 100, currentPrice: 500, assetType: 'stocks' }
    ]
  };
  var result = MarginLeverageEngine.simulateMarginCall(account, 30);
  return result && typeof result.marginCallTriggered === 'boolean';
});

runTest('Margin Leverage - calculateOptimalLeverage', function() {
  var portfolio = { volatility: 0.20, expectedReturn: 0.10 };
  var result = MarginLeverageEngine.calculateOptimalLeverage(portfolio, 'moderate', 0.25);
  return result && typeof result.recommended === 'number';
});

// ============================================================================
// TEST 15: Sentiment & News Engine
// ============================================================================
runTest('Sentiment News - analyzeTextSentiment', function() {
  var result = SentimentNewsEngine.analyzeTextSentiment(
    'Stock prices surge as market rallies to record high on strong earnings'
  );
  return result && typeof result.score === 'number' && result.score > 0;
});

runTest('Sentiment News - analyzeTextSentiment (negative)', function() {
  var result = SentimentNewsEngine.analyzeTextSentiment(
    'Markets crash amid recession fears and bearish outlook'
  );
  return result && typeof result.score === 'number' && result.score < 0;
});

runTest('Sentiment News - createNewsItem', function() {
  var result = SentimentNewsEngine.createNewsItem({
    title: 'Apple reports record earnings',
    summary: 'Strong iPhone sales drive growth',
    source: 'bloomberg',
    symbols: ['AAPL']
  });
  return result && result.id && result.sentiment;
});

runTest('Sentiment News - calculateFearGreedIndex', function() {
  var marketData = {
    priceVsMA: 0.3,
    volatility: -0.2,
    momentum: 0.4,
    volume: 0.1,
    socialSentiment: 0.3,
    putCallRatio: 0.2
  };
  var result = SentimentNewsEngine.calculateFearGreedIndex(marketData);
  return result && typeof result.index === 'number' && result.index >= 0 && result.index <= 100;
});

runTest('Sentiment News - aggregateSentiment', function() {
  var newsItems = [
    SentimentNewsEngine.createNewsItem({ title: 'BTC surge to new highs', symbols: ['BTC'] }),
    SentimentNewsEngine.createNewsItem({ title: 'Bitcoin rally continues', symbols: ['BTC'] })
  ];
  var result = SentimentNewsEngine.aggregateSentiment(newsItems, 'BTC');
  return result && typeof result.aggregateSentiment === 'number';
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n========================================');
console.log('TEST SUMMARY');
console.log('========================================');
console.log('Total Tests: ' + (passCount + failCount));
console.log('Passed: ' + passCount);
console.log('Failed: ' + failCount);
console.log('Success Rate: ' + ((passCount / (passCount + failCount)) * 100).toFixed(1) + '%');
console.log('========================================\n');

if (failCount > 0) {
  console.log('FAILED TESTS:');
  testResults.filter(function(t) { return t.status === 'FAIL'; }).forEach(function(t) {
    console.log('  - ' + t.name + ': ' + t.error);
  });
}

// Export results
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testResults: testResults, passCount: passCount, failCount: failCount };
}
