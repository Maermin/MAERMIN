// Node harness for the Asset Discovery pure layer: response parsing, EUR
// conversion at ingestion, filtering, sorting, the dividend screen, and URL
// building. The React View is browser-only and covered by smoke-views.
// Run: node test/discovery.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const D = require('../discovery.js');
const U = require('../utils.js');

(function run() {
  console.log('discovery:');

  // ---- normalizeRow --------------------------------------------------------
  const good = D.normalizeRow({ symbol: 'AAPL', name: 'Apple', price: 190, currency: 'USD', changePercent: 1.5, marketCap: 3e12, dividendYield: 0.005, type: 'EQUITY', volume: 1000 });
  ok('normalizeRow keeps a valid row', good && good.symbol === 'AAPL' && good.price === 190);
  ok('normalizeRow coerces numbers', good.changePercent === 1.5 && good.marketCap === 3e12);
  ok('normalizeRow drops rows without a symbol', D.normalizeRow({ price: 10 }) === null);
  ok('normalizeRow drops non-positive price', D.normalizeRow({ symbol: 'X', price: 0 }) === null);
  ok('normalizeRow defaults name to symbol', D.normalizeRow({ symbol: 'X', price: 1 }).name === 'X');
  ok('normalizeRow null-ifies junk numbers', D.normalizeRow({ symbol: 'X', price: 1, marketCap: 'n/a' }).marketCap === null);

  // ---- parseResponse -------------------------------------------------------
  const pErr = D.parseResponse({ error: 'unknown action' });
  ok('parseResponse flags an error payload', pErr.ok === false && /unknown/.test(pErr.error));
  ok('parseResponse on null → not ok', D.parseResponse(null).ok === false);
  const pEmpty = D.parseResponse({ quotes: [] });
  ok('parseResponse empty quotes is ok+empty', pEmpty.ok === true && pEmpty.rows.length === 0);
  const pMix = D.parseResponse({ quotes: [{ symbol: 'A', price: 5 }, { price: 9 }, { symbol: 'B', price: -1 }, { symbol: 'C', price: 12 }] });
  ok('parseResponse drops invalid rows', pMix.ok === true && pMix.rows.length === 2 && pMix.rows[0].symbol === 'A' && pMix.rows[1].symbol === 'C');

  // ---- toEURRow (EUR canonical at ingestion) -------------------------------
  const eur = D.toEURRow({ symbol: 'A', name: 'A', price: 100, currency: 'USD', marketCap: 1000, dividendYield: 0.03 }, 0.9);
  ok('toEURRow converts USD price', approx(eur.priceEUR, 90));
  ok('toEURRow converts USD market cap', approx(eur.marketCapEUR, 900));
  ok('toEURRow leaves original price intact', eur.price === 100);
  ok('toEURRow mirrors MaerminUtils.toEUR exactly', approx(eur.priceEUR, U.toEUR(100, 'USD', 0.9)));
  const eurNative = D.toEURRow({ symbol: 'B', name: 'B', price: 50, currency: 'EUR', marketCap: null, dividendYield: null }, 0.9);
  ok('toEURRow leaves EUR untouched', eurNative.priceEUR === 50);
  ok('toEURRow keeps null market cap null', eurNative.marketCapEUR === null);

  // ---- applyFilters (on EUR values) ----------------------------------------
  const rows = [
    D.toEURRow({ symbol: 'AAA', name: 'Alpha', price: 10, currency: 'EUR', marketCap: 5e9, changePercent: 2 }, 1),
    D.toEURRow({ symbol: 'BBB', name: 'Beta', price: 200, currency: 'EUR', marketCap: 1e8, changePercent: -3 }, 1),
    D.toEURRow({ symbol: 'CCC', name: 'Gamma', price: 50, currency: 'EUR', marketCap: 2e10, changePercent: 8 }, 1)
  ];
  ok('applyFilters minPrice', D.applyFilters(rows, { minPrice: 40 }).length === 2);
  ok('applyFilters maxPrice', D.applyFilters(rows, { maxPrice: 60 }).length === 2);
  ok('applyFilters minMarketCap', D.applyFilters(rows, { minMarketCap: 1e9 }).length === 2);
  ok('applyFilters minChange', D.applyFilters(rows, { minChange: 0 }).length === 2);
  ok('applyFilters query matches symbol or name', D.applyFilters(rows, { query: 'gam' }).length === 1 && D.applyFilters(rows, { query: 'BBB' }).length === 1);
  ok('applyFilters empty opts keeps all', D.applyFilters(rows, {}).length === 3);

  // ---- sortRows ------------------------------------------------------------
  const byChgDesc = D.sortRows(rows, 'changePercent', 'desc');
  ok('sortRows desc by change', byChgDesc[0].symbol === 'CCC' && byChgDesc[2].symbol === 'BBB');
  const byChgAsc = D.sortRows(rows, 'changePercent', 'asc');
  ok('sortRows asc by change', byChgAsc[0].symbol === 'BBB');
  ok('sortRows by symbol', D.sortRows(rows, 'symbol', 'asc')[0].symbol === 'AAA');
  const withNull = D.sortRows([{ marketCapEUR: 5 }, { marketCapEUR: null }, { marketCapEUR: 9 }], 'marketCapEUR', 'desc');
  ok('sortRows pushes nulls last', withNull[0].marketCapEUR === 9 && withNull[2].marketCapEUR === null);
  ok('sortRows unknown key returns a copy', D.sortRows(rows, 'bogus', 'desc').length === 3);

  // ---- dividendScreen ------------------------------------------------------
  const divRows = [
    { symbol: 'D1', dividendYield: 0.05 }, { symbol: 'D2', dividendYield: null },
    { symbol: 'D3', dividendYield: 0.01 }, { symbol: 'D4', dividendYield: 0.03 }
  ];
  const screened = D.dividendScreen(divRows, { minYield: 0.02 });
  ok('dividendScreen filters by minYield', screened.length === 2);
  ok('dividendScreen sorts by yield desc', screened[0].symbol === 'D1' && screened[1].symbol === 'D4');
  ok('dividendScreen drops null yields', screened.every((r) => r.dividendYield != null));

  // ---- buildUrl ------------------------------------------------------------
  ok('buildUrl scrId mode', D.buildUrl('https://w.example.com', { scrId: 'day_gainers', count: 25 }) === 'https://w.example.com?action=screener&scrId=day_gainers&count=25');
  ok('buildUrl symbols mode joins array', D.buildUrl('https://w.example.com/', { symbols: ['KO', 'PG'] }) === 'https://w.example.com?action=screener&symbols=KO%2CPG');
  ok('buildUrl strips trailing slashes', D.buildUrl('https://w.example.com///', { scrId: 'x' }).indexOf('com?action') > -1);
  ok('buildUrl empty base → empty', D.buildUrl('', { scrId: 'x' }) === '');

  // ---- catalogue sanity ----------------------------------------------------
  ok('MOVERS has gainers/losers/actives', D.MOVERS.length === 3 && D.MOVERS.every((m) => m.scrId));
  ok('DIVIDEND_UNIVERSE is non-empty symbols', D.DIVIDEND_UNIVERSE.length > 0 && D.DIVIDEND_UNIVERSE.every((s) => typeof s === 'string'));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
