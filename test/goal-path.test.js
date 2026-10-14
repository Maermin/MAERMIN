// Node harness for P5-5.7: saving goals with a target date, a glide path and
// an on-track status, linked to portfolios or tags.
//   - fv / requiredMonthly: monthly compounding at an expected yearly return;
//   - glidePath: the planned value month by month from the start value with
//     the monthly contribution;
//   - status: today's value against the planned value (ahead / on track /
//     behind within +-5 %), reached / missed, what it takes from here;
//   - linkedValue: the goal's money from its portfolios or tags (or the amount
//     typed in for an unlinked goal);
//   - equityGlide / riskShare: the suggested share in shares and other risky
//     assets, lowered over the last years before the target, against the
//     linked holdings' actual share.
// Run: node test/goal-path.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const approx = (a, b, e) => a != null && Math.abs(a - b) < (e || 1e-6);
const G = require('../goal-path.js');
const Tags = require('../tags.js');

(function main() {
  console.log('goal path:');

  // ---- maths -----------------------------------------------------------------------
  ok('fv without return: start + monthly x months', approx(G.fv(1000, 100, 0, 12), 2200));
  ok('fv: 12 % a year compounds to exactly 12 % over 12 months', approx(G.fv(1000, 0, 0.12, 12), 1120, 1e-6));
  ok('fv: 100 a month for 10 years at 5 % a year = 15,436.32', approx(G.fv(0, 100, 0.05, 120), 15436.32, 0.01), G.fv(0, 100, 0.05, 120));
  ok('requiredMonthly: 10,000 in 10 months without return = 1,000', approx(G.requiredMonthly(10000, 0, 0, 10), 1000));
  ok('requiredMonthly inverts fv', approx(G.requiredMonthly(15436.32, 0, 0.05, 120), 100, 0.001));
  ok('requiredMonthly: already enough = 0; no time left = null', G.requiredMonthly(1000, 2000, 0.05, 12) === 0 && G.requiredMonthly(1000, 0, 0.05, 0) === null);

  // ---- glide path and status ---------------------------------------------------------
  const goal = { id: 'g1', name: 'Flat', targetAmount: 40000, targetDate: '2031-01-01', startDate: '2026-01-01', startValue: 10000, monthlyContribution: 500, expectedReturn: 0 };
  const path = G.glidePath(goal);
  ok('glide path: monthly points from start to target, 10,000 -> 40,000', path.length === 61 && path[0].date === '2026-01-01' && path[0].value === 10000 && path[60].date === '2031-01-01' && approx(path[60].value, 40000), { n: path.length, last: path[path.length - 1] });
  ok('glide path: month 6 is 13,000', path[6].date === '2026-07-01' && approx(path[6].value, 13000));
  const on = G.status(goal, 13000, { asOf: '2026-07-01' });
  ok('on track: exactly on the path', on.state === 'on-track' && approx(on.planned, 13000) && approx(on.ratio, 1), on);
  ok('ahead: 14,000 is more than 5 % above the path', G.status(goal, 14000, { asOf: '2026-07-01' }).state === 'ahead');
  ok('on track within 5 %: 12,500', G.status(goal, 12500, { asOf: '2026-07-01' }).state === 'on-track');
  const behind = G.status(goal, 12000, { asOf: '2026-07-01' });
  ok('behind: 12,000 is more than 5 % below', behind.state === 'behind' && behind.monthsLeft === 54, behind);
  ok('behind: needs 518.52 a month from here; 500 a month ends at 39,000', approx(behind.requiredMonthly, 518.5185, 0.001) && approx(behind.projected, 39000), behind);
  ok('reached: the target is there', G.status(goal, 40000, { asOf: '2028-01-01' }).state === 'reached' && G.status(goal, 40000, { asOf: '2028-01-01' }).progressPercent === 100);
  ok('missed: the date passed below the target', G.status(goal, 30000, { asOf: '2031-02-01' }).state === 'missed');
  ok('invalid: no positive target', G.status({ targetAmount: 0, targetDate: '2030-01-01' }, 5, { asOf: '2026-01-01' }).state === 'invalid');
  const grow = Object.assign({}, goal, { expectedReturn: 0.06 });
  ok('with a return the path bends upwards (month 30 above the straight line)', G.glidePath(grow)[30].value > 10000 + 500 * 30 + 1);
  const nostart = { targetAmount: 20000, targetDate: '2028-01-01', monthlyContribution: 300, createdAt: '2026-01-01T09:00:00Z', currentAmount: 5000 };
  ok('an older goal without start fields starts at its creation date with its current amount', G.glidePath(nostart)[0].date === '2026-01-01' && G.glidePath(nostart)[0].value === 5000);

  // ---- linked value ------------------------------------------------------------------
  const txs = [
    { type: 'buy', symbol: 'AAPL', category: 'stocks', quantity: 10, portfolioId: 'p1' },
    { type: 'buy', symbol: 'AGGH', category: 'bonds', quantity: 20, portfolioId: 'p1' },
    { type: 'buy', symbol: 'BTC', category: 'crypto', quantity: 1, portfolioId: 'p2' },
    { type: 'buy', symbol: 'VWCE.DE', category: 'stocks', quantity: 5 },
    { type: 'sell', symbol: 'AAPL', category: 'stocks', quantity: 4, portfolioId: 'p1' }
  ];
  const prices = { AAPL: 100, AGGH: 5, btc: 30000, 'VWCE.DE': 120 };
  const byPf = G.linkedValue({ link: { type: 'portfolio', ids: ['p1'] } }, { transactions: txs, prices });
  ok('linked to a portfolio: its holdings only (6 AAPL + 20 AGGH = 700)', byPf.linked && approx(byPf.value, 700) && byPf.positions.length === 2, byPf);
  ok('the default portfolio is "default" for old transactions', approx(G.linkedValue({ link: { type: 'portfolio', ids: ['default'] } }, { transactions: txs, prices }).value, 600));
  let st = Tags.assign(Tags.assign(null, 'Growth', 'AAPL'), 'Growth', 'btc');
  const byTag = G.linkedValue({ link: { type: 'tag', ids: ['growth'] } }, { transactions: txs, prices, tagsState: st });
  ok('linked to a tag: every holding with it, across portfolios (600 + 30,000)', byTag.linked && approx(byTag.value, 30600), byTag);
  const manual = G.linkedValue({ currentAmount: 1234 }, { transactions: txs, prices });
  ok('not linked: the amount typed in', !manual.linked && manual.value === 1234);

  // ---- risk glide --------------------------------------------------------------------
  const g2 = { targetDate: '2031-01-01' };
  ok('equity glide: 90 % with 5 or more years left', G.equityGlide(g2, '2026-01-01') === 90 && G.equityGlide(g2, '2020-01-01') === 90);
  ok('equity glide: 55 % with 2.5 years left, 20 % at the target', approx(G.equityGlide(g2, '2028-07-02'), 55, 0.1) && G.equityGlide(g2, '2031-01-01') === 20 && G.equityGlide(g2, '2032-01-01') === 20);
  ok('equity glide: own start, end and years', G.equityGlide({ targetDate: '2031-01-01', glide: { start: 80, end: 40, years: 10 } }, '2026-01-01') === 60);
  ok('risk share: shares, crypto and items count as risky, bonds and cash not', approx(G.riskShare([{ category: 'stocks', valueEUR: 600 }, { category: 'bonds', valueEUR: 300 }, { category: 'cash', valueEUR: 100 }]), 60) && G.riskShare([]) === null);
  ok('risk share of the portfolio-linked goal: 600 of 700', approx(G.riskShare(byPf.positions), 85.714, 0.01));

  // ---- the stored goal ---------------------------------------------------------------
  const n = G.normalizeGoal({ id: 'x', name: 'Old', targetAmount: '25000', currentAmount: '100', targetDate: '2030-06-01', monthlyContribution: '250', createdAt: '2025-03-04T10:00:00Z' });
  ok('an old goal is read with numbers and safe defaults (5 % return, no link)', n.targetAmount === 25000 && n.monthlyContribution === 250 && n.expectedReturn === 0.05 && n.link === null && n.startDate === '2025-03-04', n);
  ok('a link of an unknown type is dropped', G.normalizeGoal({ targetAmount: 1, link: { type: 'planet', ids: ['x'] } }).link === null);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
