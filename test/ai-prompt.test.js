// Node harness for the AI copy-prompt export (P4-5).
// Run: node test/ai-prompt.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }

const AI = require('../ai-prompt.js');
const S = require('../share-snapshot.js');

// A book with distinctive symbols, names, amounts and private fields everywhere.
const portfolio = {
  stocks: [
    { symbol: 'ZQXW', symbolName: 'Zebraquux Holdings', amount: 37, purchasePrice: 81.23, totalCostEUR: 3005.51, notes: 'SECRET-NOTE-1', apiKey: 'sk-LEAK-1' },
    { symbol: 'VWCE.DE', symbolName: 'Vanguard FTSE All-World', amount: 12, purchasePrice: 104.5, totalCostEUR: 1254 }
  ],
  crypto: [{ symbol: 'BTC', symbolName: 'Bitcoin', amount: 0.4217, purchasePrice: 23456.7, totalCostEUR: 9891.69, journal: 'SECRET-JOURNAL' }],
  options: [{ symbol: 'OPTX', amount: 3, purchasePrice: 2 }]
};
const prices = { ZQXW: 99.87, 'VWCE.DE': 117.33, btc: 61234.56 };
const inputs = S.gatherInputs(portfolio, prices, []);
inputs.sectorWeights = [{ name: 'Technology', pct: 71.25 }, { name: 'Financial Services', pct: 28.75 }];
inputs.regionWeights = [{ name: 'United States', pct: 64 }, { name: 'Germany', pct: 36 }];
inputs.currencyRows = [{ currency: 'EUR', pct: 55.5 }, { currency: 'USD', pct: 44.5 }];
inputs.healthScore = 73; inputs.effectiveN = 2.4;
const snapshot = S.buildSnapshot(inputs);

console.log('redacted level (share-snapshot allowlist):');
{
  const txt = AI.redactedText(snapshot);
  ok('builds a text', typeof txt === 'string' && txt.length > 50);
  ok('has class, sector, country, currency weights and the scores', /Asset classes: /.test(txt) && /Technology 71\.3%|Technology 71\.2%/.test(txt) && /United States 64\.0%/.test(txt) && /USD 44\.5%/.test(txt) && /73 of 100/.test(txt) && /holdings: 2\.4/.test(txt), txt);
  const leaks = ['ZQXW', 'Zebraquux', 'VWCE', 'Vanguard', 'Bitcoin', 'BTC', 'OPTX', '37', '81.23', '3,005', '3005', '99.87', '0.4217', '61,234', '61234', '9,891', 'SECRET', 'sk-LEAK', '€']
    .filter(x => txt.includes(x));
  ok('no symbol, name, quantity, price, amount, note or key in it', leaks.length === 0, leaks.join(', '));
  ok('a snapshot with an injected field is rebuilt by the allowlist (field dropped)', !AI.redactedText(Object.assign({}, snapshot, { positions: [{ symbol: 'ZQXW' }] })).includes('ZQXW'));
  ok('an invalid snapshot gives no text', AI.redactedText({ v: 2 }) === null && AI.redactedText(null) === null);
}

console.log('full level:');
{
  const pos = AI.positionsOf(portfolio, prices);
  ok('one row per holding, options left out, largest value first', pos.map(p => p.symbol).join() === 'BTC,ZQXW,VWCE.DE', pos.map(p => p.symbol).join());
  ok('only the listed fields are read (no notes, journal or keys)', pos.every(p => Object.keys(p).sort().join() === 'category,cost,name,price,quantity,symbol,value'));
  const txt = AI.fullText(pos, snapshot);
  ok('names holdings with quantity, price, value and cost', /ZQXW \(Zebraquux Holdings\), Stocks: 37 × €99\.87 = €3,695\.19/.test(txt) && /cost €3,005\.51/.test(txt), txt.split('\n').find(l => /ZQXW/.test(l)));
  ok('total, cost and gain (3,695.19 + 1,407.96 + 25,822.61 = 30,925.76; cost 14,151.20)', /Total value: €30,925\.76 \(cost €14,151\.20, gain \+118\.5%\)/.test(txt), txt.split('\n')[2]);
  ok('still no notes, journal or API keys', !/SECRET|sk-LEAK/.test(txt));
  ok('carries the allowlisted weights too', /Asset classes: /.test(txt));
  ok('no priced holding → no text', AI.fullText([], snapshot) === null && AI.fullText(AI.positionsOf({ stocks: [{ symbol: 'X', amount: 0 }] }, {}), null) === null);
}

console.log('build():');
ok('redacted by default, full only when asked', !/ZQXW/.test(AI.build('redacted', { portfolio, prices })) && /ZQXW/.test(AI.build('full', { portfolio, prices })));
ok('an empty book gives no text', AI.build('redacted', { portfolio: {}, prices: {} }) === null);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
