// Node harness for demo mode (window.MaerminDemo): dataset integrity + flag
// toggling with an injected storage. Run: node test/demo-data.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function memStore() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }

const D = require('../demo-data.js');

(function run() {
  const ALLOWED = ['crypto', 'stocks', 'skins', 'commodities'];

  console.log('demo dataset integrity:');
  const txs = D.getTransactions();
  ok('has demo transactions', txs.length >= 5);
  ok('every tx has the canonical shape', txs.every((t) => t.symbol && t.category && t.type && t.currency && t.date));
  ok('categories are all valid', txs.every((t) => ALLOWED.indexOf(t.category) !== -1));
  ok('numeric fields are numbers', txs.every((t) => typeof t.quantity === 'number' && typeof t.price === 'number' && typeof t.fees === 'number'));
  ok('non-dividend rows have positive qty & price', txs.filter((t) => t.type !== 'dividend').every((t) => t.quantity > 0 && t.price > 0));
  ok('covers every asset class', ALLOWED.every((c) => txs.some((t) => t.category === c)));
  ok('getTransactions returns a copy (mutation-safe)', (txs[0].symbol = 'MUT') && D.getTransactions()[0].symbol !== 'MUT');

  console.log('offline demo prices:');
  const prices = D.getPrices();
  const tradable = D.getTransactions().filter((t) => t.type !== 'dividend');
  ok('a price exists for every held symbol', tradable.every((t) => typeof prices[t.symbol] === 'number' && prices[t.symbol] > 0));
  ok('getPrices returns a copy', (prices.BTC = 1) && D.getPrices().BTC !== 1);

  console.log('sample daily closes (P4-9):');
  const day = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const h = typeof D.closeHistory === 'function' ? D.closeHistory('2026-10-09') : null;
  ok('closeHistory exists and has the close-history shape', !!h && h.v === 1 && h.series && Object.keys(h.series).length > 0);
  if (h) {
    const traded = D.getTransactions().filter((t) => (t.type === 'buy' || t.type === 'sell') && t.category !== 'skins');
    ok('a series for every traded stock, commodity and coin', traded.every((t) => h.series[t.category + '|' + t.symbol.toUpperCase()]));
    ok('every trade price is the close of its trade day (FIFO and the value path agree)', traded.every((t) => {
      const e = h.series[t.category + '|' + t.symbol.toUpperCase()]; const i = e.d.indexOf(day(t.date)); return i > -1 && e.p[i] === t.price; }));
    const px = D.getPrices();
    ok('today\'s close is the demo price (EUR series) or that price in USD (USD series)', Object.keys(h.series).every((k) => {
      const e = h.series[k]; if (!px[e.sym]) return true;
      const want = e.cur === 'USD' ? px[e.sym] / D.SETTINGS.exchangeRate : px[e.sym];
      return e.d[e.d.length - 1] === day('2026-10-09') && Math.abs(e.p[e.p.length - 1] - want) < 0.01; }));
    ok('days strictly ascending, every close positive', Object.keys(h.series).every((k) => h.series[k].d.every((x, i, a) => i === 0 || x > a[i - 1]) && h.series[k].p.every((p) => p > 0)));
    ok('deterministic (same input, same series)', JSON.stringify(h) === JSON.stringify(D.closeHistory('2026-10-09')));
    ok('the dividend is gross = quantity × price with withholding', D.getTransactions().some((t) => t.type === 'dividend' && t.quantity * t.price > 0 && t.withholdingTax > 0));
    ok('a fully closed position exists', (() => { const q = {}; D.getTransactions().forEach((t) => { if (t.type === 'buy') q[t.symbol] = (q[t.symbol] || 0) + t.quantity; if (t.type === 'sell') q[t.symbol] = (q[t.symbol] || 0) - t.quantity; }); return Object.keys(q).some((s) => q[s] === 0); })());
  }

  console.log('flag toggling (injected storage):');
  const s = memStore();
  ok('inactive by default', D.isActive(s) === false);
  D.enable(s);
  ok('active after enable', D.isActive(s) === true);
  D.disable(s);
  ok('inactive after disable', D.isActive(s) === false);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
