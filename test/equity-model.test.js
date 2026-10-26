// Employee equity data model (PLAN-EQUITY Package 1): normalisation, lots and
// their cost basis in the real ledger, sell-to-cover, pipeline, income, the
// v7 migration behind the pre-migration copy.
// Run: node test/equity-model.test.js
'use strict';
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

globalThis.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
const E = require('../equity-model.js');
const FX = require('../equity-fx.js');
const L = require('../ledger.js');
const M = require('../migrations.js');
const B = require('../backup-engine.js');
const PM = require('../premigration-backup.js');
const S = require('../storage.js');

const PLAN = { id: 'p1', employer: 'Contoso', ticker: 'msft', shareCurrency: 'USD', admin: 'morgan_stanley', portfolioId: 'pf1', taxCountry: 'DE' };
const RSU = { id: 'g1', planId: 'p1', type: 'RSU', grantDate: '2023-03-01', units: 400, withholding: 'sell_to_cover' };
const base = () => ({
  plans: [PLAN],
  grants: [RSU, { id: 'g2', planId: 'p1', type: 'PSU', grantDate: '2023-03-01', units: 120, withholding: 'payroll' }],
  tranches: [
    { id: 't1', grantId: 'g1', date: '2024-03-01', units: 100, status: 'vested' },
    { id: 't2', grantId: 'g1', date: '2026-12-01', units: 25, status: 'unvested', projected: true },
    { id: 't3', grantId: 'g2', date: '2026-03-01', units: 120, status: 'unvested' },
    { id: 't4', grantId: 'g1', date: '2025-06-01', units: 25, status: 'forfeited' }
  ],
  events: [
    { id: 'v1', kind: 'vest', grantId: 'g1', trancheId: 't1', date: '2024-03-01', fmv: 400, shareCurrency: 'USD',
      fx: { EUR: { rate: 0.92, date: '2024-03-01', source: 'history' }, CHF: { rate: 0.88, date: '2024-03-01', source: 'history' } },
      grossUnits: 100, withheldUnits: 45, coverPrice: 401.5 }
  ]
});

console.log('normalize:');
const st = E.normalize(base());
ok('plan kept, ticker upper-cased, roles filled', st.plans.length === 1 && st.plans[0].ticker === 'MSFT' && st.plans[0].salaryCurrency === 'EUR' && st.plans[0].taxCountry === 'DE');
ok('defaults: unvested out of net worth, 10 % warning', st.settings.includeUnvested === false && st.settings.concentrationWarnPct === 10);
ok('net units derived from gross - withheld', st.events[0].netUnits === 55);
const bad = E.normalize({
  plans: [PLAN, { id: 'p1', ticker: 'DUP' }, { id: 'p2' }],
  grants: [RSU, { id: 'gx', planId: 'nope', type: 'RSU' }, { id: 'gy', planId: 'p1', type: 'OPTION' }],
  tranches: [{ id: 'tx', grantId: 'gx', date: '2024-01-01', units: 1 }, { id: 'ty', grantId: 'g1', date: '2024-13-01', units: 1 }],
  events: [{ id: 'e0', kind: 'vest', grantId: 'g1', date: '2024-01-01', fmv: 0, grossUnits: 1 },
    { id: 'e1', kind: 'vest', grantId: 'g1', date: '2024-01-01', fmv: 10, grossUnits: 5, withheldUnits: 9 }]
});
ok('duplicates, orphans, unknown types and impossible dates are dropped', bad.plans.length === 1 && bad.grants.length === 1 && bad.tranches.length === 0 && bad.events.length === 1, bad);
ok('an FMV of 0 never becomes an event (basis 0 = double-taxation risk)', !bad.events.some((e) => e.id === 'e0'));
ok('withheld units capped at the gross units', bad.events[0].withheldUnits === 5 && bad.events[0].netUnits === 0);
const gbx = E.normalize({ plans: [{ id: 'p', ticker: 'azn.l', shareCurrency: 'GBX' }] }).plans[0];
ok('GBX listing: share currency GBP (major unit), quote currency kept', gbx.shareCurrency === 'GBP' && gbx.quoteCurrency === 'GBX', gbx);
const gbp = E.normalize({ plans: [{ id: 'p', ticker: 'x', shareCurrency: 'GBp' }] }).plans[0];
ok('GBp (Yahoo spelling) too', gbp.shareCurrency === 'GBP' && gbp.quoteCurrency === 'GBp', gbp);
ok('round trip is stable', JSON.stringify(E.normalize(JSON.parse(JSON.stringify(st)))) === JSON.stringify(st));
ok('garbage -> empty store', JSON.stringify(E.normalize('{oops')) === JSON.stringify(E.normalize(null)) && E.normalize(null).plans.length === 0);

console.log('lots (decision 5: gross bought, withheld sold):');
const lots = E.lotsFor(st, st.events[0]);
ok('a buy of the gross units at FMV and a same-day cover sale', lots.length === 2 && lots[0].type === 'buy' && lots[0].quantity === 100 && lots[0].price === 400
  && lots[1].type === 'sell' && lots[1].quantity === 45 && lots[1].price === 401.5 && lots[1].date === '2024-03-01', lots);
ok('linked to the event, in the plan portfolio, share currency', lots.every((t) => t.source === 'equity' && t.equityEventId === 'v1' && t.portfolioId === 'pf1' && t.currency === 'USD' && t.symbol === 'MSFT'));
ok('the event\'s rates travel with the lot', lots[0].fx.EUR.rate === 0.92 && lots[0].fx.CHF.rate === 0.88);
const payroll = E.normalize(Object.assign(base(), { events: [{ id: 'v2', kind: 'vest', grantId: 'g2', date: '2026-03-02', fmv: 410, shareCurrency: 'USD', fx: { EUR: { rate: 0.91 } }, grossUnits: 144, withheldUnits: 0 }] }));
const pl = E.lotsFor(payroll, payroll.events[0]);
ok('payroll withholding: one buy, no sale', pl.length === 1 && pl[0].quantity === 144);

console.log('cost basis in the ledger:');
const R = L.build(lots, { exchangeRate: 0.5, fxAt: () => 0.5 });
const g = R.groups['stocks|MSFT'];
ok('basis = FMV × the event rate (not today\'s, not the history\'s)', near(g.openQty, 55) && near(g.openCostEUR, 55 * 400 * 0.92), { q: g.openQty, c: g.openCostEUR });
ok('the cover sale is a real disposal with its small gain', g.disposals.length === 1 && near(g.disposals[0].proceeds - g.disposals[0].qty * g.disposals[0].unitCostEUR, 45 * (401.5 - 400) * 0.92), g.disposals[0]);
ok('never 0', g.openCostEUR > 0);
const R2 = L.build(lots, { exchangeRate: 2, fxAt: () => 2 });
ok('a later rate reload does not move the basis', near(R2.groups['stocks|MSFT'].openCostEUR, g.openCostEUR));
ok('tax currency basis from the stored record', near(FX.valueIn(55 * 400, 'USD', lots[0].fx, 'CHF'), 55 * 400 * 0.88));
const manual = E.normalize(Object.assign(base(), { events: [Object.assign({}, base().events[0], { fx: { EUR: { rate: 0.95, source: 'manual' } } })] }));
const FXH = require('../fx-history.js');
ok('a manual payslip rate is marked as such', FXH.txAmountToEUR(1, E.lotsFor(manual, manual.events[0])[0], 0.5).stored === 'manual');
const gbxPlan = E.normalize({ plans: [{ id: 'p', ticker: 'AZN.L', shareCurrency: 'GBX', portfolioId: 'pf' }], grants: [{ id: 'g', planId: 'p', type: 'ESPP' }],
  events: [{ id: 'pu', kind: 'purchase', grantId: 'g', date: '2026-01-30', fmv: 112.34, shareCurrency: 'GBP', fx: { EUR: { rate: 1.19 } }, grossUnits: 10 }] });
const gl = E.lotsFor(gbxPlan, gbxPlan.events[0]);
ok('GBX-quoted share: the lot is in GBP (major unit)', gl[0].currency === 'GBP' && near(L.build(gl, {}).groups['stocks|AZN.L'].openCostEUR, 10 * 112.34 * 1.19));

console.log('missing FX:');
const noFx = E.normalize(Object.assign(base(), { events: [Object.assign({}, base().events[0], { fx: {} })] }));
ok('no EUR rate: no lot (never a basis without conversion), reported', E.lotsFor(noFx, noFx.events[0]).length === 0 && E.missingFx(noFx).join() === 'v1');
const eurShare = E.normalize({ plans: [{ id: 'p', ticker: 'SAP.DE', shareCurrency: 'EUR' }], grants: [{ id: 'g', planId: 'p', type: 'RSU' }],
  events: [{ id: 'x', kind: 'vest', grantId: 'g', date: '2026-01-02', fmv: 200, shareCurrency: 'EUR', grossUnits: 3 }] });
ok('an EUR share needs no rate', E.lotsFor(eurShare, eurShare.events[0]).length === 1 && E.missingFx(eurShare).length === 0);

console.log('syncLots:');
const other = { id: 'o1', type: 'buy', category: 'stocks', symbol: 'VWCE.DE', quantity: 1, price: 100, currency: 'EUR', date: '2024-01-01' };
const s1 = E.syncLots(st, [other]);
ok('adds the event lots after the existing rows', s1.changed && s1.transactions.length === 3 && s1.transactions[0] === other);
const s2 = E.syncLots(st, s1.transactions);
ok('idempotent: nothing changes the second time, same array', !s2.changed && s2.transactions === s1.transactions);
const edited = E.normalize(Object.assign(base(), { events: [Object.assign({}, base().events[0], { withheldUnits: 0 })] }));
const s3 = E.syncLots(edited, s1.transactions);
ok('an edited event replaces its lots (cover sale gone)', s3.changed && s3.transactions.filter(E.isEquityTx).length === 1 && s3.transactions.find(E.isEquityTx).quantity === 100);
const s4 = E.syncLots(E.normalize(Object.assign(base(), { events: [] })), s1.transactions);
ok('a deleted event takes its lots along, other rows stay', s4.transactions.length === 1 && s4.transactions[0] === other);

console.log('pipeline:');
const pipe = E.pipeline(st, () => 420, (v, p) => (p.shareCurrency === 'USD' ? v * 0.9 : null));
ok('unvested RSU + PSU units, forfeited and vested left out', pipe.total.units === 145 && pipe.plans[0].byType.RSU === 25 && pipe.plans[0].byType.PSU === 120, pipe);
ok('valued at today\'s price in base currency', near(pipe.total.base, 145 * 420 * 0.9) && pipe.total.unpriced === 0);
ok('no price: counted as unpriced, not as 0 value', E.pipeline(st, () => null, null).total.unpriced === 2);

console.log('income:');
const inc = E.normalizeIncome({ entries: [
  { id: 'i2', from: '2025-04-01', kind: 'base', amount: 84000, currency: 'EUR' },
  { id: 'i1', from: '2024-01-01', to: '2025-03-31', kind: 'base', amount: 78000, currency: 'eur', ftePct: 80 },
  { id: 'i3', from: '2025-03-31', kind: 'bonus', amount: 9000, currency: 'EUR' },
  { id: 'bad', from: '2025-01-01', amount: -1, currency: 'EUR' },
  { id: 'chf', from: '2025-01-01', kind: 'base', amount: 120000, currency: 'CHF', period: 'year' }
] });
ok('sorted by date, bad rows dropped, currency upper-cased', inc.entries.map((e) => e.id).join() === 'i1,chf,i3,i2' && inc.entries[0].currency === 'EUR');
ok('base salary per year, a bonus once, FTE kept', inc.entries[0].period === 'year' && inc.entries[0].ftePct === 80 && inc.entries.find((e) => e.id === 'i3').period === 'once');

console.log('storage + migration v7:');
ok('both stores are sensitive (encrypted at rest)', S.isSensitive(E.KEY) && S.isSensitive(E.INCOME_KEY));
ok('both stores are in the backup', B.KEYS.indexOf(E.KEY) > -1 && B.KEYS.indexOf(E.INCOME_KEY) > -1);
localStorage._d = {}; localStorage.setItem(M.VERSION_KEY, '6');
ok('v7 is pending on a v6 device', M.pending().map((m) => m.v).join() === '7');
M.run();
ok('v7 creates empty versioned stores', JSON.parse(localStorage.getItem(E.KEY)).v === 1 && JSON.parse(localStorage.getItem(E.INCOME_KEY)).entries.length === 0 && M.getVersion() === 7);
localStorage._d = {}; localStorage.setItem(M.VERSION_KEY, '6'); localStorage.setItem(E.KEY, JSON.stringify(base()));
M.run();
ok('existing equity data is left alone', JSON.parse(localStorage.getItem(E.KEY)).events.length === 1);

(async function guarded() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const vault = {
    isUnlocked: () => true,
    async encryptJSON(o) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(o))); return JSON.stringify({ iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') }); },
    async decryptJSON(env) { const e = JSON.parse(env); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(e.iv, 'base64') }, key, Buffer.from(e.ct, 'base64')); return JSON.parse(new TextDecoder().decode(pt)); }
  };
  const m = new Map();
  const idb = { m, get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return Promise.resolve(); }, del: (k) => { m.delete(k); return Promise.resolve(); } };
  localStorage._d = {}; localStorage.setItem(M.VERSION_KEY, '6');
  localStorage.setItem('transactions', JSON.stringify([{ id: 't', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 1, currency: 'EUR', date: '2024-01-01' }]));
  const v7 = M.MIGRATIONS.find((x) => x.v === 7), up = v7.up;
  let copied = null;
  v7.up = function () { copied = m.has(PM.RECORD); return up.apply(this, arguments); };
  await PM.guardedRun({ vault, idb, migrations: M, backup: B, storage: localStorage, now: Date.UTC(2026, 9, 26) });
  v7.up = up;
  ok('the encrypted pre-migration copy is written before v7 runs', copied === true && M.getVersion() === 7);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
