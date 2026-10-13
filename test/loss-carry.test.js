// Node harness for P5-4.1 loss carry-forward: the three German loss pots
// (shares sec. 20 (6) S.4, other capital income sec. 20 (6), private sales
// sec. 23 (3)) carried across years, the order against the allowance and the
// sec. 23 Freigrenze, opening balances from the last assessment, the year
// chain in MaerminTaxReport.build and the per-portfolio breakdown.
// Run: node test/loss-carry.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const GT = require('../tax-calculation-engine.js').GermanTax;
const REPORT = require('../tax-report-builder.js');
const LC = require('../loss-carry.js');
const fs = require('fs');
const path = require('path');

(function run() {
  console.log('loss-carry (engine):');
  const base = { sparerpauschbetrag: 0 };
  const calc = (x) => GT.computeGermanTaxDetailed(Object.assign({}, base, x));

  // A carried share loss offsets a later share gain, never dividends.
  let g = calc({ carryIn: { shares: 1000 }, disposals: [{ symbol: 'SAP', gain: 600, pot: 'shares' }], dividends: [{ symbol: 'SAP', gross: 500 }] });
  ok('carried share loss offsets the share gain', approx(g.carryUsed.shares, 600) && approx(g.carryOut.shares, 400), g.carryOut);
  ok('... but not the dividend', approx(g.taxableIncome, 500), g.taxableIncome);
  g = calc({ carryIn: { shares: 1000 }, dividends: [{ symbol: 'SAP', gross: 500 }] });
  ok('carried share loss stays whole against dividends only', approx(g.carryOut.shares, 1000) && approx(g.taxableIncome, 500));

  // A carried other loss offsets interest.
  g = calc({ carryIn: { other: 300 }, interestIncome: 1000 });
  ok('carried other loss offsets interest', approx(g.carryUsed.other, 300) && approx(g.carryOut.other, 0) && approx(g.taxableIncome, 700), g);
  // ... and what is left of share gains.
  g = calc({ carryIn: { other: 400 }, disposals: [{ symbol: 'SAP', gain: 1000, pot: 'shares' }] });
  ok('carried other loss offsets a share gain', approx(g.taxableIncome, 600));

  // A year's unused other loss is carried (it used to be lost).
  g = calc({ disposals: [{ symbol: 'BOND', gain: -800, pot: 'other' }], interestIncome: 300 });
  ok('unused other loss of the year is carried', approx(g.carryOut.other, 500) && approx(g.taxableIncome, 0), g.carryOut);
  ok('nettedIncome keeps the year\'s own figure', approx(g.nettedIncome, -500));

  // Share losses (own and carried) offset share gains before other losses.
  g = calc({ carryIn: { shares: 100 }, disposals: [{ symbol: 'SAP', gain: 100, pot: 'shares' }, { symbol: 'BOND', gain: -150, pot: 'other' }] });
  ok('carried share loss is used first, the other loss carries on', approx(g.carryOut.shares, 0) && approx(g.carryOut.other, 150) && approx(g.taxableIncome, 0), g.carryOut);

  // The carry-forward comes before the allowance, even when that is unfavourable.
  g = GT.computeGermanTaxDetailed({ sparerpauschbetrag: 1000, carryIn: { other: 500 }, interestIncome: 1200 });
  ok('carry-forward before the allowance', approx(g.carryUsed.other, 500) && approx(g.incomeAfterCarry, 700) && approx(g.sparerpauschbetragUsed, 700) && approx(g.taxableIncome, 0), g);
  g = GT.computeGermanTaxDetailed({ sparerpauschbetrag: 1000, carryIn: { other: 500 }, interestIncome: 400 });
  ok('carried loss is used even below the allowance', approx(g.carryUsed.other, 400) && approx(g.carryOut.other, 100) && approx(g.sparerpauschbetragUsed, 0));

  // Without carryIn nothing changes, and carryOut holds the year's own losses.
  g = calc({ disposals: [{ symbol: 'SAP', gain: -2000, pot: 'shares' }, { symbol: 'X', gain: 500, pot: 'other' }] });
  ok('no carryIn: same result, own share loss carried', approx(g.taxableIncome, 500) && approx(g.carryOut.shares, 2000) && approx(g.shareLossCarried, 2000) && approx(g.carryOut.other, 0));
  g = calc({ interestIncome: 100 });
  ok('a year with nothing to carry', g.carryOut.shares === 0 && g.carryOut.other === 0 && g.carryUsed.shares === 0 && g.carryUsed.other === 0);
  g = calc({ carryIn: { shares: -50, other: 'x' }, interestIncome: 100 });
  ok('invalid carryIn counts as 0', g.carryIn.shares === 0 && g.carryIn.other === 0 && approx(g.taxableIncome, 100));

  console.log('loss-carry (private sales, sec. 23):');
  let p = GT.privateSalesWithCarry(800, 1000, 500);
  ok('gain under the Freigrenze: tax-free, carry untouched', p.taxable === 0 && p.used === 0 && approx(p.carryOut, 500), p);
  p = GT.privateSalesWithCarry(1200, 1000, 500);
  ok('gain over the Freigrenze: carry reduces it', approx(p.taxable, 700) && approx(p.used, 500) && p.carryOut === 0, p);
  p = GT.privateSalesWithCarry(1200, 1000, 1500);
  ok('carry larger than the gain', p.taxable === 0 && approx(p.used, 1200) && approx(p.carryOut, 300), p);
  p = GT.privateSalesWithCarry(1000, 1000, 300);
  ok('at the Freigrenze the gain is taxable; what is left stays taxable below it', approx(p.taxable, 700), p);
  p = GT.privateSalesWithCarry(-400, 1000, 100);
  ok('a sec. 23 loss is added to the carry', p.taxable === 0 && approx(p.carryOut, 500), p);

  console.log('loss-carry (store):');
  const st = LC.normalize({ opening: { 2025: { shares: '100', other: -5, private: 'x' }, 'abc': { shares: 1 }, 2024: { shares: 0 } } });
  ok('normalize keeps valid years and positive amounts', JSON.stringify(st.opening) === JSON.stringify({ 2025: { shares: 100, other: 0, private: 0 } }), st);
  let s2 = LC.setOpening(LC.normalize(null), 2024, { other: 400 });
  LC.save(s2);
  ok('save / load round trip', approx(LC.openingFor(LC.load(), 2024).other, 400));
  s2 = LC.setOpening(s2, 2024, { other: 0 });
  ok('clearing a year removes it', !s2.opening[2024]);
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = fs.readFileSync(path.join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('key is sensitive (encrypted, synced)', /'maermin_loss_carry'/.test(storage));
  ok('key is in the backup', /'maermin_loss_carry'/.test(backup));
  LC.save(LC.normalize(null));

  console.log('loss-carry (report chain):');
  const opts = (year, extra) => Object.assign({ year, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
    sparerpauschbetrag: 0, taxSettings: { abgeltungRate: 0.25, soli: false, kirchensteuer: 0, freistellungsauftrag: 0, cryptoExemption: true },
    taxOverrides: {}, vapRecords: {}, fundTypes: {}, lossCarryState: { version: 1, opening: {} }, isFund: () => false }, extra || {});
  const txs = [
    { type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 200, currency: 'EUR', date: '2024-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'AAA', quantity: 10, price: 100, currency: 'EUR', date: '2024-06-10' },
    { type: 'buy', category: 'stocks', symbol: 'BBB', quantity: 10, price: 100, currency: 'EUR', date: '2025-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'BBB', quantity: 10, price: 250, currency: 'EUR', date: '2025-06-10' },
    { type: 'dividend', category: 'stocks', symbol: 'BBB', quantity: 1, price: 200, currency: 'EUR', date: '2025-03-10' }
  ];
  let r = REPORT.build(txs, opts(2025)).summary.germanDetail;
  ok('2024 share loss is brought into 2025', approx(r.carryIn.shares, 1000), r.carryIn);
  ok('... and offsets the 2025 share gain, not the dividend', approx(r.taxableIncome, 700) && approx(r.carryOut.shares, 0), r.taxableIncome);
  r = REPORT.build(txs, opts(2024)).summary.germanDetail;
  ok('2024 carries 1000 in shares to 2025', approx(r.carryOut.shares, 1000) && r.carryIn.shares === 0);
  r = REPORT.build(txs, opts(2025, { lossCarry: false })).summary.germanDetail;
  ok('lossCarry: false keeps the year on its own', approx(r.taxableIncome, 1700) && r.carryIn.shares === 0);
  r = REPORT.build(txs, opts(2025, { carryIn: { shares: 300 } })).summary.germanDetail;
  ok('an explicit carryIn wins', approx(r.carryIn.shares, 300) && approx(r.taxableIncome, 1400));

  const crypto = [
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 5000, currency: 'EUR', date: '2024-02-01' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 3000, currency: 'EUR', date: '2024-05-01' },
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1000, currency: 'EUR', date: '2025-02-01' },
    { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1800, currency: 'EUR', date: '2025-05-01' },
    { type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 1, price: 1000, currency: 'EUR', date: '2026-02-01' },
    { type: 'sell', category: 'crypto', symbol: 'SOL', quantity: 1, price: 4000, currency: 'EUR', date: '2026-05-01' }
  ];
  r = REPORT.build(crypto, opts(2025)).summary.germanDetail;
  ok('sec. 23: 2025 gain under the Freigrenze leaves the 2024 loss untouched', r.crypto.taxable === 0 && approx(r.carryIn.private, 2000) && approx(r.carryOut.private, 2000), r.carryOut);
  r = REPORT.build(crypto, opts(2026)).summary.germanDetail;
  ok('sec. 23: 2026 gain over it is reduced by the carried loss', approx(r.crypto.taxable, 1000) && approx(r.crypto.carryUsed, 2000) && approx(r.carryOut.private, 0), r.crypto);
  ok('sec. 23 losses never touch capital income', approx(r.carryIn.other, 0) && approx(r.carryIn.shares, 0));

  const interest = [{ type: 'interest', category: 'cash', symbol: 'Bank', amount: 1000, currency: 'EUR', date: '2025-05-01' }];
  r = REPORT.build(interest, opts(2025, { lossCarryState: { version: 1, opening: { 2025: { other: 400 } } } })).summary.germanDetail;
  ok('opening balance from the assessment is brought in', approx(r.carryIn.other, 400) && approx(r.taxableIncome, 600), r.carryIn);
  r = REPORT.build(interest, opts(2026, { lossCarryState: { version: 1, opening: { 2024: { other: 1500 } } } })).summary.germanDetail;
  ok('an older opening balance runs through the chain', approx(r.carryIn.other, 500), r.carryIn);
  r = REPORT.build(interest, opts(2025)).summary.germanDetail;
  ok('nothing to carry: all pots 0', r.carryIn.shares === 0 && r.carryIn.other === 0 && r.carryIn.private === 0 && r.carryOut.other === 0);

  console.log('loss-carry (tax advisor):');
  const TA = require('../tax-advisor.js');
  const td = TA.taxDataFromReport(REPORT.build(txs, opts(2025)), () => false);
  ok('advisor share pot starts from the carried loss (1500 - 1000)', approx(td.realizedStockGainsYTD, 500) && approx(td.carriedLosses.shares, 1000), td);
  const td2 = TA.taxDataFromReport(REPORT.build(crypto, opts(2025)), () => false);
  ok('advisor private-sale pot starts from the carried loss', approx(td2.realizedCryptoGainsYTD, 800 - 2000) && approx(td2.carriedLosses.private, 2000));
  const harvest = TA.analyze(Object.assign({}, td, { positions: [{ symbol: 'CCC', category: 'stocks', costBasisEUR: 2000, currentValueEUR: 1000 }] }));
  ok('a harvest hint only for the gain the carry leaves (500)', harvest.findings.some(f => f.kind === 'lossHarvest' && f.pot === 'stocks' && approx(f.offset, 500)), harvest.findings.map(f => [f.kind, f.pot, f.offset]));

  console.log('loss-carry (per portfolio):');
  const two = [
    { type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 200, currency: 'EUR', date: '2024-01-10', portfolioId: 'a' },
    { type: 'sell', category: 'stocks', symbol: 'AAA', quantity: 10, price: 100, currency: 'EUR', date: '2024-06-10', portfolioId: 'a' },
    { type: 'buy', category: 'stocks', symbol: 'BBB', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-10', portfolioId: 'b' },
    { type: 'sell', category: 'stocks', symbol: 'BBB', quantity: 10, price: 200, currency: 'EUR', date: '2024-06-10', portfolioId: 'b' }
  ];
  r = REPORT.build(two, opts(2024)).summary.germanDetail;
  ok('combined: the loss in a offsets the gain in b', approx(r.carryOut.shares, 0) && approx(r.taxableIncome, 0));
  const bd = LC.breakdown(two, opts(2024), REPORT.build);
  ok('breakdown: a keeps a 1000 share loss, b none', bd.length === 2 && approx(bd.find(x => x.portfolioId === 'a').carryOut.shares, 1000) && bd.find(x => x.portfolioId === 'b').carryOut.shares === 0, bd);
  ok('breakdown of a single portfolio is empty', LC.breakdown(txs, opts(2025), REPORT.build).length === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
