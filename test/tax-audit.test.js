// Regression tests for the tax findings of the 2026-10-04 audit (docs/AUDIT.md,
// BUG-001 ...). Each block reproduces the finding with the real modules.
// Run: node test/tax-audit.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 0.005); }

// Minimal localStorage so the settings stores are exercised for real.
let _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};
function resetStore() { _store = {}; }

const GT = require('../tax-calculation-engine.js').GermanTax;
const TS = require('../tax-settings.js');
const TR = require('../tax-report-builder.js');

// German report with the browser defaults: settings come from the store via
// the settings module, exactly like the Tax view.
function deStore(txs, extra) {
  return TR.build(txs, Object.assign({
    year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT,
    taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {}
  }, extra || {})).summary.germanDetail;
}

(function () {
  // ---- BUG-001: one church-tax store, honoured by the computation ----------
  console.log('BUG-001 church tax');
  const div3000 = [{ type: 'dividend', category: 'stocks', symbol: 'ALV', quantity: 1, price: 3000, currency: 'EUR', date: '2025-05-10' }];
  const kist9Total = 2000 / 4.09 * (1 + 0.055 + 0.09); // 559.90

  resetStore();
  GT.saveKirchensteuerRate(0.09); // the selector in the German fund-tax panel
  let g = deStore(div3000);
  ok('panel church tax reaches the computation', approx(g.totalTax, kist9Total) && g.kirchensteuer > 0);

  resetStore();
  g = deStore(div3000, { kirchensteuerRate: 0.09 });
  ok('explicit opts.kirchensteuerRate is honoured', approx(g.totalTax, kist9Total));

  resetStore();
  TS.save({ kirchensteuer: 0.08 }); // the Tax settings (overrides) panel
  ok('settings panel writes the encrypted church-tax key', localStorage.getItem('maermin_kirchensteuer') === '0.08');
  ok('settings key holds no church-tax rate', !('kirchensteuer' in JSON.parse(localStorage.getItem('maermin_tax_settings'))));
  ok('both panels read the same value', TS.load().kirchensteuer === 0.08 && GT.loadKirchensteuerRate() === 0.08);
  TS.save({ kirchensteuer: 0 });
  ok('choosing none clears the church-tax key', localStorage.getItem('maermin_kirchensteuer') === null && TS.load().kirchensteuer === 0);

  resetStore();
  localStorage.setItem('maermin_tax_settings', JSON.stringify({ abgeltungRate: 0.25, soli: true, kirchensteuer: 0.09, freistellungsauftrag: 1000 }));
  ok('plaintext rate from older builds is adopted', TS.load().kirchensteuer === 0.09);
  ok('... moved into the encrypted key', localStorage.getItem('maermin_kirchensteuer') === '0.09');
  ok('... and removed from the plaintext settings', !('kirchensteuer' in JSON.parse(localStorage.getItem('maermin_tax_settings'))));
  ok('... other settings survive the move', TS.load().freistellungsauftrag === 1000 && TS.load().soli === true);

  resetStore();
  GT.saveKirchensteuerRate(0.08);
  localStorage.setItem('maermin_tax_settings', JSON.stringify({ kirchensteuer: 0 }));
  ok('a rate set in the panel wins over a stale plaintext 0', TS.load().kirchensteuer === 0.08);

  resetStore();
  GT.saveKirchensteuerRate(0.09);
  TS.reset();
  ok('reset to defaults clears church tax too', TS.load().kirchensteuer === 0 && localStorage.getItem('maermin_kirchensteuer') === null);

  // ---- BUG-002: share losses only offset share gains (sec. 20 (6) S.4) ------
  console.log('BUG-002 loss pots');
  resetStore();
  const buySell = (sym, buy, sell, extra) => [
    Object.assign({ type: 'buy', category: 'stocks', symbol: sym, quantity: 100, price: buy, currency: 'EUR', date: '2024-01-10' }, extra || {}),
    Object.assign({ type: 'sell', category: 'stocks', symbol: sym, quantity: 100, price: sell, currency: 'EUR', date: '2025-06-01' }, extra || {})
  ];
  g = deStore(buySell('BAYN', 50, 30).concat(div3000));
  ok('share loss does not offset dividends (taxable 2000)', approx(g.taxableIncome, 2000) && approx(g.totalTax, 527.5));
  ok('unused share loss is reported as carried', approx(g.shareLossCarried, 2000));
  ok('no deductible loss shown for it', approx(g.lossesTaxable, 0));

  g = deStore(buySell('BAYN', 50, 30).concat(buySell('SAP', 100, 130)), { sparerpauschbetrag: 0 });
  ok('share loss offsets share gains (3000 - 2000)', approx(g.taxableIncome, 1000) && approx(g.shareLossCarried, 0));

  g = deStore(buySell('BAYN', 50, 30).concat(buySell('SAP', 100, 110)), { sparerpauschbetrag: 0 });
  ok('share loss larger than share gains: rest carried', approx(g.taxableIncome, 0) && approx(g.shareLossCarried, 1000));

  g = deStore(buySell('WORLD', 100, 90).concat(buySell('SAP', 100, 120)), { sparerpauschbetrag: 0, fundTypes: { WORLD: 'aktienfonds' } });
  ok('fund loss (after 30% TF) offsets share gains', approx(g.taxableIncome, 2000 - 700) && approx(g.shareLossCarried, 0));

  g = deStore(buySell('WORLD', 100, 90).concat(div3000), { sparerpauschbetrag: 0, fundTypes: { WORLD: 'aktienfonds' } });
  ok('fund loss offsets dividends (other pot)', approx(g.taxableIncome, 3000 - 700));

  g = deStore(buySell('IWDA', 100, 90).concat(div3000), { sparerpauschbetrag: 0, isFund: (s) => s === 'IWDA' });
  ok('unclassified ETF recognised by the fund rule is not a share', approx(g.taxableIncome, 2000) && approx(g.shareLossCarried, 0));

  const xml = TR.buildExcelWorkbook(TR.build(buySell('BAYN', 50, 30).concat(div3000), {
    year: 2025, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {} }));
  ok('export lists the carried share loss', xml.indexOf('Share losses not offset') > -1);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
