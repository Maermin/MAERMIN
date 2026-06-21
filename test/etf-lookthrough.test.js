// Node harness for the ETF look-through pure layer: symbol normalisation,
// static fallback lookup, Worker response parsing, fund-data merging, position
// flattening, and the full analyze() computation (effective exposure, sector/
// country/currency look-through, fund overlap, hidden concentrations). The
// React Panel is browser-only and covered by smoke-views.
// Run: node test/etf-lookthrough.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const L = require('../etf-lookthrough.js');

(function run() {
  console.log('etf-lookthrough:');

  // ---- normalizeFundSymbol / holdingKey ------------------------------------
  ok('normalizeFundSymbol strips exchange suffix', L.normalizeFundSymbol('VWCE.DE') === 'VWCE');
  ok('normalizeFundSymbol uppercases', L.normalizeFundSymbol('cspx.l') === 'CSPX');
  ok('normalizeFundSymbol plain symbol unchanged', L.normalizeFundSymbol('QQQ') === 'QQQ');
  ok('normalizeFundSymbol empty-safe', L.normalizeFundSymbol(null) === '');
  ok('holdingKey prefers symbol', L.holdingKey('aapl', 'Apple') === 'AAPL');
  ok('holdingKey falls back to name', L.holdingKey(null, 'Apple Inc') === 'APPLE INC');

  // ---- fallbackHoldings -----------------------------------------------------
  const fbWorld = L.fallbackHoldings('EUNL.DE');
  ok('fallback resolves EUNL.DE to MSCI World', fbWorld && /MSCI World/.test(fbWorld.name));
  ok('fallback carries holdings with fraction weights', fbWorld.holdings.length >= 8 && fbWorld.holdings.every((h) => h.weight > 0 && h.weight < 0.2));
  ok('fallback carries sectors and countries', fbWorld.sectors.length > 5 && fbWorld.countries.length > 3);
  ok('fallback carries a TER', fbWorld.ter > 0 && fbWorld.ter < 0.01);
  ok('fallback source is marked', fbWorld.source === 'fallback');
  ok('fallback for unknown symbol is null', L.fallbackHoldings('AAPL') === null);
  // every alias points at a defined basket
  ok('all FUND_ALIASES resolve to a basket', Object.keys(L.FUND_ALIASES).every((k) => !!L.BASKETS[L.FUND_ALIASES[k]]));
  // basket holding weights stay plausible (top-10 of a fund < 100%)
  ok('all basket holdings sum below 1', Object.keys(L.BASKETS).every((b) =>
    L.BASKETS[b].holdings.reduce((s, h) => s + h[2], 0) < 1));

  // ---- isFundCandidate ------------------------------------------------------
  ok('candidate: known alias', L.isFundCandidate('VWCE.DE', '') === true);
  ok('candidate: UCITS in name', L.isFundCandidate('XYZ', 'Some MSCI ACWI UCITS ETF') === true);
  ok('candidate: issuer in name', L.isFundCandidate('ABC', 'iShares Core DAX') === true);
  ok('candidate: plain stock is not', L.isFundCandidate('AAPL', 'Apple Inc') === false);

  // ---- buildUrl -------------------------------------------------------------
  ok('buildUrl builds the fundholdings route', L.buildUrl('https://w.example.com', 'VWCE.DE') === 'https://w.example.com?action=fundholdings&symbol=VWCE.DE');
  ok('buildUrl strips trailing slashes', L.buildUrl('https://w.example.com///', 'X').indexOf('com?action') > -1);
  ok('buildUrl empty base → empty', L.buildUrl('', 'X') === '');
  ok('buildUrl empty symbol → empty', L.buildUrl('https://w.example.com', '') === '');

  // ---- parseHoldingsResponse ------------------------------------------------
  const pErr = L.parseHoldingsResponse({ error: 'Unknown action' });
  ok('parse flags an error payload (old Worker)', pErr.ok === false && /Unknown/.test(pErr.error));
  ok('parse on null → not ok', L.parseHoldingsResponse(null).ok === false);
  const pStock = L.parseHoldingsResponse({ symbol: 'AAPL', fund: false, holdings: [], sectors: [] });
  ok('parse fund:false is a valid non-fund answer', pStock.ok === true && pStock.fund === false && pStock.data === null);
  const pFund = L.parseHoldingsResponse({
    symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World', fund: true, ter: 0.0022,
    holdings: [
      { symbol: 'AAPL', name: 'Apple', weight: 0.04 },
      { symbol: null, name: 'Mystery Co', weight: 0.01 },
      { symbol: 'BAD', name: 'Bad', weight: -1 },
      { symbol: 'ZERO', name: 'Zero', weight: 'n/a' }
    ],
    sectors: [{ sector: 'Technology', weight: 0.25 }, { sector: '', weight: 0.5 }, { sector: 'Energy', weight: 0 }]
  });
  ok('parse normalises the fund symbol', pFund.data.symbol === 'VWCE');
  ok('parse keeps valid holdings, drops junk', pFund.data.holdings.length === 2 && pFund.data.holdings[1].name === 'Mystery Co');
  ok('parse keeps valid sectors only', pFund.data.sectors.length === 1 && pFund.data.sectors[0].sector === 'Technology');
  ok('parse keeps the TER', approx(pFund.data.ter, 0.0022));
  ok('parse marks worker source', pFund.data.source === 'worker');

  // ---- mergeFundData --------------------------------------------------------
  const merged = L.mergeFundData(pFund.data, L.fallbackHoldings('VWCE'));
  ok('merge keeps worker holdings', merged.holdings.length === 2 && merged.source === 'worker');
  ok('merge fills countries from fallback', Array.isArray(merged.countries) && merged.countries.length > 3);
  const workerNoTer = L.mergeFundData({ symbol: 'VWCE', holdings: pFund.data.holdings, sectors: [], ter: null, countries: null, source: 'worker' }, L.fallbackHoldings('VWCE'));
  ok('merge fills missing TER and sectors from fallback', workerNoTer.ter > 0 && workerNoTer.sectors.length > 5);
  ok('merge without worker data returns fallback', L.mergeFundData(null, L.fallbackHoldings('VWCE')).source === 'fallback');
  ok('merge without fallback returns worker data', L.mergeFundData(pFund.data, null) === pFund.data);

  // ---- positionRows (mirrors MaerminMetrics.computeStats semantics) --------
  const portfolio = {
    stocks: [
      { symbol: 'NVDA', name: 'Nvidia', amount: 10, purchasePrice: 100 },
      { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World UCITS ETF', amount: 50, purchasePrice: 90 }
    ],
    crypto: [{ symbol: 'BTC', name: 'Bitcoin', amount: 0.5, purchasePrice: 30000 }],
    skins: [],
    commodities: []
  };
  const prices = { NVDA: 120, 'VWCE.DE': 100, BTC: 40000 };
  const rows = L.positionRows(portfolio, prices);
  ok('positionRows flattens all classes', rows.length === 3);
  const M = require('../metrics.js');
  const statsTotal = M.computeStats(portfolio, prices).totalValue;
  const rowsTotal = rows.reduce((s, r) => s + r.valueEUR, 0);
  ok('positionRows total equals MaerminMetrics.computeStats total', approx(rowsTotal, statsTotal));
  ok('positionRows falls back to purchasePrice', L.positionRows({ stocks: [{ symbol: 'X', amount: 2, purchasePrice: 5 }] }, {})[0].valueEUR === 10);
  ok('positionRows drops zero-value rows', L.positionRows({ stocks: [{ symbol: 'X', amount: 0, purchasePrice: 5 }] }, {}).length === 0);

  // ---- analyze: synthetic two-fund portfolio --------------------------------
  // 1000 total: 200 NVDA direct, 500 FUNDA, 300 FUNDB.
  // FUNDA holds NVDA 10%, AAPL 5% (coverage 15%). FUNDB holds NVDA 20%, MSFT 10%.
  const aRows = [
    { symbol: 'NVDA', name: 'Nvidia', cls: 'stocks', valueEUR: 200 },
    { symbol: 'FUNDA.DE', name: 'Fund A UCITS ETF', cls: 'stocks', valueEUR: 500 },
    { symbol: 'FUNDB', name: 'Fund B ETF', cls: 'stocks', valueEUR: 300 }
  ];
  const holdingsMap = {
    FUNDA: {
      symbol: 'FUNDA', name: 'Fund A', ter: 0.002, source: 'worker',
      holdings: [
        { symbol: 'NVDA', name: 'Nvidia', weight: 0.10 },
        { symbol: 'AAPL', name: 'Apple', weight: 0.05 }
      ],
      sectors: [{ sector: 'Technology', weight: 0.6 }, { sector: 'Healthcare', weight: 0.2 }],
      countries: [{ country: 'USA', weight: 0.8 }, { country: 'Germany', weight: 0.1 }]
    },
    FUNDB: {
      symbol: 'FUNDB', name: 'Fund B', ter: null, source: 'fallback',
      holdings: [
        { symbol: 'NVDA', name: 'Nvidia', weight: 0.20 },
        { symbol: 'MSFT', name: 'Microsoft', weight: 0.10 }
      ],
      sectors: [{ sector: 'Technology', weight: 1.0 }],
      countries: null
    }
  };
  const getMeta = (sym) => {
    const m = { NVDA: { sector: 'Technology', country: 'USA' }, AAPL: { sector: 'Technology', country: 'USA' }, MSFT: { sector: 'Technology', country: 'USA' } };
    return m[String(sym).toUpperCase()] || null;
  };
  const r = L.analyze(aRows, holdingsMap, { getMeta });

  ok('analyze is available with data', r.available === true);
  ok('analyze totals the portfolio', approx(r.totalValue, 1000));
  ok('analyze finds both funds', r.funds.length === 2 && r.funds[0].symbol === 'FUNDA');
  ok('analyze fund weights', approx(r.funds[0].weight, 0.5) && approx(r.funds[1].weight, 0.3));
  ok('analyze fund coverage', approx(r.funds[0].coverage, 0.15) && approx(r.funds[1].coverage, 0.30));
  ok('analyze keeps fund TER and source', r.funds[0].ter === 0.002 && r.funds[1].source === 'fallback');

  // Effective NVDA = 20% direct + 50%*10% + 30%*20% = 31%
  const nvda = r.effectiveExposure.find((x) => x.key === 'NVDA');
  ok('effective exposure aggregates direct + funds', nvda && approx(nvda.effectiveWeight, 0.31));
  ok('effective exposure splits direct vs funded', approx(nvda.directWeight, 0.20) && approx(nvda.fundedWeight, 0.11));
  ok('effective exposure lists contributing funds', nvda.via.length === 2 && nvda.via[0].fund === 'FUNDB');
  ok('effective exposure value in EUR', approx(nvda.valueEUR, 310));
  ok('effective exposure sorted desc', r.effectiveExposure[0].key === 'NVDA');
  const aapl = r.effectiveExposure.find((x) => x.key === 'AAPL');
  ok('fund-only security appears with no direct weight', aapl && aapl.directWeight === 0 && approx(aapl.fundedWeight, 0.025));

  // Sector look-through: NVDA direct 20% Tech + FUNDA 50%*(60% Tech, 20% Health, 20% other) + FUNDB 30%*100% Tech
  const tech = r.sectorExposure.find((s) => s.sector === 'Technology');
  const health = r.sectorExposure.find((s) => s.sector === 'Healthcare');
  const otherSector = r.sectorExposure.find((s) => s.sector === 'Other');
  ok('sector look-through aggregates funds + direct', tech && approx(tech.weight, 0.20 + 0.30 + 0.30));
  ok('sector look-through keeps fund sector split', health && approx(health.weight, 0.10));
  ok('sector look-through buckets the unexplained rest', otherSector && approx(otherSector.weight, 0.10));
  ok('sector weights sum to 1', approx(r.sectorExposure.reduce((s, x) => s + x.weight, 0), 1));

  // Country: NVDA direct USA 20% + FUNDA explicit (USA 40%, Germany 5%, other 5%)
  // + FUNDB via holding metadata (NVDA 20% + MSFT 10% → USA 9%, other 21%)
  const usa = r.countryExposure.find((c) => c.country === 'USA');
  const ger = r.countryExposure.find((c) => c.country === 'Germany');
  ok('country look-through uses explicit fund split', usa && approx(usa.weight, 0.20 + 0.40 + 0.09));
  ok('country look-through includes minor countries', ger && approx(ger.weight, 0.05));
  ok('country weights sum to 1', approx(r.countryExposure.reduce((s, x) => s + x.weight, 0), 1));

  // Currency approximation follows countries (USA→USD, Germany→EUR)
  const usd = r.currencyExposure.find((c) => c.currency === 'USD');
  const eur = r.currencyExposure.find((c) => c.currency === 'EUR');
  ok('currency look-through maps countries', usd && approx(usd.weight, 0.69) && eur && approx(eur.weight, 0.05));

  // Overlap: min(10%,20%) NVDA = 10% — the only shared holding.
  ok('overlap pairs detected', r.overlapPairs.length === 1);
  ok('overlap = sum of min weights of shared holdings', approx(r.overlapPairs[0].overlap, 0.10));
  ok('overlap lists the shared securities', r.overlapPairs[0].shared[0].key === 'NVDA');

  // Hidden concentrations: NVDA 31% effective (>= 5%, partly via funds).
  ok('hidden concentration flags NVDA', r.hiddenConcentrations.length === 1 && r.hiddenConcentrations[0].key === 'NVDA');
  ok('hidden concentration names the funds', r.hiddenConcentrations[0].funds.indexOf('FUNDA') > -1 && r.hiddenConcentrations[0].funds.indexOf('FUNDB') > -1);

  // Coverage: direct 200 + 500*0.15 + 300*0.30 = 365 → 36.5%
  ok('coverage reflects disclosed holdings only', approx(r.coverage, 0.365));

  // ---- analyze edge cases ----------------------------------------------------
  const empty = L.analyze([], {}, {});
  ok('analyze on empty portfolio degrades', empty.available === false && empty.totalValue === 0);
  const noFunds = L.analyze([{ symbol: 'AAPL', name: 'Apple', cls: 'stocks', valueEUR: 100 }], {}, { getMeta });
  ok('analyze without funds still exposes direct positions', noFunds.available === true && noFunds.funds.length === 0 && noFunds.effectiveExposure[0].key === 'AAPL');
  ok('analyze without funds has full coverage', approx(noFunds.coverage, 1));
  ok('analyze without funds finds no hidden concentration', noFunds.hiddenConcentrations.length === 0);
  const thresholded = L.analyze(aRows, holdingsMap, { getMeta, concentrationThreshold: 0.5 });
  ok('analyze respects a custom concentration threshold', thresholded.hiddenConcentrations.length === 0);

  // ---- loadFundData (injectable fetch; shared by X-Ray + cost analysis) ----
  // Each scenario uses unique symbols because the loader keeps a session cache.
  function jsonResponse(status, body) {
    return Promise.resolve({ status: status, json: function () { return Promise.resolve(body); } });
  }
  const fetchOk = (url) => jsonResponse(200, {
    symbol: 'LIVEFUND', name: 'Live Fund', fund: true, ter: 0.003,
    holdings: [{ symbol: 'AAPL', name: 'Apple', weight: 0.05 }], sectors: []
  });
  const fetchOld = () => jsonResponse(400, { error: 'Unknown action' });
  const fetchBoom = () => Promise.reject(new Error('network down'));

  const pLive = L.loadFundData('https://w.example.com', ['LIVEFUND'], { fetchImpl: fetchOk })
    .then((out) => {
      ok('loadFundData returns worker data keyed by root', out.holdings.LIVEFUND && out.holdings.LIVEFUND.ter === 0.003);
      ok('loadFundData live path is not unsupported', out.unsupported === false);
    });
  const pOld = L.loadFundData('https://w.example.com', ['VWCE.DE'], { fetchImpl: fetchOld })
    .then((out) => {
      ok('loadFundData flags an older Worker', out.unsupported === true);
      ok('loadFundData falls back to the snapshot', out.holdings.VWCE && out.holdings.VWCE.source === 'fallback');
    });
  const pBoom = L.loadFundData('https://w.example.com', ['EUNL.DE', 'NOFALLBACK1'], { fetchImpl: fetchBoom })
    .then((out) => {
      ok('loadFundData survives a network failure via fallback', out.holdings.EUNL && out.holdings.EUNL.source === 'fallback');
      ok('loadFundData omits symbols with no data at all', !out.holdings.NOFALLBACK1);
    });
  const pNoBase = L.loadFundData('', ['CSPX.L'], { fetchImpl: () => { throw new Error('must not fetch'); } })
    .then((out) => {
      ok('loadFundData without a base never fetches, snapshot answers', out.holdings.CSPX && out.holdings.CSPX.source === 'fallback');
    });
  let cacheCalls = 0;
  const fetchCount = () => { cacheCalls++; return jsonResponse(200, { symbol: 'CACHED1', fund: true, ter: 0.001, holdings: [{ symbol: 'X', name: 'X', weight: 0.1 }], sectors: [] }); };
  const pCache = L.loadFundData('https://w.example.com', ['CACHED1'], { fetchImpl: fetchCount })
    .then(() => L.loadFundData('https://w.example.com', ['CACHED1'], { fetchImpl: fetchCount }))
    .then((out) => {
      ok('loadFundData caches per session (one fetch for two calls)', cacheCalls === 1);
      ok('loadFundData cached result is served', out.holdings.CACHED1 && out.holdings.CACHED1.ter === 0.001);
    });

  // ---- advisor integration (bundle.lookThrough findings) --------------------
  const A = require('../advisor.js');
  const withLT = A.analyzeFromMetrics({ lookThrough: r });
  const ltFinding = withLT.findings.find((f) => f.category === 'Look-through');
  ok('advisor surfaces a look-through finding', !!ltFinding);
  ok('advisor look-through finding is critical at >= 10% hidden weight', ltFinding.severity === 'critical');
  ok('advisor look-through finding names the security and funds', /Nvidia|NVDA/.test(ltFinding.title) && /FUNDA/.test(ltFinding.detail));
  const noLT = A.analyzeFromMetrics({});
  ok('advisor without look-through bundle stays silent', noLT.findings.every((f) => f.category !== 'Look-through'));
  const calm = A.analyzeFromMetrics({ lookThrough: { available: true, hiddenConcentrations: [] } });
  ok('advisor with clean look-through adds no finding', calm.findings.every((f) => f.category !== 'Look-through'));

  // The loader scenarios resolve asynchronously — settle them before the verdict.
  Promise.all([pLive, pOld, pBoom, pNoBase, pCache])
    .catch((err) => { ok('async loader scenarios settle without throwing', false); console.error('  ' + err.message); })
    .then(() => {
      console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
      process.exit(failed ? 1 : 0);
    });
})();
