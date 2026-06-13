// Node harness for the FX-attribution pure layer: series inversion/alignment,
// the multiplicative return decomposition, the currency resolver (mirror of
// MaerminMetrics.computeCurrencyExposure), and the portfolio aggregation. The
// React Panel is browser-only and covered by smoke-views.
// Run: node test/fx-attribution.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const F = require('../fx-attribution.js');
const M = require('../metrics.js');

(function run() {
  console.log('fx-attribution:');

  // ---- primitives -------------------------------------------------------------
  ok('invertSeries flips USD-per-EUR to EUR-per-USD', approx(F.invertSeries([1.25, 1.0])[0], 0.8) && approx(F.invertSeries([1.25, 1.0])[1], 1.0));
  ok('invertSeries drops junk and non-positive points', F.invertSeries([1.1, 0, 'x', -2, 1.0]).length === 2);
  ok('totalReturn = last/first - 1', approx(F.totalReturn([100, 90, 110]), 0.1));
  ok('totalReturn null on short/invalid series', F.totalReturn([100]) === null && F.totalReturn(null) === null && F.totalReturn([0, 10]) === null);
  const al = F.alignTails([1, 2, 3, 4], [10, 20]);
  ok('alignTails keeps the most recent overlap', al.periods === 2 && al.a[0] === 3 && al.b[0] === 10);
  ok('alignTails null when too short', F.alignTails([1], [2, 3]) === null);

  // ---- decompose -----------------------------------------------------------------
  // USD asset: local +20%, FX (EUR per USD) -10% -> EUR return = 1.2*0.9-1 = +8%.
  // EUR price path = local x fx: 100 -> 108.
  const eurSeries = [100, 108];
  const fxSeries = [1.0, 0.9];
  const d = F.decompose(eurSeries, fxSeries, 'USD');
  ok('EUR return is the observed series return', approx(d.eurReturn, 0.08));
  ok('FX leg from the EUR-per-USD path', approx(d.fxReturn, -0.10));
  ok('local return recovered by dividing out FX', approx(d.localReturn, 0.20));
  ok('interaction closes the identity exactly', approx(d.eurReturn, d.localReturn + d.fxReturn + d.interaction));
  ok('interaction equals r_local x r_fx', approx(d.interaction, 0.20 * -0.10));

  const dEur = F.decompose([100, 110], fxSeries, 'EUR');
  ok('EUR positions carry no FX leg', dEur.fxReturn === 0 && approx(dEur.localReturn, 0.10) && dEur.interaction === 0);
  const dNoFx = F.decompose([100, 110], null, 'USD');
  ok('USD without an FX path degrades to all-local', dNoFx.fxReturn === 0 && approx(dNoFx.localReturn, 0.10));
  ok('unusable series -> null', F.decompose([100], fxSeries, 'USD') === null);
  // Different lengths: only the common tail counts.
  const dTail = F.decompose([50, 100, 108], [1.0, 0.9], 'USD');
  ok('decompose aligns to the common tail', approx(dTail.eurReturn, 0.08) && dTail.periods === 2);

  // ---- currency resolver (mirror of computeCurrencyExposure) ----------------------
  const txs = [
    { category: 'stocks', symbol: 'AAPL', currency: 'USD', type: 'buy' },
    { category: 'stocks', symbol: 'SAP.DE', currency: 'EUR', type: 'buy' },
    { category: 'stocks', symbol: 'AAPL', currency: 'EUR', type: 'buy' } // later tx must NOT override the first
  ];
  const cur = F.currencyOfPositions(txs);
  ok('transaction currency wins', cur('stocks', 'AAPL') === 'USD' && cur('stocks', 'SAP.DE') === 'EUR');
  ok('first transaction currency sticks', cur('stocks', 'aapl') === 'USD');
  ok('crypto/skins default USD, stocks default EUR', cur('crypto', 'BTC') === 'USD' && cur('skins', 'AK') === 'USD' && cur('stocks', 'UNKNOWN') === 'EUR');
  // Cross-check the defaults against the real metrics module on a tiny portfolio.
  const exposure = M.computeCurrencyExposure(
    { crypto: [{ symbol: 'BTC', amount: 1 }], stocks: [{ symbol: 'SAP.DE', amount: 1 }], skins: [], commodities: [] },
    { BTC: 100, 'SAP.DE': 100 }, []
  );
  const usdRow = exposure.rows.find((r) => r.currency === 'USD');
  ok('defaults agree with MaerminMetrics.computeCurrencyExposure', usdRow && approx(usdRow.pct, 50));

  // ---- attribute ---------------------------------------------------------------------
  const rows = [
    { symbol: 'NVDA', cls: 'stocks', currency: 'USD', valueEUR: 600, series: [100, 108] }, // local +20, fx -10
    { symbol: 'SAP.DE', cls: 'stocks', currency: 'EUR', valueEUR: 400, series: [100, 105] } // +5 all local
  ];
  const res = F.attribute(rows, fxSeries);
  ok('attribution available with data', res.available === true && res.positions.length === 2);
  // Weighted: eur = 0.6*0.08 + 0.4*0.05 = 0.068; fx = 0.6*(-0.10) = -0.06;
  // local = 0.6*0.20 + 0.4*0.05 = 0.14; interaction = 0.6*(-0.02) = -0.012.
  ok('portfolio EUR return is value-weighted', approx(res.totals.eurReturn, 0.068));
  ok('portfolio FX contribution only from USD positions', approx(res.totals.fxReturn, -0.06));
  ok('portfolio local contribution', approx(res.totals.localReturn, 0.14));
  ok('identity holds at the portfolio level too', approx(res.totals.eurReturn, res.totals.localReturn + res.totals.fxReturn + res.totals.interaction));
  const usd = res.byCurrency.find((c) => c.currency === 'USD');
  const eur = res.byCurrency.find((c) => c.currency === 'EUR');
  ok('byCurrency splits weights 60/40', approx(usd.weight, 0.6) && approx(eur.weight, 0.4));
  ok('EUR bucket has zero FX contribution', eur.fxContribution === 0);
  ok('positions sorted by absolute weighted FX impact', res.positions[0].symbol === 'NVDA');
  ok('empty input degrades', F.attribute([], fxSeries).available === false);
  ok('worthless rows are skipped', F.attribute([{ symbol: 'X', currency: 'USD', valueEUR: 0, series: [1, 2] }], fxSeries).available === false);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
