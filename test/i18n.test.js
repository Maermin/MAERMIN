// Node harness for P2-2: the language/locale module (i18n.js) and the i18n
// guard that `npm run check` runs.
// Run: node test/i18n.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const I = require('../i18n.js');
const U = require('../utils.js');

(async () => {
  // ---- formatting follows the language -----------------------------------
  I.setLang('de');
  ok('de number: 1.234,50', I.num(1234.5) === '1.234,50');
  ok('de money: 1.234,50 €', I.money(1234.5, 'EUR').replace(/ /g, ' ') === '1.234,50 €');
  ok('de percent: 12,5 %', I.pct(12.5, 1).replace(/ /g, ' ') === '12,5 %');
  ok('de signed percent', I.pct(3.2, 2, true).replace(/ /g, ' ') === '+3,20 %');
  ok('de date: 05.10.2026', I.date('2026-10-05') === '05.10.2026');
  ok('de month name', I.date('2026-10-05', 'month').indexOf('Okt') === 0);
  ok('utils.formatNumber follows the language', U.formatNumber(1234.5) === '1.234,50');
  ok('utils.formatDate follows the language', U.formatDate('2024-03-01') === '01.03.2024');
  I.setLang('en');
  ok('en number: 1,234.50', I.num(1234.5) === '1,234.50');
  ok('en money: €1,234.50', I.money(1234.5, 'EUR') === '€1,234.50');
  ok('en percent: 12.5%', I.pct(12.5, 1) === '12.5%');
  ok('en date', I.date('2026-10-05', 'medium') === 'Oct 5, 2026');
  ok('a calendar day does not shift with the time zone', I.date('2026-01-01') === '01/01/2026');
  ok('junk input formats as zero / empty', I.num(NaN) === '0.00' && I.date('nope') === '' && I.date(null) === '');

  // ---- lookup -------------------------------------------------------------
  I.setLang('de');
  ok('t: German value', I.t('navAreaTaxes', 'Taxes') === 'Steuern');
  ok('t: unknown key uses the fallback', I.t('noSuchKeyXyz', 'Fallback') === 'Fallback');
  ok('t: slots are filled', I.t('fireMedianReaches', '', { y: 7 }) === 'Der Median-Pfad erreicht FIRE in Jahr 7');
  ok('fill leaves unknown slots', I.fill('{a} {b}', { a: 1 }) === '1 {b}');
  ok('fill: plural forms', I.fill('{n} {n:fee|fees}', { n: 1 }) === '1 fee' && I.fill('{n} {n:fee|fees}', { n: 2 }) === '2 fees');
  ok('fill: a plural form may hold slots', I.fill('{n:One portfolio|All {n} portfolios}', { n: 1 }) === 'One portfolio' && I.fill('{n:One portfolio|All {n} portfolios}', { n: 3 }) === 'All 3 portfolios');
  I.setLang('fr');
  ok('an unsupported language falls back to English', I.lang() === 'en' && I.locale() === 'en-US');
  I.setLang(null);

  // ---- wiring ---------------------------------------------------------------
  const html = read('index.html');
  ok('i18n.js loads after prefs and before the views', html.indexOf('prefs-store.js') < html.indexOf('i18n.js') && html.indexOf('i18n.js') < html.indexOf('renderer.js'));
  const r = read('renderer.js');
  ok('<html lang> follows the language', /applyHtmlLang\(language\)/.test(r));
  ok('formatPrice uses the locale formatter', /MaerminI18n\.num\(converted, 2, language\)/.test(r));
  ok("no 'en-US' number formatting left in formatPrice/utils", !/toLocaleString\('en-US'/.test(read('utils.js')));

  // ---- the guard -----------------------------------------------------------
  const { run } = await import('../scripts/i18n-check.mjs');
  const res = run({ quiet: true });
  ok('guard passes on the repo', res.errors.length === 0, res.errors.join(' | ').slice(0, 400));
  ok('en and de have the same keys', res.missingDe.length === 0 && res.extraDe.length === 0);
  ok('every key the code uses exists', res.undef.length === 0, res.undef.join(','));
  ok('no dead keys', res.dead.length === 0, res.dead.join(','));
  const lib = await import('../scripts/i18n-lib.mjs');
  const hits = lib.scanText("e('h2', null, 'Portfolio Health'); x(t.k || 'Fallback'); __('k', 'Text'); console.log('Debug text'); s({ color: 'rgba(0,0,0,.2)' })");
  ok('scanner flags literal UI text only', hits.length === 1 && hits[0].text === 'Portfolio Health', JSON.stringify(hits));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
