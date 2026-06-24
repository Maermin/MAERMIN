// ============================================================================
// MAERMIN — UI Preferences Store  (window.MaerminPrefs)
// ----------------------------------------------------------------------------
// The first concrete slice migrated out of the renderer God component onto the
// MaerminStore pattern: the small set of persisted UI preferences (theme,
// language, active view, display currency). It is the single source of truth
// for these — reads come back from the in-memory store, writes go to the store
// AND localStorage. The renderer still drives React with useState for now; this
// centralises persistence and lets future components subscribe to a pref slice
// via MaerminStore.useStore without touching the renderer.
//
// Behaviour is byte-compatible with the renderer's previous direct localStorage
// usage (same keys + defaults), so this is a no-op for existing users.
//
// Pure core (loadFrom) is Node-tested; falls back to bare localStorage if the
// store library is somehow absent.
// ============================================================================
(function () {
  'use strict';

  var Store = (typeof window !== 'undefined' && window.MaerminStore)
    ? window.MaerminStore
    : (function () { try { return require('./store.js'); } catch (e) { return null; } })();

  // name → { localStorage key, default }. Mirrors the renderer's prior usage.
  var SPEC = {
    theme:      { key: 'theme',               def: 'dark' },
    language:   { key: 'maermin_language',    def: 'en' },
    activeView: { key: 'maermin_active_view', def: 'overview' },
    currency:   { key: 'currency',            def: 'EUR' }
  };

  function lsGet(k) { try { return (typeof localStorage !== 'undefined') ? localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); } catch (e) {} }

  // Pure: build the prefs object from a storage reader (key -> string|null).
  function loadFrom(reader) {
    var s = {};
    Object.keys(SPEC).forEach(function (name) {
      var v = reader(SPEC[name].key);
      s[name] = (v == null || v === '') ? SPEC[name].def : v;
    });
    return s;
  }

  var _store = Store ? Store.createStore(loadFrom(lsGet)) : null;

  function get(name) {
    if (!SPEC[name]) return undefined;
    if (_store) return _store.getState()[name];
    var v = lsGet(SPEC[name].key);
    return (v == null || v === '') ? SPEC[name].def : v;
  }
  function set(name, value) {
    if (!SPEC[name]) return;
    lsSet(SPEC[name].key, value);
    if (_store) { var p = {}; p[name] = value; _store.setState(p); }
  }
  function getState() { return _store ? _store.getState() : loadFrom(lsGet); }
  function subscribe(fn) { return _store ? _store.subscribe(fn) : function () {}; }
  // For React components that want to re-render on a single pref:
  function useValue(name) {
    if (!_store || !Store || typeof Store.useStore !== 'function') return get(name);
    return Store.useStore(_store, function (s) { return s[name]; });
  }

  var api = {
    SPEC: SPEC, loadFrom: loadFrom,
    get: get, set: set, getState: getState, subscribe: subscribe, useValue: useValue,
    store: _store
  };
  if (typeof window !== 'undefined') window.MaerminPrefs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
