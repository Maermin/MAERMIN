// P5-2.8: allocation by ETF provider and by broker / portfolio, and the two
// new Intelligence checks (emergency fund, buying power).
// Run: node test/allocation-groups.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

const A = require('../allocation-groups.js');
const PI = require('../portfolio-intelligence.js');

console.log('provider of a fund:');
[
  ['iShares Core MSCI World UCITS ETF', 'EUNL.DE', 'iShares'],
  ['Vanguard FTSE All-World UCITS ETF (Acc)', 'VWCE.DE', 'Vanguard'],
  ['Xtrackers MSCI World Swap', 'XDWD.DE', 'Xtrackers'],
  ['db x-trackers DAX', 'DBXD.DE', 'Xtrackers'],
  ['Amundi MSCI Emerging Markets', 'AEEM.PA', 'Amundi'],
  ['Lyxor Core STOXX Europe 600', 'MEUD.PA', 'Amundi'],
  ['SPDR S&P 500 UCITS ETF', 'SPY5.DE', 'SPDR (State Street)'],
  ['Invesco QQQ Trust', 'QQQ', 'Invesco'],
  ['WisdomTree Physical Gold', 'PHAU', 'WisdomTree'],
  ['VanEck Semiconductor UCITS ETF', 'VVSM.DE', 'VanEck'],
  ['HSBC MSCI World', 'H4ZJ.DE', 'HSBC'],
  ['JPMorgan Global Research Enhanced Index Equity', 'JREG.DE', 'J.P. Morgan'],
  ['Franklin FTSE India', 'FLXI.DE', 'Franklin Templeton'],
  ['Global X Uranium', 'URNU.DE', 'Global X']
].forEach(([name, sym, want]) => ok(name + ' → ' + want, A.providerOf(name, sym) === want, A.providerOf(name, sym)));
ok('an unknown fund has no provider', A.providerOf('Some Fund Plc', 'XYZ') === null);
ok('known tickers without a name (VWCE, EUNL, IWDA, SXR8, VUSA)', ['VWCE.DE', 'EUNL.DE', 'IWDA.AS', 'SXR8.DE', 'VUSA.AS'].map((s) => A.providerOf('', s)).join() === 'Vanguard,iShares,iShares,iShares,Vanguard');

console.log('\nallocation by provider:');
{
  const r = A.byProvider([
    { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World', value: 6000, fund: true },
    { symbol: 'VUSA.AS', name: 'Vanguard S&P 500', value: 1000, fund: true },
    { symbol: 'EUNL.DE', name: 'iShares Core MSCI World', value: 2000, fund: true },
    { symbol: 'XYZ', name: 'Some Fund Plc', value: 500, fund: true },
    { symbol: 'AAPL', name: 'Apple Inc.', value: 3000, fund: false },
    { symbol: 'BTC', name: 'Bitcoin', value: 500, fund: false }
  ]);
  ok('funds 9,500 of 13,000', near(r.fundsValue, 9500) && near(r.total, 13000) && near(r.otherValue, 3500));
  const v = r.providers[0];
  ok('Vanguard first: 7,000 = 73.7 % of funds, 53.8 % of everything, two funds', v.name === 'Vanguard' && near(v.value, 7000) && near(v.pctFunds, 7000 / 9500 * 100) && near(v.pctTotal, 7000 / 13000 * 100) && v.holdings.join() === 'VWCE.DE,VUSA.AS', v);
  ok('an unknown fund goes to "other providers" (null name), last', r.providers[r.providers.length - 1].name === null && near(r.providers[r.providers.length - 1].value, 500));
  ok('no funds: no providers', A.byProvider([{ symbol: 'AAPL', value: 1, fund: false }]).providers.length === 0);
}

console.log('\nallocation by broker / portfolio:');
{
  const r = A.byPortfolio([{ id: 'a', name: 'Main', value: 8000, cash: 500 }, { id: 'b', name: 'Broker', value: 1500, cash: -100 }, { id: 'c', name: 'Empty', value: 0, cash: 0 }]);
  ok('value incl. cash per portfolio, biggest first', r.rows[0].id === 'a' && near(r.rows[0].total, 8500) && near(r.rows[1].total, 1400));
  ok('shares of the total (9,900)', near(r.total, 9900) && near(r.rows[0].pct, 8500 / 9900 * 100));
  ok('empty portfolios are left out', r.rows.length === 2);
}

console.log('\nIntelligence: emergency fund');
{
  const f = (inp) => PI.analyzeFromInputs(inp).findings;
  const two = f({ emergency: { available: true, liquidEUR: 4000, monthlyExpenses: 2000 } });
  ok('2 months of expenses: important', two.length === 1 && two[0].analysis === 'emergency' && two[0].priority === 'important' && near(two[0].metric, 2), two);
  const four = f({ emergency: { available: true, liquidEUR: 8000, monthlyExpenses: 2000 } });
  ok('4 months: optimization', four.length === 1 && four[0].priority === 'optimization');
  ok('6 months or more: no finding', f({ emergency: { available: true, liquidEUR: 12000, monthlyExpenses: 2000 } }).length === 0);
  ok('without expenses: no finding', f({ emergency: { available: true, liquidEUR: 0, monthlyExpenses: 0 } }).length === 0);
  ok('thresholds can be changed', PI.analyzeFromInputs({ emergency: { available: true, liquidEUR: 8000, monthlyExpenses: 2000 } }, { thresholds: { emergencyImportant: 5 } }).findings[0].priority === 'important');
}

console.log('\nIntelligence: buying power');
{
  const f = (inp) => PI.analyzeFromInputs(inp).findings;
  const neg = f({ buyingPower: { available: true, cashEUR: -150, investedEUR: 10000, overdrawn: [{ name: 'Broker', balance: -150 }] } });
  ok('an overdrawn cash account is critical', neg.length === 1 && neg[0].priority === 'critical' && neg[0].analysis === 'buyingPower' && /Broker/.test(neg[0].title + neg[0].detail), neg);
  const idle = f({ buyingPower: { available: true, cashEUR: 3000, investedEUR: 7000, overdrawn: [] } });
  ok('30 % uninvested cash: optimization', idle.length === 1 && idle[0].priority === 'optimization' && near(idle[0].metric, 30), idle);
  ok('5 % cash: nothing', f({ buyingPower: { available: true, cashEUR: 500, investedEUR: 9500, overdrawn: [] } }).length === 0);
}

console.log('\nIntelligence inputs:');
{
  const acc = [{ type: 'cash', value: 3000, currency: 'EUR' }, { type: 'checking', value: 1000, currency: 'USD' }, { type: 'time_deposit', value: 5000 }, { type: 'loan', value: 9000 }];
  const e = PI.emergencyInputs(acc, { annualExpenses: 24000 }, { exchangeRate: 0.9 });
  ok('liquid = cash + checking (USD converted), time deposits apart', near(e.liquidEUR, 3900) && near(e.timeDepositEUR, 5000) && near(e.monthlyExpenses, 2000) && e.available, e);
  ok('no accounts and no expenses: not available', PI.emergencyInputs([], {}, {}).available === false);
  const b = PI.buyingPowerInputs([{ name: 'Main', cash: 200, value: 5000 }, { name: 'Broker', cash: -50, value: 1000 }]);
  ok('buying power from the cash accounts', near(b.cashEUR, 150) && near(b.investedEUR, 6000) && b.overdrawn.length === 1 && b.overdrawn[0].name === 'Broker', b);
  ok('no cash account at all: not available', PI.buyingPowerInputs([{ name: 'Main', value: 100 }]).available === false);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
