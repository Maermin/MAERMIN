// Node harness for demo mode (window.MaerminDemo): dataset integrity + flag
// toggling with an injected storage. Run: node test/demo-data.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function memStore() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }

const D = require('../demo-data.js');

(function run() {
  const ALLOWED = ['crypto', 'stocks', 'skins', 'commodities'];
  const L = require('../ledger.js');

  console.log('demo dataset integrity:');
  const all = D.getTransactions();
  const cash = all.filter((t) => t.category === 'cashflow');
  const txs = all.filter((t) => t.category !== 'cashflow');
  ok('has demo transactions', txs.length >= 5);
  ok('every tx has the canonical shape', txs.every((t) => t.symbol && t.category && t.type && t.currency && t.date));
  ok('categories are all valid', txs.every((t) => ALLOWED.indexOf(t.category) !== -1));
  ok('numeric fields are numbers', txs.every((t) => typeof t.quantity === 'number' && typeof t.price === 'number' && typeof t.fees === 'number'));
  ok('non-dividend rows have positive qty & price', txs.filter((t) => t.type !== 'dividend').every((t) => t.quantity > 0 && t.price > 0));
  ok('covers every asset class', ALLOWED.every((c) => txs.some((t) => t.category === c)));
  ok('cash rows are valid bookings (deposits, the tax booking)', cash.length > 0 && cash.every((t) => L.isCash(t) && L.validateCash(t).length === 0 && !('fees' in t)));
  ok('ids are unique', new Set(all.map((t) => t.id)).size === all.length);
  { const c = D.getTransactions(); ok('getTransactions returns a copy (mutation-safe)', (c[0].symbol = 'MUT') && D.getTransactions()[0].symbol !== 'MUT'); }

  console.log('offline demo prices:');
  const prices = D.getPrices();
  const tradable = txs.filter((t) => t.type !== 'dividend');
  ok('a price exists for every held symbol', tradable.every((t) => typeof prices[t.symbol] === 'number' && prices[t.symbol] > 0));
  ok('getPrices returns a copy', (prices.BTC = 1) && D.getPrices().BTC !== 1);

  console.log('sample daily closes (P4-9):');
  const day = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
  const h = typeof D.closeHistory === 'function' ? D.closeHistory('2026-10-09') : null;
  ok('closeHistory exists and has the close-history shape', !!h && h.v === 1 && h.series && Object.keys(h.series).length > 0);
  if (h) {
    const traded = txs.filter((t) => (t.type === 'buy' || t.type === 'sell') && t.category !== 'skins');
    ok('a series for every traded stock, commodity and coin', traded.every((t) => h.series[t.category + '|' + t.symbol.toUpperCase()]));
    ok('every trade price is the close of its trade day (FIFO and the value path agree)', traded.every((t) => {
      const e = h.series[t.category + '|' + t.symbol.toUpperCase()]; const i = e.d.indexOf(day(t.date)); return i > -1 && e.p[i] === t.price; }));
    const px = D.getPrices();
    ok('today\'s close is the demo price (EUR series) or that price in USD (USD series)', Object.keys(h.series).every((k) => {
      const e = h.series[k]; if (!px[e.sym]) return true;
      const want = e.cur === 'USD' ? px[e.sym] / D.SETTINGS.exchangeRate : e.cur === 'GBp' ? px[e.sym] / D.SETTINGS.gbpToEur * 100 : px[e.sym];
      return e.d[e.d.length - 1] === day('2026-10-09') && Math.abs(e.p[e.p.length - 1] - want) < 0.01; }));
    ok('days strictly ascending, every close positive', Object.keys(h.series).every((k) => h.series[k].d.every((x, i, a) => i === 0 || x > a[i - 1]) && h.series[k].p.every((p) => p > 0)));
    ok('deterministic (same input, same series)', JSON.stringify(h) === JSON.stringify(D.closeHistory('2026-10-09')));
    ok('the dividend is gross = quantity × price with withholding', D.getTransactions().some((t) => t.type === 'dividend' && t.quantity * t.price > 0 && t.withholdingTax > 0));
    ok('a fully closed position exists', (() => { const q = {}; D.getTransactions().forEach((t) => { if (t.type === 'buy') q[t.symbol] = (q[t.symbol] || 0) + t.quantity; if (t.type === 'sell') q[t.symbol] = (q[t.symbol] || 0) - t.quantity; }); return Object.keys(q).some((s) => q[s] === 0); })());
  }

  console.log('richer demo (P5-1.7):');
  const pf = (t) => t.portfolioId || 'default';
  const qty = {};
  txs.forEach((t) => { const k = pf(t) + '\u0001' + t.symbol; if (t.type === 'buy') qty[k] = (qty[k] || 0) + t.quantity; if (t.type === 'sell') qty[k] = (qty[k] || 0) - t.quantity; });
  const open = Object.keys(qty).filter((k) => qty[k] > 1e-9);
  ok('at least 30 open positions', open.length >= 30, String(open.length));
  const pfs = D.getPortfolios();
  ok('three portfolios (one is the employee plan account), every row belongs to one of them', pfs.length === 3 && all.every((t) => pfs.some((p) => p.id === pf(t))));
  ok('both trading portfolios hold positions', pfs.filter((p) => p.id !== D.EQ_PORTFOLIO).every((p) => open.some((k) => k.split('\u0001')[0] === p.id)));
  const eqPf = pfs.find((p) => p.id === D.EQ_PORTFOLIO);
  ok('the plan account is a separate depot and every equity plan books into it', !!eqPf && eqPf.separateDepot === true && D.getEquity().plans.every((p) => p.portfolioId === D.EQ_PORTFOLIO));
  const planBuys = txs.filter((t) => t.type === 'buy' && t.portfolioId === D.BROKER);
  const months = new Set(planBuys.map((t) => t.date.slice(0, 7)));
  ok('three years of monthly savings-plan buys', months.size >= 36 && planBuys.every((t) => t.fees === 0));
  const payers = new Set(txs.filter((t) => t.type === 'dividend').map((t) => t.symbol));
  ok('ten or more dividend payers', payers.size >= 10, String(payers.size));
  ok('no dividend before its position was bought', txs.filter((t) => t.type === 'dividend').every((d) => txs.some((b) => b.type === 'buy' && b.symbol === d.symbol && b.date < d.date)));
  const ft = D.store('maermin_fund_types'), vap = D.store('maermin_vap_records');
  ok('an accumulating fund with Vorabpauschale records, bought in the plan', ft['VWCE.DE'] === 'aktienfonds' && Object.keys(vap['VWCE.DE'] || {}).length >= 3 && planBuys.some((t) => t.symbol === 'VWCE.DE'));
  ok('store() is a copy and only serves the two tax keys', (ft['X'] = 1) && !('X' in D.store('maermin_fund_types')) && D.store('transactions') === undefined);
  const sale = txs.find((t) => t.type === 'sell' && t.symbol === 'NVDA');
  const taxRow = cash.find((t) => t.type === 'tax');
  ok('one taxed sale with its tax booking on the same day', !!sale && !!taxRow && taxRow.date === sale.date && taxRow.amount > 0);
  const TR = require('../tax-report-builder.js'), TE = require('../tax-calculation-engine.js');
  const rep = TR.build(all, { year: 2026, exchangeRate: D.SETTINGS.exchangeRate, germanTax: TE.GermanTax, fundTypes: ft, vapRecords: vap, taxOverrides: {}, dividendEvents: [],
    taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true } });
  const gd = rep.summary.germanDetail;
  ok('the 2026 tax report taxes the sale and counts the 2025 Vorabpauschale', gd && gd.totalTax > 0 && (gd.kapInputs.vorabpauschalen || []).some((v) => v.symbol === 'VWCE.DE' && v.amount === 118.6), gd ? String(gd.totalTax) : 'no detail');
  const broker = pfs.find((p) => p.id === D.BROKER);
  const clr = L.clearingBalance(all, D.BROKER, { exchangeRate: D.SETTINGS.exchangeRate });
  ok('the broker has a clearing account that never goes negative', broker.clearing && broker.clearing.enabled && clr.firstNegative === null && clr.balanceEUR > 0, JSON.stringify({ neg: clr.firstNegative, bal: clr.balanceEUR }));
  const btc = txs.filter((t) => t.symbol === 'BTC' && t.type === 'buy').map((t) => t.date).sort();
  ok('a crypto lot past the one-year mark and a younger one', btc.length >= 2 && btc[0] < '2024-01-01' && btc[btc.length - 1] > '2025-10-01');
  ok('deterministic (two loads give the same rows)', JSON.stringify(D.getTransactions()) === JSON.stringify(all));

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
