// Node harness for P5-3.4 bank-sync.js: stored state never holds a PIN or TAN,
// the login name only when asked; bank transactions -> cash bookings (types,
// securities rows left out, stable ids, no double booking); the depot
// statement compared with MAERMIN's quantities.
// Run: node test/bank-sync.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const BS = require('../bank-sync.js');
const F = require('../fints.js');
const { MT940_PAGES, MT535 } = require('./fints-bank-sim.js');

console.log('state:');
const s1 = BS.addConnection(null, { bankId: 'dkb', url: 'https://fints.dkb.de/fints', blz: '12030000', login: 'erika', rememberLogin: false, pin: '4711', tan: '123456', label: 'DKB' });
const c1 = s1.connections[0];
ok('a connection is stored without PIN or TAN', c1 && !('pin' in c1) && !('tan' in c1) && JSON.stringify(s1).indexOf('4711') < 0 && JSON.stringify(s1).indexOf('123456') < 0, c1);
ok('the login name only when "remember" is ticked', c1.login === '' && BS.addConnection(null, { url: 'https://x', blz: '12030000', login: 'erika', rememberLogin: true }).connections[0].login === 'erika');
ok('a connection needs a URL and an 8-digit bank code', BS.addConnection(null, { url: 'https://x', blz: '1203' }).connections.length === 0 && BS.addConnection(null, { blz: '12030000' }).connections.length === 0);
const result = { accounts: [
  { accountNo: '1234567890', iban: 'DE02120300000000202051', currency: 'EUR', product: 'Girokonto', depot: false, balance: { amount: 2420.1, currency: 'EUR', date: '2025-02-03' }, transactions: F.mt940(MT940_PAGES.join('')), pin: '4711' },
  { accountNo: '9876543', iban: '', currency: 'EUR', product: 'Depot', depot: true, positions: F.mt535(MT535).positions, positionsDate: '2025-02-03' }
], warnings: [] };
const c2 = BS.applyResult(Object.assign({}, c1, { accounts: [{ accountNo: '1234567890', importBookings: true }] }), result, '2025-02-03');
const s2 = BS.normalize(BS.updateConnection(s1, c1.id, c2));
const stored = JSON.stringify(s2);
ok('the stored result keeps balances and positions, not the transactions', s2.connections[0].accounts.length === 2 && s2.connections[0].accounts[0].balance.amount === 2420.1 && s2.connections[0].accounts[1].positions.length === 2 && stored.indexOf('Miete') < 0 && stored.indexOf('4711') < 0, s2.connections[0].accounts);
ok('the "book transactions" tick survives a new sync', s2.connections[0].accounts[0].importBookings === true && s2.connections[0].accounts[1].importBookings === false);
ok('last sync date', s2.connections[0].lastSync === '2025-02-03');

console.log('\nbookings:');
const acc = s2.connections[0].accounts[0];
const b = BS.toBookings(acc, result.accounts[0].transactions, { portfolioId: 'p1' });
ok('four statement rows -> four cash bookings', b.rows.length === 4 && b.skipped === 0, b);
const types = b.rows.map((r) => r.type).join();
ok('rent = withdrawal, salary = deposit, account fee = fee, tax = tax', types === 'withdrawal,deposit,fee,tax', types);
ok('positive amounts, date, currency, portfolio, note', b.rows[0].amount === 50 && b.rows[0].date === '2025-01-15' && b.rows[0].currency === 'EUR' && b.rows[0].portfolioId === 'p1' && /Max Mustermann - Miete Januar/.test(b.rows[0].notes), b.rows[0]);
ok('marked source fints with an id', b.rows.every((r) => r.source === 'fints' && /^[0-9a-f]{8}-\d+$/.test(r.externalId)) && b.rows.every((r) => r.category === 'cashflow'));
const b2 = BS.toBookings(acc, result.accounts[0].transactions);
ok('ids are stable across syncs', b2.rows.map((r) => r.externalId).join() === b.rows.map((r) => r.externalId).join());
ok('a repeat sync books nothing twice', BS.newOnly(b2.rows, b.rows).length === 0 && BS.newOnly(b2.rows, b.rows.slice(0, 2)).length === 2);
const twin = BS.toBookings(acc, [{ date: '2025-01-05', amount: -10, purpose: 'Kaffee', name: 'Cafe', currency: 'EUR' }, { date: '2025-01-05', amount: -10, purpose: 'Kaffee', name: 'Cafe', currency: 'EUR' }]);
ok('two identical rows on one day are two bookings', twin.rows.length === 2 && twin.rows[0].externalId !== twin.rows[1].externalId);
const cls = (o) => BS.classify(Object.assign({ bookingText: '', purpose: '', name: '' }, o));
ok('securities settlements and payouts are left out', cls({ amount: -1000, purpose: 'WP-Abrechnung Kauf DE0005933931' }) === null && cls({ amount: 12, bookingText: 'Dividende', purpose: 'US0378331005' }) === null);
ok('tax refund, fee refund, overdraft interest', cls({ amount: 30, purpose: 'Steuererstattung 2024' }) === 'tax_refund' && cls({ amount: 4.9, purpose: 'Erstattung Entgelt' }) === 'fee_refund' && cls({ amount: -3.2, purpose: 'Sollzinsen' }) === 'interest_charge');
ok('every type is a cash type the import knows', b.rows.every((r) => ['deposit', 'withdrawal', 'fee', 'fee_refund', 'tax', 'tax_refund', 'interest_charge'].indexOf(r.type) > -1));

console.log('\ndepot:');
const txs = [{ type: 'buy', symbol: 'DE0005933931', quantity: 10 }, { type: 'buy', symbol: 'DE0005933931', quantity: 4 }, { type: 'sell', symbol: 'DE0005933931', quantity: 2 },
  { type: 'buy', symbol: 'AAPL', isin: 'US0378331005', quantity: 3 }];
const d = BS.depotDiff(s2.connections[0].accounts[1].positions, txs);
ok('DAX ETF: 12 at the bank, 12 in MAERMIN -> matches', d[0].status === 'match' && d[0].maermin === 12, d[0]);
ok('Apple (ticker with ISIN field): 3.5 vs 3 -> differs by +0.5', d[1].status === 'differs' && d[1].diff === 0.5, d[1]);
ok('a position MAERMIN does not hold -> missing', BS.depotDiff([{ isin: 'IE00B4L5Y983', quantity: 1 }], txs)[0].status === 'missing');
ok('since date: 90 days back', BS.sinceDate('2025-04-01') === '2025-01-01');

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
