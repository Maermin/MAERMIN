// One release version everywhere (cleanup B-4: the header badge still said
// "v11" in v12.0.0). package.json is the source; the backup stamp carries it,
// the header badge reads it from there, and the page titles name its major.minor.
// Run: node test/app-version.test.js
'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const root = path.join(__dirname, '..');
const read = (f) => readFileSync(path.join(root, f), 'utf8');
const version = JSON.parse(read('package.json')).version;
const [major, minor] = version.split('.');
const B = require('../backup-engine.js');

console.log('release version ' + version + ':');
ok('backup stamp = package.json version', B.VERSION === version, B.VERSION);
const renderer = read('renderer.js');
ok('header badge reads the version, no hard-coded "vNN"', /'data-testid': 'brand-version' \}, 'v' \+ String\(\(window\.MaerminBackup && window\.MaerminBackup\.VERSION\)/.test(renderer) && !/'mx-brand-tag' \}, 'v\d+'\)/.test(renderer));
const short = 'v' + major + '.' + minor;
ok('index.html title names ' + short, read('index.html').includes('<title>MAERMIN ' + short + ' '));
const build = read('build.mjs');
ok('production title and splash badge name ' + short, build.includes('<title>MAERMIN ' + short + ' ') && build.includes('<div class="version-badge">' + short + '</div>'));

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
