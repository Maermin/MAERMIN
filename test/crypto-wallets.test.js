// Node harness for P5-3.6 crypto-wallets.js: address checks, the stored state
// (no transactions), duplicates, totals across wallets and the comparison with
// MAERMIN's crypto quantities.
// Run: node test/crypto-wallets.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const WL = require('../crypto-wallets.js');
const sim = require('./wallet-sim.js');

console.log('state:');
ok('seven networks', WL.CHAIN_IDS.length === 7 && WL.chainName('arb') === 'Arbitrum One' && WL.chainName('sol') === 'Solana');
let r = WL.addWallet(null, { chain: 'btc', address: sim.BTC, label: 'Cold storage' });
ok('a valid address is added', !r.error && r.state.wallets.length === 1 && r.state.wallets[0].label === 'Cold storage');
ok('an invalid one is refused', WL.addWallet(r.state, { chain: 'eth', address: sim.BTC }).error === 'invalid' && WL.addWallet(r.state, { chain: 'doge', address: 'D8' }).error === 'invalid');
ok('the same address twice is refused (EVM case-insensitive)', WL.addWallet(r.state, { chain: 'btc', address: sim.BTC }).error === 'duplicate' &&
  WL.addWallet(WL.addWallet(null, { chain: 'eth', address: sim.EVM }).state, { chain: 'eth', address: sim.EVM.toUpperCase().replace('0X', '0x') }).error === 'duplicate');
ok('the same EVM address on another network is a separate wallet', !WL.addWallet(WL.addWallet(null, { chain: 'eth', address: sim.EVM }).state, { chain: 'base', address: sim.EVM }).error);
r = WL.addWallet(r.state, { chain: 'eth', address: sim.EVM });
r = WL.addWallet(r.state, { chain: 'arb', address: sim.EVM });
const [w1, w2, w3] = r.state.wallets;
let s = WL.applySnapshot(r.state, w1.id, { native: { symbol: 'BTC', amount: 1 }, tokens: [], txs: [{ hash: 'b1' }] }, '2025-03-01');
s = WL.applySnapshot(s, w2.id, { native: { symbol: 'ETH', amount: 1.5 }, tokens: [{ symbol: 'usdc', name: 'USD Coin', amount: 2500, contract: '0xa0' }, { symbol: 'X', amount: 0 }], txs: [] }, '2025-03-01');
s = WL.applySnapshot(s, w3.id, { native: { symbol: 'ETH', amount: 0.25 }, tokens: [{ symbol: 'USDC', amount: 100 }] }, '2025-03-01');
const stored = JSON.stringify(s);
ok('balances stored, transactions not', s.wallets[0].native.amount === 1 && s.wallets[0].lastSync === '2025-03-01' && stored.indexOf('"txs"') < 0 && stored.indexOf('"b1"') < 0); // the hash as a JSON value (random wallet ids may contain b1)
ok('token symbols upper-case, zero balances dropped', s.wallets[1].tokens.length === 1 && s.wallets[1].tokens[0].symbol === 'USDC');
ok('a stored wallet with a broken address is dropped on load', WL.normalize({ wallets: [{ chain: 'btc', address: 'nope' }] }).wallets.length === 0);
ok('remove', WL.removeWallet(s, w1.id).wallets.length === 2);

console.log('\ntotals and comparison:');
const t = WL.totals(s);
ok('totals across wallets and networks: ETH 1.75, USDC 2600, BTC 1', t.ETH === 1.75 && t.USDC === 2600 && t.BTC === 1, t);
const txs = [{ category: 'crypto', type: 'buy', symbol: 'btc', quantity: 1.2 }, { category: 'crypto', type: 'sell', symbol: 'BTC', quantity: 0.2 },
  { category: 'crypto', type: 'buy', symbol: 'ETH', quantity: 1.5 }, { category: 'stocks', type: 'buy', symbol: 'USDC', quantity: 9 }];
const c = WL.compare(s, txs);
const by = (k) => c.find((x) => x.symbol === k);
ok('BTC 1 vs 1.2 - 0.2 -> matches', by('BTC').status === 'match' && by('BTC').maermin === 1, by('BTC'));
ok('ETH 1.75 vs 1.5 -> differs by +0.25', by('ETH').status === 'differs' && by('ETH').diff === 0.25, by('ETH'));
ok('USDC only held as a stock row -> not in MAERMIN (crypto only)', by('USDC').status === 'missing');

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
