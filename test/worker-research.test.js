// P5-5.4: the Worker's research route - key figures, analyst ratings and
// targets, EPS actual vs estimate and the company profile from one Yahoo
// quoteSummary call, cached. Market data only (no user data), so the shared
// price Worker serves it too.
// Run: node test/worker-research.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail).slice(0, 400) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  const upstream = [], puts = [];
  globalThis.caches = { default: { match: async () => undefined, put: async (k) => { puts.push(String(k.url || k)); } } };
  const R = (v) => ({ raw: v, fmt: String(v) });
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push(u);
    if (/quoteSummary\/AAPL/.test(u)) {
      return new Response(JSON.stringify({ quoteSummary: { result: [{
        price: { shortName: 'Apple Inc.', currency: 'USD', regularMarketPrice: R(250) },
        summaryDetail: { marketCap: R(3.8e12), trailingPE: R(38.2), forwardPE: R(31.5), beta: R(1.2), fiftyTwoWeekHigh: R(260), fiftyTwoWeekLow: R(170), dividendYield: R(0.004), payoutRatio: R(0.15), priceToSalesTrailing12Months: R(9.1) },
        defaultKeyStatistics: { pegRatio: R(2.4), priceToBook: R(55) },
        financialData: { targetMeanPrice: R(270), targetHighPrice: R(320), targetLowPrice: R(200), targetMedianPrice: R(275), recommendationKey: 'buy', recommendationMean: R(2.0), numberOfAnalystOpinions: R(41),
          totalRevenue: R(4.0e11), revenueGrowth: R(0.06), grossMargins: R(0.46), operatingMargins: R(0.31), profitMargins: R(0.25), returnOnEquity: R(1.5), debtToEquity: R(150), freeCashflow: R(1.0e11) },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 12, buy: 20, hold: 8, sell: 1, strongSell: 0 }, { period: '-1m', strongBuy: 11, buy: 21, hold: 8, sell: 1, strongSell: 0 }] },
        earnings: { earningsChart: { quarterly: [{ date: '3Q2025', actual: R(1.65), estimate: R(1.6) }, { date: '4Q2025', actual: R(2.4), estimate: R(2.35) }] } },
        assetProfile: { sector: 'Technology', industry: 'Consumer Electronics', country: 'United States', website: 'https://www.apple.com', fullTimeEmployees: 164000, longBusinessSummary: 'A'.repeat(2000) }
      }] } }), { status: 200 });
    }
    if (/quoteSummary\/NONE/.test(u)) return new Response(JSON.stringify({ quoteSummary: { result: null, error: { code: 'Not Found' } } }), { status: 404 });
    return new Response('', { status: 500 });
  };
  const call = async (q, env) => {
    const r = await worker.fetch(new Request('https://maermin-test.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '203.0.113.40' } }), env || {}, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  console.log('worker research:');
  ok('listed in WORKER_ACTIONS and served by the shared price Worker', W.WORKER_ACTIONS.includes('research') && W.PRICE_ONLY_ACTIONS.includes('research'));
  const r = await call('action=research&symbol=AAPL');
  const b = r.body;
  ok('one quoteSummary call with the research modules', r.status === 200 && upstream.length === 1 && /modules=.*financialData.*recommendationTrend.*earnings.*assetProfile/.test(decodeURIComponent(upstream[0])), upstream);
  ok('name, currency, price', b.name === 'Apple Inc.' && b.currency === 'USD' && b.price === 250);
  ok('valuation: market cap, P/E, forward P/E, PEG, P/B, P/S, beta, 52-week range', b.valuation.marketCap === 3.8e12 && b.valuation.trailingPE === 38.2 && b.valuation.forwardPE === 31.5 && b.valuation.peg === 2.4
    && b.valuation.priceToBook === 55 && b.valuation.priceToSales === 9.1 && b.valuation.beta === 1.2 && b.valuation.high52 === 260 && b.valuation.low52 === 170, b.valuation);
  ok('analysts: count, consensus, targets and the rating trend', b.analysts.count === 41 && b.analysts.recommendationKey === 'buy' && b.analysts.targetMean === 270 && b.analysts.targetHigh === 320
    && b.analysts.targetLow === 200 && b.analysts.trend[0].strongBuy === 12 && b.analysts.trend.length === 2, b.analysts);
  ok('financials: revenue, growth, margins, ROE, debt/equity, free cash flow', b.financials.revenue === 4e11 && b.financials.grossMargins === 0.46 && b.financials.freeCashflow === 1e11, b.financials);
  ok('EPS: actual vs estimate per quarter', b.earnings.length === 2 && b.earnings[1].quarter === '4Q2025' && b.earnings[1].actual === 2.4 && b.earnings[1].estimate === 2.35, b.earnings);
  ok('profile, the summary cut to 600 characters', b.profile.sector === 'Technology' && b.profile.country === 'United States' && b.profile.summary.length <= 601 && b.profile.employees === 164000, b.profile);
  ok('the source is named; the answer is cached', b.source === 'Yahoo Finance' && puts.some((k) => /research\/AAPL/.test(k)));
  ok('unknown symbol: 404', (await call('action=research&symbol=NONE')).status === 404);
  ok('no symbol: 400', (await call('action=research')).status === 400);
  ok('a CS2 item name is not sent upstream', (await call('action=research&symbol=' + encodeURIComponent('AK-47 | Redline (Field-Tested)'))).status === 400);
  const shared = await call('action=research&symbol=AAPL', { PRICE_ONLY: '1' });
  ok('the shared price Worker answers it (market data only)', shared.status === 200 && shared.body.name === 'Apple Inc.');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
