// The single skin-name normaliser (MaerminTickers.normalizeSkinName): every
// lookup in the skin price list goes through it.
// Run: node test/skin-names.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const T = require('../ticker-validation.js');

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
