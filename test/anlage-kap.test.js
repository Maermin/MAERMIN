// Anlage KAP / KAP-INV mapping (P2-6): direct securities to KAP 19/20/22/23/41,
// funds to KAP-INV per fund type (before Teilfreistellung), and the same
// through the real tax report.
// Run: node test/anlage-kap.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const K = require('../anlage-kap.js');
const TaxReport = require('../tax-report-builder.js');
const TE = require('../tax-calculation-engine.js');
const line = (rows, form, n) => { const r = rows.find((x) => x.form === form && x.line === n); return r ? r.amount : 0; };

console.log('anlage KAP mapping:');
const rows = K.map({
  disposals: [
    { symbol: 'AAPL', gain: 500, pot: 'shares' }, { symbol: 'SAP', gain: -200, pot: 'shares' },
    { symbol: 'BOND1', gain: -50, pot: 'other' }, { symbol: 'ETC1', gain: 80, pot: 'other' },
    { symbol: 'VWCE', gain: 300, vapCredit: 20, pot: 'other' }, { symbol: 'MIX', gain: -40, pot: 'other' }],
  dividends: [{ symbol: 'AAPL', gross: 100, withholding: 30 }, { symbol: 'VWCE', gross: 60 }, { symbol: 'XFUND', gross: 10 }],
  interestIncome: 25,
  vorabpauschalen: [{ symbol: 'VWCE', amount: 15 }],
  fundTypes: { VWCE: 'aktienfonds', MIX: 'mischfonds' },
  fundSymbols: { VWCE: true, MIX: true, XFUND: true }
});
ok('KAP 19 = gains 580 + dividends 100 + interest 25 - other losses 50 (share loss not included)', line(rows, 'KAP', 19) === 655, JSON.stringify(rows));
ok('KAP 20 = share gains 500', line(rows, 'KAP', 20) === 500);
ok('KAP 22 = other losses 50', line(rows, 'KAP', 22) === 50);
ok('KAP 23 = share losses 200', line(rows, 'KAP', 23) === 200);
ok('KAP 41 = withholding capped at 15 % of the gross (30 -> 15)', line(rows, 'KAP', 41) === 15);
ok('KAP-INV 4 / 8: distributions per fund type, untyped fund = other', line(rows, 'KAP-INV', 4) === 60 && line(rows, 'KAP-INV', 8) === 10);
ok('KAP-INV 9: Vorabpauschale of equity funds', line(rows, 'KAP-INV', 9) === 15);
ok('KAP-INV 14 / 17: fund gains after the taxed Vorabpauschale, losses negative', line(rows, 'KAP-INV', 14) === 280 && line(rows, 'KAP-INV', 17) === -40);
ok('zero lines are left out; rows in form order', !rows.some((r) => r.amount === 0) && rows[0].line === 19 && rows[rows.length - 1].form === 'KAP-INV');
ok('CSV has a header and one row per line', K.toCSV(rows, 2025).split('\n').length === rows.length + 1 && /^form;line;label;amount_eur;year/.test(K.toCSV(rows, 2025)));

console.log('through the tax report:');
const txs = [
  { id: 'a1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 10, currency: 'EUR', date: '2025-02-03' },
  { id: 'a2', type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 150, currency: 'EUR', date: '2025-06-02' },
  { id: 'v1', type: 'buy', category: 'stocks', symbol: 'VWCE.DE', quantity: 5, price: 100, currency: 'EUR', date: '2025-01-02' },
  { id: 'v2', type: 'sell', category: 'stocks', symbol: 'VWCE.DE', quantity: 5, price: 120, currency: 'EUR', date: '2025-09-01' },
  { id: 'b1', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 500, currency: 'EUR', date: '2025-01-10' },
  { id: 'b2', type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 1200, currency: 'EUR', date: '2025-03-10' }];
const rep = TaxReport.build(txs, { year: 2025, exchangeRate: 0.9, germanTax: TE.GermanTax, fundTypes: { 'VWCE.DE': 'aktienfonds' }, vapRecords: {}, taxOverrides: {}, dividendEvents: [],
  taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true } });
const g = rep.summary.germanDetail;
ok('the report carries the capital inputs', g && g.kapInputs && Array.isArray(g.kapInputs.disposals));
const r2 = K.map(g.kapInputs);
ok('AAPL gain 490 -> KAP 19 and 20; crypto stays out (private sale)', line(r2, 'KAP', 19) === 490 && line(r2, 'KAP', 20) === 490, JSON.stringify(r2));
ok('VWCE.DE (equity fund) gain 100 -> KAP-INV 14, gross', line(r2, 'KAP-INV', 14) === 100);
console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
