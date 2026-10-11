// Regression test, docs/AUDIT.md run 2026-10-09: the import wizard's mapping pipeline (the one that is
// actually committed) books an exchange PAIR as the symbol and EUR as the
// currency: Binance "BTCUSDT" → symbol BTCUSDT, priced in USDT but counted as
// EUR; Kraken "XXBTZEUR" → symbol XXBTZEUR. Neither gets a price. The legacy
// parser (splitPair) and the API sync (parsePair, H-1) split pairs; this path
// does not.
// Run: node test/audit-import-crypto-pairs.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const IM = require('../import-mapping.js');
const isBtc = (s) => s === 'BTC' || s === 'bitcoin';

console.log('crypto pairs in the mapping import:');
const bn = IM.preview('Date(UTC),Pair,Side,Price,Executed,Amount,Fee\n2025-03-01 10:00:00,BTCUSDT,BUY,90000,0.01,900,0.9', { existing: [], broker: 'binance' });
const b = bn.transactions[0];
ok('Binance BTCUSDT → symbol is the base asset (BTC/bitcoin)', b && isBtc(b.symbol));
ok('Binance BTCUSDT → currency USD (USDT quote), not EUR', b && b.currency === 'USD');

const kr = IM.preview('txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol\nT1,O1,XXBTZEUR,2025-03-01 10:00:00,buy,limit,30000,3000,1,0.1', { existing: [] });
const k = kr.transactions[0];
ok('Kraken XXBTZEUR → symbol BTC/bitcoin', k && isBtc(k.symbol));
ok('Kraken XXBTZEUR → currency EUR', k && k.currency === 'EUR');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
