// Node harness for the minimal state store (MaerminStore) and the first concrete
// slice migrated onto it (MaerminPrefs). The React binding (useStore) is
// browser-only; here we cover the pure observable core + prefs persistence.
// Run: node test/store.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const S = require('../store.js');

(function run() {
  console.log('store:');
  ok('shallowEqual: equal / unequal / extra-key',
    S.shallowEqual({ a: 1 }, { a: 1 }) && !S.shallowEqual({ a: 1 }, { a: 2 }) && !S.shallowEqual({ a: 1 }, { a: 1, b: 2 }));

  const st = S.createStore({ a: 1, b: 2 });
  ok('getState initial', st.getState().a === 1 && st.getState().b === 2);

  let notifs = 0, lastPrev = null;
  const unsub = st.subscribe((s, prev) => { notifs++; lastPrev = prev; });
  st.setState({ a: 5 });
  ok('setState shallow-merges (b preserved)', st.getState().a === 5 && st.getState().b === 2);
  ok('subscriber notified once', notifs === 1);
  ok('listener receives previous state', lastPrev && lastPrev.a === 1);

  st.setState({ a: 5 }); // identical → no-op
  ok('no notification when nothing changed', notifs === 1);

  st.setState((s) => ({ b: s.b + 10 }));
  ok('functional setState', st.getState().b === 12 && notifs === 2);

  unsub();
  st.setState({ a: 99 });
  ok('unsubscribe stops notifications', notifs === 2 && st.getState().a === 99);

  st.setState({ only: true }, true); // replace
  ok('replace mode swaps the whole state', st.getState().only === true && st.getState().a === undefined);

  // ---- prefs-store (mock localStorage) --------------------------------------
  console.log('prefs-store:');
  class LS {
    constructor() { this._d = new Map(); }
    getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
    setItem(k, v) { this._d.set(k, String(v)); }
    removeItem(k) { this._d.delete(k); }
  }
  const ls = new LS();
  ls.setItem('theme', 'purple');
  ls.setItem('maermin_active_view', 'tax');
  globalThis.localStorage = ls;
  const P = require('../prefs-store.js'); // seeds its store from localStorage at load

  ok('loadFrom reads keys + applies defaults', (() => {
    const s = P.loadFrom((k) => ls.getItem(k));
    return s.theme === 'purple' && s.activeView === 'tax' && s.language === 'en' && s.currency === 'EUR';
  })());
  ok('get returns stored values', P.get('theme') === 'purple' && P.get('activeView') === 'tax');
  ok('get returns the default for an unset key', P.get('language') === 'en' && P.get('currency') === 'EUR');

  P.set('language', 'de');
  ok('set writes through to localStorage (correct key)', ls.getItem('maermin_language') === 'de');
  ok('set updates the in-memory store', P.get('language') === 'de' && P.getState().language === 'de');

  let fired = false;
  const u = P.subscribe(() => { fired = true; });
  P.set('currency', 'USD');
  u();
  ok('subscribe fires on a pref change', fired && P.get('currency') === 'USD' && ls.getItem('currency') === 'USD');
  ok('unknown pref → undefined / ignored', P.get('nope') === undefined);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
