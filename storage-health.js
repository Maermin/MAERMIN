// ============================================================================
// MAERMIN — Storage health  (window.MaerminStorageHealth)
// ----------------------------------------------------------------------------
// All data lives in this browser. Two ways to lose it without a sign
// (audit 2026-10-24, feature 2):
//   - the browser clears "best-effort" site data under storage pressure, and
//     Safari on iOS deletes it after 7 days without a visit unless MAERMIN is
//     installed to the home screen;
//   - a save of the encrypted vault fails (storage full or blocked) and the
//     error was swallowed.
// This module asks the browser to keep the data (navigator.storage.persist()),
// shows usage and protection in a card on the Privacy page, and reports a
// failed vault save to the app (event bus 'storage:save-failed').
//
// Chromium grants persist() without a prompt (based on engagement / install),
// so it is asked automatically after unlock; Firefox shows a permission
// prompt, so there it is only asked from the card's button.
//
//   assess(input)            → { level: 'ok'|'warn'|'risk', items: [{ code, level }] }   (pure)
//   shouldAutoRequest(input) → boolean                                             (pure)
//   reportSave(ok, error)    → called by storage.js after each vault save
//   snapshot() / request() / autoRequest()                                        (browser)
//   Card(props)              → the Privacy page card
// No persisted key: the browser's own answer (persisted()) is the state.
// Tested in test/storage-health.test.js.
// ============================================================================
(function () {
  'use strict';

  // ---- pure --------------------------------------------------------------------
  function assess(i) {
    i = i || {};
    var items = [];
    if (i.saveFailed) items.push({ code: 'save-failed', level: 'risk' });
    if (i.supported === false) items.push({ code: 'no-api', level: 'warn' });
    else if (i.persisted === true) items.push({ code: 'persisted', level: 'ok' });
    else items.push({ code: i.ios && !i.standalone ? 'ios-not-installed' : 'not-persisted', level: 'warn' });
    var usage = typeof i.usage === 'number' && isFinite(i.usage) ? i.usage : null;
    var quota = typeof i.quota === 'number' && isFinite(i.quota) && i.quota > 0 ? i.quota : null;
    if (usage != null && quota != null) {
      var share = usage / quota;
      if (share >= 0.95) items.push({ code: 'nearly-full', level: 'risk' });
      else if (share >= 0.8) items.push({ code: 'filling-up', level: 'warn' });
    }
    var level = items.some(function (x) { return x.level === 'risk'; }) ? 'risk'
      : items.some(function (x) { return x.level === 'warn'; }) ? 'warn' : 'ok';
    return { level: level, items: items, usage: usage, quota: quota };
  }

  // Ask without a click only where the browser does not prompt (not Firefox).
  function shouldAutoRequest(i) {
    i = i || {};
    return i.supported === true && i.persisted !== true && !i.firefox;
  }

  // ---- save reports (storage.js) --------------------------------------------------
  var saveState = { failed: false, at: null, message: '' };
  var listeners = [];
  function reportSave(ok, error) {
    if (ok) { saveState = { failed: false, at: null, message: '' }; return; }
    var first = !saveState.failed;   // one alert per failure streak, not per retry
    saveState = { failed: true, at: Date.now(), message: String((error && (error.name || error.message)) || 'unknown') };
    if (!first) return;
    listeners.forEach(function (cb) { try { cb(saveState); } catch (e) { /* a listener must not break saving */ } });
    var Bus = typeof window !== 'undefined' && window.MaerminBus;
    if (Bus && typeof Bus.emit === 'function') { try { Bus.emit('storage:save-failed', { at: saveState.at, message: saveState.message }); } catch (e) { /* no bus */ } }
  }
  function onSaveFailed(cb) { if (typeof cb === 'function') listeners.push(cb); }
  function lastSave() { return Object.assign({}, saveState); }

  // ---- browser ---------------------------------------------------------------------
  function nav() { return typeof navigator !== 'undefined' ? navigator : null; }
  function env(n) {
    n = n || nav() || {};
    var ua = String(n.userAgent || '');
    var w = typeof window !== 'undefined' ? window : {};
    var standalone = !!((w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || n.standalone === true);
    return {
      supported: !!(n.storage && typeof n.storage.persist === 'function' && typeof n.storage.persisted === 'function'),
      ios: /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (n.maxTouchPoints || 0) > 1),
      firefox: /Firefox\//.test(ua),
      standalone: standalone
    };
  }
  function snapshot(n) {
    n = n || nav() || {};
    var e = env(n);
    var out = Object.assign({}, e, { persisted: null, usage: null, quota: null, saveFailed: saveState.failed });
    if (!e.supported) return Promise.resolve(out);
    return Promise.all([
      n.storage.persisted().catch(function () { return null; }),
      typeof n.storage.estimate === 'function' ? n.storage.estimate().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (r) {
      out.persisted = r[0] === true;
      if (r[1]) { out.usage = r[1].usage; out.quota = r[1].quota; }
      return out;
    });
  }
  function request(n) {
    n = n || nav() || {};
    if (!env(n).supported) return Promise.resolve(false);
    return n.storage.persist().then(function (v) { return v === true; }, function () { return false; });
  }
  function autoRequest(n) {
    return snapshot(n).then(function (s) { return shouldAutoRequest(s) ? request(n) : s.persisted === true; });
  }

  // ---- card (Privacy page) ----------------------------------------------------------
  function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.t(k, f, v) : f; }
  function mb(bytes) {
    var I = typeof window !== 'undefined' && window.MaerminI18n;
    if (bytes == null) return '—';
    var v = bytes >= 1e9 ? bytes / 1e9 : bytes / 1e6, unit = bytes >= 1e9 ? 'GB' : 'MB';
    return (I && I.num ? I.num(v, v < 10 ? 1 : 0) : v.toFixed(v < 10 ? 1 : 0)) + ' ' + unit;
  }
  function itemText(code) {
    switch (code) {
      case 'persisted': return __('shPersisted', 'Protected: the browser will not clear MAERMIN\'s data to free up space.');
      case 'not-persisted': return __('shNotPersisted', 'Not protected: when space runs low, the browser may clear MAERMIN\'s data. Protect it, or install MAERMIN as an app, and keep backups.');
      case 'ios-not-installed': return __('shIos', 'Safari on iPhone and iPad deletes the data of sites you have not opened for 7 days. Add MAERMIN to your home screen (Share → Add to Home Screen) and keep backups.');
      case 'no-api': return __('shNoApi', 'This browser cannot promise to keep the data. Keep backups.');
      case 'filling-up': return __('shFillingUp', 'Storage for this site is over 80 % full.');
      case 'nearly-full': return __('shNearlyFull', 'Storage for this site is nearly full: new changes may not be saved. Make a backup now.');
      case 'save-failed': return __('shSaveFailed', 'The last change could not be saved: browser storage is full or blocked. Make a backup now.');
      default: return '';
    }
  }
  function Card(props) {
    var React = typeof window !== 'undefined' ? window.React : null;
    if (!React) return null;
    var e = React.createElement, UIC = window.MaerminComponents;
    var s0 = React.useState(null), snap = s0[0], setSnap = s0[1];
    var s1 = React.useState(''), note = s1[0], setNote = s1[1];
    var s2 = React.useState(false), busy = s2[0], setBusy = s2[1];
    React.useEffect(function () {
      var alive = true;
      snapshot().then(function (s) { if (alive) setSnap(s); });
      return function () { alive = false; };
    }, []);
    if (!snap) return null;
    var a = assess(snap);
    var tone = a.level === 'ok' ? 'gain' : a.level === 'warn' ? 'warning' : 'loss';
    var protect = function () {
      setBusy(true);
      request().then(function (granted) {
        return snapshot().then(function (s) {
          setSnap(s); setBusy(false);
          setNote(granted ? '' : __('shDenied', 'The browser did not allow it. Installing MAERMIN as an app usually does; until then, keep backups.'));
        });
      });
    };
    return e(UIC.Card, { title: __('shTitle', 'Storage on this device'), headingLevel: 'h3', 'data-testid': 'storage-health', className: 'ui-sh' },
      e('p', { className: 'tone-' + tone, 'data-testid': 'storage-health-level' },
        a.level === 'ok' ? __('shOk', 'Your data is stored and protected on this device.')
          : a.level === 'warn' ? __('shWarn', 'Your data is stored on this device, but it is not protected yet.')
            : __('shRisk', 'Your data is at risk on this device.')),
      e('ul', { className: 'ui-pv-list' }, a.items.map(function (it) { return e('li', { key: it.code, 'data-code': it.code }, itemText(it.code)); })),
      a.usage != null && a.quota != null ? e('p', { className: 'is-dim', 'data-testid': 'storage-health-usage' }, __('shUsage', '{used} used of {quota} available to this site', { used: mb(a.usage), quota: mb(a.quota) })) : null,
      snap.supported && !snap.persisted ? e(UIC.Button, { variant: 'primary', size: 'sm', loading: busy, onClick: protect, 'data-testid': 'storage-health-protect' }, __('shProtect', 'Protect my data from cleanup')) : null,
      note ? e('p', { className: 'tone-warning', role: 'status' }, note) : null);
  }

  var api = { assess: assess, shouldAutoRequest: shouldAutoRequest, reportSave: reportSave, onSaveFailed: onSaveFailed, lastSave: lastSave,
    env: env, snapshot: snapshot, request: request, autoRequest: autoRequest, Card: Card };
  if (typeof window !== 'undefined') window.MaerminStorageHealth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
