// Regression tests for the money-maths findings of the 2026-10-04 audit
// (docs/AUDIT.md, BUG-008 ...). Each block reproduces the finding with the
// real modules.
// Run: node test/money-audit.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

(function () {
  // ---- BUG-008: CSV import type classification ------------------------------
  console.log('BUG-008 import transaction types');
  const M = require('../import-mapping.js');
  const map = { date: 'd', type: 't', symbol: 's', quantity: 'q', price: 'p' };
  const one = (type, qty, mapping) => M.applyMapping([{ d: '2025-03-01', t: type, s: 'VWCE', q: qty == null ? '2' : qty, p: '100' }], mapping || map, { category: 'stocks' });
  const typeOf = (type) => { const r = one(type); return r.transactions.length ? r.transactions[0].type : 'error'; };

  ok('"Savings plan" is a buy', typeOf('Savings plan') === 'buy');
  ok('"Sparplan" is a buy', typeOf('Sparplan') === 'buy');
  ok('"Sparplanausführung" is a buy', typeOf('Sparplanausführung') === 'buy');
  ok('"Purchase" is a buy', typeOf('Purchase') === 'buy');
  ok('"Wertpapierkauf" stays a buy', typeOf('Wertpapierkauf') === 'buy');
  ok('"Verkauf" stays a sell', typeOf('Verkauf') === 'sell');
  ok('"Market sell" stays a sell', typeOf('Market sell') === 'sell');
  ok('IBKR "B" / "S" still work', typeOf('B') === 'buy' && typeOf('S') === 'sell');
  ok('"Dividend (Ordinary)" stays a dividend', typeOf('Dividend (Ordinary)') === 'dividend');

  const unk = one('Transfer');
  ok('unknown type "Transfer" is a row error, not a trade', unk.transactions.length === 0 && unk.errors.length === 1 && /type/i.test(unk.errors[0].reason) && /Transfer/.test(unk.errors[0].reason));
  ok('unknown types "Fee" / "Convert" / "Send" are errors', ['Fee', 'Convert', 'Send'].every((t) => typeOf(t) === 'error'));

  const noType = { date: 'd', symbol: 's', quantity: 'q', price: 'p' };
  const neg = one(undefined, '-0.5', noType);
  ok('no type column + negative quantity = sell of 0.5', neg.transactions[0].type === 'sell' && approx(neg.transactions[0].quantity, 0.5));
  const pos = one(undefined, '0.5', noType);
  ok('no type column + positive quantity = buy', pos.transactions[0].type === 'buy');
  ok('empty type value + negative quantity = sell', one('', '-1').transactions[0].type === 'sell');
  ok('normalizeType keeps its contract for an empty value (buy)', M.normalizeType('') === 'buy');

  // ---- BUG-009: USD conversions outside the FX history are flagged ----------
  console.log('BUG-009 FX coverage');
  const F = require('../fx-history.js');
  const L = require('../ledger.js');
  const sessionRates = { '2026-09-01': 0.86, '2026-10-04': 0.85 }; // no Worker: live rates of app sessions
  const fxAt = F.fxResolver(0.85, sessionRates);
  const old = F.txToEUR(1000, 'USD', '2022-03-01', 0.85, fxAt);
  ok('2022 USD trade before the history is "approx"', old.status === 'approx');
  ok('... value unchanged (nearest known rate)', approx(old.value, 860));
  ok('covered date stays "exact"', F.txToEUR(1000, 'USD', '2026-10-04', 0.85, fxAt).status === 'exact');
  ok('a date within 7 days after a stored rate stays "exact"', F.txToEUR(1000, 'USD', '2026-09-05', 0.85, fxAt).status === 'exact');
  ok('a date in a long gap between stored rates is "approx"', F.txToEUR(1000, 'USD', '2026-09-20', 0.85, fxAt).status === 'approx');
  ok('empty history: every date is "approx"', F.txToEUR(1000, 'USD', '2026-10-04', 0.85, F.fxResolver(0.85, {})).status === 'approx');
  ok('USD stablecoins follow the same rule', F.txToEUR(1000, 'USDT', '2022-03-01', 0.85, fxAt).status === 'approx');
  const lb = L.build([{ type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, currency: 'USD', date: '2022-03-01' }], { exchangeRate: 0.85, fxAt });
  ok('ledger data check lists the approximate USD conversion', lb.issues.some((i) => i.kind === 'currency' && i.currency === 'USD' && i.status === 'approx'));
  ok('plain resolver use (no fxAt) keeps the static rate as "exact"', F.txToEUR(1000, 'USD', '2022-03-01', 0.85, null).status === 'exact');

  // ---- BUG-010: legacy CSV fallback reads dates day-first, no UTC shift -----
  console.log('BUG-010 legacy CSV dates');
  process.env.TZ = 'Europe/Berlin';
  const IE = require('../import-export-engine.js');
  const legacyDates = IE.importData('Date,Symbol,Quantity,Price\n31.12.2025,AAPL,1,100\n01.02.2025,MSFT,1,100\n2025-03-10,SAP,1,100', 'csv', { broker: 'generic' })
    .transactions.map((t) => String(t.date).slice(0, 10));
  ok('31.12.2025 stays 2025-12-31 (no shift into the day before)', legacyDates[0] === '2025-12-31');
  ok('01.02.2025 is 1 February, not 2 January', legacyDates[1] === '2025-02-01');
  ok('ISO dates unchanged', legacyDates[2] === '2025-03-10');

  // ---- BUG-011: non-positive quantities are reported, not silently dropped --
  console.log('BUG-011 invalid quantities');
  const lq = L.build([
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1500, currency: 'EUR', date: '2024-02-01' },
    { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: -0.5, price: 1800, currency: 'EUR', date: '2024-03-01' },
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 0, price: 1500, currency: 'EUR', date: '2024-03-02' },
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 'abc', price: 1500, currency: 'EUR', date: '2024-03-03' },
    { type: 'dividend', category: 'stocks', symbol: 'ALV', quantity: 0, price: 0, amount: 10, currency: 'EUR', date: '2024-03-04' }
  ], { exchangeRate: 1 });
  const qIssues = lq.issues.filter((i) => i.kind === 'quantity');
  ok('three buy/sell rows with a bad quantity are reported', qIssues.length === 3);
  ok('the issue names the row (type, symbol, date, quantity)', qIssues.some((i) => i.type === 'sell' && i.symbol === 'ETH' && i.date === '2024-03-01' && i.qty === -0.5));
  ok('it is a warning (affects cost basis)', qIssues.every((i) => i.severity === 'warning'));
  ok('dividends are not checked for a trade quantity', !qIssues.some((i) => i.type === 'dividend'));
  ok('the valid buy still builds the position', approx(lq.list[0].openQty, 1));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
