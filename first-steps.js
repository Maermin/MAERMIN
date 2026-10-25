// ============================================================================
// MAERMIN — First steps  (window.MaerminFirstSteps)
// ----------------------------------------------------------------------------
// Onboarding used to end after the Worker wizard. This card on the Overview
// lists what a new vault still needs, read from the user's own data (audit
// 2026-10-24, feature 4):
//   transaction  at least one transaction
//   prices       a Worker URL for stock / ETF prices (crypto works without)
//   backup       a backup made (the reminder's lastBackup, plain or encrypted)
//   tax          the tax settings saved once (Tax view; German tax system only)
// It shows once there is a first transaction (before that the "Welcome" card
// leads) and goes away when every step is done or the user hides it. Hiding
// sets the "firstSteps" widget of the Overview layout (maermin_dashboard_layout)
// to hidden, so Customize Overview can bring it back: no new storage key.
//
//   steps(state) -> [{ id, done }]     state: { txCount, workerUrl, lastBackup, taxSaved }
//   summary(list) -> { done, total, complete }
//   read(storage, txCount, workerUrl) -> state (from localStorage)
//   Card({ state, onAction(id), onHide }) -> React element or null
// Pure parts tested in test/first-steps.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var WIDGET_ID = 'firstSteps';
  var IDS = ['transaction', 'prices', 'backup', 'tax'];

  function steps(state) {
    var s = state || {};
    var done = {
      transaction: (Number(s.txCount) || 0) > 0,
      prices: String(s.workerUrl || '').trim().length >= 5,
      backup: (Number(s.lastBackup) || 0) > 0,
      tax: !!s.taxSaved
    };
    return IDS.map(function (id) { return { id: id, done: done[id] }; });
  }

  function summary(list) {
    var n = (list || []).filter(function (x) { return x.done; }).length;
    var total = (list || []).length;
    return { done: n, total: total, complete: total > 0 && n === total };
  }

  // The card is worth showing: a first transaction exists (the Welcome card
  // covers an empty vault) and something is still open.
  function shouldShow(state) {
    var list = steps(state);
    return list[0].done && !summary(list).complete;
  }

  function read(storage, txCount, workerUrl) {
    var st = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    var lastBackup = 0, taxSaved = false;
    try {
      var raw = st && st.getItem('maermin_backup_reminder');
      var b = raw ? JSON.parse(raw) : null;
      lastBackup = b && typeof b.lastBackup === 'number' ? b.lastBackup : 0;
    } catch (e) { lastBackup = 0; }
    // The tax settings (allowance, joint filing, church tax) are the German
    // profile; another tax system has nothing to set up there.
    try {
      var jur = (st && st.getItem('taxJurisdiction')) || 'de';
      taxSaved = jur !== 'de' || !!(st && st.getItem('maermin_tax_settings'));
    } catch (e) { taxSaved = false; }
    return { txCount: txCount, workerUrl: workerUrl, lastBackup: lastBackup, taxSaved: taxSaved };
  }

  function texts(id) {
    switch (id) {
      case 'transaction': return { label: __('fsTx', 'Add your first transaction'), action: null };
      case 'prices': return { label: __('fsPrices', 'Connect a price source for stocks and ETFs'), action: __('fsPricesAct', 'Add Worker URL') };
      case 'backup': return { label: __('fsBackup', 'Make a first backup of your vault'), action: __('fsBackupAct', 'Download encrypted backup') };
      case 'tax': return { label: __('fsTax', 'Set up your tax profile'), action: __('fsTaxAct', 'Open tax settings') };
      default: return { label: id, action: null };
    }
  }

  function Card(props) {
    var React = window.React, h = React.createElement;
    var UIC = window.MaerminComponents || {};
    var list = steps(props.state);
    var sum = summary(list);
    var hide = UIC.Button ? h(UIC.Button, { variant: 'quiet', size: 'sm', 'data-testid': 'first-steps-hide', onClick: props.onHide }, __('fsHide', 'Hide')) : null;
    return h(UIC.Card, { className: 'ui-first-steps', 'data-testid': 'first-steps', title: __('fsTitle', 'First steps'),
      subtitle: h('span', { 'data-testid': 'first-steps-progress' }, __('fsProgress', '{d} of {n} done', { d: sum.done, n: sum.total })), action: hide },
      h('ul', { className: 'ui-first-steps__list' }, list.map(function (s) {
        var tx = texts(s.id);
        return h('li', { key: s.id, 'data-step': s.id, 'data-done': s.done ? 'true' : 'false', className: 'ui-first-steps__item' + (s.done ? ' is-done' : '') },
          h('span', { className: 'ui-first-steps__mark', 'aria-hidden': 'true' }, s.done ? '✓' : '○'),
          h('span', { className: 'ui-first-steps__label' }, tx.label,
            h('span', { className: 'sr-only' }, s.done ? ' — ' + __('fsDone', 'done') : ' — ' + __('fsOpen', 'open'))),
          !s.done && tx.action && UIC.Button ? h(UIC.Button, { size: 'sm', 'data-step-action': s.id, onClick: function () { if (props.onAction) props.onAction(s.id); } }, tx.action) : null);
      })));
  }

  var api = { WIDGET_ID: WIDGET_ID, IDS: IDS, steps: steps, summary: summary, shouldShow: shouldShow, read: read, Card: Card };
  if (typeof window !== 'undefined') window.MaerminFirstSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
