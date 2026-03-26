# MAERMIN v6.0 - Investment Analysis Engines Summary

## Overview
15 new professional-grade investment analysis engines have been added to MAERMIN v6.0.

## Engine List

### 1. DCA Analyzer Engine (`dca-analyzer-engine.js`)
**Purpose:** Dollar-Cost Averaging strategy analysis and comparison
- `analyzeDCAvsLumpSum()` - Compare DCA vs lump sum investing
- `simulateDCAPerformance()` - Backtest DCA strategy
- `findOptimalDCAFrequency()` - Find best DCA interval
- `createDCASchedule()` - Generate contribution schedule
- `analyzeValueAveraging()` - Alternative VA strategy

### 2. Dividend Tracker Engine (`dividend-tracker-engine.js`)
**Purpose:** Dividend income tracking and DRIP simulation
- `trackDividendIncome()` - Calculate dividend yields and income
- `createDividendCalendar()` - Ex-date payment calendar
- `simulateDRIP()` - Dividend reinvestment projection
- `compareDRIPvsCash()` - Compare strategies
- `analyzeDividendGrowth()` - Dividend aristocrat detection
- `rankDividendPositions()` - Quality scoring

### 3. Benchmark Comparison Engine (`benchmark-engine.js`)
**Purpose:** Portfolio vs benchmark performance analysis
- `comparePerformance()` - Full comparison metrics
- `compareMultipleBenchmarks()` - Multi-benchmark analysis
- `calculateBetaAlpha()` - CAPM calculations
- `calculateTrackingError()` - Active risk metrics
- `calculateRollingOutperformance()` - Rolling windows
- **8 built-in benchmarks:** S&P 500, NASDAQ, MSCI World, etc.

### 4. Goal-Based Investing Engine (`goal-investing-engine.js`)
**Purpose:** Financial goal planning and tracking
- `createGoal()` - Define financial goals
- `calculateGoalProgress()` - Progress tracking
- `simulateGoalProbability()` - Monte Carlo success rate
- `optimizeGoalContributions()` - Multi-goal budgeting
- `projectGoalTimeline()` - Completion estimates
- **9 goal types:** Retirement, house, education, emergency, etc.

### 5. Portfolio Optimizer Engine (`portfolio-optimizer-engine.js`)
**Purpose:** Modern portfolio theory optimization
- `findMinimumVariancePortfolio()` - Lowest risk allocation
- `findMaxSharpePortfolio()` - Optimal risk-adjusted
- `calculateEfficientFrontier()` - Full frontier curve
- `calculateRiskParityPortfolio()` - Equal risk contribution
- `blackLittermanOptimization()` - With investor views
- `comparePortfolioToOptimal()` - Gap analysis

### 6. Factor Analysis Engine (`factor-analysis-engine.js`)
**Purpose:** Factor exposure and style analysis
- `getFactorExposure()` - Single asset factors
- `calculatePortfolioFactorExposures()` - Portfolio factors
- `calculateStyleBox()` - Morningstar-style 3x3 box
- `estimateFactorReturns()` - Factor attribution
- `generateFactorRebalancingSuggestions()` - Target exposures
- **6 factors:** Value, Momentum, Quality, Size, Low Vol, Growth

### 7. Sector Allocation Engine (`sector-allocation-engine.js`)
**Purpose:** Sector exposure and rotation analysis
- `calculateSectorAllocation()` - Current weights
- `analyzeSectorConcentration()` - Herfindahl index
- `compareToBenchmark()` - Active share
- `analyzeCyclicality()` - Economic sensitivity
- `generateSectorRotationSignals()` - Regime recommendations
- **13 sectors:** 11 GICS + Crypto + Gaming

### 8. Currency Exposure Engine (`currency-exposure-engine.js`)
**Purpose:** FX risk management
- `calculateCurrencyExposure()` - Currency weights
- `calculateCurrencyImpact()` - FX attribution
- `analyzeCurrencyConcentration()` - Concentration risk
- `generateHedgingRecommendations()` - Hedge ratios
- `simulateCurrencyScenarios()` - FX stress tests
- **14 currencies** with hedging instrument recommendations

### 9. Liquidity Analysis Engine (`liquidity-analysis-engine.js`)
**Purpose:** Position liquidity assessment
- `calculatePositionLiquidity()` - Liquidity scoring
- `calculatePortfolioLiquidity()` - Portfolio metrics
- `analyzeLiquidityRisk()` - Stress scenarios
- `trackSpreadHistory()` - Bid-ask monitoring
- `calculateVWAP()` - Volume weighted price
- `estimateMarketImpact()` - Square root model

### 10. Economic Indicator Engine (`economic-indicator-engine.js`)
**Purpose:** Macro dashboard and regime identification
- `createEconomicDashboard()` - Full indicator view
- `calculateRecessionProbability()` - Risk scoring
- `analyzeEconomicImpact()` - Portfolio sensitivity
- `identifyEconomicRegime()` - Goldilocks/stagflation/etc.
- **25+ indicators** across growth, inflation, employment, rates

### 11. Options & Derivatives Engine (`options-derivatives-engine.js`)
**Purpose:** Options portfolio tracking and analysis
- `blackScholes()` - Option pricing
- `calculateGreeks()` - Delta, gamma, theta, vega, rho
- `calculateImpliedVolatility()` - IV calculation
- `analyzeOptionsPortfolio()` - Portfolio Greeks
- `trackWheelStrategy()` - Wheel income tracker
- **9 strategy templates:** Covered call, iron condor, straddle, etc.

### 12. Performance Attribution Engine (`attribution-engine.js`)
**Purpose:** Return decomposition
- `calculateBrinsonAttribution()` - Allocation/selection effects
- `calculateMultiPeriodAttribution()` - Linked attribution
- `calculateHoldingsAttribution()` - Security-level
- `calculateFactorAttribution()` - Factor-based
- `calculateRiskAdjustedAttribution()` - Sharpe, IR, Jensen's alpha

### 13. Tax-Efficient Withdrawal Engine (`tax-withdrawal-engine.js`)
**Purpose:** Tax optimization (German tax system)
- `calculateCapitalGainsTax()` - Abgeltungssteuer
- `calculateCryptoTax()` - 1-year tax-free rule
- `planWithdrawalSequence()` - Optimal ordering
- `findTaxLossHarvesting()` - Loss opportunities
- `analyzeCryptoTaxStrategy()` - Hold vs sell analysis
- `calculateOptimalWithdrawal()` - Exemption optimization

### 14. Margin & Leverage Engine (`margin-leverage-engine.js`)
**Purpose:** Margin account management
- `calculateMarginMetrics()` - Utilization, cushion
- `simulateMarginCall()` - Stress scenarios
- `calculateOptimalLeverage()` - Kelly criterion
- `trackMarginHistory()` - Historical tracking
- `calculateLiquidationRisk()` - Probability analysis
- Margin requirements for stocks, crypto, options, forex

### 15. Sentiment & News Engine (`sentiment-news-engine.js`)
**Purpose:** News and sentiment analysis
- `analyzeTextSentiment()` - Keyword-based scoring
- `aggregateSentiment()` - Weighted by source/recency
- `calculateFearGreedIndex()` - Market sentiment
- `trackSocialMentions()` - Social velocity
- `detectSentimentDivergence()` - Price vs sentiment
- `generateNewsAlerts()` - Watchlist alerts

---

## Testing

### Test Files
- `test-investment-engines.js` - Node.js test suite
- `test-engines.html` - Browser test runner

### Running Tests
1. **Browser:** Open `test-engines.html` in a browser
2. **Electron:** Load with the app

---

## Integration

All engines follow MAERMIN patterns:
- ES5 syntax (no arrow functions, const/let)
- `window.EngineName` export for browser
- `module.exports` for Node.js
- Console log confirmation: `[OK] Engine loaded`

### Loading in HTML
```html
<script src="dca-analyzer-engine.js"></script>
<script src="dividend-tracker-engine.js"></script>
<!-- etc. -->
```

### Usage Example
```javascript
// DCA Analysis
var result = DCAAnalyzerEngine.analyzeDCAvsLumpSum(10000, priceHistory, 'monthly');
console.log('Winner:', result.winner);

// Sector Analysis
var sectors = SectorAllocationEngine.calculateSectorAllocation(portfolio);
console.log('Top sector:', sectors.sectors[0].name);

// Options Greeks
var greeks = OptionsEngine.calculateGreeks('call', 100, 100, 0.25, 0.05, 0.20);
console.log('Delta:', greeks.delta);
```

---

## File Count Summary
- **New engines:** 15 files
- **Test files:** 2 files
- **Total new lines of code:** ~8,500+

All engines are fully functional and ready for UI integration!
