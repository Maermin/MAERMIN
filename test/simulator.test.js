// Node harness for the simulator panel's pure glue (defaults + buildResults).
// The underlying math lives in portfolio-analytics.js (analytics.test.js); here
// we verify the input→engine mapping. Run: node test/simulator.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const Analytics = require('../portfolio-analytics.js');
const Sim = require('../simulator-view.js');

(function run() {
  console.log('simulator:');

  const d = Sim.defaults(12345.6);
  ok('defaults rounds startValue', d.startValue === 12346);
  ok('defaults gives sane horizon + return', d.years > 0 && d.annualReturn > 0);
  ok('defaults clamps negative startValue', Sim.defaults(-5).startValue === 0);

  // Future value: positive return → growth above contributions.
  const fv = Sim.buildResults('future', { startValue: 10000, monthly: 500, annualReturn: 7, years: 20 }, Analytics);
  ok('future returns projected/contributions/growth', fv && fv.projected > 0 && fv.contributions === 10000 + 500 * 12 * 20);
  ok('future growth = projected − contributions', Math.abs(fv.growth - (fv.projected - fv.contributions)) < 1e-6);
  ok('future projected exceeds contributions at 7%', fv.projected > fv.contributions);

  // FIRE: number = expenses / (wr%).
  const fire = Sim.buildResults('fire', { startValue: 100000, monthly: 1000, annualReturn: 5, annualExpenses: 40000, withdrawalRate: 4 }, Analytics);
  ok('fire configured', fire && fire.configured === true);
  ok('fire number = expenses * 100/wr', Math.abs(fire.fireNumber - 40000 * 25) < 1e-6);
  ok('fire progress is a percentage', fire.currentProgress >= 0 && fire.currentProgress <= 100);

  // Withdrawal: depletes fast with huge spend; survives with tiny spend.
  const deplete = Sim.buildResults('withdraw', { startValue: 100000, annualWithdrawal: 50000, annualReturn: 3, inflation: 2, years: 30 }, Analytics);
  ok('withdraw depletes with oversized spend', deplete && deplete.survives === false && deplete.depletedYear !== null);
  const survive = Sim.buildResults('withdraw', { startValue: 1000000, annualWithdrawal: 1000, annualReturn: 5, inflation: 2, years: 30 }, Analytics);
  ok('withdraw survives with modest spend', survive.survives === true && survive.depletedYear === null);

  // Monte Carlo: success rate in [0,1], percentiles ordered, deterministic seed.
  const mc1 = Sim.buildResults('montecarlo', { startValue: 100000, monthly: 500, annualReturn: 7, volatility: 15, years: 20, paths: 500 }, Analytics);
  const mc2 = Sim.buildResults('montecarlo', { startValue: 100000, monthly: 500, annualReturn: 7, volatility: 15, years: 20, paths: 500 }, Analytics);
  ok('mc success rate in [0,1]', mc1.successRate >= 0 && mc1.successRate <= 1);
  ok('mc percentiles ordered p10 ≤ median ≤ p90', mc1.p10 <= mc1.median && mc1.median <= mc1.p90);
  ok('mc deterministic for the same inputs', mc1.median === mc2.median && mc1.successRate === mc2.successRate);

  // Guards.
  ok('null engine → null', Sim.buildResults('future', { startValue: 1 }, null) === null);
  ok('unknown mode → null', Sim.buildResults('nope', { startValue: 1 }, Analytics) === null);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
