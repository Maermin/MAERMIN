// Employee equity: ESPP (PLAN-EQUITY Package 4) - income timeline, variable
// contributions incl. a bonus month over the cap, payslip overrides, lookback
// with price rise and drop, carry / refund, FX at purchase vs monthly,
// withdrawal, CHF salary with a USD share, sale right after purchase, return.
// Run: node test/equity-espp.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
const S = require('../equity-espp.js');
const E = require('../equity-model.js');
const L = require('../ledger.js');
const DAY = 86400000;
const dn = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

const INCOME = E.normalizeIncome({ entries: [
  { id: 'b1', from: '2025-01-01', to: '2025-04-15', kind: 'base', period: 'year', amount: 60000, currency: 'EUR' },
  { id: 'b2', from: '2025-04-16', kind: 'base', period: 'year', amount: 72000, currency: 'EUR' },
  { id: 'bo', from: '2025-03-31', kind: 'bonus', period: 'once', amount: 6000, currency: 'EUR' },
  { id: 'th', from: '2025-11-30', kind: '13th', period: 'once', amount: 6000, currency: 'EUR' },
  { id: 'pl', from: '2026-01-01', to: '2026-02-28', kind: 'base', period: 'year', amount: 0, currency: 'EUR' }   // parental leave
] }).entries;

console.log('income timeline:');
ok('a month of base pay', near(S.monthIncome(INCOME, '2025-01').byKind.base, 5000));
ok('raise on the 16th: prorated by day (15 × 5,000 + 15 × 6,000) / 30', near(S.monthIncome(INCOME, '2025-04').byKind.base, 5500));
ok('bonus in its month', S.monthIncome(INCOME, '2025-03').byKind.bonus === 6000 && S.monthIncome(INCOME, '2025-04').byKind.bonus === 0);
ok('13th salary in November', S.monthIncome(INCOME, '2025-11').byKind['13th'] === 6000);
ok('parental leave = 0, then the salary again', S.monthIncome(INCOME, '2026-02').byKind.base === 0 && near(S.monthIncome(INCOME, '2026-03').byKind.base, 6000));
const pt = E.normalizeIncome({ entries: [{ id: 'p', from: '2025-01-01', kind: 'base', period: 'year', amount: 60000, currency: 'EUR', ftePct: 80 }] }).entries;
ok('part-time 80 %', near(S.monthIncome(pt, '2025-05').byKind.base, 4000));
const s0 = S.normalizeSettings({ eligible: 'base' });
const inc = S.monthIncome(INCOME, '2025-11');
ok('eligible pay: base only / base + bonus / custom', S.eligibleOf(inc, s0) === 6000 && S.eligibleOf(S.monthIncome(INCOME, '2025-03'), S.normalizeSettings({ eligible: 'base_bonus' })) === 11000
  && S.eligibleOf(inc, S.normalizeSettings({ eligible: 'custom', customKinds: { base: true, '13th': true } })) === 12000);

console.log('contribution %:');
const ph = S.normalizeSettings({ pctHistory: [{ from: '2025-01-01', pct: 10 }, { from: '2025-03-01', pct: 5 }, { from: '2025-08-01', pct: 12 }] });
ok('fixed at the offering start by default', S.pctAt(ph, '2025-04-01', '2025-01-01') === 10 && S.pctAt(ph, '2025-09-01', '2025-07-01') === 5);
const dec = S.normalizeSettings({ midPeriodDecrease: true, pctHistory: ph.pctHistory });
ok('a mid-period decrease when allowed, never an increase', S.pctAt(dec, '2025-04-01', '2025-01-01') === 5 && S.pctAt(dec, '2025-09-01', '2025-07-01') === 5);

console.log('offerings:');
const off = S.offerings(S.normalizeSettings({ anchor: '2025-01-01', periodMonths: 6 }), '2026-03-01');
ok('6-month offerings, purchase on the last day', off.length === 3 && off[0].end === '2025-06-30' && off[1].start === '2025-07-01' && off[1].end === '2025-12-31');
ok('purchase price with lookback: rise -> start FMV, drop -> end FMV', near(S.purchasePrice(15, true, 100, 120).price, 85) && near(S.purchasePrice(15, true, 100, 80).price, 68) && near(S.purchasePrice(15, false, 100, 120).price, 102));

// ---- a full offering --------------------------------------------------------------
const PLAN = { id: 'p', ticker: 'ACME', shareCurrency: 'USD', portfolioId: 'pf', taxCountry: 'DE', salaryCurrency: 'EUR' };
const series = (end) => ({ cur: 'USD', d: [dn('2024-12-31'), dn('2025-06-30'), dn('2025-12-31')], p: [100, end, 130] });
const fxCtx = { series: (c) => (c === 'USD' ? [{ d: '2024-12-20', r: 0.9 }] : c === 'CHF' ? [{ d: '2024-12-20', r: 1.05 }] : []), maxGapDays: 400 };
const grant = (contribution) => ({ id: 'g', planId: 'p', type: 'ESPP', grantDate: '2025-01-01', contribution: Object.assign({
  anchor: '2025-01-01', periodMonths: 6, discountPct: 15, lookback: true, pctHistory: [{ from: '2025-01-01', pct: 10 }],
  eligible: 'base_bonus', caps: { periodAmount: 3500, excess: 'carry' }, leftover: 'carry' }, contribution || {}) });
const st = (g) => E.normalize({ plans: [PLAN], grants: [g] });
const sched = (g, end, today, extra) => S.schedule(st(g), E.normalize({ plans: [PLAN], grants: [g] }).grants[0], Object.assign({ today: today || '2025-07-15', income: INCOME, closes: () => series(end), fxCtx }, extra || {}));

console.log('contributions and caps:');
const a = sched(grant(), 120);
const o1 = a.offerings[0];
ok('monthly amounts vary: 500, 500, 1,100 (bonus), 550 (raise), 600, 600', o1.months.map((m) => m.amount).join() === '500,500,1100,550,600,600', o1.months.map((m) => m.amount));
ok('cap 3,500 per offering: June is over by 350 -> carried, with a warning', near(o1.contributed, 3500) && o1.warnings.length === 1 && o1.warnings[0].month === '2025-06' && near(o1.warnings[0].excess, 350));
ok('a bonus month that passes the cap is flagged as such', sched(grant({ caps: { periodAmount: 1800, excess: 'refund' } }), 120).offerings[0].warnings[0].kind === 'bonusOverCap');
ok('headroom after the offering', o1.headroom.period === 0);
const ref = sched(grant({ caps: { periodAmount: 3500, excess: 'refund' } }), 120).offerings[0];
ok('or refunded (the cap excess; the leftover is still carried)', near(ref.refund, 350) && near(ref.carryOut, 57.5, 0.01), [ref.refund, ref.carryOut]);
const act = sched(grant({ actuals: { '2025-02': 450 } }), 120).offerings[0];
ok('the payslip amount overrides the calculated one and is marked confirmed', act.months[1].amount === 450 && act.months[1].confirmed && act.months[1].calculated === 500 && !act.months[0].confirmed);

console.log('purchase:');
const p = o1.purchase;
ok('lookback, price rose: price = 85 % of the start FMV (100)', near(p.price, 85) && p.fmvStart === 100 && p.fmvEnd === 120);
ok('whole shares: 3,500 EUR = 3,888.89 USD -> 45 shares', p.units === 45, p.units);
ok('discount 675, lookback gain 900, effective discount 29.17 %', near(p.discountAmount, 675) && near(p.lookbackGain, 900) && near(p.effectiveDiscountPct, (120 - 85) / 120 * 100));
ok('leftover cash (63.89 USD = 57.50 EUR) carried with the cap excess', near(o1.carryOut, 350 + 57.5, 0.01), o1.carryOut);
const o2 = a.offerings[1];
ok('the next offering starts with the carried cash (July not paid yet on 15 July)', near(o2.carryIn, o1.carryOut) && o2.status === 'open' && near(o2.cash, o1.carryOut) && o2.months.length === 0);
const aug = sched(grant(), 120, '2025-08-31').offerings[1];
ok('... and grows by each paid month: ESPP cash', near(aug.cash, o1.carryOut + 600 + 600) && aug.months.length === 2);
const drop = sched(grant(), 80).offerings[0].purchase;
ok('lookback, price fell: price = 85 % of the purchase-day FMV (80) = 68', near(drop.price, 68) && drop.lookbackGain === 0 && near(drop.effectiveDiscountPct, 15));
const left = sched(grant({ leftover: 'refund' }), 120).offerings[0];
ok('leftover refunded instead of carried', near(left.refund, 57.5, 0.01) && near(left.carryOut, 350));
const frac = sched(grant({ fractional: true }), 120).offerings[0].purchase;
ok('fractional shares when the plan allows them', near(frac.units, 45.7516, 1e-4));

console.log('FX:');
const fxM = { series: (c) => (c === 'USD' ? [{ d: '2024-12-20', r: 0.9 }, { d: '2025-04-01', r: 0.95 }] : []), maxGapDays: 400 };
const monthly = sched(grant({ fxMode: 'monthly' }), 120, null, { fxCtx: fxM }).offerings[0].purchase;
const atEnd = sched(grant({ fxMode: 'purchase' }), 120, null, { fxCtx: fxM }).offerings[0].purchase;
ok('monthly conversion vs at the purchase date: the FX effect is shown apart', monthly.fxEffect > 0 && atEnd.fxEffect === 0 && monthly.units >= atEnd.units, [monthly.fxEffect, monthly.units, atEnd.units]);

console.log('withdrawal:');
const wd = sched(grant({ withdrawals: [{ date: '2025-04-10' }] }), 120, '2025-12-31');
ok('contributions stop, no purchase, the cash is refunded, enrolment ends', wd.offerings.length === 1 && wd.offerings[0].status === 'withdrawn' && !wd.offerings[0].purchase
  && near(wd.offerings[0].refund, 500 + 500 + 1100) && wd.offerings[0].months[3].withdrawn);

console.log('CHF salary, USD share:');
const chfIncome = E.normalizeIncome({ entries: [{ id: 'c', from: '2025-01-01', kind: 'base', period: 'year', amount: 120000, currency: 'CHF' }] }).entries;
const chf = sched(grant({ eligible: 'base', caps: {} }), 120, null, { income: chfIncome }).offerings[0];
ok('contributions in CHF (1,000 a month), shares bought in USD', chf.currency === 'CHF' && near(chf.contributed, 6000) && chf.purchase.units === Math.floor(6000 * 1.05 / 0.9 / 85));

console.log('events and lots:');
const reg = S.regenerate(st(grant()), { today: '2025-07-15', income: INCOME, closes: () => series(120), fxCtx });
const ns = E.normalize(reg.state);
const ev = ns.events[0];
ok('an auto purchase event: 45 shares, basis = FMV 120 at the purchase date', reg.added === 1 && ev.kind === 'purchase' && ev.grossUnits === 45 && ev.fmv === 120 && ev.purchasePrice === 85 && ev.offeringStart === '2025-01-01');
const tx = E.syncLots(ns, []).transactions;
ok('the lot: cost basis 45 × 120 × 0.9 EUR (never the discounted price)', tx.length === 1 && near(L.build(tx, {}).list[0].openCostEUR, 45 * 120 * 0.9));
const sell = E.normalize(S.regenerate(st(grant({ sellImmediately: true, salePrices: { '2025-06-30': 119 } })), { today: '2025-07-15', income: INCOME, closes: () => series(120), fxCtx }).state);
const stx = E.syncLots(sell, []).transactions;
const g = L.build(stx, {}).list[0];
ok('sell right after purchase: a same-day sale, its loss realised apart', stx.length === 2 && stx[1].type === 'sell' && g.openQty === 0 && near(g.disposals[0].proceeds - g.disposals[0].qty * g.disposals[0].unitCostEUR, 45 * (119 - 120) * 0.9));
const manual = E.normalize({ plans: [PLAN], grants: [grant()], events: [{ id: 'm', kind: 'purchase', grantId: 'g', date: '2025-06-30', offeringStart: '2025-01-01', fmv: 121, fmvStart: 100, purchasePrice: 85, shareCurrency: 'USD', fx: { EUR: { rate: 0.91 } }, grossUnits: 44, source: 'manual', carry: 0, refund: 10 }] });
const mreg = E.normalize(S.regenerate(manual, { today: '2025-07-15', income: INCOME, closes: () => series(120), fxCtx }).state);
ok('a manual purchase (from the statement) wins over the computed one', mreg.events.length === 1 && mreg.events[0].id === 'm' && mreg.events[0].grossUnits === 44);

console.log('return on cash:');
const year = S.schedule(st(grant()), st(grant()).grants[0], { today: '2026-01-15', income: INCOME, closes: () => series(120), fxCtx });
const rc = S.returnOnCash(year, PLAN, 'EUR', fxCtx);
ok('annualised, in salary and base currency (here both EUR): clearly positive', rc && rc.salary > 0.3 && near(rc.salary, rc.base, 1e-6), rc);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
