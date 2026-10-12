// Node harness: the money figures of Risk Level (VaR, CVaR) are in EUR of the
// portfolio, also when the risk engine runs on the daily value index (VIS-005),
// where it computes them for a value of 1. Run: node test/risk-money.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
const R = require('../risk-analytics.js');
const fs = require('fs');
const path = require('path');

(function run() {
  console.log('scaleRiskMoney:');
  const m = { var95: 0.0123, cvar95: 0.0181, maxDrawdown: 0.2, maxDrawdownPercent: 20, volatility: 15, sharpeRatio: 1.1 };
  const s = R.scaleRiskMoney(m, 176756.66);
  ok('VaR and CVaR become EUR of the portfolio', near(s.var95, 0.0123 * 176756.66) && near(s.cvar95, 0.0181 * 176756.66), JSON.stringify(s));
  ok('the absolute drawdown scales too; percentages and ratios stay', near(s.maxDrawdown, 0.2 * 176756.66) && s.maxDrawdownPercent === 20 && s.volatility === 15 && s.sharpeRatio === 1.1);
  ok('returns a copy (the input is unchanged)', m.var95 === 0.0123 && s !== m);
  ok('no usable value -> the metrics as they are', R.scaleRiskMoney(m, 0) === m && R.scaleRiskMoney(m, NaN) === m && R.scaleRiskMoney(null, 5) === null);

  console.log('the engine on an index of 1:');
  const idx = []; let v = 100;
  for (let i = 0; i < 60; i++) { v *= 1 + (i % 7 === 0 ? -0.03 : 0.004); idx.push(v); }
  const raw = R.calculatePortfolioRiskMetrics({ stocks: [{ symbol: '__portfolio__', amount: 1, currentPrice: 1 }] }, { __portfolio__: idx }, 1);
  ok('without scaling VaR is per 1 EUR (the old 0.01 EUR figure)', raw.var95 > 0 && raw.var95 < 1, String(raw.var95));
  const scaled = R.scaleRiskMoney(raw, 50000);
  ok('scaled VaR = the 1-day 95 % loss of a 50,000 EUR portfolio', near(scaled.var95, raw.var95 * 50000) && scaled.var95 > 100);

  console.log('bookWeights (the real holdings, not the index placeholder):');
  const book = { stocks: [{ symbol: 'AAPL', amount: 10, currentPrice: 200 }, { symbol: 'VWCE.DE', amount: 20, purchasePrice: 100 }],
    crypto: [{ symbol: 'BTC', amount: 0.1, currentPrice: 50000 }], commodities: [{ symbol: 'XAU', amount: 1, currentPrice: 2000 }], meta: 'x' };
  const w = R.bookWeights(book, { aapl: 250 });
  const tot = 10 * 250 + 20 * 100 + 0.1 * 50000 + 2000;
  ok('value shares across every asset class (commodities too), live price first', near(w.aapl, 2500 / tot) && near(w['vwce.de'], 2000 / tot) && near(w.btc, 5000 / tot) && near(w.xau, 2000 / tot), JSON.stringify(w));
  ok('no placeholder, shares add up to 1', !('__portfolio__' in w) && near(Object.values(w).reduce((a, b) => a + b, 0), 1));
  ok('an empty book gives no weights', Object.keys(R.bookWeights({}, {})).length === 0);
  const w2 = R.bookWeights({ stocks: [{ symbol: 'NVDA', amount: 10, purchasePrice: 15 }, { symbol: 'KO', amount: 10, purchasePrice: 60 }] }, { NVDA: 165, KO: 65 });
  ok('live prices keyed as the app keys them (upper case) win over the purchase price', near(w2.nvda, 1650 / 2300) && near(w2.ko, 650 / 2300), JSON.stringify(w2));
  const recs = R.generateRiskRecommendations(Object.assign({}, raw, { weights: R.bookWeights(book, {}) }), book);
  ok('recommendations name real holdings, never the placeholder', !JSON.stringify(recs).includes('PORTFOLIO__'));

  console.log('wiring:');
  const view = fs.readFileSync(path.join(__dirname, '..', 'risk-analytics-view-v2.js'), 'utf8');
  ok('the view scales the index-path metrics by the portfolio value', /scaleRiskMoney\(/.test(view) && /portfolioValueEUR/.test(view));
  ok('the view uses the real book weights on the index path', /bookWeights\(/.test(view));
  const rend = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  ok('the renderer passes the active portfolio value (EUR)', /RiskAnalyticsViewV2, \{[^}]*portfolioValueEUR: portfolioStats\.totalValue/.test(rend));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
