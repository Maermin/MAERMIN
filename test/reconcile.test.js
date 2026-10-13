// Node harness for P5-3.7 reconcile.js: the sources collected from the stored
// states, reported vs computed (cash per linked portfolio, depot per ISIN,
// crypto per coin) and the health findings (stale prices, broken transfers,
// stale and failed syncs, reconciliation differences).
// Run: node test/reconcile.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const RC = require('../reconcile.js');

const bank = { connections: [{ id: 'c1', label: 'DKB', blz: '12030000', lastSync: '2025-02-03', lastError: null, accounts: [
  { accountNo: '1234567890', iban: 'DE02120300000000202051', depot: false, balance: { amount: 2420.1, currency: 'EUR', date: '2025-02-03' } },
  { accountNo: '9876543', product: 'Depot', depot: true, positions: [{ isin: 'DE0005933931', quantity: 12 }, { isin: 'US0378331005', quantity: 3.5 }], positionsDate: '2025-02-03' },
  { accountNo: '555', iban: 'DE55', depot: false, balance: { amount: 100, currency: 'USD', date: '2025-02-03' } }] }] };
const aggregators = { gocardless: { requisitionId: '8126e9fb-93c9-4228-937c-68f0383c2df7', institutionName: 'Sparkasse', lastSync: '2024-11-01', lastError: null, accounts: [{ id: 'g1', iban: 'DE89', balance: { amount: 500, currency: 'EUR', date: '2024-11-01' } }] },
  snaptrade: { registered: true, lastSync: null, lastError: { date: '2025-02-01', message: 'Invalid signature' }, accounts: [] } };
const wallets = { wallets: [{ id: 'w1', chain: 'btc', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', lastSync: '2025-02-03', native: { symbol: 'BTC', amount: 1 }, tokens: [] }] };
const exchange = { connections: [{ id: 'x1', exchange: 'binance', label: 'Binance', lastSync: '2025-02-01' }] };

console.log('sources:');
const src = RC.collect({ bank, aggregators, wallets, exchange });
ok('cash accounts: FinTS (EUR and USD) and GoCardless', src.cash.length === 3 && src.cash.map((c) => c.provider).join() === 'fints,fints,gocardless', src.cash.map((c) => c.key));
ok('depots: the FinTS depot statement', src.depots.length === 1 && src.depots[0].positions.length === 2);
ok('syncs: bank, GoCardless, SnapTrade, wallet, exchange', src.syncs.map((s) => s.provider).join() === 'fints,gocardless,snaptrade,wallet,exchange', src.syncs.map((s) => s.provider));
ok('nothing connected -> nothing collected', RC.collect({}).syncs.length === 0 && RC.collect({ aggregators: { gocardless: {}, snaptrade: {} } }).syncs.length === 0);

console.log('\ncash:');
const clearing = { p1: { series: [{ d: '2025-01-15', balance: 950 }, { d: '2025-02-01', balance: 2420.1 }, { d: '2025-02-10', balance: 3000 }] }, p2: { series: [{ d: '2024-10-01', balance: 480 }] } };
ok('balanceAt: the end of the balance date, before it, nothing before the first day', RC.balanceAt(clearing.p1, '2025-02-03') === 2420.1 && RC.balanceAt(clearing.p1, '2025-01-20') === 950 && RC.balanceAt(clearing.p1, '2024-12-31') === 0);
const rows = RC.cashRows(src.cash, { 'fints:c1:1234567890': 'p1', 'gocardless:g1': 'p2', 'fints:c1:555': 'p1' }, clearing, '2025-02-03');
ok('DKB 2,420.10 vs clearing p1 on 2025-02-03 -> matches', rows[0].status === 'match' && rows[0].computed === 2420.1 && rows[0].diff === 0, rows[0]);
ok('a USD account is not comparable with the EUR clearing account', rows[1].status === 'currency');
ok('GoCardless 500 vs 480 -> differs by +20', rows[2].status === 'differs' && rows[2].diff === 20, rows[2]);
ok('without a link: unlinked; a portfolio without clearing account: nocash', RC.cashRows(src.cash, {}, clearing)[0].status === 'unlinked' && RC.cashRows(src.cash, { 'fints:c1:1234567890': 'p9' }, clearing)[0].status === 'nocash');

console.log('\ndepot and crypto:');
const txs = [{ type: 'buy', symbol: 'DE0005933931', quantity: 12 }, { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 0.8 }];
const dep = RC.depotRows(src.depots, txs);
ok('depot: 1 of 2 positions match, 1 not in MAERMIN', dep[0].match === 1 && dep[0].missing === 1 && dep[0].status === 'differs', dep[0]);
const cr = RC.cryptoRows(wallets, txs);
ok('crypto: BTC 1 in the wallet vs 0.8 -> differs', cr.length === 1 && cr[0].status === 'differs' && cr[0].diff === 0.2, cr);

console.log('\nhealth:');
const now = Date.parse('2025-02-10T12:00:00Z');
const tr = [
  { id: 'a1', type: 'transfer_out', category: 'cashflow', amount: 100, currency: 'EUR', date: '2025-01-05', portfolioId: 'p1', counterPortfolioId: 'p2', transferId: 'tr1' },
  { id: 'a2', type: 'transfer_in', category: 'cashflow', amount: 100, currency: 'EUR', date: '2025-01-05', portfolioId: 'p2', counterPortfolioId: 'p1', transferId: 'tr1' },
  { id: 'b1', type: 'transfer_out', category: 'cashflow', amount: 50, currency: 'EUR', date: '2025-01-06', portfolioId: 'p1', counterPortfolioId: 'p2', transferId: 'tr2' },
  { id: 'c1', type: 'transfer_out', category: 'cashflow', amount: 70, currency: 'EUR', date: '2025-01-07', portfolioId: 'p1', counterPortfolioId: 'p2', transferId: 'tr3' },
  { id: 'c2', type: 'transfer_in', category: 'cashflow', amount: 75, currency: 'EUR', date: '2025-01-07', portfolioId: 'p2', counterPortfolioId: 'p1', transferId: 'tr3' }];
const h = RC.health({ transactions: tr, syncs: src.syncs, now,
  priceItems: [{ symbol: 'AAPL', price: 200, fetchedAt: now - 3600e3 }, { symbol: 'VWCE.DE', price: 100, fetchedAt: now - 5 * 864e5 }, { symbol: 'XYZ', price: null, fetchedAt: null }],
  cash: rows, depots: dep, crypto: cr });
const kinds = (k) => h.filter((x) => x.kind === k);
ok('prices: one 5 days old, one missing; a fresh one is fine', kinds('price-stale').length === 2 && kinds('price-stale')[0].symbol === 'VWCE.DE' && kinds('price-stale')[0].days === 5 && kinds('price-stale')[1].missing === true, kinds('price-stale'));
ok('transfers: a missing other half and different amounts (once per pair); a good pair is fine', kinds('transfer-broken').length === 2 && kinds('transfer-broken')[0].reason === 'missing' && kinds('transfer-broken')[0].txId === 'b1' && kinds('transfer-broken')[1].reason === 'differs', kinds('transfer-broken'));
ok('syncs: GoCardless 101 days old -> stale; SnapTrade failed with its message', kinds('sync-stale').length === 1 && kinds('sync-stale')[0].source === 'Sparkasse' && kinds('sync-failed').length === 1 && /Invalid signature/.test(kinds('sync-failed')[0].message), { stale: kinds('sync-stale'), failed: kinds('sync-failed') });
ok('reconciliation: the GoCardless cash, the depot and the crypto differences', kinds('recon-diff').map((x) => x.what).join() === 'cash,depot,crypto', kinds('recon-diff'));
ok('severities: broken transfers are warnings, the rest information', kinds('transfer-broken').every((x) => x.severity === 'warning') && kinds('sync-stale').every((x) => x.severity === 'info'));
ok('all clear -> no findings', RC.health({ transactions: tr.slice(0, 2), syncs: [{ label: 'x', lastSync: '2025-02-09' }], now, priceItems: [{ symbol: 'A', price: 1, fetchedAt: now }] }).length === 0);

console.log('\nlinks:');
const n = RC.normalize({ links: { 'fints:c1:1': 'p1', bad: '', ['x'.repeat(200)]: 'p2' } });
ok('links keep keys and portfolio ids, drop empty and over-long ones', n.links['fints:c1:1'] === 'p1' && Object.keys(n.links).length === 1, n);

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
