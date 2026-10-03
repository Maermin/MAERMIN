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

  // ---- modal dialogs: one wrapper for focus, Tab and Escape -----------------
  // Every dialog renders its backdrop through <Overlay> and spreads
  // dialogProps() onto its panel. The wrapper moves focus into the dialog,
  // keeps Tab inside it, closes on Escape / backdrop click and gives focus back
  // to the opener. Stacked dialogs: only the topmost one reacts to keys.
  // Focus on open goes to the first field of a form; a dialog without a field
  // gets focus on its panel, so Enter cannot hit a button nobody chose.
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
  var FIELDS = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])';

  // Pure (Node-tested). Which element gets focus on Tab, as an index into the
  // dialog's focusable elements: a number = focus that one; -1 = nothing is
  // focusable, keep focus on the panel; null = not at an edge, let the browser
  // move focus. `index` is the position of the focused element (-1 = outside).
  function trapTarget(count, index, shift) {
    if (!(count > 0)) return -1;
    if (index < 0 || index >= count) return shift ? count - 1 : 0;
    if (shift && index === 0) return count - 1;
    if (!shift && index === count - 1) return 0;
    return null;
  }

  // Pure (Node-tested). Open dialogs, oldest first.
  var _stack = [];
  function pushOverlay(token) { _stack.push(token); return _stack.length; }
  function popOverlay(token) { var i = _stack.indexOf(token); if (i >= 0) _stack.splice(i, 1); return _stack.length; }
  function isTopOverlay(token) { return _stack.length > 0 && _stack[_stack.length - 1] === token; }
  function topOverlay() { return _stack.length ? _stack[_stack.length - 1] : null; }
  function overlayDepth() { return _stack.length; }

  // Attributes for the dialog panel. labelId = id of the visible title; a
  // dialog without a visible title passes its name as `label` instead.
  function dialogProps(labelId, label) {
    var p = { role: 'dialog', 'aria-modal': 'true' };
    if (labelId) p['aria-labelledby'] = labelId;
    else if (label) p['aria-label'] = label;
    return p;
  }

  function visible(el) { return !!(el && el.getClientRects && el.getClientRects().length); }
  function focusables(node) {
    return Array.prototype.filter.call(node.querySelectorAll(FOCUSABLE), visible);
  }
  function focusEl(el) { try { if (el && el.focus) { el.focus(); return true; } } catch (e) {} return false; }
  function panelOf(node) { return node.querySelector('[role="dialog"]') || node; }
  function focusPanel(node) { var p = panelOf(node); p.setAttribute('tabindex', '-1'); return focusEl(p); }

  // props: onClose, dismissable (default true; false = no Escape, no backdrop
  // close), focusField (default true; false = focus the panel even if the
  // dialog has a field), restoreFocus (() => element, used when the opener is
  // gone), style / className for the backdrop, children (the panel).
  function Overlay(props) {
    var React = window.React;
    var ref = React.useRef(null);
    var live = React.useRef(props);
    live.current = props;
    // The opener is read during the first render, before a child can take focus.
    var opener = React.useRef(undefined);
    if (opener.current === undefined) opener.current = document.activeElement || null;

    React.useEffect(function () {
      var node = ref.current, token = { node: node };
      pushOverlay(token);

      // Focus in: the first field, else the panel. A child that already took
      // focus (autoFocus) keeps it.
      if (!node.contains(document.activeElement)) {
        var field = live.current.focusField === false ? null : Array.prototype.filter.call(node.querySelectorAll(FIELDS), visible)[0];
        if (!field || !focusEl(field)) focusPanel(node);
      }

      var onKey = function (e) {
        if (!isTopOverlay(token)) return;
        if (e.key === 'Escape') {
          e.stopPropagation(); // one Escape closes one dialog
          if (live.current.dismissable !== false && live.current.onClose) live.current.onClose();
          return;
        }
        if (e.key !== 'Tab') return;
        var list = focusables(node);
        var target = trapTarget(list.length, list.indexOf(document.activeElement), e.shiftKey);
        if (target === null) return;
        e.preventDefault();
        if (target < 0) focusPanel(node); else focusEl(list[target]);
      };
      document.addEventListener('keydown', onKey, true);

      return function () {
        document.removeEventListener('keydown', onKey, true);
        popOverlay(token);
        // Focus back: the opener; else the dialog underneath; else what the
        // caller names; else <main>.
        var o = opener.current;
        if (o && o !== document.body && o.isConnected && visible(o) && focusEl(o)) return;
        var below = topOverlay();
        if (below && below.node && below.node.isConnected && focusPanel(below.node)) return;
        var alt = live.current.restoreFocus ? live.current.restoreFocus() : null;
        if (alt && alt.isConnected && visible(alt) && focusEl(alt)) return;
        focusEl(document.getElementById('main'));
      };
    }, []);

    return React.createElement('div', {
      ref: ref,
      className: props.className,
      style: props.style,
      onClick: function (e) {
        if (e.target === e.currentTarget && live.current.dismissable !== false && live.current.onClose) live.current.onClose();
      }
    }, props.children);
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
    isOverlayOpen: isOverlayOpen, closeAllOverlays: closeAllOverlays, anyOverlayOpen: anyOverlayOpen,
    // modal dialogs
    Overlay: Overlay, dialogProps: dialogProps, trapTarget: trapTarget,
    pushOverlay: pushOverlay, popOverlay: popOverlay, isTopOverlay: isTopOverlay, topOverlay: topOverlay, overlayDepth: overlayDepth
  };
  if (typeof window !== 'undefined') window.MaerminUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
