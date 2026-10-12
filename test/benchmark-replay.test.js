// Node harness for P5-2.2: replay of the book's own money in and out into a
// benchmark (MaerminBenchmarkReplay). Hand-computed on made-up closes.
// Run: node test/benchmark-replay.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, e) => a !== null && b !== null && a !== undefined && Math.abs(a - b) < (e || 1e-6);

globalThis.window = {};
const L = require('../ledger.js');
const R = require('../returns-engine.js');
window.MaerminLedger = L; window.MaerminReturns = R;
const VA = require('../value-attribution.js');
const BR = require('../benchmark-replay.js');

// Benchmark closes in EUR: 100 → 125 → 150
const bench = [['2025-01-02', 100], ['2025-06-02', 125], ['2025-12-31', 150]];

(function run() {
  console.log('replaying money in and out:');
  // In 1,000 on 2 Jan (10 units), out 250 on 2 Jun (2 units at 125), end 8 × 150 = 1,200.
  const att = { start: '2025-01-01', end: '2025-12-31', startValue: 0, endValue: 1100,
    flows: [{ d: '2025-01-02', amount: 1000 }, { d: '2025-06-02', amount: -250 }] };
  const r = BR.replay(att, bench);
  ok('same money into the benchmark: 10 units, 2 sold, 8 × 150 = 1,200', r.available && near(r.benchEnd, 1200), JSON.stringify(r));
  ok('own end value 1,100 → 100 behind the benchmark', near(r.ownEnd, 1100) && near(r.diff, -100));
  const ownX = R.xirr([{ date: '2025-01-02', amount: -1000 }, { date: '2025-06-02', amount: 250 }, { date: '2025-12-31', amount: 1100 }]);
  const benchX = R.xirr([{ date: '2025-01-02', amount: -1000 }, { date: '2025-06-02', amount: 250 }, { date: '2025-12-31', amount: 1200 }]);
  ok('money-weighted return a year for both, on the same dates', near(r.ownXirr, ownX, 1e-9) && near(r.benchXirr, benchX, 1e-9) && r.benchXirr > r.ownXirr, r.ownXirr + ' / ' + r.benchXirr);

  console.log('a period that starts with a value:');
  const s = BR.replay({ start: '2025-06-02', end: '2025-12-31', startValue: 500, endValue: 640, flows: [] }, bench);
  ok('the start value buys the benchmark at the start close: 500 / 125 × 150 = 600', near(s.benchEnd, 600) && near(s.diff, 40), JSON.stringify(s));
  const ff = BR.replay({ start: '2025-07-15', end: '2025-12-31', startValue: 250, endValue: 300, flows: [] }, bench);
  ok('a start between two closes uses the last close before it (125)', near(ff.benchEnd, 300));

  console.log('limits:');
  const early = BR.replay({ start: '2024-12-01', end: '2025-12-31', startValue: 0, endValue: 10, flows: [{ d: '2024-12-15', amount: 10 }] }, bench);
  ok('money before the benchmark history starts → not available, with the first date', early.available === false && early.from === '2025-01-02');
  const big = BR.replay({ start: '2025-01-01', end: '2025-12-31', startValue: 0, endValue: 0,
    flows: [{ d: '2025-01-02', amount: 100 }, { d: '2025-06-02', amount: -200 }] }, bench);
  ok('taking out more than the benchmark holds: units stop at 0, the rest is reported', near(big.benchEnd, 0) && near(big.shortfall, 75), JSON.stringify(big));
  ok('no benchmark closes → not available', BR.replay({ start: '2025-01-01', end: '2025-12-31', startValue: 0, endValue: 0, flows: [] }, []).available === false);
  ok('no attribution → null', BR.replay(null, bench) === null);

  console.log('flows from the value-change attribution:');
  const book = [
    { id: 'b', type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 100, fees: 1, currency: 'EUR', date: '2025-01-02' },
    { id: 's', type: 'sell', category: 'stocks', symbol: 'AAA', quantity: 4, price: 121, fees: 1, currency: 'EUR', date: '2025-06-02' }
  ];
  const series = { 'stocks|AAA': { cur: 'EUR', closes: [['2025-01-02', 100], ['2025-06-02', 120], ['2025-12-31', 130]] } };
  const a = VA.compute(book, series, { start: '2025-01-01', today: '2025-12-31' });
  ok('attribution lists money in and out per day: +1,001 on 2 Jan, −483 on 2 Jun', a.flows.length === 2 && a.flows[0].d === '2025-01-02' && near(a.flows[0].amount, 1001) && near(a.flows[1].amount, -483), JSON.stringify(a.flows));
  ok('the flows add up to money in − money out', near(a.flows.reduce((x, f) => x + f.amount, 0), a.parts.moneyIn - a.parts.moneyOut));

  console.log('closes in EUR and fetch range:');
  const usd = BR.toEurCloses({ currency: 'USD', prices: [{ date: '2025-01-02', price: 100 }, { date: '2025-07-02', price: 110 }] }, { fxAt: (d) => (d < '2025-07-01' ? 0.9 : 0.8) });
  ok('USD closes convert at the rate of their date', usd.length === 2 && near(usd[0][1], 90) && near(usd[1][1], 88), JSON.stringify(usd));
  const eur = BR.toEurCloses({ currency: 'EUR', prices: [{ date: '2025-01-02', price: 50 }, { date: '2025-01-03', price: null }] });
  ok('EUR closes stay, empty ones are dropped', eur.length === 1 && eur[0][1] === 50);
  ok('fetch range: 1y, 2y, 5y, 10y, max by the start', BR.rangeFor('2025-01-10', '2025-12-31') === '1y' && BR.rangeFor('2024-06-01', '2025-12-31') === '2y'
    && BR.rangeFor('2021-06-01', '2025-12-31') === '5y' && BR.rangeFor('2017-01-01', '2025-12-31') === '10y' && BR.rangeFor('2010-01-01', '2025-12-31') === 'max');
  ok('presets: accumulating EUR listings (dividends reinvested) and the price indices',
    BR.PRESETS.length === 4 && BR.PRESETS.every((p) => /\.DE$/.test(p.acc) && p.price) && BR.symbolOf('msci_world', true) === 'EUNL.DE' && BR.symbolOf('msci_world', false) === 'URTH');

  ok('index names come from the Benchmark comparison list', BR.labelOf('msci_world') === 'MSCI World' && BR.labelOf('nasdaq100') === 'Nasdaq 100');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
