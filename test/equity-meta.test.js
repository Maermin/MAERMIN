// Node harness for the equity metadata service (sector/country resolution).
// Run: node test/equity-meta.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.window = {};
globalThis.localStorage = {
  _d: {}, getItem(k){ return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null; },
  setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; }
};
// ticker-validation provides normalizeForDividends used by the meta service.
const Tickers = require('../ticker-validation.js');
globalThis.window.MaerminTickers = Tickers;
const Meta = require('../equity-metadata.js');

(function run() {
  console.log('static resolution:');
  ok('US tech stock → Technology / USA', (() => { const m = Meta.getMeta('AAPL'); return m.sector === 'Technology' && m.country === 'USA'; })());
  ok('German stock (Xetra suffix) → Germany', Meta.getMeta('SAP.DE').country === 'Germany');
  ok('share-class normalises (BRK.B → BRK-B) → Financials/USA', (() => { const m = Meta.getMeta('BRK.B'); return m.sector === 'Financials' && m.country === 'USA'; })());
  ok('lowercase symbol still resolves', Meta.getMeta('aapl').sector === 'Technology');
  ok('unknown ticker → Other/Other, source unknown', (() => { const m = Meta.getMeta('ZZZZ'); return m.sector === 'Other' && m.country === 'Other' && m.source === 'unknown'; })());

  console.log('cache:');
  Meta.saveToCache('ZZZZ', { sector: 'Healthcare', country: 'Canada' });
  ok('cached value takes precedence over static/unknown', (() => { const m = Meta.getMeta('ZZZZ'); return m.sector === 'Healthcare' && m.country === 'Canada' && m.source === 'cache'; })());
  ok('cache keyed by normalized ticker', Meta.getFromCache('zzzz'.toUpperCase()) !== null);

  console.log('label normalisation (Worker/FMP → app buckets):');
  ok('Yahoo "Financial Services" → Financials', Meta.sectorName('Financial Services') === 'Financials');
  ok('Yahoo "Consumer Cyclical" → Consumer Discretionary', Meta.sectorName('Consumer Cyclical') === 'Consumer Discretionary');
  ok('Yahoo "Consumer Defensive" → Consumer Staples', Meta.sectorName('Consumer Defensive') === 'Consumer Staples');
  ok('unmapped sector passes through', Meta.sectorName('Technology') === 'Technology');
  ok('country full name "United States" → USA', Meta.countryName('United States') === 'USA');
  ok('country ISO "DE" → Germany', Meta.countryName('DE') === 'Germany');
  ok('country ISO "DK" → Denmark', Meta.countryName('DK') === 'Denmark');

  console.log('expanded static coverage:');
  ok('NVO → Healthcare / Denmark', (() => { const m = Meta.getMeta('NVO'); return m.sector === 'Healthcare' && m.country === 'Denmark'; })());
  ok('CHKP → Technology / Israel', (() => { const m = Meta.getMeta('CHKP'); return m.sector === 'Technology' && m.country === 'Israel'; })());
  ok('KHC → Consumer Staples / USA', (() => { const m = Meta.getMeta('KHC'); return m.sector === 'Consumer Staples' && m.country === 'USA'; })());
  ok('VWCE → ETF / Global', (() => { const m = Meta.getMeta('VWCE'); return m.sector === 'ETF' && m.country === 'Global'; })());

  console.log('prefetch without API key:');
  Meta.prefetchPortfolio({ stocks: [{ symbol: 'AAPL' }, { symbol: 'XYZ' }] }).then((n) => {
    ok('no key → resolves 0 (static still applies)', n === 0);
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
})();
