// Node harness for the Portfolio Intelligence pure layer: the ten analyses,
// priority ranking (critical → important → optimization), threshold overrides,
// the direct-concentration fallback when look-through is absent, and the export
// helper. The React View is browser-only and covered by smoke-views.
// Run: node test/portfolio-intelligence.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const I = require('../portfolio-intelligence.js');

function byId(report, id) { return report.findings.find((f) => f.id === id); }
function byAnalysis(report, a) { return report.findings.filter((f) => f.analysis === a); }

(function run() {
  console.log('portfolio-intelligence:');

  // ---- empty / degenerate ----------------------------------------------------
  const empty = I.analyzeFromInputs({});
  ok('no inputs → no findings', empty.findings.length === 0 && empty.summary.total === 0);
  ok('summary counts present', empty.summary.critical === 0 && empty.summary.important === 0 && empty.summary.optimization === 0);

  // ---- 1) single company risk (effective look-through) -----------------------
  const sc = I.analyzeFromInputs({
    effectiveExposure: [{ key: 'MSFT', name: 'Microsoft', effectiveWeight: 0.34, directWeight: 0.10, fundedWeight: 0.24, funds: ['VWCE', 'QQQ'] }]
  });
  const scF = byId(sc, 'sc-critical');
  ok('34% effective → critical single-company finding', scF && scF.priority === 'critical');
  ok('finding phrases the effective exposure like the spec', /34/.test(scF.title) && /Microsoft/.test(scF.title));
  ok('moderate (22%) effective → important', byId(
    I.analyzeFromInputs({ effectiveExposure: [{ name: 'Apple', effectiveWeight: 0.22, directWeight: 0.22, fundedWeight: 0 }] }),
    'sc-important').priority === 'important');
  ok('15% effective → no single-company finding', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ name: 'Apple', effectiveWeight: 0.15 }] }), 'singleCompany').length === 0);
  ok('Other/Unknown buckets are ignored', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ name: 'Other', effectiveWeight: 0.9 }] }), 'singleCompany').length === 0);

  // ---- 2) hidden concentration ----------------------------------------------
  const hid = I.analyzeFromInputs({
    hiddenConcentrations: [{ name: 'Nvidia', effectiveWeight: 0.14, directWeight: 0.01, fundedWeight: 0.13, funds: ['VWCE'] }]
  });
  ok('mostly-hidden security → important hidden finding', byId(hid, 'hidden-1').priority === 'important');
  ok('hidden finding names the funds', /VWCE/.test(byId(hid, 'hidden-1').detail));
  ok('small hidden share (8% < 10%) → no finding', byAnalysis(
    I.analyzeFromInputs({ hiddenConcentrations: [{ name: 'X', effectiveWeight: 0.08, fundedWeight: 0.08 }] }), 'hidden').length === 0);

  // ---- 2b) Magnificent-7 cluster --------------------------------------------
  const m7 = I.analyzeFromInputs({ effectiveExposure: [
    { key: 'AAPL', name: 'Apple',     effectiveWeight: 0.09 },
    { key: 'MSFT', name: 'Microsoft', effectiveWeight: 0.08 },
    { key: 'NVDA', name: 'Nvidia',    effectiveWeight: 0.07 },
    { key: 'GOOGL', name: 'Alphabet', effectiveWeight: 0.05 },
    { key: 'AMZN', name: 'Amazon',    effectiveWeight: 0.05 },
  ] });
  ok('combined Mag-7 (34%) → important mag7 finding', byId(m7, 'mag7-important') && byId(m7, 'mag7-important').priority === 'important');
  ok('mag7 finding names the cluster members', /Apple/.test(byId(m7, 'mag7-important').detail) && /Nvidia/.test(byId(m7, 'mag7-important').detail));
  ok('mag7 metric is the summed weight', Math.abs(byId(m7, 'mag7-important').metric - 34) < 0.5);
  ok('moderate Mag-7 (24%) → optimization', byId(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'AAPL', name: 'Apple', effectiveWeight: 0.14 }, { key: 'MSFT', name: 'Microsoft', effectiveWeight: 0.10 }] }),
    'mag7-optimize').priority === 'optimization');
  ok('low Mag-7 (12%) → no mag7 finding', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'AAPL', name: 'Apple', effectiveWeight: 0.12 }] }), 'mag7').length === 0);
  ok('non-Mag-7 names do not count', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'KO', name: 'Coca-Cola', effectiveWeight: 0.40 }] }), 'mag7').length === 0);

  // ---- 2c) semiconductor concentration --------------------------------------
  const semi = I.analyzeFromInputs({ effectiveExposure: [
    { key: 'NVDA', name: 'Nvidia',  effectiveWeight: 0.10 },
    { key: 'AVGO', name: 'Broadcom', effectiveWeight: 0.08 },
    { key: 'TSM',  name: 'TSMC',     effectiveWeight: 0.09 },
  ] });
  ok('combined semis (27%) → important', byId(semi, 'semi-important') && byId(semi, 'semi-important').priority === 'important');
  ok('semi finding names the chips', /Nvidia/.test(byId(semi, 'semi-important').detail) && /Broadcom/.test(byId(semi, 'semi-important').detail));
  ok('moderate semis (18%) → optimization', byId(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'NVDA', name: 'Nvidia', effectiveWeight: 0.18 }] }), 'semi-optimize').priority === 'optimization');
  ok('low semis (10%) → no finding', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'NVDA', name: 'Nvidia', effectiveWeight: 0.10 }] }), 'semiconductor').length === 0);
  ok('non-semi names do not count', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ key: 'KO', name: 'Coca-Cola', effectiveWeight: 0.40 }] }), 'semiconductor').length === 0);

  // ---- 2d) hidden leverage (leveraged / inverse ETPs) -----------------------
  const lev = I.analyzeFromInputs({ leverage: { available: true,
    positions: [{ symbol: 'TQQQ', factor: 3, weightPct: 12 }], rawWeightPct: 12, leveredWeightPct: 36 } });
  ok('12% leveraged ETP → important', byId(lev, 'leverage-important') && byId(lev, 'leverage-important').priority === 'important');
  ok('leverage finding names the ticker + factor', /TQQQ \(\+3x\)/.test(byId(lev, 'leverage-important').detail));
  const inv = I.analyzeFromInputs({ leverage: { available: true,
    positions: [{ symbol: 'SQQQ', factor: -3, weightPct: 2 }], rawWeightPct: 2, leveredWeightPct: 6 } });
  ok('any inverse ETP → important even when small', byId(inv, 'leverage-important') && byId(inv, 'leverage-important').priority === 'important');
  const lo = I.analyzeFromInputs({ leverage: { available: true,
    positions: [{ symbol: 'SSO', factor: 2, weightPct: 4 }], rawWeightPct: 4, leveredWeightPct: 8 } });
  ok('small long-leverage (4%) → optimization', byId(lo, 'leverage-optimize') && byId(lo, 'leverage-optimize').priority === 'optimization');
  ok('2% long-leverage → no finding', byAnalysis(
    I.analyzeFromInputs({ leverage: { available: true, positions: [{ symbol: 'SSO', factor: 2, weightPct: 2 }], rawWeightPct: 2, leveredWeightPct: 4 } }), 'leverage').length === 0);
  ok('leverageOf maps known tickers (case-insensitive) + null for the rest',
    I.leverageOf('tqqq') === 3 && I.leverageOf('SQQQ') === -3 && I.leverageOf('AAPL') === null);

  // ---- 3) sector overexposure -----------------------------------------------
  ok('45% sector → critical', byId(I.analyzeFromInputs({ sectorExposure: [{ sector: 'Technology', weight: 0.45 }] }), 'sector-critical').priority === 'critical');
  ok('32% sector → important', byId(I.analyzeFromInputs({ sectorExposure: [{ sector: 'Energy', weight: 0.32 }] }), 'sector-important').priority === 'important');
  ok('26% sector → optimization', byId(I.analyzeFromInputs({ sectorExposure: [{ sector: 'Energy', weight: 0.26 }] }), 'sector-optimize').priority === 'optimization');

  // ---- 4) country risk -------------------------------------------------------
  ok('78% country → important', byId(I.analyzeFromInputs({ countryExposure: [{ country: 'United States', weight: 0.78 }] }), 'country-important').priority === 'important');
  ok('62% country → optimization', byId(I.analyzeFromInputs({ countryExposure: [{ country: 'United States', weight: 0.62 }] }), 'country-optimize').priority === 'optimization');

  // ---- 5) currency risk (look-through, fractions) ----------------------------
  const fx = I.analyzeFromInputs({ currencyExposure: [{ currency: 'USD', weight: 0.78 }] });
  ok('78% USD currency → optimization (65–80 band)', byId(fx, 'currency-optimize').priority === 'optimization');
  ok('currency finding phrases like the spec ("USD Exposure beträgt …")', /USD exposure is 78/i.test(byId(fx, 'currency-optimize').title));
  ok('85% USD currency → important', byId(I.analyzeFromInputs({ currencyExposure: [{ currency: 'USD', weight: 0.85 }] }), 'currency-important').priority === 'important');
  // accepts pct inputs too (metrics fallback gives 0..100)
  ok('currency accepts percent inputs', byId(I.analyzeFromInputs({ currencyExposure: [{ currency: 'USD', weight: 85 }] }), 'currency-important') != null);

  // ---- 6) correlation clusters (fund overlap) --------------------------------
  const ov = I.analyzeFromInputs({ overlapPairs: [{ a: 'VWCE', b: 'QQQ', overlap: 0.36, shared: [{ name: 'Apple', weight: 0.05 }, { name: 'Microsoft', weight: 0.04 }] }] });
  ok('36% overlap → important correlation finding', byId(ov, 'corr-important').priority === 'important');
  ok('overlap finding names both funds + shared names', /VWCE/.test(byId(ov, 'corr-important').title) && /Apple/.test(byId(ov, 'corr-important').detail));
  ok('22% overlap → optimization', byId(I.analyzeFromInputs({ overlapPairs: [{ a: 'A', b: 'B', overlap: 0.22, shared: [] }] }), 'corr-optimize').priority === 'optimization');

  // ---- 7) style drift (sector tilt vs reference) -----------------------------
  // Technology reference is 24%; 39% → +15pp drift but below the 40% critical cut.
  const sd = I.analyzeFromInputs({ sectorExposure: [{ sector: 'Technology', weight: 0.39 }] });
  ok('Technology 39% → style-drift optimization finding', byId(sd, 'style-drift') && byId(sd, 'style-drift').analysis === 'styleDrift');
  ok('style drift does not fire when sector is near the reference', byAnalysis(I.analyzeFromInputs({ sectorExposure: [{ sector: 'Technology', weight: 0.27 }] }), 'styleDrift').length === 0);

  // ---- 8) dividend trap (high yield + weak growth) ---------------------------
  const dt = I.analyzeFromInputs({ dividend: { available: true, yield: 6.2, weightedGrowth: 0.5, incomeAtRiskPct: 0, traps: [] } });
  ok('high yield + low growth → dividend trap (important)', byId(dt, 'div-trap').priority === 'important');
  ok('dividend trap phrased like the spec', /high \(6.2%\)/.test(byId(dt, 'div-trap').title) && /low \(0.5%\)/.test(byId(dt, 'div-trap').title));
  ok('high yield + healthy growth → no dividend trap', byAnalysis(
    I.analyzeFromInputs({ dividend: { available: true, yield: 6.2, weightedGrowth: 8, incomeAtRiskPct: 0, traps: [] } }), 'dividendTrap').length === 0);

  // ---- 9) yield trap (high yield + cut-risk) ---------------------------------
  const yt = I.analyzeFromInputs({ dividend: { available: true, yield: 8.5, weightedGrowth: -3, incomeAtRiskPct: 40, traps: [{ symbol: 'XYZ', yield: 9, growth: -5, cutRisk: true }] } });
  ok('high yield + cut-risk → yield trap (critical)', byId(yt, 'yield-trap').priority === 'critical');
  ok('yield trap names the at-risk payer', /XYZ/.test(byId(yt, 'yield-trap').detail));

  // ---- 10) liquidity risk ----------------------------------------------------
  ok('18% illiquid → important', byId(I.analyzeFromInputs({ liquidity: { available: true, illiquidPct: 18, classes: [{ cls: 'skins', pct: 18 }] } }), 'liq-important').priority === 'important');
  ok('10% illiquid → optimization', byId(I.analyzeFromInputs({ liquidity: { available: true, illiquidPct: 10, classes: [{ cls: 'skins', pct: 10 }] } }), 'liq-optimize').priority === 'optimization');

  // ---- direct-concentration fallback (no look-through) -----------------------
  const fb = I.analyzeFromInputs({ directConcentration: { available: true, maxWeight: 0.41, topLabel: 'BTC' } });
  ok('fallback fires when no effective exposure', byId(fb, 'sc-direct') && byId(fb, 'sc-direct').priority === 'critical');
  ok('fallback suppressed when effective exposure exists', byAnalysis(
    I.analyzeFromInputs({ effectiveExposure: [{ name: 'MSFT', effectiveWeight: 0.34 }], directConcentration: { available: true, maxWeight: 0.41, topLabel: 'BTC' } }),
    'singleCompany').every((f) => f.id !== 'sc-direct'));

  // ---- ranking + summary -----------------------------------------------------
  const full = I.analyzeFromInputs({
    effectiveExposure: [{ name: 'Microsoft', effectiveWeight: 0.34, directWeight: 0.1, fundedWeight: 0.24, funds: ['VWCE'] }],
    sectorExposure: [{ sector: 'Technology', weight: 0.33 }],
    countryExposure: [{ country: 'United States', weight: 0.62 }],
    currencyExposure: [{ currency: 'USD', weight: 0.78 }]
  });
  ok('findings are sorted critical-first', full.findings[0].priority === 'critical');
  ok('summary tallies each priority', full.summary.critical >= 1 && full.summary.important >= 1 && full.summary.optimization >= 1);
  ok('summary total equals findings length', full.summary.total === full.findings.length);

  // ---- threshold overrides ---------------------------------------------------
  const lenient = I.analyzeFromInputs({ effectiveExposure: [{ name: 'X', effectiveWeight: 0.34 }] }, { thresholds: { singleCompanyCritical: 40 } });
  ok('raising the critical threshold downgrades the finding', byId(lenient, 'sc-critical') == null && byId(lenient, 'sc-important') != null);

  // ---- export helper ---------------------------------------------------------
  const exp = I.toExport(full, { generatedAt: '2026-01-01T00:00:00.000Z' });
  ok('export carries module + version + fixed timestamp', exp.module === 'portfolio-intelligence' && exp.version === 1 && exp.generatedAt === '2026-01-01T00:00:00.000Z');
  ok('export findings omit no priority and keep advice text', exp.findings.length === full.findings.length && exp.findings.every((f) => f.title && f.priority));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
