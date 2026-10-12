// Node harness for P5-1.6: plain-language verdicts (MaerminVerdicts).
// Every band edge, null input and the German texts. Run: node test/verdicts.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

const I = require('../i18n.js');
const V = require('../verdicts.js');
const T = require('../translations-complete.js');
I.setLang('en');
const lv = (r) => r && r.level;

(function run() {
  console.log('null / non-finite input:');
  ['benchmark', 'sharpe', 'sortino', 'volatility', 'drawdown', 'health', 'dividendSafety'].forEach((k) => {
    ok(k + '(null|NaN|Infinity) → null', V[k](null) === null && V[k](NaN) === null && V[k](Infinity) === null && V[k]('5') === null);
  });

  console.log('benchmark (±1 pp is level):');
  ok('+0.99 pp → neutral', lv(V.benchmark(0.99, 'MSCI World')) === 'neutral');
  ok('−0.99 pp → neutral', lv(V.benchmark(-0.99, 'MSCI World')) === 'neutral');
  ok('+1 pp → good', lv(V.benchmark(1, 'MSCI World')) === 'good');
  ok('−1 pp → warn', lv(V.benchmark(-1, 'MSCI World')) === 'warn');
  // P5-2.2: same money in an index (XIRR fractions a year, € difference)
  ok('replay: within ±1 pp a year → neutral', lv(V.replay(0.072, 0.065, 150, 'MSCI World')) === 'neutral');
  ok('replay: 2 pp a year ahead → good, names the amount', lv(V.replay(0.09, 0.07, 1234.5, 'MSCI World')) === 'good' && /1,234\.50/.test(V.replay(0.09, 0.07, 1234.5, 'MSCI World').text) && /2\.0 percentage points/.test(V.replay(0.09, 0.07, 1234.5, 'MSCI World').text));
  ok('replay: behind → warn', lv(V.replay(0.04, 0.07, -800, 'S&P 500')) === 'warn' && /S&P 500/.test(V.replay(0.04, 0.07, -800, 'S&P 500').text));
  ok('replay: no money-weighted return → no sentence', V.replay(null, 0.07, 10, 'X') === null);
  const b = V.benchmark(-3.24, 'MSCI World');
  ok('text names the benchmark and the gap', /3\.2 percentage points worse than MSCI World/.test(b.text), b.text);

  console.log('Sharpe / Sortino bands 0 · 0.5 · 1 · 2:');
  ok('−0.01 → bad', lv(V.sharpe(-0.01)) === 'bad');
  ok('0 → warn', lv(V.sharpe(0)) === 'warn');
  ok('0.49 → warn', lv(V.sharpe(0.49)) === 'warn');
  ok('0.5 → neutral', lv(V.sharpe(0.5)) === 'neutral');
  ok('0.99 → neutral', lv(V.sharpe(0.99)) === 'neutral');
  ok('1 → good', lv(V.sharpe(1)) === 'good');
  ok('2 → good (very high text)', lv(V.sharpe(2)) === 'good' && /2 or more/.test(V.sharpe(2).text));
  ok('Sharpe text names Sharpe', /^Sharpe Ratio/.test(V.sharpe(0.7).text));
  ok('Sortino uses the same bands and names Sortino', lv(V.sortino(0.49)) === 'warn' && /^Sortino Ratio/.test(V.sortino(1.2).text));

  console.log('volatility bands 10 · 20 · 35 %:');
  ok('9.9 → good', lv(V.volatility(9.9)) === 'good');
  ok('10 → neutral', lv(V.volatility(10)) === 'neutral');
  ok('19.9 → neutral', lv(V.volatility(19.9)) === 'neutral');
  ok('20 → warn', lv(V.volatility(20)) === 'warn');
  ok('35 → bad', lv(V.volatility(35)) === 'bad');

  console.log('drawdown bands 10 · 20 · 35 % (sign ignored):');
  ok('9.9 → good', lv(V.drawdown(9.9)) === 'good');
  ok('10 → neutral', lv(V.drawdown(10)) === 'neutral');
  ok('−25 → warn', lv(V.drawdown(-25)) === 'warn');
  ok('35 → bad', lv(V.drawdown(35)) === 'bad');

  console.log('health bands = grade bands 85 · 70 · 55 · 40:');
  ok('85 → good (A)', lv(V.health(85)) === 'good' && /no single position/.test(V.health(85).text));
  ok('84 → good (B)', lv(V.health(84)) === 'good' && /Solid/.test(V.health(84).text));
  ok('70 → good (B)', lv(V.health(70)) === 'good');
  ok('69 → neutral (C)', lv(V.health(69)) === 'neutral');
  ok('55 → neutral (C)', lv(V.health(55)) === 'neutral');
  ok('54 → warn (D)', lv(V.health(54)) === 'warn');
  ok('40 → warn (D)', lv(V.health(40)) === 'warn');
  ok('39 → bad (F)', lv(V.health(39)) === 'bad');

  console.log('dividend safety (score 70 · 45, income at risk):');
  ok('70, 0 % at risk → good', lv(V.dividendSafety(70, 0)) === 'good');
  ok('80, 12 % at risk → neutral, names the share', lv(V.dividendSafety(80, 12)) === 'neutral' && /12%/.test(V.dividendSafety(80, 12).text), V.dividendSafety(80, 12).text);
  ok('69 → warn', lv(V.dividendSafety(69, 30)) === 'warn' && /\(30%\)/.test(V.dividendSafety(69, 30).text));
  ok('45 → warn without a share → no empty brackets', lv(V.dividendSafety(45, 0)) === 'warn' && !/\(\)/.test(V.dividendSafety(45, 0).text));
  ok('44 → bad', lv(V.dividendSafety(44, 50)) === 'bad');

  console.log('cumulative difference:');
  const d = V.cumulativeDiffPp([0.1, 0.1], [0.05, 0]);
  ok('(1.1·1.1 − 1.05) × 100 = 16 pp', Math.abs(d - 16) < 1e-9, String(d));
  ok('length mismatch / empty → null', V.cumulativeDiffPp([0.1], [0.1, 0.2]) === null && V.cumulativeDiffPp([], []) === null);

  console.log('no advice + translations:');
  ok('disclaimer says not investment advice', /not investment advice/.test(V.disclaimer()));
  const keys = ['vdBenchLevel', 'vdBenchAhead', 'vdBenchBehind', 'vdRatioNeg', 'vdRatioLow', 'vdRatioOk', 'vdRatioGood', 'vdRatioGreat',
    'vdVolLow', 'vdVolMid', 'vdVolHigh', 'vdVolVeryHigh', 'vdDdLow', 'vdDdMid', 'vdDdHigh', 'vdDdVeryHigh',
    'vdHealthA', 'vdHealthB', 'vdHealthC', 'vdHealthD', 'vdHealthF', 'vdDivSafe', 'vdDivSafeSome', 'vdDivMixed', 'vdDivFragile', 'vdNoAdvice'];
  const missing = keys.filter((k) => !T.en[k] || !T.de[k]);
  ok('every verdict key exists in en and de', missing.length === 0, missing.join(', '));
  const srcEn = keys.filter((k) => T.en[k] && T.de[k] && T.en[k] === T.de[k]);
  ok('German texts differ from English', srcEn.length === 0, srcEn.join(', '));
  I.setLang('de');
  const g = V.benchmark(2.5, 'MSCI World');
  ok('German: decimal comma and benchmark name', /2,5 Prozentpunkte/.test(g.text) && /MSCI World/.test(g.text), g.text);
  ok('German disclaimer: keine Anlageberatung', /keine Anlageberatung/.test(V.disclaimer()));
  ok('German Sharpe sentence', /Sharpe/.test(V.sharpe(0.7).text) && V.sharpe(0.7).text !== T.en.vdRatioOk);
  I.setLang('en');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
