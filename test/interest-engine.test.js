// Node harness for the Interest engine (WI-2). Pure, no browser.
// Run: node test/interest-engine.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

const I = require('../interest-engine.js');

(function run() {
  console.log('interest-engine:');

  // ---- daysBetween act/365 ----
  ok('daysBetween counts calendar days', I.daysBetween('2026-01-01', '2026-01-31') === 30);
  ok('daysBetween never negative', I.daysBetween('2026-02-01', '2026-01-01') === 0);

  // ---- isInterestBearing ----
  ok('time_deposit with rate is bearing', I.isInterestBearing({ type: 'time_deposit', interestRate: 2.5, startDate: '2026-01-01' }));
  ok('cash with rate is bearing', I.isInterestBearing({ type: 'cash', interestRate: 2.5, startDate: '2026-01-01' }));
  ok('cash with no rate is not bearing', !I.isInterestBearing({ type: 'cash', interestRate: 0, startDate: '2026-01-01' }));
  ok('loan is never bearing', !I.isInterestBearing({ type: 'loan', interestRate: 5, startDate: '2026-01-01' }));
  ok('no anchor -> not bearing', !I.isInterestBearing({ type: 'time_deposit', interestRate: 2.5 }));

  // ---- accrue daily over 365 days at 2.5% ----
  const acc = { id: 'a1', name: 'Tagesgeld', type: 'cash', value: 10000, interestRate: 2.5, compounding: 'daily', startDate: '2026-01-01' };
  const r = I.accrue(acc, '2027-01-01'); // 365 days
  ok('accrue 365 days has 365 day count', r.days === 365);
  // daily compounding factor (1+r/365)^365
  const expected = 10000 * (Math.pow(1 + 0.025 / 365, 365) - 1);
  ok('daily accrual matches (1+r/365)^365', near(r.interest, expected, 1e-6));
  ok('newBalance = value + interest', near(r.newBalance, 10000 + expected, 1e-6));
  ok('lastAccrualDate advances to asOf', r.lastAccrualDate === '2027-01-01');

  // ---- compounding variants over the same window ----
  const annual = I.accrue(Object.assign({}, acc, { compounding: 'annual' }), '2027-01-01');
  ok('annual compounding ~ simple over 1y', near(annual.interest, 10000 * 0.025, 1e-6));
  const monthly = I.accrue(Object.assign({}, acc, { compounding: 'monthly' }), '2027-01-01');
  ok('monthly compounding > annual', monthly.interest > annual.interest);
  ok('daily compounding > monthly', r.interest > monthly.interest);

  // ---- Festgeld stops at maturity ----
  const fd = { id: 'fd', name: 'Festgeld', type: 'time_deposit', value: 10000, interestRate: 3, compounding: 'annual', startDate: '2026-01-01', maturityDate: '2026-07-01' };
  const past = I.accrue(fd, '2027-01-01'); // asOf well past maturity
  ok('accrual stops at maturity date', past.toDate === '2026-07-01');
  const daysToMat = I.daysBetween('2026-01-01', '2026-07-01');
  ok('matured interest uses days to maturity only', near(past.interest, 10000 * (Math.pow(1.03, daysToMat / 365) - 1), 1e-6));

  // ---- idempotency: same-day re-run books nothing ----
  let accounts = [acc];
  const pass1 = I.accrueAll(accounts, '2027-01-01');
  ok('first accrueAll books one posting', pass1.postings.length === 1);
  const pass2 = I.accrueAll(pass1.accounts, '2027-01-01'); // lastAccrualDate now 2027-01-01
  ok('second accrueAll same day books nothing', pass2.postings.length === 0);
  ok('balance unchanged on re-run', near(pass2.accounts[0].value, pass1.accounts[0].value, 1e-9));

  // ---- runCatchUp books a type:interest transaction, idempotently ----
  const cu1 = I.runCatchUp({ accounts: [acc], transactions: [], asOf: '2027-01-01' });
  ok('runCatchUp creates one interest tx', cu1.created.length === 1 && cu1.created[0].type === 'interest');
  ok('interest tx carries the accrual marker', cu1.created[0].source === 'interest-accrual' && cu1.created[0].accountId === 'a1');
  ok('interest tx amount matches accrual', near(cu1.created[0].amount, expected, 1e-6));
  const cu2 = I.runCatchUp({ accounts: cu1.accounts, transactions: cu1.transactions, asOf: '2027-01-01' });
  ok('runCatchUp idempotent (no second tx)', cu2.created.length === 0 && cu2.transactions.length === 1);

  // ---- ledger ----
  ok('ledger has one entry after catch-up', cu1.ledger.entries.length === 1);
  ok('yearlyInterest sums the year', near(I.yearlyInterest(cu1.ledger, 2027), expected, 1e-6));
  ok('yearlyInterest other year = 0', I.yearlyInterest(cu1.ledger, 2025) === 0);
  const reappend = I.appendLedger(cu1.ledger, cu1.postings);
  ok('appendLedger idempotent on (accountId, periodEnd)', reappend.entries.length === 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
