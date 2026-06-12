// Node harness for the options-tracking pure layer: contract identity,
// transaction validation, the signed-contract position builder (EUR at
// ingestion), intrinsic-only market metrics, and the book-level stats. The
// React Panel is browser-only and covered by smoke-views.
// Run: node test/options-engine.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const O = require('../options-engine.js');
const NOW = '2026-06-12T12:00:00Z';

(function run() {
  console.log('options-engine:');

  // ---- contract identity -----------------------------------------------------
  ok('contractSymbol formats the contract', O.contractSymbol({ underlying: 'aapl', optionType: 'call', strike: 150, expiry: '2026-12-18' }) === 'AAPL 2026-12-18 C 150');
  ok('contractSymbol marks puts', /P 90$/.test(O.contractSymbol({ underlying: 'KO', optionType: 'put', strike: 90, expiry: '2026-09-18' })));
  ok('contractSymbol empty on missing fields', O.contractSymbol({ optionType: 'call' }) === '');
  ok('contractKey is case/format stable', O.contractKey({ underlying: ' aapl ', optionType: 'call', strike: 150, expiry: '2026-12-18' }) === O.contractKey({ underlying: 'AAPL', optionType: 'call', strike: '150', expiry: '2026-12-18T00:00:00Z' }));

  // ---- validateOptionTx ---------------------------------------------------------
  const valid = { underlying: 'AAPL', optionType: 'call', strike: 150, expiry: '2026-12-18' };
  ok('valid option tx passes', O.validateOptionTx(valid).ok === true);
  ok('missing underlying rejected', O.validateOptionTx({ ...valid, underlying: ' ' }).ok === false);
  ok('bad option type rejected', O.validateOptionTx({ ...valid, optionType: 'straddle' }).ok === false);
  ok('non-positive strike rejected', O.validateOptionTx({ ...valid, strike: 0 }).ok === false);
  ok('bad expiry rejected', O.validateOptionTx({ ...valid, expiry: 'whenever' }).ok === false);
  ok('bad contract size rejected', O.validateOptionTx({ ...valid, contractSize: -1 }).ok === false);
  ok('empty contract size is fine (default applies)', O.validateOptionTx({ ...valid, contractSize: '' }).ok === true);

  // ---- buildOptionPositions -------------------------------------------------------
  const txs = [
    // Long call, built in two buys (USD premium -> EUR at 0.9)
    { category: 'options', type: 'buy', underlying: 'AAPL', optionType: 'call', strike: 150, expiry: '2026-12-18', quantity: 1, price: 5, fees: 2, currency: 'USD' },
    { category: 'options', type: 'buy', underlying: 'AAPL', optionType: 'call', strike: 150, expiry: '2026-12-18', quantity: 1, price: 7, fees: 0, currency: 'USD' },
    // Short put (premium received, EUR)
    { category: 'options', type: 'sell', underlying: 'SAP.DE', optionType: 'put', strike: 180, expiry: '2026-06-19', quantity: 2, price: 4, fees: 1, currency: 'EUR' },
    // Closed round trip: buy 1 @ 3, sell 1 @ 5 (EUR)
    { category: 'options', type: 'buy', underlying: 'KO', optionType: 'call', strike: 60, expiry: '2026-09-18', quantity: 1, price: 3, fees: 0, currency: 'EUR' },
    { category: 'options', type: 'sell', underlying: 'KO', optionType: 'call', strike: 60, expiry: '2026-09-18', quantity: 1, price: 5, fees: 0, currency: 'EUR' },
    // Noise that must be ignored: other categories, malformed option rows
    { category: 'stocks', type: 'buy', symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD' },
    { category: 'options', type: 'buy', underlying: '', optionType: 'call', strike: 1, expiry: '2026-01-01', quantity: 1, price: 1 },
    { category: 'options', type: 'dividend', underlying: 'AAPL', optionType: 'call', strike: 150, expiry: '2026-12-18', quantity: 1, price: 1 }
  ];
  const book = O.buildOptionPositions(txs, { exchangeRate: 0.9 });
  ok('one position per contract', book.length === 3);
  ok('positions sorted by expiry', book[0].underlying === 'SAP.DE' && book[2].underlying === 'AAPL');

  const aapl = book.find((p) => p.underlying === 'AAPL');
  ok('long side detected', aapl.side === 'long' && aapl.netContracts === 2);
  // Premium paid: (1*5 + 1*7) * 100 shares * 0.9 = 1080; fees 2 * 0.9 = 1.8
  ok('USD premium converts at ingestion', approx(aapl.premiumPaidEUR, 1080));
  ok('fees convert and count against the position', approx(aapl.feesEUR, 1.8));
  ok('net premium is signed (paid -> negative)', approx(aapl.netPremiumEUR, -1081.8));

  const sap = book.find((p) => p.underlying === 'SAP.DE');
  ok('short side detected', sap.side === 'short' && sap.netContracts === -2);
  // Received: 2 * 4 * 100 = 800 EUR, fees 1 -> net +799
  ok('short premium received is positive', approx(sap.netPremiumEUR, 799));

  const koPos = book.find((p) => p.underlying === 'KO');
  ok('round trip nets to closed', koPos.side === 'closed' && koPos.netContracts === 0);
  ok('closed position keeps the realised premium', approx(koPos.netPremiumEUR, 200));
  ok('non-buy/sell and malformed rows are ignored', book.every((p) => p.txCount <= 2));

  // ---- positionMetrics ----------------------------------------------------------------
  // Long AAPL 150C, underlying at 180 EUR... strike is USD -> 135 EUR at 0.9.
  const mLong = O.positionMetrics(aapl, 180, { exchangeRate: 0.9, now: NOW });
  ok('strike converts at the current rate', approx(mLong.strikeEUR, 135));
  ok('call intrinsic per share', approx(mLong.intrinsicPerShare, 45));
  ok('signed intrinsic value (long, 2 contracts)', approx(mLong.intrinsicValueEUR, 2 * 45 * 100));
  ok('est P&L = intrinsic + net premium', approx(mLong.estPnlEUR, 9000 - 1081.8));
  ok('ITM detected', mLong.moneyness === 'ITM' && mLong.status === 'open');
  ok('days to expiry from injectable now', mLong.daysToExpiry === 190);
  ok('notional uses abs contracts x size x strike', approx(mLong.notionalEUR, 2 * 100 * 135));

  // Short SAP 180P, underlying at 170 EUR -> put intrinsic 10, short owes it.
  const mShort = O.positionMetrics(sap, 170, { exchangeRate: 0.9, now: NOW });
  ok('put intrinsic per share', approx(mShort.intrinsicPerShare, 10));
  ok('short intrinsic value is negative', approx(mShort.intrinsicValueEUR, -2 * 10 * 100));
  ok('short est P&L = premium - owed intrinsic', approx(mShort.estPnlEUR, 799 - 2000));

  // OTM + ATM bands
  const mOtm = O.positionMetrics(aapl, 100, { exchangeRate: 0.9, now: NOW });
  ok('OTM call has zero intrinsic', mOtm.intrinsicPerShare === 0 && mOtm.moneyness === 'OTM');
  const mAtm = O.positionMetrics(aapl, 135.2, { exchangeRate: 0.9, now: NOW });
  ok('within 0.5% counts as ATM', mAtm.moneyness === 'ATM');

  // No price -> no intrinsic, but closed/expired still report realised P&L.
  const mNoPrice = O.positionMetrics(aapl, null, { exchangeRate: 0.9, now: NOW });
  ok('no price -> intrinsic unknown', mNoPrice.intrinsicValueEUR === null && mNoPrice.estPnlEUR === null);
  const mClosed = O.positionMetrics(koPos, null, { now: NOW });
  ok('closed position realises the net premium', mClosed.status === 'closed' && approx(mClosed.estPnlEUR, 200) && mClosed.intrinsicValueEUR === 0);
  const expiredPos = { ...sap, expiry: '2026-01-16' };
  const mExpired = O.positionMetrics(expiredPos, null, { exchangeRate: 0.9, now: NOW });
  ok('past expiry -> expired with premium as estimate', mExpired.status === 'expired' && approx(mExpired.estPnlEUR, 799));

  // ---- computeStats ----------------------------------------------------------------------
  const stats = O.computeStats(book, { AAPL: 180, 'SAP.DE': 170 }, { exchangeRate: 0.9, now: NOW });
  ok('stats counts open positions only', stats.openCount === 2 && stats.openContracts === 4);
  ok('stats nets the premium across the book', approx(stats.netPremiumEUR, -1081.8 + 799 + 200));
  ok('stats sums signed intrinsic of open positions', approx(stats.intrinsicValueEUR, 9000 - 2000));
  ok('stats est P&L includes the closed trade', approx(stats.estPnlEUR, (9000 - 1081.8) + (799 - 2000) + 200));
  ok('expiring-soon catches the near contract', stats.expiringSoon.length === 1 && stats.expiringSoon[0].position.underlying === 'SAP.DE');
  ok('price map falls back across cases', O.computeStats([aapl], { aapl: 180 }, { exchangeRate: 0.9, now: NOW }).rows[0].underlyingPriceEUR === 180);

  // ---- hasOptionTransactions ------------------------------------------------------------------
  ok('detects option transactions', O.hasOptionTransactions(txs) === true);
  ok('no options -> false', O.hasOptionTransactions([{ category: 'stocks' }]) === false && O.hasOptionTransactions([]) === false);

  // ---- the non-bending guarantee: MaerminMetrics ignores the options category ----------------
  const M = require('../metrics.js');
  const positions = M.buildPositions(txs, { exchangeRate: 0.9 });
  ok('buildPositions ignores options entirely', positions.stocks.length === 1 && positions.crypto.length === 0);
  const flat = [].concat(positions.crypto, positions.stocks, positions.skins, positions.commodities);
  ok('no option contract leaks into shared positions', flat.every((p) => (p.symbol || '').indexOf('150') === -1));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
