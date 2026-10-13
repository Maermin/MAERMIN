// Node harness for bonds (P5-3.9): terms, coupon schedule, accrued interest
// (Stückzinsen), coupon / redemption catch-up and the tax + cash wiring.
// Run: node test/bonds.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -- ' + JSON.stringify(info) : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.005 : eps); }
function days(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

let _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const B = require('../bonds.js');
const I = require('../interest-engine.js');
const M = require('../metrics.js');
const L = require('../ledger.js');
const GT = require('../tax-calculation-engine.js').GermanTax;
const TS = require('../tax-settings.js');
const TR = require('../tax-report-builder.js');
const KAP = require('../anlage-kap.js');

// 2 % annual, act/act, maturity 15 June 2030 (the demo bond of these tests)
const BUND = { name: 'Bund 2030', coupon: 2, frequency: 1, maturity: '2030-06-15', dayCount: 'act/act', currency: 'EUR' };
const buy = (date, nominal, pct, extra) => Object.assign({ id: 'b' + date + nominal, type: 'buy', category: 'bonds', symbol: 'DE0001102499', symbolName: 'Bund 2030',
  quantity: nominal, price: pct / 100, fees: 0, currency: 'EUR', date: date, portfolioId: 'p1' }, extra || {});
const sell = (date, nominal, pct, extra) => Object.assign(buy(date, nominal, pct, extra), { id: 's' + date + nominal, type: 'sell' });

(function run() {
  console.log('bonds:');

  // ---- terms ---------------------------------------------------------------
  const st = B.normalize({ bonds: { 'de0001102499': Object.assign({}, BUND), bad: { coupon: 'x' }, '': { coupon: 1 }, US912828: { coupon: 4, maturity: '2031-02-28', frequency: 2, dayCount: 'nonsense', currency: 'USD', price: 97.25, priceDate: '2026-10-01' } } });
  ok('normalize upper-cases symbols and keeps valid terms', !!st.bonds.DE0001102499 && st.bonds.DE0001102499.coupon === 2 && st.bonds.DE0001102499.frequency === 1);
  ok('normalize drops terms without maturity and empty symbols', !st.bonds.BAD && !st.bonds[''], Object.keys(st.bonds));
  ok('normalize falls back to act/act and keeps a manual price', st.bonds.US912828.dayCount === 'act/act' && st.bonds.US912828.price === 97.25 && st.bonds.US912828.frequency === 2);
  ok('normalize rejects an odd frequency', B.normalize({ bonds: { X: { coupon: 1, maturity: '2030-01-01', frequency: 5 } } }).bonds.X.frequency === 1);

  // ---- schedule --------------------------------------------------------------
  const semi = { coupon: 3, frequency: 2, maturity: '2028-08-31', dayCount: 'act/act' };
  ok('schedule counts back from maturity, month ends kept',
    B.schedule(semi, '2026-01-01', '2028-12-31').join() === '2026-02-28,2026-08-31,2027-02-28,2027-08-31,2028-02-29,2028-08-31',
    B.schedule(semi, '2026-01-01', '2028-12-31'));
  ok('schedule of an annual bond', B.schedule(BUND, '2026-01-01', '2028-01-01').join() === '2026-06-15,2027-06-15');
  ok('schedule never passes maturity', B.schedule(BUND, '2029-01-01', '2035-01-01').join() === '2029-06-15,2030-06-15');
  const pr = B.period(BUND, '2026-03-01');
  ok('period around a date', pr.prev === '2025-06-15' && pr.next === '2026-06-15', pr);
  ok('a coupon date starts the new period', B.period(BUND, '2026-06-15').prev === '2026-06-15');

  // ---- accrued interest ------------------------------------------------------
  const d = days('2025-06-15', '2026-03-01');
  ok('accrued act/act = nominal x coupon x days / days of the period',
    near(B.accrued(BUND, 10000, '2026-03-01'), 10000 * 0.02 * d / 365), [B.accrued(BUND, 10000, '2026-03-01'), d]);
  ok('accrued is 0 on the coupon date', B.accrued(BUND, 10000, '2026-06-15') === 0);
  const t30 = { coupon: 6, frequency: 2, maturity: '2030-03-31', dayCount: '30/360' };
  // 30E/360: 30 Sep 2026 -> 15 Nov 2026 = 45 days
  ok('accrued 30E/360', near(B.accrued(t30, 1000, '2026-11-15'), 1000 * 0.06 * 45 / 360), B.accrued(t30, 1000, '2026-11-15'));
  ok('accrued act/360', near(B.accrued(Object.assign({}, BUND, { dayCount: 'act/360' }), 10000, '2026-03-01'), 10000 * 0.02 * d / 360));
  const fresh = Object.assign({}, BUND, { issueDate: '2025-09-01' });
  ok('before the first coupon accrued runs from the issue date',
    near(B.accrued(fresh, 10000, '2026-03-01'), 10000 * 0.02 * days('2025-09-01', '2026-03-01') / 365));
  ok('nothing accrues before issue or after maturity', B.accrued(fresh, 10000, '2025-08-01') === 0 && B.accrued(BUND, 10000, '2030-07-01') === 0);
  ok('regular coupon = nominal x coupon / frequency', near(B.couponAmount(BUND, 10000, '2026-06-15'), 200) && near(B.couponAmount(semi, 1000, '2027-02-28'), 15));

  // ---- form helper -----------------------------------------------------------
  const f = B.fromForm({ nominal: '10.000', pricePct: '98,5' });
  ok('form: nominal and price in % become quantity and a price per unit of nominal', f.quantity === 10000 && near(f.price, 0.985, 1e-12), f);
  ok('form: market value = nominal x price %', near(f.quantity * f.price, 9850));

  // ---- coupon and redemption catch-up ---------------------------------------
  const bonds = { DE0001102499: BUND };
  const base = [buy('2026-03-01', 10000, 98.5, { accruedInterest: 141.92 }), sell('2026-12-01', 4000, 99, { accruedInterest: 37.92 })];
  const r1 = B.catchUp({ transactions: base, bonds: bonds, asOf: '2027-07-01' });
  const cps = r1.created.filter((x) => x.source === 'bond-coupon');
  ok('one coupon per date for the nominal held the day before', cps.length === 2 && near(cps[0].amount, 200) && near(cps[1].amount, 120),
    cps.map((x) => x.date + ' ' + x.amount));
  ok('coupons are interest bookings of the bond', cps.every((x) => x.type === 'interest' && x.category === 'bonds' && x.symbol === 'DE0001102499' && x.portfolioId === 'p1' && x.date === x.couponDate));
  const r2 = B.catchUp({ transactions: r1.transactions, bonds: bonds, asOf: '2027-07-01' });
  ok('a second run books nothing', r2.created.length === 0 && r2.transactions === r1.transactions);
  const onDate = B.catchUp({ transactions: [buy('2026-06-15', 1000, 100)], bonds: bonds, asOf: '2026-12-31' });
  ok('a buy on the coupon date does not get that coupon', onDate.created.length === 0);
  const two = B.catchUp({ transactions: [buy('2026-01-10', 1000, 100), buy('2026-01-10', 3000, 100, { id: 'x2', portfolioId: 'p2' })], bonds: bonds, asOf: '2026-07-01' });
  ok('coupons per portfolio', two.created.length === 2 && two.created.some((x) => x.portfolioId === 'p2' && near(x.amount, 60)));

  const late = B.catchUp({ transactions: base, bonds: bonds, asOf: '2031-01-01' });
  const red = late.created.filter((x) => x.source === 'bond-redemption');
  ok('redemption at maturity: a sale of the nominal held at 100 %', red.length === 1 && red[0].type === 'sell' && red[0].quantity === 6000 && red[0].price === 1 && red[0].date === '2030-06-15', red);
  ok('the last coupon is paid on the maturity day, nothing after it',
    late.created.filter((x) => x.source === 'bond-coupon').map((x) => x.date).join() === '2026-06-15,2027-06-15,2028-06-15,2029-06-15,2030-06-15');
  ok('redemption is idempotent', B.catchUp({ transactions: late.transactions, bonds: bonds, asOf: '2031-06-01' }).created.length === 0);
  ok('a fully sold bond is not redeemed', B.catchUp({ transactions: [buy('2026-03-01', 1000, 99), sell('2026-04-01', 1000, 99)], bonds: bonds, asOf: '2031-01-01' }).created.filter((x) => x.source === 'bond-redemption').length === 0);
  ok('no terms, no bookings', B.catchUp({ transactions: base, bonds: {}, asOf: '2031-01-01' }).created.length === 0);
  ok('postings go to the shared interest ledger', near(I.yearlyInterest(late.ledger, 2027), 120) && near(I.yearlyInterest(late.ledger, 2026), 200));
  const pos = M.buildPositions(late.transactions, { exchangeRate: 1 });
  ok('after redemption no bond position is left', !(pos.bonds || []).length);

  // ---- positions and value ---------------------------------------------------
  const p = M.buildPositions(base, { exchangeRate: 1 });
  ok('bonds are a position bucket: quantity = nominal, cost per unit of nominal', p.bonds && p.bonds.length === 1 && p.bonds[0].amount === 6000 && near(p.bonds[0].purchasePrice, 0.985, 1e-9), p.bonds);
  ok('no bonds bucket without bond transactions', !('bonds' in M.buildPositions([{ type: 'buy', category: 'stocks', symbol: 'SAP', quantity: 1, price: 100, date: '2026-01-01' }], { exchangeRate: 1 })));
  const pm = B.priceMap({ bonds: { DE0001102499: Object.assign({}, BUND, { price: 101.2 }), US912828: { coupon: 4, maturity: '2031-02-28', currency: 'USD', price: 97 } } }, (v, cur) => cur === 'USD' ? v * 0.9 : v);
  ok('manual price in % becomes a price per unit of nominal in EUR', near(pm.DE0001102499, 1.012, 1e-12) && near(pm.US912828, 0.873, 1e-12), pm);
  ok('stats value the bond at nominal x price', near(M.computeStats(p, pm).totalValue, 6000 * 1.012));

  // ---- yield ---------------------------------------------------------------
  ok('yield to maturity at par on a coupon date = the coupon', near(B.ytm(BUND, 100, '2026-06-15'), 0.02, 1e-6), B.ytm(BUND, 100, '2026-06-15'));
  ok('below par the yield is higher', B.ytm(BUND, 95, '2026-06-15') > 0.02 && B.ytm(BUND, 105, '2026-06-15') < 0.02);

  // ---- tax rows ------------------------------------------------------------
  const rows = B.accruedRows(base, 2026);
  ok('accrued interest paid is negative, received positive, in the year of the trade',
    rows.length === 2 && near(rows[0].amount, -141.92) && near(rows[1].amount, 37.92) && rows[0].symbol === 'DE0001102499', rows);
  ok('accrued rows of other years are left out', B.accruedRows(base, 2027).length === 0);

  // German report 2026: coupon 200 interest, accrued -141.92 + 37.92, sale
  // 4000 x (0.99 - 0.985) = 20 gain in the 'other' pot.
  const txs26 = r1.transactions;
  const rep = TR.build(txs26, { year: 2026, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT,
    taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {}, sparerpauschbetrag: 0 });
  const g = rep.summary.germanDetail;
  ok('coupon is interest income', near(rep.summary.interestIncome, 200), rep.summary.interestIncome);
  ok('report lists the accrued interest', rep.accruedInterest && rep.accruedInterest.length === 2 && near(rep.summary.accruedInterestNet, -104), rep.summary.accruedInterestNet);
  ok('bond sale gain goes to the other pot, not the shares pot', near(rep.summary.realizedGains, 20) && g.shareLossCarried === 0);
  ok('accrued interest paid nets as negative capital income', near(g.nettedIncome, 200 + 20 - 141.92 + 37.92), g.nettedIncome);
  ok('total taxable income includes the accrued interest', near(rep.summary.totalTaxableIncome, 20 + 200 - 104));
  // A share loss cannot be offset by bond income, but paid accrued interest
  // offsets everything else (other pot).
  const shareLoss = [{ id: 's1', type: 'buy', category: 'stocks', symbol: 'SAP', quantity: 10, price: 100, currency: 'EUR', date: '2026-01-05', portfolioId: 'p1' },
    { id: 's2', type: 'sell', category: 'stocks', symbol: 'SAP', quantity: 10, price: 90, currency: 'EUR', date: '2026-02-05', portfolioId: 'p1' }];
  const g2 = TR.build(txs26.concat(shareLoss), { year: 2026, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT,
    taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {}, sparerpauschbetrag: 0 }).summary.germanDetail;
  ok('bond income does not absorb a share loss', near(g2.shareLossCarried, 100) && near(g2.nettedIncome, g.nettedIncome), g2);
  const kap = KAP.map(g.kapInputs);
  const line = (n) => (kap.find((r) => r.form === 'KAP' && r.line === n) || {}).amount || 0;
  ok('Anlage KAP: accrued interest paid in line 22, the net in line 19', near(line(22), 141.92) && near(line(19), 200 + 20 - 104), kap);
  const xml = TR.buildExcelWorkbook(rep);
  ok('the Excel export has the accrued-interest sheet', /Accrued interest/.test(xml));

  // ---- clearing account ------------------------------------------------------
  const c = L.clearingBalance(txs26, 'p1');
  const want = -(10000 * 0.985 + 141.92) + (4000 * 0.99 + 37.92) + 200 + 120; // coupons 2026 and 2027
  ok('clearing account pays and receives the accrued interest and the coupon', near(c.balanceEUR, want), [c.balanceEUR, want]);

  // ---- storage -----------------------------------------------------------------
  B.save({ bonds: { DE0001102499: BUND } });
  ok('save and load round-trip', B.load().bonds.DE0001102499.maturity === '2030-06-15');
  ok('stored under maermin_bonds', !!_store.maermin_bonds && B.STORAGE_KEY === 'maermin_bonds');
  const S = require('../storage.js');
  const BK = require('../backup-engine.js');
  ok('the store is encrypted at rest (held symbols)', (S.SENSITIVE_KEYS || []).indexOf('maermin_bonds') !== -1);
  ok('the store is in the backup', (BK.KEYS || BK.BACKUP_KEYS || []).indexOf('maermin_bonds') !== -1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
