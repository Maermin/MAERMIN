// Trust pages (P2-5): the disclaimer wording per kind and the Privacy page
// sections, in English and German.
// Run: node test/trust.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const I = require('../i18n.js');
const T = require('../trust.js');
console.log('trust pages:');
I.setLang('en');
ok('every disclaimer says "no tax or investment advice"', /No tax or investment advice/.test(T.disclaimerText('tax')) && /No tax or investment advice/.test(T.disclaimerText('invest')));
ok('the tax disclaimer names the supported tax rules (Germany, US)', /German and US tax rules/.test(T.disclaimerText('tax')) && !/German and US/.test(T.disclaimerText('invest')));
const secs = T.privacySections();
ok('privacy page: local, Worker, direct requests, opt-in features', secs.length === 4 && secs.every((s) => s[0] && s[1].length >= 2));
const all = secs.map((s) => s[1].join(' ')).join(' ');
ok('privacy page names every outside service', ['CoinGecko', 'open.er-api.com', 'unpkg.com', 'cdnjs.cloudflare.com', 'Yahoo', 'Steam'].every((h) => all.includes(h)));
ok('privacy page covers sync, sharing and exchange connections', /Cloud sync/.test(all) && /Share & Compare/.test(all) && /Exchange connections/.test(all));
I.setLang('de');
ok('German disclaimer', /Keine Steuer- oder Anlageberatung/.test(T.disclaimerText('tax')) && /deutsche und US-Steuerregeln/.test(T.disclaimerText('tax')));
ok('German privacy page', T.privacySections()[0][0] === 'Bleibt auf diesem Gerät');
I.setLang(null);
console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
