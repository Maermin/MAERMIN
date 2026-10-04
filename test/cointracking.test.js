// CoinTracking import (MaerminImportMapping.parseCoinTracking) and the Add
// Transaction start category (MaerminUtils.defaultTxCategory).
// Run: node test/cointracking.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const M = require('../import-mapping.js');
const U = require('../utils.js');

const q = (cells) => cells.map((c) => '"' + c + '"').join(',');
const HEAD = q(['Type', 'Buy', 'Cur.', 'Sell', 'Cur.', 'Fee', 'Cur.', 'Exchange', 'Group', 'Comment', 'Date']);
const FULL = q(['Type', 'Buy', 'Cur.', 'Buy value in EUR', 'Sell', 'Cur.', 'Sell value in EUR', 'Fee', 'Cur.', 'Fee value in EUR', 'Exchange', 'Group', 'Comment', 'Trade ID', 'Date']);
const csv = (head, rows) => [head].concat(rows.map(q)).join('\n');
const has = typeof M.parseCoinTracking === 'function';
const parse = (text, opts) => (has ? M.parseCoinTracking(text, opts) : { transactions: [], errors: [], warnings: [], stats: {} });

console.log('CoinTracking: basic export');
ok('parseCoinTracking exists', has);
const basic = parse(csv(HEAD, [
  ['Trade', '0.5', 'BTC', '15000', 'EUR', '10', 'EUR', 'Kraken', '', 'first buy', '15.01.2024 14:30:00'],
  ['Trade', '1000', 'EUR', '0.02', 'BTC', '', '', 'Kraken', '', '', '20.02.2024 10:00:00'],
  ['Deposit', '1', 'ETH', '', '', '', '', 'Ledger', '', '', '01.03.2024 09:00:00'],
  ['Withdrawal', '', '', '0.1', 'BTC', '', '', 'Kraken', '', '', '02.03.2024 09:00:00']
]));
const b0 = basic.transactions[0] || {}, b1 = basic.transactions[1] || {};
ok('fiat -> coin is a buy priced fiat / quantity', b0.type === 'buy' && b0.symbol === 'bitcoin' && approx(b0.quantity, 0.5) && approx(b0.price, 30000) && b0.currency === 'EUR' && b0.date === '2024-01-15' && b0.category === 'crypto');
ok('... the EUR fee is kept', approx(b0.fees, 10));
ok('... ticker shown as name, exchange and comment in the notes', b0.symbolName === 'BTC' && /Kraken/.test(b0.notes) && /first buy/.test(b0.notes));
ok('coin -> fiat is a sell', b1.type === 'sell' && b1.symbol === 'bitcoin' && approx(b1.quantity, 0.02) && approx(b1.price, 50000));
ok('deposits and withdrawals are not booked', basic.transactions.length === 2 && basic.stats.transfers === 2);
ok('... but reported with their row and reason', basic.errors.length === 2 && basic.errors[0].row === 3 && /transfer/.test(basic.errors[0].reason));

console.log('CoinTracking: three "Cur." columns are told apart');
const curs = parse(csv(HEAD, [['Trade', '2', 'ETH', '0.1', 'BTC', '0.001', 'BNB', 'Binance', '', '', '2024-04-01 12:00:00']]));
ok('coin -> coin without value columns is skipped with a hint', curs.transactions.length === 0 && /value in EUR/.test((curs.errors[0] || {}).reason || ''));

console.log('CoinTracking: full export with value columns');
const full = parse(csv(FULL, [
  ['Trade', '2', 'ETH', '6000', '0.1', 'BTC', '6000', '0.001', 'BNB', '0.5', 'Binance', '', '', 'T-1', '01.04.2024 12:00:00'],
  ['Staking', '0.05', 'ETH', '150', '', '', '', '', '', '', 'Lido', '', '', 'T-2', '05.04.2024 00:00:00'],
  ['Spend', '', '', '', '0.01', 'BTC', '650', '', '', '', '', '', 'coffee', 'T-3', '06.04.2024 08:00:00'],
  ['Trade', '100', 'USDT', '100', '90', 'EUR', '90', '', '', '', 'Kraken', '', '', 'T-4', '07.04.2024 08:00:00'],
  ['Trade', '10', 'SOL', '1000', '1090', 'USDT', '1000', '1', 'USDT', '0.92', 'Binance', '', '', 'T-5', '08.04.2024 08:00:00'],
  ['Margin Profit', '5', 'EUR', '5', '', '', '', '', '', '', 'Kraken', '', '', 'T-6', '09.04.2024 08:00:00']
]));
const ft = full.transactions;
const sellBtc = ft.find((t) => t.type === 'sell' && t.symbol === 'bitcoin' && approx(t.quantity, 0.1));
const buyEth = ft.find((t) => t.type === 'buy' && t.symbol === 'ethereum' && approx(t.quantity, 2));
ok('coin -> coin = sale of one coin ...', !!sellBtc && approx(sellBtc.price, 60000) && sellBtc.currency === 'EUR');
ok('... plus purchase of the other at the recorded value', !!buyEth && approx(buyEth.price, 3000) && buyEth.currency === 'EUR');
ok('... a fee paid in a coin uses its value column', !!sellBtc && approx(sellBtc.fees, 0.5));
ok('... the value currency is read from the header', !!buyEth && buyEth.currency === 'EUR');
const stake = ft.find((t) => t.symbol === 'ethereum' && approx(t.quantity, 0.05));
ok('staking reward = buy at market value (cost basis)', !!stake && stake.type === 'buy' && approx(stake.price, 3000) && /Staking/.test(stake.notes));
const spend = ft.find((t) => t.type === 'sell' && approx(t.quantity, 0.01));
ok('spend = sale at market value', !!spend && approx(spend.price, 65000));
ok('fiat <-> stablecoin exchange is not booked', full.errors.some((e) => e.row === 4 && /stablecoin/.test(e.reason)));
const sol = ft.find((t) => t.symbol === 'solana');
ok('a stablecoin counts as the fiat it tracks (USDT -> USD)', !!sol && sol.type === 'buy' && sol.currency === 'USD' && approx(sol.price, 109) && approx(sol.fees, 1));
ok('margin and other unsupported types are reported', full.errors.some((e) => e.row === 6 && /not booked/.test(e.reason)));
ok('trade ids become external ids (one per leg)', !!sellBtc && sellBtc.externalId === 'cointracking:T-1:sell' && buyEth.externalId === 'cointracking:T-1:buy');
ok('no stablecoin position is created', !ft.some((t) => /tether|usdt/i.test(t.symbol)));

console.log('CoinTracking: German export, semicolons, decimal commas');
const de = parse([
  ['Typ', 'Kauf', 'Cur.', 'Verkauf', 'Cur.', 'Gebühr', 'Cur.', 'Börse', 'Gruppe', 'Kommentar', 'Datum'].join(';'),
  ['Handel', '1,5', 'ETH', '3.000,75', 'EUR', '2,50', 'EUR', 'Bitpanda', '', '', '03.05.2024 10:00:00'].join(';'),
  ['Einnahme', '0,25', 'XYZQ', '', '', '', '', '', '', '', '04.05.2024 10:00:00'].join(';')
].join('\n'));
const d0 = de.transactions[0] || {};
ok('German labels and numbers', d0.type === 'buy' && d0.symbol === 'ethereum' && approx(d0.quantity, 1.5) && approx(d0.price, 2000.5) && approx(d0.fees, 2.5) && d0.date === '2024-05-03');
const d1 = de.transactions[1] || {};
ok('income without a value column: cost basis 0, with a warning', d1.type === 'buy' && d1.price === 0 && de.warnings.some((w) => /cost basis of 0/.test(w)));
ok('an unknown ticker is kept in lower case and listed', d1.symbol === 'xyzq' && de.warnings.some((w) => /XYZQ/.test(w)));

console.log('CoinTracking: through the wizard preview and the quick import');
const text = csv(HEAD, [['Trade', '0.5', 'BTC', '15000', 'EUR', '10', 'EUR', 'Kraken', '', '', '15.01.2024 14:30:00']]);
const pv = M.preview(text, { category: 'crypto' });
ok('preview detects CoinTracking and uses the parser', pv.broker && pv.broker.id === 'cointracking' && pv.fixedFormat === true && pv.transactions.length === 1 && pv.transactions[0].symbol === 'bitcoin');
const pvChosen = M.preview(text, { broker: 'cointracking' });
ok('... also when chosen in the wizard', pvChosen.fixedFormat === true && pvChosen.stats.ok === 1);
const dupe = M.preview(text, { existing: [pv.transactions[0]] });
ok('... duplicates against existing transactions are flagged', dupe.stats.duplicates === 1);
const quick = M.quickCSV(text);
ok('quick import reads CoinTracking too', quick.transactions.length === 1 && quick.transactions[0].symbol === 'bitcoin');
const commit = M.commit(pv);
ok('commit hands over the transactions', commit.transactions.length === 1 && commit.transactions[0].price === 30000);
ok('a normal CSV is not taken for CoinTracking', M.preview('type,symbol,quantity,price,date\nbuy,BTC,1,100,2025-01-01', {}).fixedFormat !== true);

console.log('Add Transaction: start category');
const dc = (txs, pid, allowed) => (typeof U.defaultTxCategory === 'function' ? U.defaultTxCategory(txs, pid, allowed) : null);
ok('defaultTxCategory exists', typeof U.defaultTxCategory === 'function');
ok('no transactions -> crypto', dc([], 'default') === 'crypto');
const txs = [
  { id: '1700000000000', category: 'crypto', portfolioId: 'default' },
  { id: '1700000005000', category: 'stocks', portfolioId: 'default' },
  { id: '1700000003000', category: 'skins', portfolioId: 'default' },
  { id: '1700000009000', category: 'commodities', portfolioId: 'p2' }
];
ok('the category entered last in this portfolio', dc(txs, 'default') === 'stocks');
ok('other portfolios do not count', dc(txs, 'p2') === 'commodities');
ok('missing portfolioId counts as default', dc([{ id: '5', category: 'skins' }], 'default') === 'skins');
ok('a category that no longer exists is ignored', dc([{ id: '1', category: 'stocks' }, { id: '2', category: 'gone' }], 'default', ['crypto', 'stocks']) === 'stocks');

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
