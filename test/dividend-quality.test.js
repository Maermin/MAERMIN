// Node harness for the dividend quality/safety pure layer: URL building,
// fundamentals parsing, CAGR from a yearly series, the per-position safety
// scoring heuristic, and the portfolio aggregation. The React QualityPanel is
// browser-only and covered by smoke-views.
// Run: node test/dividend-quality.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const Q = require('../dividend-quality.js');

(function run() {
  console.log('dividend-quality:');

  // ---- buildUrl --------------------------------------------------------------
  ok('buildUrl builds the fundamentals route', Q.buildUrl('https://w.example.com', 'KO') === 'https://w.example.com?action=fundamentals&symbol=KO');
  ok('buildUrl strips trailing slashes', Q.buildUrl('https://w.example.com///', 'X').indexOf('com?action') > -1);
  ok('buildUrl empty base or symbol → empty', Q.buildUrl('', 'X') === '' && Q.buildUrl('https://w.example.com', '') === '');

  // ---- parseFundamentalsResponse ----------------------------------------------
  const pErr = Q.parseFundamentalsResponse({ error: 'Unknown action' });
  ok('parse flags an error payload (old Worker)', pErr.ok === false && /Unknown/.test(pErr.error));
  ok('parse on null → not ok', Q.parseFundamentalsResponse(null).ok === false);
  const pOk = Q.parseFundamentalsResponse({
    symbol: 'ko', name: 'Coca-Cola', currency: 'USD', price: 60,
    dividendRate: 1.94, dividendYield: 0.032, fiveYearAvgDividendYield: 0.031,
    payoutRatio: 0.74, trailingEps: 2.6, forwardEps: 2.9
  });
  ok('parse uppercases the symbol', pOk.data.symbol === 'KO');
  ok('parse keeps the ratios', approx(pOk.data.payoutRatio, 0.74) && approx(pOk.data.dividendYield, 0.032));
  ok('parse null-ifies junk numbers', Q.parseFundamentalsResponse({ symbol: 'X', payoutRatio: 'n/a' }).data.payoutRatio === null);

  // ---- cagrFromSeries -----------------------------------------------------------
  // 1.00 → 1.331 over 3 years = 10% CAGR
  const series = [
    { year: 2023, amount: 1.0 }, { year: 2024, amount: 1.1 },
    { year: 2025, amount: 1.21 }, { year: 2026, amount: 1.331 }
  ];
  ok('cagr over 3 years', approx(Q.cagrFromSeries(series, 3), 0.10, 1e-10));
  ok('cagr handles unsorted input', approx(Q.cagrFromSeries(series.slice().reverse(), 3), 0.10, 1e-10));
  ok('cagr null when window not covered', Q.cagrFromSeries(series, 5) === null);
  ok('cagr null on empty/invalid', Q.cagrFromSeries([], 3) === null && Q.cagrFromSeries(null, 3) === null);
  ok('cagr null on zero start', Q.cagrFromSeries([{ year: 2023, amount: 0 }, { year: 2026, amount: 1 }], 3) === null);

  // ---- scorePosition: archetypes -------------------------------------------------
  // Aristocrat: low payout, long streak, steady growth, sane yield.
  const aristocrat = Q.scorePosition({
    payoutRatio: 0.35, trailingEps: 6, dividendRate: 2.1,
    dividendYield: 0.025, growthRate: 0.06, yearsOfGrowth: 30
  });
  ok('aristocrat scores safe', aristocrat.rating === 'safe' && aristocrat.score >= 85);
  ok('aristocrat has no cut risk', aristocrat.cutRisk === false);
  ok('aristocrat coverage = 1/payout', approx(aristocrat.metrics.coverage, 1 / 0.35));
  ok('all four components known', aristocrat.knownComponents === 4);

  // Stressed payer: payout > 100%, cut last year, fat yield, no streak.
  const stressed = Q.scorePosition({
    payoutRatio: 1.15, trailingEps: 1.0, dividendRate: 1.15,
    dividendYield: 0.095, growthRate: -0.2, yearsOfGrowth: 0
  });
  ok('stressed payer scores risky', stressed.rating === 'risky' && stressed.score < 30);
  ok('stressed payer is flagged', stressed.cutRisk === true);
  ok('stressed payer reasons mention the cut', stressed.reasons.some((r) => /cut/i.test(r)));

  // Negative earnings while paying → uncovered.
  const uncovered = Q.scorePosition({ trailingEps: -2, dividendRate: 1.5, dividendYield: 0.04, growthRate: 0.02, yearsOfGrowth: 4 });
  ok('negative EPS zeroes the payout component', uncovered.components.payout === 0);
  ok('negative EPS sets coverage 0 and cut risk', uncovered.metrics.coverage === 0 && uncovered.cutRisk === true);
  ok('negative EPS reason is explicit', uncovered.reasons.some((r) => /not covered/i.test(r)));

  // Payout derived from DPS/EPS when the ratio is absent.
  const derived = Q.scorePosition({ trailingEps: 4, dividendRate: 2, dividendYield: 0.03, growthRate: 0.05, yearsOfGrowth: 10 });
  ok('payout derived from DPS/EPS', approx(derived.metrics.payoutRatio, 0.5));

  // History-only (no fundamentals): score still computes, confidence lower.
  const historyOnly = Q.scorePosition({ dividendYield: 0.03, growthRate: 0.05, yearsOfGrowth: 12 });
  ok('history-only still scores', historyOnly.score != null && historyOnly.knownComponents === 3);
  ok('history-only says so', historyOnly.reasons.some((r) => /history only/i.test(r)));

  // Yield trap: high yield with a short streak flags even with ok payout.
  const trap = Q.scorePosition({ payoutRatio: 0.6, trailingEps: 2, dividendRate: 1.2, dividendYield: 0.10, growthRate: 0.01, yearsOfGrowth: 2 });
  ok('yield trap flags cut risk', trap.cutRisk === true);
  ok('yield trap reason names the yield', trap.reasons.some((r) => /yield/i.test(r)));
  const fatButProven = Q.scorePosition({ payoutRatio: 0.6, trailingEps: 2, dividendRate: 1.2, dividendYield: 0.10, growthRate: 0.03, yearsOfGrowth: 20 });
  ok('long streak defuses the pure-yield flag', fatButProven.cutRisk === false);

  // Nothing known → unknown rating, null score.
  const empty = Q.scorePosition({});
  ok('no inputs → unknown', empty.score === null && empty.rating === 'unknown');

  // CAGR preference: 5y beats 3y beats growthRate.
  const prefers = Q.scorePosition({ dividendYield: 0.02, cagr5: -0.05, cagr3: 0.2, growthRate: 0.2, yearsOfGrowth: 5 });
  ok('scoring prefers the longest CAGR window', prefers.metrics.growth === -0.05 && prefers.cutRisk === true);

  // ---- scorePortfolio --------------------------------------------------------
  const agg = Q.scorePortfolio([
    { score: 90, cutRisk: false, incomeEUR: 800 },
    { score: 30, cutRisk: true, incomeEUR: 200 },
    { score: null, cutRisk: false, incomeEUR: 0 }
  ]);
  ok('portfolio health is income-weighted', agg.score === Math.round((90 * 800 + 30 * 200) / 1000));
  ok('portfolio counts ratings', agg.counts.safe === 1 && agg.counts.risky === 1 && agg.counts.unknown === 1);
  ok('income at risk share', approx(agg.incomeAtRiskPct, 20));
  ok('portfolio label follows score', agg.label === 'healthy');

  const equalW = Q.scorePortfolio([{ score: 80, cutRisk: false }, { score: 40, cutRisk: false }]);
  ok('missing incomes → equal weighting', equalW.score === 60);
  ok('no scored rows → unavailable', Q.scorePortfolio([{ score: null, cutRisk: false }]).available === false);
  ok('empty portfolio → unavailable', Q.scorePortfolio([]).available === false);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
