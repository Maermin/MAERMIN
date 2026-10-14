// Node harness for P5-4.11: US contribution limits (IRA, Roth IRA, 401(k)).
// Limits from the IRS cost-of-living notices: Notice 2024-80 (2025, with the
// 2024 amounts it increases from) and Notice 2025-67 / IR-2025-111 (2026).
// Roth IRA reduction per IRS Publication 590-A (worksheet 2-2).
// Run: node test/us-contrib.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const US = require('../us-contrib.js');
const dep = (pid, date, amount, currency) => ({ type: 'deposit', category: 'cashflow', portfolioId: pid, date, amount, currency: currency || 'USD' });

(function main() {
  console.log('us-contrib:');

  // ---- limits per year and age ------------------------------------------------
  let l = US.limitsFor(2026, 1990);
  ok('2026, age 36: 401(k) 24,500, IRA 7,500', l.k401 === 24500 && l.ira === 7500 && !l.estimated, l);
  l = US.limitsFor(2026, 1975);
  ok('2026, age 51: catch-up 8,000 (401(k)) and 1,100 (IRA)', l.k401 === 32500 && l.ira === 8600, l);
  l = US.limitsFor(2026, 1964);
  ok('2026, age 62: the SECURE 2.0 catch-up of 11,250 for ages 60-63', l.k401 === 35750 && l.ira === 8600, l);
  l = US.limitsFor(2026, 1962);
  ok('2026, age 64: back to the 50+ catch-up', l.k401 === 32500, l);
  l = US.limitsFor(2025, 1965);
  ok('2025, age 60: 23,500 + 11,250; IRA 7,000 + 1,000', l.k401 === 34750 && l.ira === 8000, l);
  l = US.limitsFor(2024, 1990);
  ok('2024: 401(k) 23,000, IRA 7,000; no 60-63 catch-up yet', l.k401 === 23000 && l.ira === 7000 && US.limitsFor(2024, 1962).k401 === 30500, l);
  l = US.limitsFor(2027, 1990);
  ok('2027 not published yet: the 2026 amounts, marked estimated', l.k401 === 24500 && l.ira === 7500 && l.estimated === true, l);
  ok('no birth year: no catch-up', US.limitsFor(2026, null).k401 === 24500);

  // ---- Roth IRA phase-out ------------------------------------------------------------
  ok('Roth 2026 single, MAGI 160,500: half of 7,500 = 3,750', US.rothLimit(2026, 7500, 160500, 'single') === 3750);
  ok('Roth 2026 single, MAGI 167,900: at least 200', US.rothLimit(2026, 7500, 167900, 'single') === 200);
  ok('Roth 2026 single, MAGI 168,000: nothing', US.rothLimit(2026, 7500, 168000, 'single') === 0);
  ok('Roth 2026 joint, MAGI 245,000: 7,500 x 0.7 = 5,250', US.rothLimit(2026, 7500, 245000, 'mfj') === 5250);
  ok('Roth 2025 single, MAGI 151,234: 6,424.13 rounded up to 6,430', US.rothLimit(2025, 7000, 151234, 'single') === 6430);
  ok('Roth 2026 single with catch-up, MAGI 160,500: 4,300', US.rothLimit(2026, 8600, 160500, 'single') === 4300);
  ok('Roth married filing separately: phased out between 0 and 10,000', US.rothLimit(2026, 7500, 5000, 'mfs') === 3750);
  ok('Roth below the range: the full limit', US.rothLimit(2026, 7500, 120000, 'single') === 7500);

  // ---- contributions from the deposits ------------------------------------------
  const settings = { birthYear: 1990, filing: 'single', accounts: { R: 'roth-ira', T: 'ira', K: '401k' } };
  const txs = [
    dep('R', '2026-02-01', 3000), dep('T', '2026-03-01', 2000),
    dep('T', '2026-04-10', 900, 'EUR'),
    { type: 'transfer_in', category: 'cashflow', portfolioId: 'T', date: '2026-05-01', amount: 10000, currency: 'USD' },
    { type: 'withdrawal', category: 'cashflow', portfolioId: 'R', date: '2026-06-01', amount: 500, currency: 'USD' },
    dep('X', '2026-02-01', 9999),
    dep('T', '2027-03-10', 1000)
  ];
  for (let m = 1; m <= 6; m++) txs.push(dep('K', '2026-0' + m + '-15', 2000));
  let r = US.compute(txs, settings, { year: 2026, exchangeRate: 0.9, today: '2026-10-14' });
  ok('IRA: deposits of both IRAs count together (3,000 + 2,000 + 900 EUR / 0.9 = 6,000)', r.ira.contributed === 6000 && r.ira.limit === 7500 && r.ira.remaining === 1500, r.ira);
  ok('rollovers (transfers), withdrawals and other portfolios do not count', r.accounts.find((a) => a.portfolioId === 'T').contributed === 3000);
  ok('Roth without MAGI: the full limit, flagged', r.ira.roth.limit === 7500 && r.ira.roth.magiMissing === true, r.ira.roth);
  ok('401(k): 6 x 2,000 = 12,000 of 24,500', r.k401.contributed === 12000 && r.k401.remaining === 12500, r.k401);
  ok('deadlines: IRA 15 April of the next year, 401(k) 31 December', r.ira.deadline === '2027-04-15' && r.k401.deadline === '2026-12-31');

  // An IRA deposit in early 2027 designated for 2026; employer money in the 401(k).
  const s2 = Object.assign({}, settings, { magi: { 2026: 160500 }, priorYear: { T: { 2026: 1000 } }, employer: { K: { 2026: 3000 } } });
  r = US.compute(txs, s2, { year: 2026, exchangeRate: 0.9, today: '2026-10-14' });
  ok('a deposit by 15 April 2027 designated for 2026 counts for 2026', r.ira.contributed === 7000 && r.ira.remaining === 500, r.ira);
  ok('Roth with MAGI 160,500: limit 3,750, 3,000 used; 500 left (the shared IRA limit is lower)', r.ira.roth.limit === 3750 && r.ira.roth.contributed === 3000 && r.ira.roth.remaining === 500, r.ira.roth);
  ok('employer contributions do not count against the 402(g) limit', r.k401.contributed === 9000 && r.k401.employer === 3000 && r.k401.remaining === 15500, r.k401);
  const r27 = US.compute(txs, s2, { year: 2027, exchangeRate: 0.9, today: '2027-01-20' });
  ok('...and not again for 2027', r27.ira.contributed === 0 && r27.limits.estimated === true, r27.ira);

  // Excess contributions.
  const over = txs.concat([dep('K', '2026-09-01', 14000), dep('R', '2026-09-02', 2500)]);
  r = US.compute(over, settings, { year: 2026, exchangeRate: 0.9, today: '2026-10-14' });
  ok('401(k) over the limit: excess 1,500 flagged', r.k401.excess === 1500 && r.k401.remaining === 0, r.k401);
  ok('IRA over the limit: excess 1,000 flagged', r.ira.excess === 1000 && r.ira.remaining === 0, r.ira);

  // ---- storage ------------------------------------------------------------------------
  US.saveSettings({ birthYear: '1980', filing: 'mfj', magi: { 2026: '250000', x: 1 }, accounts: { A: 'roth-ira', B: 'bogus' }, priorYear: { A: { 2025: '500' } } });
  const st = US.loadSettings();
  ok('settings: numbers, filing status, known account types only', st.birthYear === 1980 && st.filing === 'mfj' && st.magi['2026'] === 250000 && !st.magi.x && st.accounts.A === 'roth-ira' && !st.accounts.B && st.priorYear.A['2025'] === 500, st);
  const storage = require('fs').readFileSync(require('path').join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = require('fs').readFileSync(require('path').join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('maermin_us_retirement is encrypted and in the backup', /'maermin_us_retirement'/.test(storage) && /'maermin_us_retirement'/.test(backup));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
