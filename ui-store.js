// ============================================================================
// MAERMIN — Ephemeral UI Store  (window.MaerminUI)
// ----------------------------------------------------------------------------
// Second slice migrated off the renderer God component onto MaerminStore: toast
// notifications. The toasts array used to be App-level useState, so every toast
// add/expire re-rendered the WHOLE app. Now it lives in a store and a small
// <ToastContainer> subscribes to just that slice via MaerminStore.useStore — a
// toast no longer re-renders the rest of the app, only the container.
//
// The renderer keeps its addToast(message, type) API; it just delegates here, so
// the dozens of call sites are unchanged. Pure reducers (reduceAdd/reduceDismiss)
// are Node-tested; ToastContainer touches React only at render.
// ============================================================================
(function () {
  'use strict';

  var Store = (typeof window !== 'undefined' && window.MaerminStore)
    ? window.MaerminStore
    : (function () { try { return require('./store.js'); } catch (e) { return null; } })();

  var DEFAULT_TTL = 3000;   // ms a toast stays before auto-dismiss
  var MAX = 6;              // cap so a burst can't grow the list unbounded
  var _seq = 0;

  // ---- pure reducers (Node-tested) -----------------------------------------
  function reduceAdd(items, toast, max) {
    max = max || MAX;
    var next = (items || []).concat([toast]);
    if (next.length > max) next = next.slice(next.length - max); // drop oldest
    return next;
  }
  function reduceDismiss(items, id) {
    return (items || []).filter(function (t) { return t.id !== id; });
  }

  var toasts = Store ? Store.createStore({ items: [] }) : null;

  function add(message, type, ttl) {
    var id = 't' + Date.now() + '_' + (++_seq);
    var ms = (typeof ttl === 'number') ? ttl : DEFAULT_TTL;
    var toast = { id: id, message: String(message == null ? '' : message), type: type || 'info', ttl: ms };
    if (toasts) toasts.setState(function (s) { return { items: reduceAdd(s.items, toast, MAX) }; });
    if (ms > 0 && typeof setTimeout !== 'undefined') setTimeout(function () { dismiss(id); }, ms);
    return id;
  }
  function dismiss(id) { if (toasts) toasts.setState(function (s) { return { items: reduceDismiss(s.items, id) }; }); }
  function clear() { if (toasts) toasts.setState({ items: [] }); }
  function items() { return toasts ? toasts.getState().items : []; }

  // ---- overlays (modal / palette open-states) -------------------------------
  // A single store keyed by overlay name, so open-states are centralised and a
  // future modal just adds a key. Designed to grow: closeAll/anyOpen let the
  // Escape handler + the "is any overlay open" check stop enumerating booleans.
  var overlays = Store ? Store.createStore({}) : null;
  function openOverlay(name) { if (overlays) overlays.setState(function () { var p = {}; p[name] = true; return p; }); }
  function closeOverlay(name) { if (overlays) overlays.setState(function () { var p = {}; p[name] = false; return p; }); }
  function toggleOverlay(name) { if (overlays) overlays.setState(function (s) { var p = {}; p[name] = !s[name]; return p; }); }
  function isOverlayOpen(name) { return overlays ? !!overlays.getState()[name] : false; }
  function closeAllOverlays() {
    if (!overlays) return;
    var s = overlays.getState(), p = {};
    Object.keys(s).forEach(function (k) { p[k] = false; });
    overlays.setState(p);
  }
  function anyOverlayOpen() {
    if (!overlays) return false;
    var s = overlays.getState();
    return Object.keys(s).some(function (k) { return !!s[k]; });
  }

  // ---- React component (browser): subscribes to just the toasts slice -------
  function ToastContainer(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !Store || !toasts) return null;
    var theme = (props && props.theme) || {};
    var list = Store.useStore(toasts, function (s) { return s.items; });
    return React.createElement('div', { className: 'toast-container' },
      list.map(function (toast) {
        // Aurora: glass toast with a status icon, a live countdown bar (the
        // real TTL) and click-to-dismiss. Colours come from styles.css.
        var Icon = window.MaerminIcon;
        var ico = toast.type === 'success' ? 'realized' : toast.type === 'error' ? 'close' : toast.type === 'warning' ? 'alerts' : 'sparkle';
        return React.createElement('div', {
          key: toast.id,
          className: 'toast ' + toast.type,
          role: toast.type === 'error' ? 'alert' : 'status',
          onClick: function () { dismiss(toast.id); },
          style: { '--mx-ttl': (toast.ttl > 0 ? toast.ttl : 0) + 'ms', cursor: 'pointer' }
        },
          Icon ? React.createElement('span', { className: 'toast-icon' }, Icon(ico, { size: 15, strokeWidth: 2.2 })) : null,
          React.createElement('span', { className: 'toast-msg' }, toast.message),
          toast.ttl > 0 ? React.createElement('span', { className: 'toast-timer', 'aria-hidden': 'true' }) : null
        );
      }));
  }

  var api = {
    toasts: toasts,
    add: add, dismiss: dismiss, clear: clear, items: items,
    reduceAdd: reduceAdd, reduceDismiss: reduceDismiss,
    ToastContainer: ToastContainer,
    DEFAULT_TTL: DEFAULT_TTL, MAX: MAX,
    // overlays
    overlays: overlays,
    openOverlay: openOverlay, closeOverlay: closeOverlay, toggleOverlay: toggleOverlay,
    isOverlayOpen: isOverlayOpen, closeAllOverlays: closeAllOverlays, anyOverlayOpen: anyOverlayOpen
  };
  if (typeof window !== 'undefined') window.MaerminUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
