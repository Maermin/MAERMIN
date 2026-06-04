// Node harness for the audit/error log. Run: node test/audit-log.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.localStorage = {
  _d: {}, getItem(k){ return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null; },
  setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; }
};
// no globalThis.window → install() is a no-op (headless), record() still works
const Audit = require('../audit-log.js');

(function run() {
  console.log('record / read:');
  Audit.record(Audit.EVENTS.VAULT_UNLOCK, 'unlocked');
  Audit.record(Audit.EVENTS.DATA_EXPORT, 'exported tax report');
  let entries = Audit.getEntries();
  ok('two entries recorded', entries.length === 2);
  ok('newest first', entries[0].type === Audit.EVENTS.DATA_EXPORT);
  ok('entry has timestamp + type + detail', entries[0].t > 0 && !!entries[0].type && entries[0].detail === 'exported tax report');

  console.log('filtering:');
  Audit.record(Audit.EVENTS.ERROR, 'boom', 'error');
  ok('filter by level', Audit.getEntries({ level: 'error' }).length === 1);
  ok('filter by type', Audit.getEntries({ type: Audit.EVENTS.VAULT_UNLOCK }).length === 1);
  ok('limit honoured', Audit.getEntries({ limit: 1 }).length === 1);

  console.log('non-sensitive + bounded:');
  ok('detail truncated to 200 chars', (() => { Audit.record('x', 'y'.repeat(500)); return Audit.getEntries({ limit: 1 })[0].detail.length === 200; })());
  ok('ring buffer caps at MAX', (() => {
    Audit.clear();
    for (let i = 0; i < Audit.MAX + 50; i++) Audit.record('e', String(i));
    return Audit.getEntries().length === Audit.MAX;
  })());

  console.log('clear:');
  Audit.clear();
  ok('clear empties the log', Audit.getEntries().length === 0);

  console.log('resilience:');
  ok('corrupt store → getEntries returns []', (() => { localStorage.setItem(Audit.KEY, 'not json'); return Audit.getEntries().length === 0; })());

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
