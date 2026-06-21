// Node harness for the Custom Asset Categories engine. Pure, no browser.
// Run: node test/custom-categories.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const C = require('../custom-categories.js');
const EMPTY = { version: 1, categories: [] };

(function run() {
  console.log('custom-categories:');

  // ---- slug ----
  ok('slug spaces -> underscore', C.slug('Real Estate') === 'real_estate');
  ok('slug strips punctuation', C.slug('Crypto!!') === 'crypto');
  ok('slug digit-leading prefixed', C.slug('123 fund') === 'cat_123_fund');
  ok('slug empty', C.slug('   ') === '');

  // ---- normalize drops reserved / dup / empty ----
  let st = C.normalize({ categories: [
    { label: 'Real Estate' },
    { id: 'crypto', label: 'My Crypto' },     // reserved -> dropped
    { label: 'options' },                     // reserved slug -> dropped
    { label: 'Real Estate', color: '#fff' },  // dup slug -> dropped
    { label: '   ' },                         // empty -> dropped
    { id: 'p2p', label: 'P2P Loans', color: '#123456' }
  ]});
  ok('normalize keeps only valid', st.categories.length === 2);
  ok('normalize slugs id from label', st.categories[0].id === 'real_estate');
  ok('normalize keeps explicit colour', st.categories[1].color === '#123456');
  ok('normalize assigns colour when missing', /^#/.test(st.categories[0].color));

  // ---- add / collisions ----
  let s2 = C.add(EMPTY, 'Real Estate');
  ok('add creates a custom category', s2.categories.length === 1 && s2.categories[0].id === 'real_estate');
  s2 = C.add(s2, 'Crypto');                   // reserved
  ok('add rejects a reserved built-in id', s2.categories.length === 1);
  s2 = C.add(s2, 'Real Estate');              // dup
  ok('add rejects a duplicate', s2.categories.length === 1);
  s2 = C.add(s2, 'P2P Loans', '#abcdef');
  ok('add with colour', s2.categories[1].color === '#abcdef');

  // ---- ids / all / get / label / color / isCustom (explicit state) ----
  ok('ids returns custom ids only', C.ids(s2).join(',') === 'real_estate,p2p_loans');
  const all = C.all(s2);
  ok('all merges built-ins first', all[0].id === 'crypto' && all[0].custom === false);
  ok('all includes custom flagged', all.some(c => c.id === 'p2p_loans' && c.custom === true));
  ok('all length = 4 builtins + 2 custom', all.length === 6);
  ok('label resolves custom', C.label('real_estate', s2) === 'Real Estate');
  ok('label resolves built-in', C.label('crypto', s2) === 'Crypto');
  ok('label falls back to id', C.label('unknown_x', s2) === 'unknown_x');
  ok('color resolves custom', C.color('p2p_loans', s2) === '#abcdef');
  ok('isCustom true for custom', C.isCustom('real_estate', s2) === true);
  ok('isCustom false for built-in', C.isCustom('crypto', s2) === false);

  // ---- rename / setColor / remove ----
  let s3 = C.rename(s2, 'real_estate', 'Property');
  ok('rename changes label, keeps id', C.label('real_estate', s3) === 'Property' && C.ids(s3).indexOf('real_estate') !== -1);
  s3 = C.setColor(s3, 'real_estate', '#00ff00');
  ok('setColor updates colour', C.color('real_estate', s3) === '#00ff00');
  s3 = C.setColor(s3, 'real_estate', 'not-a-color');
  ok('setColor ignores bad colour', C.color('real_estate', s3) === '#00ff00');
  s3 = C.remove(s3, 'real_estate');
  ok('remove deletes', C.isCustom('real_estate', s3) === false && C.ids(s3).length === 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
