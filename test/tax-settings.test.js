// Node harness for the user tax-settings layer: sanitisation/clamping, the
// Abgeltungsteuer resolver (custom rate, Soli toggle, church-tax formula),
// Teilfreistellung overrides, per-position taxable overrides, and the
// integration into calculateGermanTax + the report builder's German detail.
// Run: node test/tax-settings.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const S = require('../tax-settings.js');
const ENGINE = require('../tax-calculation-engine.js');
const REPORT = require('../tax-report-builder.js');
const GT = ENGINE.GermanTax;

(function run() {
  console.log('tax-settings:');

  // ---- sanitize / defaults -----------------------------------------------------
  const def = S.sanitize({});
  ok('defaults are the German statutory values', def.abgeltungRate === 0.25 && def.soli === true && def.kirchensteuer === 0 && def.freistellungsauftrag === 1000 && def.cryptoExemption === true);
  ok('implausible rate falls back to default', S.sanitize({ abgeltungRate: 0.9 }).abgeltungRate === 0.25);
  ok('only 8 or 9 percent church tax accepted', S.sanitize({ kirchensteuer: 0.05 }).kirchensteuer === 0 && S.sanitize({ kirchensteuer: 0.09 }).kirchensteuer === 0.09);
  ok('flags coerce to boolean', S.sanitize({ soli: 0, cryptoExemption: 1 }).soli === false && S.sanitize({ soli: 0, cryptoExemption: 1 }).cryptoExemption === true);
  ok('allowance clamps to a sane range', S.sanitize({ freistellungsauftrag: -5 }).freistellungsauftrag === 1000 && S.sanitize({ freistellungsauftrag: 2000 }).freistellungsauftrag === 2000);
  ok('teilfreistellung overrides kept only when in [0,1]', JSON.stringify(S.sanitize({ teilfreistellung: { aktienfonds: 0.4, x: 5 } }).teilfreistellung) === JSON.stringify({ aktienfonds: 0.4 }));

  // ---- persistence -------------------------------------------------------------
  S.save({ abgeltungRate: 0.26375, soli: false });
  ok('save persists and merges', S.load().abgeltungRate === 0.26375 && S.load().soli === false && S.load().freistellungsauftrag === 1000);
  S.reset();
  ok('reset returns to defaults', S.load().abgeltungRate === 0.25 && S.load().soli === true);

  // ---- computeAbgeltung --------------------------------------------------------
  const plain = S.computeAbgeltung(1000, S.sanitize({}));
  ok('25% flat + Soli by default', approx(plain.tax, 250) && approx(plain.soli, 13.75) && plain.kirchensteuer === 0);
  ok('Soli toggle off removes Soli', S.computeAbgeltung(1000, S.sanitize({ soli: false })).soli === 0);
  const kist = S.computeAbgeltung(4080, S.sanitize({ kirchensteuer: 0.08 }));
  ok('church tax uses the reduced 32d base at 25%', approx(kist.tax, 1000) && approx(kist.kirchensteuer, 80) && approx(kist.soli, 55));
  const custom = S.computeAbgeltung(1000, S.sanitize({ abgeltungRate: 0.3 }));
  ok('custom rate applies directly', approx(custom.tax, 300) && approx(custom.soli, 16.5));
  ok('negative income clamps to zero', S.computeAbgeltung(-50, S.sanitize({})).total === 0);

  // ---- teilfreistellungRate override -------------------------------------------
  ok('override wins over statutory default', S.teilfreistellungRate('aktienfonds', 0.30, S.sanitize({ teilfreistellung: { aktienfonds: 0.4 } })) === 0.4);
  ok('falls back to the statutory default', S.teilfreistellungRate('mischfonds', 0.15, S.sanitize({})) === 0.15);

  // ---- position overrides (sensitive store) ------------------------------------
  S.saveOverride('aapl', 2025, 1234.5);
  ok('override stored by uppercased symbol + year', S.positionOverride(S.loadOverrides(), 'AAPL', 2025) === 1234.5);
  ok('missing override -> null', S.positionOverride(S.loadOverrides(), 'AAPL', 2024) === null);
  S.saveOverride('AAPL', 2025, null);
  ok('null clears the override', S.positionOverride(S.loadOverrides(), 'AAPL', 2025) === null);

  // ---- integration: calculateGermanTax reads settings -------------------------
  const txs = [
    { type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 1000, date: '2024-01-02' },
    { type: 'sell', category: 'stocks', symbol: 'X', quantity: 1, price: 4000, date: '2025-03-01' }, // +3000 gain
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 1000, date: '2023-01-02' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 6000, date: '2025-03-01' } // +5000, >1y
  ];
  const baseSettings = S.sanitize({});
  // Inject the resolver so the pure (window-less) engine path uses settings too.
  baseSettings.__viaModule = true;
  const def2 = ENGINE.calculateGermanTax(txs, 2025, S.sanitize({}));
  // Stocks 3000 - 1000 allowance = 2000 @ 25% + 5.5% Soli; crypto >1y exempt.
  ok('default: long-term crypto exempt, stocks taxed', approx(def2.cryptoTaxFreeGains, 5000) && approx(def2.totalCapitalIncome, 3000));

  const noExempt = ENGINE.calculateGermanTax(txs, 2025, S.sanitize({ cryptoExemption: false }));
  ok('crypto exemption off taxes the long-term gain', approx(noExempt.totalCapitalIncome, 8000) && noExempt.cryptoTaxFreeGains === 0);

  const higherAllowance = ENGINE.calculateGermanTax(txs, 2025, S.sanitize({ freistellungsauftrag: 3000 }));
  ok('higher allowance lowers taxable income', approx(higherAllowance.taxableIncome, 0));

  // ---- integration: report builder threads settings + overrides ---------------
  const rep = REPORT.build([
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 100, currency: 'EUR', date: '2023-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 50, price: 140, currency: 'EUR', date: '2025-06-01' }
  ], {
    year: 2025, jurisdiction: 'de', exchangeRate: 0.9, germanTax: GT, dividendEvents: [],
    taxSettings: S.sanitize({ abgeltungRate: 0.25, freistellungsauftrag: 0 }),
    fundTypes: { WORLD: 'aktienfonds' }
  });
  const g = rep.summary.germanDetail;
  // gain 2000, 30% TF -> 1400 taxable, allowance 0 -> 350 tax + 19.25 Soli.
  ok('report applies settings allowance + teilfreistellung', g && approx(g.gainsTaxable, 1400) && approx(g.abgeltungsteuer, 350));

  const repOverride = REPORT.build([
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 100, currency: 'EUR', date: '2023-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 50, price: 140, currency: 'EUR', date: '2025-06-01' }
  ], {
    year: 2025, jurisdiction: 'de', exchangeRate: 0.9, germanTax: GT, dividendEvents: [],
    taxSettings: S.sanitize({ freistellungsauftrag: 0 }),
    taxOverrides: { 'WORLD|2025': 500 },
    fundTypes: { WORLD: 'aktienfonds' }
  });
  // Override replaces the gain with 500; 30% TF -> 350 taxable.
  ok('per-position override replaces the computed gain', approx(repOverride.summary.germanDetail.gainsTaxable, 350));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
