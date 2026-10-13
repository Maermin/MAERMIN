// Dividends depth (P5-2.5): matrix security x year, growth per payment and
// payer (CAGR 3/5 years), the 24-month forecast months and the backtest of
// today's holdings over past market dividends.
// Run: node test/dividend-history.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

const DH = require('../dividend-history.js');
const div = (symbol, date, quantity, price, extra) => Object.assign({ type: 'dividend', category: 'stocks', symbol, date, quantity, price, currency: 'EUR' }, extra || {});
const usdEUR = (amount, tx) => (tx.currency === 'USD' ? 0.9 : 1) * amount;

console.log('amountOf (gross / net):');
const w = div('KO', '2026-04-01', 10, 0.5, { withholdingTax: 0.75, currency: 'USD' });
ok('gross = shares x amount per share', near(DH.amountOf(w, 'gross'), 5));
ok('net = gross - withholding tax', near(DH.amountOf(w, 'net'), 4.25));
ok('a payment booked as an amount only', near(DH.amountOf({ type: 'dividend', amount: 12, withholdingTax: 2 }, 'net'), 10) && near(DH.amountOf({ type: 'dividend', amount: 12 }, 'gross'), 12));
ok('default basis is net; a negative withholding is ignored', near(DH.amountOf(div('X', '2026-01-01', 1, 3, { withholdingTax: -1 })), 3));

console.log('\nmatrix:');
const txs = [
  div('ALV.DE', '2023-05-10', 10, 11.4),
  div('ALV.DE', '2024-05-10', 10, 13.8),
  div('ALV.DE', '2025-05-10', 10, 15.4),
  div('KO', '2024-04-01', 20, 0.485, { currency: 'USD', withholdingTax: 1.455 }),
  div('KO', '2025-04-01', 20, 0.51, { currency: 'USD', withholdingTax: 1.53 }),
  { type: 'buy', symbol: 'KO', date: '2024-01-02', quantity: 20, price: 55 },
  { type: 'interest', amount: 3, date: '2025-01-01' }
];
const m = DH.matrix(txs, { toEUR: usdEUR, basis: 'gross', today: '2026-10-13' });
ok('years from the first dividend to this year', JSON.stringify(m.years) === '[2023,2024,2025,2026]', JSON.stringify(m.years));
ok('one row per payer, largest total first', m.rows.length === 2 && m.rows[0].sym === 'ALV.DE' && m.rows[1].sym === 'KO');
ok('cells are gross EUR per year', near(m.rows[0].byYear[2024], 138) && near(m.rows[1].byYear[2025], 20 * 0.51 * 0.9));
ok('a year without payment is 0', m.rows[1].byYear[2023] === 0 && m.rows[0].byYear[2026] === 0);
ok('year totals and grand total add up', near(m.totals[2024], 138 + 20 * 0.485 * 0.9) && near(m.grand, 114 + 138 + 154 + 20 * (0.485 + 0.51) * 0.9));
const mn = DH.matrix(txs, { toEUR: usdEUR, basis: 'net', today: '2026-10-13' });
ok('net subtracts the withholding tax (in EUR)', near(mn.rows[1].byYear[2025], (20 * 0.51 - 1.53) * 0.9) && mn.grand < m.grand);
ok('only dividends count (no interest, no trades)', m.rows.every((r) => r.sym !== '' && r.sym !== undefined));
ok('symbols are grouped case-insensitively', DH.matrix([div('ko', '2025-01-01', 1, 1), div('KO', '2025-04-01', 1, 1)], { today: '2026-01-01' }).rows.length === 1);
const empty = DH.matrix([], { today: '2026-10-13' });
ok('no dividends: no years, no rows, total 0', empty.years.length === 0 && empty.rows.length === 0 && empty.grand === 0);

console.log('\ngrowth:');
const ko = [];
// four payments a year, +5 % a year from 2020; 2026 so far Q1-Q3
for (let y = 2020; y <= 2026; y++) {
  const dps = 0.4 * Math.pow(1.05, y - 2020);
  ['-03-15', '-06-15', '-09-15', '-12-15'].forEach((md) => { const d = y + md; if (d <= '2026-10-13') ko.push(div('KO', d, 100, dps)); });
}
const g = DH.growth(ko, { today: '2026-10-13' });
const kp = g.payers.find((p) => p.sym === 'KO');
ok('per-share sum per calendar year', near(kp.years[2025], 4 * 0.4 * Math.pow(1.05, 5)));
ok('CAGR 3 years from complete years (2022 -> 2025) = 5 %', near(kp.cagr3, 0.05, 1e-9), kp.cagr3);
ok('CAGR 5 years (2020 -> 2025) = 5 %', near(kp.cagr5, 0.05, 1e-9), kp.cagr5);
const last = g.payments.filter((p) => p.sym === 'KO').pop();
ok('the latest payment is compared with the one a year before: +5 %', last.date === '2026-09-15' && last.prevDate === '2025-09-15' && near(last.yoy, 0.05, 1e-9), JSON.stringify(last));
ok('the payer carries its latest payment', kp.last && kp.last.date === '2026-09-15' && near(kp.last.yoy, 0.05, 1e-9));
const firstPay = g.payments.find((p) => p.sym === 'KO');
ok('the first payment has nothing to compare with', firstPay.prevDps === null && firstPay.yoy === null);
// A buy increase does not count as growth: the comparison is per share.
const more = [div('MSFT', '2025-03-10', 10, 0.83), div('MSFT', '2026-03-10', 40, 0.91)];
ok('growth is per share, not per payment amount', near(DH.growth(more, { today: '2026-10-13' }).payments[1].yoy, 0.91 / 0.83 - 1));
// A partly recorded first year (bought mid-year) would inflate the CAGR: no figure then.
const part = [div('PG', '2022-11-15', 10, 0.9), div('PG', '2023-02-15', 10, 0.9), div('PG', '2023-05-15', 10, 0.94), div('PG', '2023-08-15', 10, 0.94), div('PG', '2023-11-15', 10, 0.94),
  div('PG', '2024-02-15', 10, 0.94), div('PG', '2024-05-15', 10, 1.0), div('PG', '2024-08-15', 10, 1.0), div('PG', '2024-11-15', 10, 1.0),
  div('PG', '2025-02-15', 10, 1.0), div('PG', '2025-05-15', 10, 1.05), div('PG', '2025-08-15', 10, 1.05), div('PG', '2025-11-15', 10, 1.05)];
const pg = DH.growth(part, { today: '2026-10-13' }).payers[0];
ok('CAGR 3 years needs a full base year: 2022 had 1 of 4 payments -> none', pg.cagr3 === null, pg.cagr3);
ok('... and no CAGR 5 years without five years of history', pg.cagr5 === null);
ok('a payment without an amount per share is left out of the growth', DH.growth([{ type: 'dividend', symbol: 'X', amount: 5, date: '2025-01-01' }], { today: '2026-01-01' }).payments.length === 0);

console.log('\nforecast months:');
const rates = [
  { sym: 'KO', annualRate: 200, perPayment: 50, paymentsPerYear: 4, months: [2, 5, 8, 11], source: 'history' },
  { sym: 'SAP', annualRate: 24, paymentsPerYear: 1, frequency: 'annual', source: 'estimated' }
];
const fm = DH.months(rates, { today: '2026-10-13', months: 24 });
ok('24 months from this month', fm.length === 24 && fm[0].y === 2026 && fm[0].m === 9 && fm[23].y === 2028 && fm[23].m === 8, JSON.stringify([fm[0], fm[23]].map((x) => [x.y, x.m])));
ok('a payer with history pays in its months (Dec 2026: KO 50)', near(fm[2].amount, 50) && fm[2].items[0].sym === 'KO' && fm[2].items[0].source === 'history');
ok('an estimated annual payer pays in the first month and 12 months later', fm[0].items.some((i) => i.sym === 'SAP' && near(i.amount, 24) && i.source === 'estimated') && fm[12].items.some((i) => i.sym === 'SAP'));
ok('24 months = two years of the annual rates', near(fm.reduce((s, x) => s + x.amount, 0), 2 * 224));

console.log('\nbacktest:');
// today's holdings: 10 ALV.DE (EUR), 20 KO (USD at 0.9)
const hist = {
  'ALV.DE': { currency: 'EUR', divs: [{ date: '2021-05-06', amount: 9.6 }, { date: '2022-05-05', amount: 10.8 }, { date: '2023-05-05', amount: 11.4 }, { date: '2024-05-09', amount: 13.8 }, { date: '2025-05-08', amount: 15.4 }],
    closes: [['2020-12-31', 200], ['2021-12-31', 208], ['2022-12-30', 200], ['2023-12-29', 242], ['2024-12-31', 296], ['2025-12-31', 360]] },
  KO: { currency: 'USD', divs: [['2021', 0.42], ['2022', 0.44], ['2023', 0.46], ['2024', 0.485], ['2025', 0.51]].flatMap(([y, d]) => ['-03-15', '-06-15', '-09-15', '-12-01'].map((md) => ({ date: y + md, amount: d }))),
    closes: [['2020-12-31', 54], ['2021-12-31', 59], ['2022-12-30', 63], ['2023-12-29', 59], ['2024-12-31', 62], ['2025-12-31', 70]] }
};
const toEURc = (amount, currency) => (currency === 'USD' ? 0.9 : 1) * amount;
const bt = DH.backtest([{ sym: 'ALV.DE', shares: 10 }, { sym: 'KO', shares: 20 }, { sym: 'NOPE', shares: 5 }], hist, { years: 5, today: '2026-10-13', toEUR: toEURc });
ok('five complete years, oldest first (2021-2025)', bt.years.length === 5 && bt.years[0].y === 2021 && bt.years[4].y === 2025, JSON.stringify(bt.years.map((x) => x.y)));
const y25 = bt.years[4];
ok('income = today\'s shares x the dividends paid that year, in EUR', near(y25.income, 10 * 15.4 + 20 * 4 * 0.51 * 0.9), y25.income);
ok('yield = income / value at the start of the year (prior year-end closes)', near(y25.startValue, 10 * 296 + 20 * 62 * 0.9) && near(y25.yield, y25.income / y25.startValue));
ok('year-over-year growth of that income', near(y25.growth, y25.income / bt.years[3].income - 1) && bt.years[0].growth === null);
ok('growth rate over the period (2021 -> 2025, 4 steps)', near(bt.cagr, Math.pow(y25.income / bt.years[0].income, 1 / 4) - 1));
ok('a holding without market history is listed as missing', JSON.stringify(bt.missing) === '["NOPE"]' && JSON.stringify(bt.covered) === '["ALV.DE","KO"]');
const bt10 = DH.backtest([{ sym: 'ALV.DE', shares: 10 }], hist, { years: 10, today: '2026-10-13', toEUR: toEURc });
ok('10 years: only years with a price are shown (2021-2025)', bt10.years[0].y === 2021 && bt10.years.length === 5, JSON.stringify(bt10.years.map((x) => x.y)));
const none = DH.backtest([{ sym: 'NOPE', shares: 1 }], hist, { years: 5, today: '2026-10-13', toEUR: toEURc });
ok('no history at all: no years and no growth rate', none.years.length === 0 && none.cagr === null);
const toEURtx = DH.backtest([{ sym: 'ALV.DE', shares: 0 }], hist, { years: 5, today: '2026-10-13' });
ok('a holding without shares is not counted', toEURtx.years.length === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
