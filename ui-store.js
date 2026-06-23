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
    var toast = { id: id, message: String(message == null ? '' : message), type: type || 'info' };
    if (toasts) toasts.setState(function (s) { return { items: reduceAdd(s.items, toast, MAX) }; });
    var ms = (typeof ttl === 'number') ? ttl : DEFAULT_TTL;
    if (ms > 0 && typeof setTimeout !== 'undefined') setTimeout(function () { dismiss(id); }, ms);
    return id;
  }
  function dismiss(id) { if (toasts) toasts.setState(function (s) { return { items: reduceDismiss(s.items, id) }; }); }
  function clear() { if (toasts) toasts.setState({ items: [] }); }
  function items() { return toasts ? toasts.getState().items : []; }

  // ---- React component (browser): subscribes to just the toasts slice -------
  function ToastContainer(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !Store || !toasts) return null;
    var theme = (props && props.theme) || {};
    var list = Store.useStore(toasts, function (s) { return s.items; });
    return React.createElement('div', { className: 'toast-container' },
      list.map(function (toast) {
        return React.createElement('div', {
          key: toast.id,
          className: 'toast ' + toast.type,
          style: {
            padding: '1rem 1.5rem',
            background: theme.card,
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            color: theme.text,
            borderLeft: '4px solid ' + (
              toast.type === 'success' ? theme.success :
              toast.type === 'error' ? theme.danger :
              toast.type === 'warning' ? theme.warning :
              theme.accent
            )
          }
        }, toast.message);
      }));
  }

  var api = {
    toasts: toasts,
    add: add, dismiss: dismiss, clear: clear, items: items,
    reduceAdd: reduceAdd, reduceDismiss: reduceDismiss,
    ToastContainer: ToastContainer,
    DEFAULT_TTL: DEFAULT_TTL, MAX: MAX
  };
  if (typeof window !== 'undefined') window.MaerminUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
