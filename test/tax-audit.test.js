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

  // ---- BUG-003: skins + physical commodities are sec. 23 private sales -----
  console.log('BUG-003 private sales');
  resetStore();
  const lot = (cat, sym, buyDate, buy, sellDate, sell) => [
    { type: 'buy', category: cat, symbol: sym, quantity: 1, price: buy, currency: 'EUR', date: buyDate },
    { type: 'sell', category: cat, symbol: sym, quantity: 1, price: sell, currency: 'EUR', date: sellDate }
  ];
  g = deStore(lot('skins', 'AWP DRAGON LORE', '2022-01-10', 2000, '2025-06-01', 5000));
  ok('skin held > 1 year is tax-free', approx(g.totalTax, 0) && approx(g.gainsTaxable, 0) && approx(g.crypto.exemptLongTermGains, 3000));

  g = deStore(lot('skins', 'AK REDLINE', '2025-01-10', 200, '2025-06-01', 1000));
  ok('short-term skin gain under the Freigrenze is tax-free', approx(g.totalTax, 0) && approx(g.crypto.netShortTermGains, 800));
  ok('... and does not use the Sparerpauschbetrag', approx(g.sparerpauschbetragUsed, 0));

  g = deStore(lot('skins', 'AK REDLINE', '2025-01-10', 200, '2025-06-01', 1000).concat(lot('crypto', 'ETH', '2025-02-01', 1000, '2025-07-01', 1300)));
  ok('one Freigrenze across skins + crypto (800 + 300 taxable)', approx(g.crypto.taxable, 1100));

  g = deStore(lot('commodities', 'GOLD BAR', '2023-01-10', 1500, '2025-06-01', 2500));
  ok('physical commodity held > 1 year is tax-free by default', approx(g.totalTax, 0) && approx(g.crypto.exemptLongTermGains, 1000));

  TS.saveTaxClass('4GLD', 'capital');
  ok('tax class override stored in the sensitive per-position store', TS.taxClassOf(TS.loadOverrides(), '4gld') === 'capital');
  g = TR.build(lot('commodities', '4GLD', '2023-01-10', 1500, '2025-06-01', 2500), {
    year: 2025, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [],
    taxOverrides: TS.loadOverrides(), sparerpauschbetrag: 0 }).summary.germanDetail;
  ok('commodity marked as security (ETC) is capital income', approx(g.gainsTaxable, 1000) && approx(g.crypto.exemptLongTermGains, 0));
  TS.saveTaxClass('4GLD', null);
  ok('clearing the class override removes it', TS.taxClassOf(TS.loadOverrides(), '4GLD') === null);

  g = deStore(lot('crypto', 'BTC', '2022-01-10', 1000, '2025-06-01', 4000).concat(lot('skins', 'M4 HOWL', '2022-01-10', 1000, '2025-06-01', 4000)),
    { taxSettings: TS.sanitize({ cryptoExemption: false }) });
  ok('crypto exemption toggle leaves the skin 1-year rule alone', approx(g.crypto.netShortTermGains, 3000) && approx(g.crypto.exemptLongTermGains, 3000));

  const xml3 = TR.buildExcelWorkbook(TR.build(lot('skins', 'X', '2025-01-10', 1, '2025-06-01', 2), {
    year: 2025, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {} }));
  ok('export labels the block as private sales (sec. 23)', xml3.indexOf('Private sales (sec. 23)') > -1);

  // ---- BUG-004: exchange trades are booked on the LOCAL calendar day -------
  console.log('BUG-004 exchange trade dates');
  process.env.TZ = 'Europe/Berlin';
  const EX = require('../exchange-sync.js');
  const ms = Date.parse('2025-12-31T23:30:00Z'); // 1 Jan 2026, 00:30 in Berlin
  const bn = EX.ADAPTERS.binance([{ symbol: 'BTCEUR', id: 1, price: '90000', qty: '0.1', commission: '0', commissionAsset: 'EUR', time: ms, isBuyer: false }])[0];
  ok('Binance trade at 00:30 local on 1 Jan is dated 2026-01-01', bn.date === '2026-01-01');
  const kr = EX.ADAPTERS.kraken({ result: { trades: { T1: { pair: 'XBTEUR', type: 'buy', price: '1', vol: '1', fee: '0', time: ms / 1000 } } } })[0];
  ok('Kraken trade dated on the local day', kr.date === '2026-01-01');
  const cb = EX.ADAPTERS.coinbase([{ trade_id: 7, product_id: 'BTC-EUR', side: 'buy', size: '1', price: '1', fee: '0', created_at: '2025-12-31T23:30:00.000Z' }])[0];
  ok('Coinbase trade dated on the local day', cb.date === '2026-01-01');
  const bp = EX.ADAPTERS.bitpanda({ data: [{ id: 'b1', attributes: { cryptocoin_symbol: 'BTC', type: 'buy', amount: '1', price: '1', currency: 'EUR', time: { date_iso8601: '2026-03-10T09:00:00+01:00' } } }] })[0];
  ok('offset-aware ISO dates keep their day', bp.date === '2026-03-10');
  const buyMs = Date.parse('2025-03-09T23:30:00Z'); // 10 Mar 2025, 00:30 in Berlin
  const buy = EX.ADAPTERS.binance([{ symbol: 'BTCEUR', id: 2, price: '80000', qty: '0.1', commission: '0', commissionAsset: 'EUR', time: buyMs, isBuyer: true }])[0];
  const d4 = TR.fifo([buy, { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 0.1, price: 90000, currency: 'EUR', date: '2026-03-10' }], 2026, 1, null)[0];
  ok('sale on the anniversary of a 00:30 buy stays taxable', buy.date === '2025-03-10' && d4.longTerm === false);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
