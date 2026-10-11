// Regression test, docs/AUDIT.md run 2026-10-09: the CSV import keeps the UTC calendar day of exchange
// timestamps (Binance "Date(UTC)", Coinbase "...Z"). The exchange API sync was
// fixed to use the local day (BUG-004), the CSV import of the same trades was
// not: a trade at 00:30 on 1 January in Berlin lands in the previous tax year,
// and the API sync's same-day duplicate check no longer matches the CSV row.
// Run: node test/audit-import-utc-date.test.js
'use strict';
process.env.TZ = 'Europe/Berlin';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const IM = require('../import-mapping.js');
const EX = require('../exchange-sync.js');

console.log('CSV import, UTC timestamps (TZ=Europe/Berlin):');
const csv = 'Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2024-12-31 23:30:00,BTCEUR,BUY,90000,0.01,900,0.9';
const prev = IM.preview(csv, { existing: [], broker: 'binance' });
const tx = prev.transactions[0];
ok('Binance Date(UTC) 2024-12-31 23:30 → local day 2025-01-01', tx && tx.date === '2025-01-01');

ok('ISO with Z 2024-12-31T23:30:00Z → 2025-01-01', IM.parseDate('2024-12-31T23:30:00Z') === '2025-01-01');

// The same fill via the API sync gets the local day; the CSV row must match it.
const api = EX.mapTrades('binance', [{ symbol: 'BTCEUR', id: 7, price: '90000', qty: '0.01', commission: '0.9', commissionAsset: 'EUR', time: Date.parse('2024-12-31T23:30:00Z'), isBuyer: true }]);
ok('API sync books 2025-01-01 (sanity, BUG-004 fix)', api[0] && api[0].date === '2025-01-01');
ok('API fill is recognised as the already imported CSV row', tx && EX.dedupe(api, [Object.assign({}, tx, { id: 'csv1' })]).unique.length === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
