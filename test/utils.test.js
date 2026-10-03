// Tests for MaerminUtils.parseDecimal (locale-tolerant numeric input) and
// MaerminUtils.safeParse (crash-proof JSON parsing of storage entries).
// Run: node test/utils.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const Utils = require('../utils.js');

(function run() {
  console.log('parseDecimal — plain numbers:');
  ok('integer string', Utils.parseDecimal('42') === 42);
  ok('dot decimal', Utils.parseDecimal('1234.56') === 1234.56);
  ok('leading dot', Utils.parseDecimal('.5') === 0.5);
  ok('negative', Utils.parseDecimal('-3.25') === -3.25);
  ok('number passthrough', Utils.parseDecimal(7.5) === 7.5);
  ok('whitespace trimmed', Utils.parseDecimal(' 12.5 ') === 12.5);

  console.log('parseDecimal — German / mixed formats:');
  ok('comma decimal "1,5"', Utils.parseDecimal('1,5') === 1.5);
  ok('German thousands "1.234,56"', Utils.parseDecimal('1.234,56') === 1234.56);
  ok('US thousands "1,234.56"', Utils.parseDecimal('1,234.56') === 1234.56);
  ok('multiple commas as thousands "1,234,567"', Utils.parseDecimal('1,234,567') === 1234567);
  ok('comma decimal small "0,001"', Utils.parseDecimal('0,001') === 0.001);

  console.log('parseDecimal — invalid input returns NaN (never a truncated value):');
  ok('"abc" is NaN', isNaN(Utils.parseDecimal('abc')));
  ok('"1.5x" is NaN', isNaN(Utils.parseDecimal('1.5x')));
  ok('empty string is NaN', isNaN(Utils.parseDecimal('')));
  ok('null is NaN', isNaN(Utils.parseDecimal(null)));
  ok('undefined is NaN', isNaN(Utils.parseDecimal(undefined)));
  ok('Infinity is NaN', isNaN(Utils.parseDecimal(Infinity)));

  console.log('safeParse — never throws:');
  ok('valid JSON parsed', Utils.safeParse('{"a":1}', null).a === 1);
  ok('array parsed', Utils.safeParse('[1,2]', []).length === 2);
  ok('corrupt JSON returns fallback', Utils.safeParse('{oops', 'FB') === 'FB');
  ok('null returns fallback', Utils.safeParse(null, 'FB') === 'FB');
  ok('empty string returns fallback', Utils.safeParse('', 'FB') === 'FB');
  ok('undefined returns fallback', Utils.safeParse(undefined, 'FB') === 'FB');

  // ---- txTypeInfo: one display name per transaction type ----
  {
    const T = Utils.txTypeInfo;
    ok('buy / sell keep their labels and tones', T('buy').label === 'Buy' && T('buy').tone === 'in' && T('sell').label === 'Sell' && T('sell').tone === 'out');
    ok('a dividend is not a sell', T('dividend').label === 'Dividend' && T('dividend').tone === 'income');
    ok('interest is income', T('interest').label === 'Interest' && T('interest').tone === 'income');
    ok('type is case-insensitive', T('DIVIDEND').label === 'Dividend');
    ok('translations win when present', T('dividend', { txDividend: 'Dividende' }).label === 'Dividende' && T('buy', { buy: 'Kauf' }).label === 'Kauf');
    ok('missing translation falls back to English', T('interest', { buy: 'Kauf' }).label === 'Interest');
    ok('unknown type is shown as written, neutral', T('transfer').label === 'Transfer' && T('transfer').tone === 'neutral');
    ok('empty type renders a dash', T(undefined).label === '—' && T('').tone === 'neutral');
    ok('every tone carries colours', ['buy', 'sell', 'dividend', 'x'].every((k) => /^#/.test(T(k).color) && /^rgba/.test(T(k).background)));
  }


  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
