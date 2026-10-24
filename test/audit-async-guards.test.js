// Regression guards, AUDIT.md run 2026-10-24 BUG-9 / BUG-10 / BUG-11: three
// async view paths applied results that arrived after the user had moved on.
// The paths live inside React views (not loadable in Node), so this checks the
// guards in the source; the e2e suite and the PR walkthrough exercise the views.
// Run: node test/audit-async-guards.test.js
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
// The body of the first `marker ... endMarker` stretch in a file.
function between(text, marker, endMarker) {
  const a = text.indexOf(marker);
  if (a < 0) return '';
  const b = text.indexOf(endMarker, a);
  return b < 0 ? '' : text.slice(a, b);
}

console.log('BUG-9: the value chart sets state only from its newest build:');
const chart = between(src('features6.js'), 'const buildChart = useCallback(async () => {', 'useEffect(() => { buildChart(); }, [buildChart]);');
ok('a build sequence number is taken when a build starts', /const seq = \+\+buildSeqRef\.current;/.test(chart));
ok('the result, the error and the loading flag are set only by the newest build',
  /if \(current\(\)\) setChartData\(final\)/.test(chart) && /if \(current\(\)\) setError\(/.test(chart) && /if \(current\(\)\) setLoading\(false\)/.test(chart));

console.log('BUG-10: a late symbol-search answer is dropped:');
const search = between(src('features3.js'), '// Debounced search', 'const pick = (item) =>');
ok('the search effect returns a cleanup that cancels its pending answer', /return \(\) => \{ cancelled = true; \};/.test(search));
ok('both search paths stop before setting results when cancelled',
  (search.match(/if \(cancelled\) return;/g) || []).length >= 3);

console.log('BUG-11: an auto-fetched dividend schedule survives leaving the view:');
const divs = between(src('renderer.js'), 'const freshSchedule = generated.filter', 'setFetching(false);');
ok('the schedule is written to maermin_divevents directly, not only through view state',
  /localStorage\.setItem\('maermin_divevents'/.test(divs) && /setDivEvents\(withSchedule\)/.test(divs));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
