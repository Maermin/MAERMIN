// Node harness for storage-health.js (persistent storage + storage health):
// the pure assessment, when to ask without a click, the save-failure report,
// and snapshot / request over a fake navigator.storage.
// Run: node test/storage-health.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const H = require('../storage-health.js');
const codes = (a) => a.items.map((x) => x.code).join(',');

(async () => {
  console.log('assess:');
  let a = H.assess({ supported: true, persisted: true, usage: 5e6, quota: 1e9 });
  ok('protected, little used → ok', a.level === 'ok' && codes(a) === 'persisted', a);
  a = H.assess({ supported: true, persisted: false, usage: 5e6, quota: 1e9 });
  ok('not protected → warn, not-persisted', a.level === 'warn' && codes(a) === 'not-persisted', a);
  a = H.assess({ supported: true, persisted: false, ios: true, standalone: false });
  ok('iPhone Safari, not installed → the 7-day warning', codes(a) === 'ios-not-installed', a);
  a = H.assess({ supported: true, persisted: false, ios: true, standalone: true });
  ok('iPhone, installed to the home screen → the plain warning', codes(a) === 'not-persisted', a);
  a = H.assess({ supported: false });
  ok('no Storage API → warn, no-api', a.level === 'warn' && codes(a) === 'no-api', a);
  a = H.assess({ supported: true, persisted: true, usage: 85, quota: 100 });
  ok('over 80 % full → filling-up warn', a.level === 'warn' && codes(a) === 'persisted,filling-up', a);
  a = H.assess({ supported: true, persisted: true, usage: 96, quota: 100 });
  ok('over 95 % full → nearly-full risk', a.level === 'risk' && codes(a) === 'persisted,nearly-full', a);
  a = H.assess({ supported: true, persisted: true, saveFailed: true });
  ok('a failed save → risk, listed first', a.level === 'risk' && codes(a) === 'save-failed,persisted', a);
  a = H.assess({ supported: true, persisted: true, usage: NaN, quota: 0 });
  ok('unknown usage / quota → no usage line', a.usage === null && a.quota === null && a.level === 'ok', a);

  console.log('shouldAutoRequest:');
  ok('Chromium, not protected → ask without a click', H.shouldAutoRequest({ supported: true, persisted: false }));
  ok('Firefox (shows a prompt) → only from the button', !H.shouldAutoRequest({ supported: true, persisted: false, firefox: true }));
  ok('already protected or no API → do not ask', !H.shouldAutoRequest({ supported: true, persisted: true }) && !H.shouldAutoRequest({ supported: false }));

  console.log('reportSave:');
  const seen = [];
  H.onSaveFailed((s) => seen.push(s.message));
  H.reportSave(false, { name: 'QuotaExceededError' });
  H.reportSave(false, { name: 'QuotaExceededError' });
  ok('a failure is reported once per streak, not per retry', seen.length === 1 && seen[0] === 'QuotaExceededError' && H.lastSave().failed === true, seen);
  H.reportSave(true);
  H.reportSave(false, new Error('blocked'));
  ok('a success ends the streak; the next failure is reported again', seen.length === 2 && seen[1] === 'Error', seen);
  H.reportSave(true);
  ok('lastSave after a success is clean', H.lastSave().failed === false);

  console.log('snapshot / request (fake navigator):');
  let persistedNow = false, asked = 0;
  const nav = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', storage: {
    persisted: () => Promise.resolve(persistedNow),
    persist: () => { asked++; persistedNow = true; return Promise.resolve(true); },
    estimate: () => Promise.resolve({ usage: 12e6, quota: 6e10 }) } };
  const s = await H.snapshot(nav);
  ok('snapshot reads protection and usage', s.supported === true && s.persisted === false && s.usage === 12e6 && s.quota === 6e10 && s.firefox === false, s);
  ok('autoRequest asks once and reports protection', (await H.autoRequest(nav)) === true && asked === 1);
  ok('autoRequest does not ask again once protected', (await H.autoRequest(nav)) === true && asked === 1);
  const ff = { userAgent: 'Mozilla/5.0 (X11; rv:130.0) Gecko/20100101 Firefox/130.0', storage: nav.storage };
  persistedNow = false;
  ok('Firefox: autoRequest does not ask (no prompt without a click)', (await H.autoRequest(ff)) === false && asked === 1);
  ok('no Storage API: request is false, snapshot says unsupported', (await H.request({ userAgent: '' })) === false && (await H.snapshot({ userAgent: '' })).supported === false);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
