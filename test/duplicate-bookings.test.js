// Node harness for P1-1 (FINDINGS.md C-1, C-2, C-3): automatic bookings must
// never double. Uses the real modules, including the sync merge.
// Run: node test/duplicate-bookings.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.005 : eps); }

const X = require('../exchange-sync.js');
const D = require('../dividend-executor.js');
const I = require('../interest-engine.js');
const S = require('../sync-engine.js');

// Merge two devices' transaction lists the way the cloud sync does.
function syncMerge(a, b) { return JSON.parse(S.unionTransactions(JSON.stringify(a), JSON.stringify(b)).str); }
function sumInterest(txs) { return txs.filter(t => t.type === 'interest').reduce((s, t) => s + t.amount, 0); }

(function run() {
  console.log('duplicate-bookings:');

  // ---- C-1: "Sync now" twice imports every trade twice ----------------------
  const krakenRaw = { result: { trades: {
    TX1: { pair: 'XBTEUR', type: 'buy', price: '30000', vol: '0.1', fee: '1', time: 1767225600 },
    TX2: { pair: 'XBTEUR', type: 'sell', price: '32000', vol: '0.05', fee: '1', time: 1767312000 }
  } } };
  const mapped = X.mapTrades('kraken', krakenRaw);
  // Both runs start from the same snapshot (props.existing), so both pass dedupe.
  const run1 = X.mergeSync([], mapped, { portfolioId: 'default' });
  const run2 = X.mergeSync([], mapped, { portfolioId: 'default' });
  let store = [];
  store = X.appendNew(store, run1.added);
  store = X.appendNew(store, run2.added);
  ok('C-1: two overlapping syncs append each trade once', store.length === 2);
  ok('C-1: a second sync of one connection cannot start while the first runs',
    X.beginSync('conn-1') === true && X.beginSync('conn-1') === false);
  X.endSync('conn-1');
  ok('C-1: after it finishes, the connection can sync again', X.beginSync('conn-1') === true);
  X.endSync('conn-1');

  // ---- C-2: auto-booking adds a second row for a dividend already entered ----
  const holdings = [{ id: 'b1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 150, date: '2026-01-05', portfolioId: 'default' }];
  const sched = [{ symbol: 'AAPL', date: '2026-08-14', perShare: 0.26, shares: 10, amount: 2.6, currency: 'USD', past: true }];
  const manual = { id: 'm1', type: 'dividend', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 0.26, currency: 'USD', date: '2026-08-14', portfolioId: 'default' };
  const c2 = D.runCatchUp(sched, holdings.concat([manual]), 'default', 'seed');
  ok('C-2: a manual dividend on the pay date counts as booked (1 row)',
    c2.transactions.filter(t => t.type === 'dividend' && t.date === '2026-08-14').length === 1);
  const imported = Object.assign({}, manual, { id: 'csv1', date: '2026-08-12', source: 'csv-import' });
  ok('C-2: an imported dividend within 3 days of the pay date counts as booked',
    D.runCatchUp(sched, holdings.concat([imported]), 'default', 'seed').created.length === 0);
  const tooEarly = Object.assign({}, manual, { id: 'm2', date: '2026-08-10' });
  ok('C-2: a dividend 4 days away does not block the booking',
    D.runCatchUp(sched, holdings.concat([tooEarly]), 'default', 'seed').created.length === 1);
  const otherPf = Object.assign({}, manual, { id: 'm3', portfolioId: 'p2' });
  ok('C-2: a dividend in another portfolio does not block the booking',
    D.runCatchUp(sched, holdings.concat([otherPf]), 'default', 'seed').created.length === 1);
  const otherSym = Object.assign({}, manual, { id: 'm4', symbol: 'MSFT' });
  ok('C-2: a dividend of another symbol does not block the booking',
    D.runCatchUp(sched, holdings.concat([otherSym]), 'default', 'seed').created.length === 1);

  // ---- C-3: two devices book the same period, then sync merges them ---------
  // Interest: 50,000 EUR at 3 %, accrued on device A to 03-01, on B to 03-03.
  const acc0 = { id: 'fg', name: 'Tagesgeld', type: 'cash', interestRate: 3, compounding: 'daily', value: 50000, currency: 'EUR', startDate: '2026-01-01' };
  const devA = I.runCatchUp({ accounts: [acc0], transactions: [], asOf: '2026-03-01' });
  const devB = I.runCatchUp({ accounts: [acc0], transactions: [], asOf: '2026-03-03' });
  const mergedTx = syncMerge(devA.transactions, devB.transactions);
  ok('C-3 repro: the sync union holds both accruals (494.35 EUR)', near(sumInterest(mergedTx), 494.35));

  // The accounts key is last-write-wins: either device's version can survive.
  const winB = I.dedupeAccruals(mergedTx, devB.accounts, devB.ledger);
  ok('C-3: B\'s accounts win -> one accrual, 251.30 EUR', near(sumInterest(winB.transactions), 251.30) && winB.removed === 1);
  ok('C-3: B\'s account balance matches the booked interest', near(winB.accounts[0].value, 50000 + sumInterest(winB.transactions)));
  ok('C-3: lastAccrualDate stays on the kept accrual (03-03)', winB.accounts[0].lastAccrualDate === '2026-03-03');
  ok('C-3: the interest ledger keeps one entry', winB.ledger.entries.length === 1 && near(winB.ledger.entries[0].amount, 251.30));

  const winA = I.dedupeAccruals(mergedTx, devA.accounts, devB.ledger);
  ok('C-3: A\'s accounts win -> A\'s accrual kept, lastAccrualDate 03-01',
    winA.removed === 1 && near(sumInterest(winA.transactions), 243.04) && winA.accounts[0].lastAccrualDate === '2026-03-01');
  ok('C-3: the ledger follows the kept accrual', winA.ledger.entries.length === 1 && winA.ledger.entries[0].date === '2026-03-01');
  const next = I.runCatchUp({ accounts: winA.accounts, transactions: winA.transactions, asOf: '2026-03-03', ledger: winA.ledger });
  ok('C-3: the next catch-up books only the gap -> 251.30 EUR in total', near(sumInterest(next.transactions), 251.30, 0.02));
  ok('C-3: the balance matches the booked interest', near(next.accounts[0].value, 50000 + sumInterest(next.transactions)));

  const again = I.dedupeAccruals(winB.transactions, winB.accounts, winB.ledger);
  ok('C-3: dedupe is idempotent', again.removed === 0 && again.transactions === winB.transactions);
  // Both devices run the dedupe on the same merged data and must agree.
  const onA = I.dedupeAccruals(syncMerge(devB.transactions, devA.transactions), devB.accounts, devB.ledger);
  ok('C-3: the survivor does not depend on merge order',
    onA.transactions.map(t => t.id).sort().join() === winB.transactions.map(t => t.id).sort().join());

  // Two consecutive accruals on one device are a chain, not duplicates.
  const step1 = I.runCatchUp({ accounts: [acc0], transactions: [], asOf: '2026-02-01' });
  const step2 = I.runCatchUp({ accounts: step1.accounts, transactions: step1.transactions, asOf: '2026-03-01' });
  ok('C-3: consecutive accruals are kept', I.dedupeAccruals(step2.transactions, step2.accounts).removed === 0);
  // Device B diverged after step1 and accrued twice.
  const b1 = I.runCatchUp({ accounts: step1.accounts, transactions: step1.transactions, asOf: '2026-02-15' });
  const b2 = I.runCatchUp({ accounts: b1.accounts, transactions: b1.transactions, asOf: '2026-03-05' });
  const chain = I.dedupeAccruals(syncMerge(step2.transactions, b2.transactions), b2.accounts);
  ok('C-3: a longer chain on the winning device survives whole',
    chain.removed === 1 && near(chain.accounts[0].value, 50000 + sumInterest(chain.transactions)));
  // Legacy rows (no periodStart) with distinct period ends are never dropped.
  const legacy = [
    { id: 'l1', type: 'interest', source: 'interest-accrual', accountId: 'fg', periodEnd: '2026-02-01', amount: 5 },
    { id: 'l2', type: 'interest', source: 'interest-accrual', accountId: 'fg', periodEnd: '2026-02-03', amount: 6 },
    { id: 'l0', type: 'interest', source: 'interest-accrual', accountId: 'fg', periodEnd: '2026-02-03', amount: 6 }
  ];
  const lg = I.dedupeAccruals(legacy, [Object.assign({}, acc0, { lastAccrualDate: '2026-02-03' })]);
  ok('C-3: legacy accruals - only the exact same period is a duplicate (smallest id kept)',
    lg.removed === 1 && lg.transactions.map(t => t.id).sort().join() === 'l0,l1');

  // Auto-dividend: each device books the same payout under its own id.
  const dA = D.runCatchUp(sched, holdings, 'default', 'a-1');
  const dB = D.runCatchUp(sched, holdings, 'default', 'b-1');
  const dMerged = syncMerge(dA.transactions, dB.transactions);
  ok('C-3 repro: the sync union holds two auto-dividends', dMerged.filter(t => t.type === 'dividend').length === 2);
  const dd = D.dedupeBooked(dMerged);
  ok('C-3: one auto-dividend survives, the smallest id', dd.removed === 1 &&
    dd.transactions.filter(t => t.type === 'dividend').map(t => t.id).join() === dA.created[0].id);
  ok('C-3: manual dividends are never touched by the dedupe',
    D.dedupeBooked([manual, Object.assign({}, manual, { id: 'm0' })]).removed === 0);

  // Exchange import: both devices synced the same exchange account.
  const eA = X.mergeSync([], mapped, { portfolioId: 'default' });
  const eB = X.mergeSync([], mapped, { portfolioId: 'default' });
  const eMerged = syncMerge(eA.transactions, eB.transactions);
  ok('C-3 repro: the sync union holds every trade twice', eMerged.length === 4);
  const ed = X.dedupeImported(eMerged);
  ok('C-3: one row per exchange|externalId survives', ed.removed === 2 && ed.transactions.length === 2);
  const smallest = ['TX1', 'TX2'].map(id => eMerged.filter(t => t.externalId === id).map(t => String(t.id)).sort()[0]);
  ok('C-3: the survivor is the smallest id', ed.transactions.every(t => smallest.indexOf(String(t.id)) > -1));
  ok('C-3: dedupe leaves rows without an external id alone',
    X.dedupeImported([{ id: '1', symbol: 'BTC' }, { id: '2', symbol: 'BTC' }]).removed === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
