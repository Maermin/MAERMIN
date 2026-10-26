// Employee equity: employer matching (PLAN-EQUITY Package 5) - % of purchase
// value vs own contribution vs ratio, caps, immediate vs vesting delivery,
// forfeiture on an early sale of the underlying and on leaving (rule flag),
// the sell preview, per-purchase summary.
// Run: node test/equity-match.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
const M = require('../equity-match.js');
const V = require('../equity-vesting.js');
const E = require('../equity-model.js');
const L = require('../ledger.js');
const DAY = 86400000;
const dn = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

// one purchase: 40 shares at 85 (FMV 100), 3,400 USD paid; own contribution 3,060 EUR (0.9 EUR per USD)
const purchase = (extra) => Object.assign({ id: 'pu1', kind: 'purchase', grantId: 'es', date: '2025-06-30', offeringStart: '2025-01-01', fmv: 100, purchasePrice: 85,
  shareCurrency: 'USD', fx: { EUR: { rate: 0.9 } }, grossUnits: 40, netUnits: 40, contributed: { amount: 3060, currency: 'EUR' },
  discountAmount: 600, lookbackGain: 0, source: 'auto' }, extra || {});
const plan = (rules) => ({ id: 'p', ticker: 'ACME', shareCurrency: 'USD', portfolioId: 'pf', taxCountry: 'DE', salaryCurrency: 'EUR', matchRules: rules });
const st = (rules, events) => E.normalize({ plans: [plan(rules)], grants: [{ id: 'es', planId: 'p', type: 'ESPP', grantDate: '2025-01-01', contribution: { anchor: '2025-01-01' } }], events: events || [purchase()] });

console.log('rules:');
const pl = plan([{ from: '2024-01-01', pct: 20 }, { from: '2025-04-01', pct: 25 }]);
ok('the rule in force on the purchase date (effective dates)', M.ruleAt(pl, '2025-03-31').pct === 20 && M.ruleAt(pl, '2025-06-30').pct === 25 && M.ruleAt(pl, '2023-12-31') === null);

console.log('match value:');
const r25 = M.normalizeRule({ pct: 25 });
const mv = M.matchFor(purchase(), pl, r25, null, {});
ok('% of purchase value: 25 % of 3,400 paid = 850 -> 8 shares at the FMV of 100 (rounded down)', mv.units === 8 && mv.value === 800, mv);
const frac = M.matchFor(purchase(), pl, M.normalizeRule({ pct: 25, rounding: 'none' }), null, {});
ok('or fractional: 8.5 shares', near(frac.units, 8.5));
const own = M.matchFor(purchase(), pl, M.normalizeRule({ pct: 25, basis: 'own_contribution', rounding: 'none' }), null, {});
ok('% of own contribution: 25 % of 3,060 EUR = 850 USD at the purchase-day rate', near(own.value, 3060 / 0.9 * 0.25), own);
const ratio = M.matchFor(purchase(), pl, M.normalizeRule({ basis: 'ratio', ratioFree: 1, ratioPer: 3 }), null, {});
ok('ratio 1 : 3: 40 bought -> 13 free', ratio.units === 13 && ratio.value === 1300);
const capped = M.matchFor(purchase(), pl, M.normalizeRule({ pct: 25, caps: { yearAmount: 1000 } }), { year: { amount: 600, shares: 0 }, period: { amount: 0, shares: 0 } }, {});
ok('cap per year: only 400 left -> 4 shares, marked', capped.units === 4 && capped.capped === 'amount');
const sharesCap = M.matchFor(purchase(), pl, M.normalizeRule({ pct: 25, caps: { periodShares: 5 } }), null, {});
ok('cap in shares per offering', sharesCap.units === 5 && sharesCap.capped === 'shares');

console.log('immediate delivery:');
const series = { cur: 'USD', d: [dn('2025-06-30'), dn('2027-06-30')], p: [100, 140] };
const opts = { today: '2026-10-26', closes: () => series, fxCtx: { series: (c) => (c === 'USD' ? [{ d: '2025-06-20', r: 0.9 }, { d: '2027-06-28', r: 0.95 }] : []), maxGapDays: 900 } };
const imm = E.normalize(V.regenerate(E.normalize(M.regenerate(st([{ pct: 25 }]), opts).state), opts).state);
const mg = imm.grants.find((g) => g.type === 'MATCH');
ok('a MATCH grant linked to the purchase', !!mg && mg.parentEventId === 'pu1' && mg.units === 8 && mg.match.value === 800);
const del = imm.events.find((e) => e.grantId === mg.id);
ok('delivered at once: a delivery event at the purchase-day FMV', !!del && del.kind === 'delivery' && del.date === '2025-06-30' && del.fmv === 100 && del.grossUnits === 8);
const lots = E.syncLots(imm, []).transactions;
ok('its lot: basis = FMV at delivery', lots.some((t) => t.equityKind === 'MATCH' && t.quantity === 8 && t.price === 100));

console.log('vesting delivery:');
const vr = [{ pct: 25, delivery: 'vesting', vest: { years: 2, cliffMonths: 24, freqMonths: 24 }, forfeitOnSale: true }];
const ves = E.normalize(V.regenerate(E.normalize(M.regenerate(st(vr), opts).state), opts).state);
const vt = ves.tranches.filter((t) => t.grantId === 'pu1-m');
ok('a 2-year holding period: one unvested tranche on 2027-06-30, no lot yet', vt.length === 1 && vt[0].date === '2027-06-30' && vt[0].status === 'unvested' && !ves.events.some((e) => e.grantId === 'pu1-m'));
const later = E.normalize(V.regenerate(E.normalize(M.regenerate(st(vr), Object.assign({}, opts, { today: '2027-07-15' })).state), Object.assign({}, opts, { today: '2027-07-15' })).state);
const vev = later.events.find((e) => e.grantId === 'pu1-m');
ok('after the holding period: vested at the FMV and rate of THAT day', !!vev && vev.date === '2027-06-30' && vev.fmv === 140 && near(vev.fx.EUR.rate, 0.95));

console.log('forfeiture on an early sale:');
const pState = E.normalize(V.regenerate(st(vr), opts).state);
const baseTx = E.syncLots(st(vr), []).transactions;   // the purchase lot
const sale = { id: 's1', type: 'sell', category: 'stocks', symbol: 'ACME', quantity: 20, price: 110, currency: 'USD', date: '2026-01-15', portfolioId: 'pf', fx: { EUR: { rate: 0.9 } } };
const after = E.normalize(V.regenerate(E.normalize(M.regenerate(pState, Object.assign({}, opts, { transactions: baseTx.concat([sale]) })).state), opts).state);
const ft = after.tranches.filter((t) => t.grantId === 'pu1-m');
ok('half the purchase sold in the holding period: half the match forfeited', ft.find((t) => t.status === 'forfeited').units === 4 && ft.find((t) => t.status === 'unvested').units === 4, ft);
const undone = E.normalize(V.regenerate(E.normalize(M.regenerate(after, Object.assign({}, opts, { transactions: baseTx })).state), opts).state);
ok('the sale deleted again: the match is whole again', undone.tranches.filter((t) => t.grantId === 'pu1-m' && t.status === 'unvested').reduce((a, t) => a + t.units, 0) === 8);
const late = { id: 's2', type: 'sell', category: 'stocks', symbol: 'ACME', quantity: 40, price: 150, currency: 'USD', date: '2027-08-01', portfolioId: 'pf', fx: { EUR: { rate: 0.9 } } };
const afterVest = E.normalize(V.regenerate(E.normalize(M.regenerate(pState, Object.assign({}, opts, { today: '2027-09-01', transactions: baseTx.concat([late]) })).state), Object.assign({}, opts, { today: '2027-09-01' })).state);
ok('a sale after the holding period forfeits nothing', !afterVest.tranches.some((t) => t.grantId === 'pu1-m' && t.status === 'forfeited'));
const cover = { id: 'eq-v9-cover', type: 'sell', category: 'stocks', symbol: 'ACME', quantity: 20, price: 110, currency: 'USD', date: '2026-01-15', portfolioId: 'pf', source: 'equity', fx: { EUR: { rate: 0.9 } } };
const afterCover = E.normalize(V.regenerate(E.normalize(M.regenerate(pState, Object.assign({}, opts, { transactions: baseTx.concat([cover]) })).state), opts).state);
ok('a sell-to-cover of another vest is no sale of the purchase (even where FIFO books it there)', !afterCover.tranches.some((t) => t.grantId === 'pu1-m' && t.status === 'forfeited'));
const noRule = E.normalize(V.regenerate(E.normalize(M.regenerate(st([{ pct: 25, delivery: 'vesting', forfeitOnSale: false }]), Object.assign({}, opts, { transactions: baseTx.concat([sale]) })).state), opts).state);
ok('without the forfeiture rule a sale keeps the match', !noRule.tranches.some((t) => t.status === 'forfeited'));

console.log('sell preview:');
const pv = M.forfeitPreview(pState.grants.some((g) => g.type === 'MATCH') ? pState : E.normalize(V.regenerate(E.normalize(M.regenerate(st(vr), opts).state), opts).state), baseTx,
  { portfolioId: 'pf', symbol: 'ACME', quantity: 10, date: '2026-10-26' });
ok('selling 10 of the 40 purchase shares forfeits 2 match shares', pv.units === 2 && pv.perGrant[0].purchase === '2025-06-30', pv);
ok('leaving forfeits unvested match shares (the rule says so)', M.normalizeRule({}).forfeitOnLeave === true && M.normalizeRule({ forfeitOnLeave: false }).forfeitOnLeave === false);

console.log('summary:');
const sum = M.purchaseSummary(imm, imm.events.find((e) => e.id === 'pu1'));
ok('own money 3,400, discount 600, match 800, free 1,400, return on own money 41.2 %', sum.own === 3400 && sum.discount === 600 && sum.matchValue === 800 && sum.free === 1400 && near(sum.returnOnOwn, 1400 / 3400), sum);
ok('effective discount incl. match: 15 % + 25 % match ≈ 32 %', near(M.effectiveInclMatch(M.normalizeRule({ pct: 25 }), 85, 100), (1 - 85 / (100 + 21.25)) * 100) && near(M.effectiveInclMatch(null, 85, 100), 15));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
