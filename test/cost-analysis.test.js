// Node harness for the ongoing-cost (TER) pure layer: fund-row construction
// with override resolution, the cost aggregation, the multi-year cost-drag
// projection, and the localStorage override store. The React OngoingCostsPanel
// is browser-only and covered by smoke-views.
// Run: node test/cost-analysis.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

// Minimal localStorage so the override store is exercised for real.
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const C = require('../cost-analysis.js');

(function run() {
  console.log('cost-analysis:');

  // ---- overrides store -------------------------------------------------------
  ok('overrides start empty', Object.keys(C.loadOverrides()).length === 0);
  let o = C.saveOverride('VWCE.DE', 0.0022);
  ok('saveOverride keys by root symbol', o.VWCE === 0.0022);
  ok('override persists', C.loadOverrides().VWCE === 0.0022);
  o = C.saveOverride('vwce', null);
  ok('null clears the override', !('VWCE' in o) && !('VWCE' in C.loadOverrides()));
  o = C.saveOverride('QQQ', 0.5);
  ok('implausible TER (50%) is rejected', !('QQQ' in o));
  o = C.saveOverride('QQQ', 'not a number');
  ok('junk TER clears instead of storing NaN', !('QQQ' in o));
  ok('saveOverride without symbol is a no-op', Object.keys(C.saveOverride('', 0.01)).length === 0);
  _store[C.TER_OVERRIDES_KEY] = '{broken json';
  ok('corrupt store reads as empty', Object.keys(C.loadOverrides()).length === 0);
  delete _store[C.TER_OVERRIDES_KEY];

  // ---- buildFundRows ---------------------------------------------------------
  const positions = [
    { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World', cls: 'stocks', valueEUR: 10000 },
    { symbol: 'EUNL.DE', name: 'iShares Core MSCI World', cls: 'stocks', valueEUR: 5000 },
    { symbol: 'AAPL', name: 'Apple', cls: 'stocks', valueEUR: 3000 },
    { symbol: 'MYSTERY.MI', name: 'Some UCITS ETF', cls: 'stocks', valueEUR: 2000 }
  ];
  const fundData = {
    VWCE: { ter: 0.0022, name: 'Vanguard FTSE All-World', source: 'worker' },
    EUNL: { ter: null, name: 'iShares Core MSCI World', source: 'fallback' }
  };

  const rows = C.buildFundRows(positions, fundData, {});
  ok('buildFundRows keeps funds, drops plain stocks', rows.length === 2 && rows.every((r) => r.symbol !== 'AAPL'));
  ok('buildFundRows resolves TER from data', rows[0].ter === 0.0022 && rows[0].terSource === 'worker');
  ok('buildFundRows leaves unknown TER null', rows[1].ter === null && rows[1].terSource === null);

  const rowsOv = C.buildFundRows(positions, fundData, { VWCE: 0.001, MYSTERY: 0.005 });
  ok('override beats fund data', rowsOv[0].ter === 0.001 && rowsOv[0].terSource === 'override');
  ok('override makes an unknown fund visible', rowsOv.length === 3 && rowsOv[2].symbol === 'MYSTERY' && rowsOv[2].ter === 0.005);

  // ---- computeOngoingCosts ---------------------------------------------------
  const costs = C.computeOngoingCosts(C.buildFundRows(positions, fundData, { EUNL: 0.002 }));
  // VWCE: 10000 * 0.0022 = 22; EUNL: 5000 * 0.002 = 10
  ok('cost per position is value x TER', approx(costs.rows.find((r) => r.symbol === 'VWCE').annualCostEUR, 22));
  ok('total annual cost sums known funds', approx(costs.totalAnnualCostEUR, 32));
  ok('weighted TER over covered value', approx(costs.weightedTer, 32 / 15000));
  ok('covered vs total fund value', approx(costs.knownValue, 15000) && approx(costs.totalFundValue, 15000));
  ok('rows sorted by annual cost desc', costs.rows[0].symbol === 'VWCE');

  const withUnknown = C.computeOngoingCosts(C.buildFundRows(positions, fundData, {}));
  ok('unknown TER counted, not costed', withUnknown.unknownCount === 1 && approx(withUnknown.totalAnnualCostEUR, 22));
  ok('unknown TER excluded from weighting', approx(withUnknown.weightedTer, 0.0022));
  ok('empty rows degrade', C.computeOngoingCosts([]).available === false);

  // ---- projectCostDrag -------------------------------------------------------
  const proj = C.projectCostDrag(10000, 0.002, { years: 20, growthRate: 0.05 });
  ok('projection covers the requested horizon', proj.length === 20 && proj[19].year === 20);
  // Year 1: gross 10500, net 10500 * 0.998 = 10479 → drag 21
  ok('year-1 drag is value x growth x TER', approx(proj[0].gross, 10500) && approx(proj[0].cumulativeCost, 21));
  ok('cumulative drag grows monotonically', proj.every((p, i) => i === 0 || p.cumulativeCost > proj[i - 1].cumulativeCost));
  ok('net stays below gross', proj.every((p) => p.net < p.gross));
  // Compounding sanity: 20y drag far exceeds 20x the year-1 drag.
  ok('drag compounds over time', proj[19].cumulativeCost > 21 * 20);

  const zero = C.projectCostDrag(10000, 0, { years: 5 });
  ok('zero TER → zero drag', zero.every((p) => approx(p.cumulativeCost, 0)));
  const contrib = C.projectCostDrag(0, 0.002, { years: 2, growthRate: 0.05, annualContribution: 1000 });
  ok('contributions feed both paths', approx(contrib[0].gross, 1050) && contrib[1].cumulativeCost > contrib[0].cumulativeCost);
  ok('horizon is clamped to sane bounds', C.projectCostDrag(1, 0.01, { years: 999 }).length === 50);
  ok('negative TER treated as zero', C.projectCostDrag(1000, -1, { years: 1 })[0].cumulativeCost === 0);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
