// ISIN -> ticker on import (MaerminImportMapping): detection, listing choice by
// trade currency, preview rewrite, Worker lookup with an injected fetch.
// Run: node test/import-isin.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

const M = require('../import-mapping.js');

(async function run() {
  console.log('isISIN:');
  ok('Apple', M.isISIN('US0378331005'));
  ok('VWCE', M.isISIN('IE00BK5BQT80'));
  ok('SAP, lower case + spaces', M.isISIN(' de0007164600 '));
  ok('wrong check digit rejected', !M.isISIN('US0378331006'));
  ok('tickers are not ISINs', !M.isISIN('AAPL') && !M.isISIN('VWCE.DE') && !M.isISIN('BRK-B'));
  ok('12 chars but not ISIN shaped', !M.isISIN('123456789012') && !M.isISIN('ABCDEFGHIJKL'));
  ok('empty / null', !M.isISIN('') && !M.isISIN(null));

  console.log('listingCurrency:');
  ok('no suffix = USD', M.listingCurrency('AAPL') === 'USD');
  ok('.DE / .F / .PA = EUR', M.listingCurrency('APC.DE') === 'EUR' && M.listingCurrency('APC.F') === 'EUR' && M.listingCurrency('MC.PA') === 'EUR');
  ok('.L = GBP, .SW = CHF', M.listingCurrency('SHEL.L') === 'GBP' && M.listingCurrency('NESN.SW') === 'CHF');
  ok('unknown suffix = null', M.listingCurrency('X.ZZ') === null);
  ok('class shares keep USD (BRK-B)', M.listingCurrency('BRK-B') === 'USD');

  console.log('pickListing:');
  const apple = [
    { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NMS', score: 100 },
    { symbol: 'APC.F', name: 'Apple Inc.', exchange: 'FRA', score: 60 },
    { symbol: 'APC.DE', name: 'Apple Inc.', exchange: 'GER', score: 40 },
    { symbol: 'AAPL.MX', name: 'Apple Inc.', exchange: 'MEX', score: 30 }
  ];
  ok('USD trade -> US listing', M.pickListing(apple, 'USD').symbol === 'AAPL');
  const eur = M.pickListing(apple, 'EUR');
  ok('EUR trade -> Xetra, even with a lower score than Frankfurt', eur.symbol === 'APC.DE' && eur.currency === 'EUR' && eur.currencyMismatch === false);
  const gbp = M.pickListing(apple, 'GBP');
  ok('no listing in the trade currency -> best score, flagged', gbp.symbol === 'AAPL' && gbp.currencyMismatch === true);
  ok('default trade currency is EUR', M.pickListing(apple).symbol === 'APC.DE');
  ok('no candidates -> null', M.pickListing([], 'EUR') === null && M.pickListing(null, 'EUR') === null);
  ok('name carried', eur.name === 'Apple Inc.');

  console.log('collectIsins:');
  const txs = [
    { type: 'buy', symbol: 'US0378331005', quantity: 12, price: 1234.56, currency: 'USD', date: '2024-03-10' },
    { type: 'sell', symbol: 'US0378331005', quantity: 2, price: 1300, currency: 'USD', date: '2024-03-11' },
    { type: 'buy', symbol: 'US0378331005', quantity: 1, price: 150, currency: 'EUR', date: '2024-03-12' },
    { type: 'buy', symbol: 'IE00BK5BQT80', quantity: 5, price: 110, currency: 'EUR', date: '2024-03-12' },
    { type: 'buy', symbol: 'KO', quantity: 5, price: 60, currency: 'USD', date: '2024-03-12' }
  ];
  const isins = M.collectIsins(txs);
  ok('distinct ISINs only', isins.length === 2 && isins.map((x) => x.isin).sort().join() === 'IE00BK5BQT80,US0378331005');
  ok('most used trade currency per ISIN', isins.find((x) => x.isin === 'US0378331005').currency === 'USD');
  ok('no ISINs -> []', M.collectIsins([{ symbol: 'AAPL' }]).length === 0);

  console.log('applyTickerMap:');
  const prev = { transactions: txs.map((t) => Object.assign({ category: 'stocks', fees: 0 }, t)), errors: [], stats: { total: 5, ok: 5, failed: 0, duplicates: 0 } };
  const existing = [
    { type: 'buy', symbol: 'US0378331005', quantity: 12, price: 1234.56, date: '2024-03-10' }, // imported before, ISIN as symbol
    { type: 'buy', symbol: 'VWCE.DE', quantity: 5, price: 110, date: '2024-03-12' }
  ];
  const out = M.applyTickerMap(prev, { US0378331005: { symbol: 'aapl', name: 'Apple Inc.' }, IE00BK5BQT80: 'VWCE.DE' }, existing);
  ok('symbol replaced, ISIN kept, name set', out.transactions[0].symbol === 'AAPL' && out.transactions[0].isin === 'US0378331005' && out.transactions[0].symbolName === 'Apple Inc.');
  ok('string picks work', out.transactions[3].symbol === 'VWCE.DE' && out.transactions[3].isin === 'IE00BK5BQT80');
  ok('non-ISIN rows untouched', out.transactions[4].symbol === 'KO' && out.transactions[4].isin === undefined);
  ok('duplicate found via the old ISIN-as-symbol row', out.transactions[0].duplicate === true);
  ok('duplicate found via the ticker', out.transactions[3].duplicate === true);
  ok('other rows are not duplicates', out.transactions[1].duplicate === false && out.transactions[4].duplicate === false);
  ok('stats', out.stats.isinMapped === 4 && out.stats.isinUnresolved === 0 && out.stats.duplicates === 2 && out.stats.ok === 5);
  ok('input preview not mutated', prev.transactions[0].symbol === 'US0378331005' && prev.stats.duplicates === 0);

  const partial = M.applyTickerMap(prev, { IE00BK5BQT80: 'VWCE.DE' }, []);
  ok('unresolved ISIN stays, flagged', partial.transactions[0].symbol === 'US0378331005' && partial.transactions[0].unresolvedIsin === true && partial.stats.isinUnresolved === 3);
  ok('an ISIN typed as the ticker is not accepted', M.applyTickerMap(prev, { US0378331005: 'US0378331005', IE00BK5BQT80: 'VWCE.DE' }, []).stats.isinUnresolved === 3);
  const again = M.applyTickerMap(out, { US0378331005: 'APC.DE', IE00BK5BQT80: 'VWCE.DE' }, []);
  ok('re-mapping an already mapped preview works off the stored ISIN', again.transactions[0].symbol === 'APC.DE' && again.transactions[0].isin === 'US0378331005');
  const commit = M.commit(out);
  ok('commit keeps isin, drops duplicates', commit.transactions.length === 3 && commit.transactions.every((t) => t.duplicate === undefined) && commit.transactions[0].isin === 'US0378331005');

  console.log('resolveIsins:');
  const calls = [];
  const fakeFetch = (url) => { calls.push(url); if (/IE00BK5BQT80/.test(url)) return Promise.reject(new Error('net')); return Promise.resolve({ ok: true, json: () => Promise.resolve(apple) }); };
  const res = await M.resolveIsins(isins, { workerBase: 'https://w.example/', fetch: fakeFetch });
  ok('one Worker search per ISIN', calls.length === 2 && calls.every((u) => u.indexOf('https://w.example?action=yfsearch&q=') === 0 && /&type=stock$/.test(u)));
  ok('candidates returned', res.US0378331005.length === 4);
  ok('a failed lookup yields [] and does not reject', Array.isArray(res.IE00BK5BQT80) && res.IE00BK5BQT80.length === 0);
  const none = await M.resolveIsins(isins, { workerBase: '', fetch: fakeFetch });
  ok('no Worker URL -> no requests, empty candidates', calls.length === 2 && none.US0378331005.length === 0);
  const bad = await M.resolveIsins(['US0378331005'], { workerBase: 'https://w.example', fetch: () => Promise.resolve({ ok: false }) });
  ok('HTTP error -> []', bad.US0378331005.length === 0);

  console.log('end to end (Trade Republic sample):');
  const csv = 'Date;Type;ISIN;Shares;Price;Fee;Currency\n10.03.2024;Kauf;US0378331005;12;1.234,56;1,00;USD\n11.03.2024;Verkauf;US0378331005;2;1.300,00;1,00;USD';
  const p0 = M.preview(csv, { existing: [] });
  const found = M.collectIsins(p0.transactions);
  const cand = await M.resolveIsins(found, { workerBase: 'https://w.example', fetch: fakeFetch });
  const map = {}; found.forEach((f) => { map[f.isin] = M.pickListing(cand[f.isin], f.currency); });
  const p1 = M.applyTickerMap(p0, map, []);
  ok('the sample imports as AAPL (USD trade -> US listing)', p1.transactions.length === 2 && p1.transactions.every((t) => t.symbol === 'AAPL' && t.isin === 'US0378331005'), JSON.stringify(p1.transactions.map((t) => t.symbol)));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
