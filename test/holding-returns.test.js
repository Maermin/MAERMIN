// P5-2.6: per-holding and per-group IRR, best / worst closed trades and the
// capital-flow table. Every expected figure is computed by hand next to it.
// Run: node test/holding-returns.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

const L = require('../ledger.js');
const R = require('../returns-engine.js');
const H = require('../holding-returns.js');

const tx = (o) => Object.assign({ category: 'stocks', currency: 'EUR' }, o);
const buy = (symbol, date, quantity, price, extra) => tx(Object.assign({ type: 'buy', symbol, date, quantity, price }, extra || {}));
const sell = (symbol, date, quantity, price, extra) => tx(Object.assign({ type: 'sell', symbol, date, quantity, price }, extra || {}));
const div = (symbol, date, quantity, price, extra) => tx(Object.assign({ type: 'dividend', symbol, date, quantity, price }, extra || {}));
const usd = (amount, t) => (t.currency === 'USD' ? 0.9 : 1) * amount;

console.log('flows per holding:');
{
  const f = H.flowsOf([buy('AAA', '2024-01-02', 10, 100, { fees: 5 }), div('AAA', '2024-06-01', 10, 2, { withholdingTax: 3 }), sell('AAA', '2025-01-02', 4, 120, { fees: 1 })], { toEUR: usd });
  const a = f['stocks|AAA'];
  ok('net: buy -(1000 + 5), dividend 20 - 3, sale 480 - 1', a && a.flows.map((x) => x.amount).join() === '-1005,17,479', a && a.flows);
  const g = H.flowsOf([buy('AAA', '2024-01-02', 10, 100, { fees: 5 }), div('AAA', '2024-06-01', 10, 2, { withholdingTax: 3 }), sell('AAA', '2025-01-02', 4, 120, { fees: 1 })], { toEUR: usd, basis: 'gross' });
  ok('gross: without fees and withholding', g['stocks|AAA'].flows.map((x) => x.amount).join() === '-1000,20,480');
  const u = H.flowsOf([buy('KO', '2024-01-02', 10, 50, { currency: 'USD' })], { toEUR: usd });
  ok('USD at the given rate', near(u['stocks|KO'].flows[0].amount, -450));
  ok('symbols are grouped case-insensitively and per category', Object.keys(H.flowsOf([buy('aaa', '2024-01-01', 1, 1), buy('AAA', '2024-02-01', 1, 1), buy('AAA', '2024-02-01', 1, 1, { category: 'crypto' })], {})).sort().join() === 'crypto|AAA,stocks|AAA');
  ok('cash bookings and options are not holdings', Object.keys(H.flowsOf([{ type: 'fee', category: 'cashflow', amount: 3, date: '2024-01-01' }, buy('OPT', '2024-01-01', 1, 1, { category: 'options' })], {})).length === 0);
}

console.log('\nIRR per holding:');
{
  // 1000 in on 2024-01-01, worth 1100 on 2025-01-01: 10 % a year
  const txs = [buy('AAA', '2024-01-01', 10, 100), buy('BBB', '2024-01-01', 1, 500), sell('BBB', '2024-07-01', 1, 400)];
  const r = H.irr(txs, { valueOf: (k) => (k === 'stocks|AAA' ? 1100 : 0), today: '2025-01-01' });
  const a = r.find((x) => x.key === 'stocks|AAA'), b = r.find((x) => x.key === 'stocks|BBB');
  ok('open holding: the current value is the last flow (= XIRR of the flows)', near(a.irr, R.xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1100 }]), 1e-9) && a.open && near(a.value, 1100), a);
  ok('closed holding: no end value, its own sale', !b.open && b.value === 0 && b.irr < 0 && near(b.irr, R.xirr([{ date: '2024-01-01', amount: -500 }, { date: '2024-07-01', amount: 400 }]), 1e-9), b);
  ok('invested and returned money per holding', near(a.invested, 1000) && near(b.invested, 500) && near(b.returned, 400));
  ok('sorted by IRR, best first', r[0].key === 'stocks|AAA');
  const same = H.irr([buy('CCC', '2025-01-01', 1, 10)], { valueOf: () => 11, today: '2025-01-01' })[0];
  ok('bought today: no IRR (all flows on one day)', same.irr === null);
}

console.log('\nIRR per group:');
{
  const txs = [buy('AAA', '2024-01-01', 10, 100), buy('BBB', '2024-01-01', 10, 100), buy('BTC', '2024-01-01', 1, 1000, { category: 'crypto' })];
  const val = { 'stocks|AAA': 1200, 'stocks|BBB': 1000, 'crypto|BTC': 2000 };
  const tags = { version: 1, tags: { Tech: { color: '#000', symbols: ['AAA', 'BTC'] }, Empty: { color: '#000', symbols: ['ZZZ'] } } };
  const g = H.irrBy(txs, { valueOf: (k) => val[k] || 0, today: '2025-01-01', tags });
  const st = g.classes.find((x) => x.name === 'stocks'), cr = g.classes.find((x) => x.name === 'crypto'), te = g.tags.find((x) => x.name === 'Tech');
  ok('per asset class: 2000 in, 2200 now = 10 %', near(st.irr, R.xirr([{ date: '2024-01-01', amount: -2000 }, { date: '2025-01-01', amount: 2200 }]), 1e-9) && near(st.value, 2200), st);
  ok('crypto doubled in a year', near(cr.irr, R.xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 2000 }]), 1e-9) && cr.irr > 0.99, cr);
  ok('per tag: AAA + BTC, 2000 in, 3200 now', near(te.irr, R.xirr([{ date: '2024-01-01', amount: -2000 }, { date: '2025-01-01', amount: 3200 }]), 1e-9) && near(te.value, 3200), te);
  ok('a tag without held symbols is left out', !g.tags.some((x) => x.name === 'Empty'));
}

console.log('\nclosed trades:');
{
  const txs = [
    buy('AAA', '2023-01-02', 10, 100, { fees: 10 }), // unit cost 101
    sell('AAA', '2023-07-03', 4, 150, { fees: 4 }),  // 596 - 404 = +192, 182 days
    sell('AAA', '2025-01-02', 6, 80),                // 480 - 606 = -126, 731 days
    buy('BBB', '2024-01-02', 5, 20), buy('BBB', '2024-04-01', 5, 30),
    sell('BBB', '2024-10-01', 10, 40)                // one sale over two lots: 400 - 250 = +150
  ];
  const tr = H.trades(L.build(txs, {}));
  ok('one row per sale (three sales)', tr.all.length === 3, tr.all.length);
  const s1 = tr.all.find((t) => t.date === '2023-07-03');
  ok('sale 1: cost 404, proceeds 596, +47.5 %, held 182 days', near(s1.cost, 404) && near(s1.proceeds, 596) && near(s1.ret, 192 / 404) && s1.days === 182, s1);
  ok('... under a year: no annualised figure', s1.annualized === null);
  const s2 = tr.all.find((t) => t.date === '2025-01-02');
  ok('sale 2: -126 over 731 days, annualised', near(s2.gain, -126) && s2.days === 731 && near(s2.annualized, Math.pow(480 / 606, 365.25 / 731) - 1), s2);
  const s3 = tr.all.find((t) => t.symbol === 'BBB');
  ok('a sale over two lots: holding period weighted by quantity ((5 x 273 + 5 x 183) / 10)', near(s3.gain, 150) && s3.days === 228 && s3.lots === 2, s3);
  ok('best: by return (BBB +60 %, AAA +47.5 %); worst: AAA -20.8 %', tr.best[0].symbol === 'BBB' && tr.best[1].date === '2023-07-03' && tr.worst[0].date === '2025-01-02', [tr.best.map((t) => t.ret), tr.worst.map((t) => t.ret)]);
  ok('best and worst never show the same sale twice when there are few', tr.best.length + tr.worst.length <= tr.all.length && tr.best.every((b) => tr.worst.indexOf(b) === -1));
  ok('no sales: empty lists', H.trades(L.build([buy('AAA', '2024-01-01', 1, 1)], {})).all.length === 0);
}

console.log('\ncapital flow:');
{
  const txs = [
    buy('AAA', '2024-01-15', 10, 100, { fees: 1 }), buy('BBB', '2024-01-20', 1, 50, { currency: 'USD' }),
    sell('AAA', '2024-03-01', 2, 120, { fees: 2 }), buy('AAA', '2025-02-01', 1, 100),
    div('AAA', '2024-06-01', 10, 1), { type: 'deposit', category: 'cashflow', amount: 5000, date: '2024-01-01' }
  ];
  const c = H.capitalFlow(txs, { toEUR: usd, today: '2025-03-15' });
  const jan = c.months.find((m) => m.ym === '2024-01');
  ok('January 2024: buys 1001 + 45, no sales, net 1046', near(jan.buys, 1046) && jan.sells === 0 && near(jan.net, 1046), jan);
  const mar = c.months.find((m) => m.ym === '2024-03');
  ok('March 2024: sale 240 - 2 = 238, net -238', near(mar.sells, 238) && near(mar.net, -238));
  ok('every month from the first trade to this month, empty ones as 0', c.months.length === 15 && c.months[1].ym === '2024-02' && c.months[1].net === 0, c.months.map((m) => m.ym).join());
  const y24 = c.years.find((y) => y.y === 2024);
  ok('2024: buys 1046, sales 238, net 808, 12 months, 67.33 a month', near(y24.buys, 1046) && near(y24.sells, 238) && near(y24.net, 808) && y24.months === 12 && near(y24.avg, 808 / 12), y24);
  const y25 = c.years.find((y) => y.y === 2025);
  ok('this year: averaged over the months so far (3)', y25.months === 3 && near(y25.avg, 100 / 3), y25);
  ok('overall: net 908 over 15 months', near(c.total.net, 908) && c.total.months === 15 && near(c.total.avg, 908 / 15), c.total);
  ok('dividends and cash bookings are not capital flow', !c.months.some((m) => m.ym === '2024-06' && m.net !== 0));
  ok('no trades: nothing', H.capitalFlow([], {}).months.length === 0 && H.capitalFlow([], {}).total.net === 0);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
