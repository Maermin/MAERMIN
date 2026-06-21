// Node harness for the Steam price-history pure layer: the line1 listing-page
// parser and the priceoverview parser exported from cf-worker/worker.js (ESM,
// loaded via dynamic import), plus the single skin-name normaliser in
// MaerminTickers. Fixtures are frozen TEXT snippets modelled on the real
// pages, including the Souvenir case diagnosed 2026-06: Steam redirects the
// listing URL to a grouped item page WITHOUT a line1 graph, and the
// priceoverview answer carries only lowest_price (no median_price).
// Run: node test/steam-history.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const T = require('../ticker-validation.js');

// ---- frozen fixtures ---------------------------------------------------------
const PAGE_WITH_HISTORY = [
  '<html><head><title>Steam Community Market :: AK-47 | Redline (Field-Tested)</title></head>',
  '<body><script>',
  'var line1=[["Dec 01 2021 01: +0","12.50","3"],["Dec 02 2021 01: +0","13.25","5"],["Nov 30 2021 01: +0","12.10","2"]];',
  'g_timePriceHistoryEarliest = new Date();',
  '</script></body></html>'
].join('\n');

// The Souvenir case: Steam redirects /listings/730/<name> to a grouped item
// page (e.g. /listings/730/G180120FC053004) that lists OTHER wears and has no
// price graph variable at all.
const GROUPED_PAGE_NO_LINE1 = [
  '<html><head><title>Steam Community Market</title></head>',
  '<body><div class="market_listing_row">Souvenir Desert Eagle | Fennec Fox (Battle-Scarred)</div>',
  '<div class="market_listing_row">Souvenir Desert Eagle | Fennec Fox (Well-Worn)</div>',
  '<script>var g_rgAssets = {};</script></body></html>'
].join('\n');

const PAGE_WITH_EMPTY_LINE1 = '<html><body><script>var line1=[];</script></body></html>';
const PAGE_WITH_BROKEN_LINE1 = '<html><body><script>var line1=[["Dec 01 2021 01: +0", broken];</script></body></html>';

(async function run() {
  console.log('steam-history:');
  const W = await import('../cf-worker/worker.js');

  // ---- parseSteamLine1 ---------------------------------------------------------
  const hist = W.parseSteamLine1(PAGE_WITH_HISTORY);
  ok('history page is recognised', hist.found === true && hist.prices.length === 3);
  ok('rows parse to {ts, date, price(USD)}', hist.prices.every((p) => p.ts > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.price > 0));
  ok('hour suffix is stripped from the date', hist.prices.some((p) => p.date === '2021-12-01'));
  ok('points are sorted ascending', hist.prices[0].date === '2021-11-30' && hist.prices[2].date === '2021-12-02');
  ok('prices stay numeric USD', approx(hist.prices[1].price, 12.5));

  const grouped = W.parseSteamLine1(GROUPED_PAGE_NO_LINE1);
  ok('grouped page (Souvenir redirect) -> found:false', grouped.found === false && grouped.prices.length === 0);

  const empty = W.parseSteamLine1(PAGE_WITH_EMPTY_LINE1);
  ok('empty graph is found:true with zero rows (the old regex missed this)', empty.found === true && empty.prices.length === 0);

  const broken = W.parseSteamLine1(PAGE_WITH_BROKEN_LINE1);
  ok('malformed graph JSON degrades to found:true, no rows', broken.found === true && broken.prices.length === 0);
  ok('null/empty html -> found:false', W.parseSteamLine1('').found === false && W.parseSteamLine1(null).found === false);
  const junkRows = W.parseSteamLine1('<script>var line1=[["not a date","12.50","1"],["Dec 01 2021 01: +0","0","1"],["Dec 02 2021 01: +0","9.99","1"]];</script>');
  ok('unparseable dates and zero prices drop row-by-row', junkRows.prices.length === 1 && approx(junkRows.prices[0].price, 9.99));

  // ---- parseSteamOverview --------------------------------------------------------
  // Real Souvenir answer (diagnosed): lowest_price only, no median_price.
  ok('lowest_price-only answer parses', approx(W.parseSteamOverview({ success: true, lowest_price: '$415.45' }), 415.45));
  ok('median_price fallback parses', approx(W.parseSteamOverview({ success: true, median_price: '12,34€' }), 12.34));
  // Regression: USD thousands separator. "$1,113.00" is 1113, NOT 1.113 - the
  // old single .replace(',', '.') turned pricey knives into ~1 (off by 1000x).
  ok('thousands separator -> full price', approx(W.parseSteamOverview({ success: true, lowest_price: '$1,113.00' }), 1113));
  ok('thousands separator, large', approx(W.parseSteamOverview({ success: true, lowest_price: '$1,234.56' }), 1234.56));
  ok('thousands comma, no cents', approx(W.parseSteamOverview({ success: true, lowest_price: '$2,000' }), 2000));
  ok('both present -> lowest wins', approx(W.parseSteamOverview({ success: true, lowest_price: '$10.00', median_price: '$11.00' }), 10));
  ok('success without any price -> 0', W.parseSteamOverview({ success: true }) === 0);
  ok('success:false -> 0', W.parseSteamOverview({ success: false, lowest_price: '$5.00' }) === 0);
  ok('junk body -> 0', W.parseSteamOverview(null) === 0 && W.parseSteamOverview({ success: true, lowest_price: 'n/a' }) === 0);

  // ---- normalizeSkinName (the ONE normalising place) -------------------------------
  const N = T.normalizeSkinName;
  ok('exact names pass through unchanged', N('Souvenir Desert Eagle | Fennec Fox (Minimal Wear)') === 'Souvenir Desert Eagle | Fennec Fox (Minimal Wear)');
  ok('double spaces collapse', N('Souvenir  Desert Eagle |  Fennec Fox  (Minimal Wear)') === 'Souvenir Desert Eagle | Fennec Fox (Minimal Wear)');
  ok('souvenir prefix casing fixes', N('souvenir Desert Eagle | Fennec Fox (Minimal Wear)') === 'Souvenir Desert Eagle | Fennec Fox (Minimal Wear)');
  ok('stattrak prefix normalises to the trademark form', N('stattrak AK-47 | Redline (Field-Tested)') === 'StatTrak™ AK-47 | Redline (Field-Tested)');
  ok('stattrak(tm) variant normalises too', N('StatTrak(TM) AK-47 | Redline (Field-Tested)') === 'StatTrak™ AK-47 | Redline (Field-Tested)');
  ok('separator spacing is fixed', N('AK-47|Redline (Field-Tested)') === 'AK-47 | Redline (Field-Tested)');
  ok('wear casing canonicalises', N('AK-47 | Redline (field-tested)') === 'AK-47 | Redline (Field-Tested)');
  ok('unknown parenthetical stays untouched', N('Sticker | Crown (Foil)') === 'Sticker | Crown (Foil)');
  ok('knife star prefix survives', N('★ Karambit | Doppler (Factory New)').indexOf('★ Karambit') === 0);
  ok('empty input stays empty', N('') === '' && N(null) === '');

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
