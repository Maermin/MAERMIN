// Node harness for the deterministic advisor findings engine (pure, no LLM).
// Run: node test/advisor.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.window = {};
const Advisor = require('../advisor.js');

(function run() {
  console.log('advisor — findings from metrics:');

  // High concentration + heavy USD + big drift + harvest opportunity
  const r = Advisor.analyzeFromMetrics({
    concentration: { available: true, maxWeight: 42, effectiveN: 2.1, classCount: 2, top: [{ symbol: 'NVDA' }] },
    currency: { available: true, currencyCount: 2, rows: [{ currency: 'USD', pct: 85 }, { currency: 'EUR', pct: 15 }] },
    drift: { available: true, maxDrift: 14, rows: [{ cls: 'crypto', drift: 14 }, { cls: 'stocks', drift: -14 }] },
    dividends: { available: true, totalAnnual: 1200, monthly: 100, yield: 1.2, payers: 4 },
    taxLoss: { available: true, totalSavings: 530, rows: [{ symbol: 'X', washSale: false }] },
    health: { empty: false, score: 44, subScores: { diversification: 30, risk: 55, tax: 60 } }
  }, {});

  const ids = r.findings.map(f => f.id);
  ok('flags critical concentration (NVDA 42%)', ids.includes('conc-critical'));
  ok('finding names the position and weight', r.findings.find(f => f.id === 'conc-critical').title.includes('NVDA') && r.findings.find(f => f.id === 'conc-critical').title.includes('42'));
  ok('flags low diversification', ids.includes('div-low'));
  ok('flags heavy USD currency', ids.includes('fx-warning'));
  ok('flags rebalancing drift', ids.includes('rebal-warning'));
  ok('surfaces dividend income', ids.includes('div-income'));
  ok('surfaces tax-loss harvest opportunity', ids.includes('tax-harvest'));
  ok('flags low health with weakest area', r.findings.find(f => f.id === 'health-low').detail.includes('diversification'));

  // critical sorts before warning before opportunity before good
  ok('findings ranked by severity', r.findings[0].severity === 'critical');
  ok('summary counts critical', r.summary.critical === 1 && r.summary.total === ids.length);

  // Healthy portfolio → good findings, no warnings
  const healthy = Advisor.analyzeFromMetrics({
    concentration: { available: true, maxWeight: 12, effectiveN: 9, classCount: 4, top: [{ symbol: 'VWCE' }] },
    currency: { available: true, currencyCount: 3, rows: [{ currency: 'EUR', pct: 45 }] },
    drift: { available: true, maxDrift: 2, rows: [] },
    health: { empty: false, score: 86, subScores: { risk: 80 } }
  }, {});
  ok('well-diversified → good finding', healthy.findings.some(f => f.id === 'div-good'));
  ok('on-target allocation → good finding', healthy.findings.some(f => f.id === 'rebal-good'));
  ok('strong health → good finding', healthy.findings.some(f => f.id === 'health-good'));
  ok('no critical/warning for healthy portfolio', healthy.summary.critical === 0 && healthy.summary.warning === 0);

  // chatContext shape feeds AICopilot
  const ctx = Advisor.chatContext(r, 'How do I de-risk?');
  ok('chatContext carries findings + question', ctx.data.findings.length === r.findings.length && ctx.question === 'How do I de-risk?');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
