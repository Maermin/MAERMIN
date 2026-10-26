// Employee equity: currency roles, rate lookup, fallback, manual override
// (PLAN-EQUITY § 2, Package 1). Run: node test/equity-fx.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);
const FX = require('../equity-fx.js');
const RC = require('../reporting-currency.js');
const I = require('../i18n.js');

// EUR per 1 unit, by day (Fri 2026-03-13, Mon 2026-03-16, ...).
const SERIES = {
  USD: [{ d: '2026-03-12', r: 0.92 }, { d: '2026-03-13', r: 0.9 }, { d: '2026-03-16', r: 0.91 }],
  CHF: [{ d: '2026-03-13', r: 1.05 }, { d: '2026-03-16', r: 1.04 }],
  GBP: [{ d: '2026-03-13', r: 1.2 }],
  JPY: [{ d: '2026-03-13', r: 0.0062 }]
};
const ctx = (extra) => Object.assign({ series: (c) => SERIES[c] || [], usdRates: { EUR: 0.9, USD: 1, CHF: 0.86, KWD: 0.307 } }, extra || {});

console.log('roles:');
ok('tax currency follows the tax country', FX.taxCurrency('DE') === 'EUR' && FX.taxCurrency('at') === 'EUR' && FX.taxCurrency('CH') === 'CHF' && FX.taxCurrency('US') === null);
ok('minor units: GBX / GBp / ZAc / ILA -> major / 100', ['GBX', 'GBp', 'ZAc', 'ILA'].map((c) => FX.majorOf(c)).map((m) => m.cur + '/' + m.div).join() === 'GBP/100,GBP/100,ZAR/100,ILS/100');

console.log('lookup:');
const exact = FX.eurPer('USD', '2026-03-13', ctx());
ok('rate of the day: source history', near(exact.rate, 0.9) && exact.source === 'history' && exact.date === '2026-03-13', exact);
const sat = FX.eurPer('USD', '2026-03-14', ctx());
ok('weekend: previous trading day, marked fallback with its date', near(sat.rate, 0.9) && sat.source === 'fallback' && sat.date === '2026-03-13', sat);
const late = FX.eurPer('CHF', '2026-04-30', ctx());
ok('more than 7 days without a fixing: today\'s table rate, approx', late.source === 'approx' && near(late.rate, 0.9 / 0.86), late);
ok('no history and no table rate: null', FX.eurPer('SEK', '2026-03-13', ctx()) === null);
const demoUsd = FX.eurPer('USD', '2026-10-17', { usdHistory: { '2026-10-15': 0.86, '2026-10-16': 0.861 } });
ok('a USD history handed in (the demo\'s) is used like the stored one', near(demoUsd.rate, 0.861) && demoUsd.source === 'fallback' && demoUsd.date === '2026-10-16', demoUsd);
ok('EUR is exact', FX.eurPer('EUR', '2026-03-13', ctx()).source === 'exact');
const kwd = FX.eurPer('KWD', '2026-03-13', ctx());
ok('a currency with only a table rate (KWD) is approx', kwd.source === 'approx' && near(kwd.rate, 0.9 / 0.307), kwd);

console.log('manual override:');
const ov = ctx({ overrides: { [FX.overrideKey('USD', 'EUR', '2026-03-13')]: { rate: 0.8888, note: 'Lohnabrechnung' } } });
const m = FX.eurPer('USD', '2026-03-13', ov);
ok('a manual rate wins over the history', near(m.rate, 0.8888) && m.source === 'manual', m);
ok('other days keep the history', FX.eurPer('USD', '2026-03-16', ov).source === 'history');
const pair = FX.rate('USD', 'CHF', '2026-03-13', ctx({ overrides: { 'USD>CHF@2026-03-13': { rate: 0.85 } } }));
ok('a manual cross rate is used as entered', near(pair.rate, 0.85) && pair.source === 'manual', pair);
ok('a cross with one manual leg is marked manual', FX.rate('USD', 'CHF', '2026-03-13', ov).source === 'manual');

console.log('cross rates:');
const usdChf = FX.rate('USD', 'CHF', '2026-03-13', ctx());
ok('USD share, CHF salary: through EUR', near(usdChf.rate, 0.9 / 1.05) && usdChf.source === 'history', usdChf);
const gbx = FX.convert(1234, 'GBX', 'EUR', '2026-03-13', ctx());
ok('1,234 GBX = 12.34 GBP = 14.808 EUR', near(gbx.value, 14.808), gbx);
ok('GBX -> GBP is a pure unit change', near(FX.convert(1234, 'GBX', 'GBP', '2026-03-13', ctx()).value, 12.34));
const jpy = FX.convert(100, 'USD', 'JPY', '2026-03-13', ctx());
ok('USD -> JPY', near(jpy.value, 100 * 0.9 / 0.0062, 1e-6), jpy);
const mixed = FX.rate('USD', 'CHF', '2026-03-14', ctx());
ok('a fallback leg marks the cross as fallback', mixed.source === 'fallback' && mixed.date === '2026-03-13', mixed);

console.log('event record:');
const rec = FX.record('USD', ['EUR', 'CHF', 'EUR', 'JPY', ''], '2026-03-13', ctx());
ok('one rate per target, duplicates dropped', Object.keys(rec).join() === 'EUR,CHF,JPY' && near(rec.EUR.rate, 0.9) && rec.CHF.source === 'history', rec);
ok('valueIn uses the stored record, no lookup', near(FX.valueIn(100, 'USD', rec, 'CHF'), 100 * 0.9 / 1.05) && FX.valueIn(100, 'USD', rec, 'SEK') === null && FX.valueIn(5, 'USD', rec, 'USD') === 5);
SERIES.USD[1].r = 0.5;   // the history changes later ...
ok('... a stored record does not move', near(FX.valueIn(100, 'USD', rec, 'EUR'), 90));

console.log('formatting (no currency table):');
I.setLang('de');
ok('JPY 0 decimals, KWD 3, EUR 2', I.moneyAuto(1234.5, 'JPY') === '1.235\u00a0¥' && I.moneyAuto(1.5, 'KWD') === '1,500\u00a0KWD' && I.moneyAuto(2, 'EUR') === '2,00\u00a0€', [I.moneyAuto(1234.5, 'JPY'), I.moneyAuto(1.5, 'KWD')]);
ok('reporting decimals match', RC.decimals('JPY') === 0 && RC.decimals('KWD') === 3);
I.setLang('en');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
