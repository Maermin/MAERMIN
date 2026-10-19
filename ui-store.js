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
  function __(k, f, v) { var I = (typeof window !== 'undefined' && window.MaerminI18n) || null; return I && I.t ? I.t(k, f, v) : f; }

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

  // action (optional): { label, run } — a button in the toast (e.g. "Undo").
  function add(message, type, ttl, action) {
    var id = 't' + Date.now() + '_' + (++_seq);
    var ms = (typeof ttl === 'number') ? ttl : DEFAULT_TTL;
    var toast = { id: id, message: String(message == null ? '' : message), type: type || 'info', ttl: ms };
    if (action && typeof action.run === 'function') toast.action = { label: String(action.label || ''), run: action.run };
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

  // ---- in-app confirmation (replaces window.confirm) ------------------------
  // confirm({ title, message, confirmLabel, cancelLabel, danger }) → Promise
  // <boolean>. One <ConfirmHost> rendered by the app shows it through Overlay
  // (focus trap, Escape = cancel, focus back to the opener). A new confirm
  // while one is open cancels the old one.
  var confirmState = Store ? Store.createStore({ open: false }) : null;
  var _confirmResolve = null;
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (_confirmResolve) { var prev = _confirmResolve; _confirmResolve = null; prev(false); }
      _confirmResolve = resolve;
      if (confirmState) confirmState.setState({
        open: true,
        title: String(opts.title || 'Are you sure?'),
        message: opts.message == null ? '' : String(opts.message),
        confirmLabel: String(opts.confirmLabel || 'Confirm'),
        cancelLabel: String(opts.cancelLabel || 'Cancel'),
        danger: !!opts.danger
      });
    });
  }
  function answerConfirm(value) {
    var r = _confirmResolve;
    _confirmResolve = null;
    if (confirmState) confirmState.setState({ open: false });
    if (r) r(!!value);
  }
  function ConfirmHost(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !Store || !confirmState) return null;
    var s = Store.useStore(confirmState, function (x) { return x; });
    if (!s.open) return null;
    var e = React.createElement;
    // R5.1: the shared dialog look, above any dialog that asks
    return e(Overlay, {
      onClose: function () { answerConfirm(false); },
      className: ['ui-modal-backdrop', 'is-confirm'].join(' ')
    },
      e('div', Object.assign({}, dialogProps('dlg-confirm'), {
        'aria-describedby': s.message ? 'dlg-confirm-msg' : undefined,
        className: ['ui-modal', 'ui-modal--sm'].join(' ')
      }),
        e('header', { className: 'ui-modal__head' },
          e('h2', { id: 'dlg-confirm', className: 'ui-modal__title' }, s.title)),
        s.message ? e('div', { className: 'ui-modal__body' }, e('p', { id: 'dlg-confirm-msg', className: ['ui-muted', 'ui-confirm__msg'].join(' ') }, s.message)) : null,
        e('footer', { className: 'ui-modal__foot' },
          e('button', { type: 'button', onClick: function () { answerConfirm(false); }, className: 'ui-btn ui-btn--secondary ui-btn--md' },
            e('span', { className: 'ui-btn__label' }, s.cancelLabel)),
          e('button', { type: 'button', onClick: function () { answerConfirm(true); }, className: 'ui-btn ui-btn--md ' + (s.danger ? 'ui-btn--danger' : 'ui-btn--primary') },
            e('span', { className: 'ui-btn__label' }, s.confirmLabel)))));
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
          toast.action ? React.createElement('button', { type: 'button', className: 'toast-action', 'data-testid': 'toast-action',
            onClick: function (ev) { ev.stopPropagation(); dismiss(toast.id); toast.action.run(); } }, toast.action.label) : null,
          toast.ttl > 0 ? React.createElement('span', { className: 'toast-timer', 'aria-hidden': 'true' }) : null
        );
      }));
  }

  // ---- design tokens and shared component props ---------------------------
  // Mirror of the styles.css :root tokens for inline styles. Literal px/rem,
  // not var(): fx.js measures inline paddings and radii to find cards.
  var tokens = {
    space: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 7: '32px', 8: '48px' },
    text: { '3xs': '0.625rem', '2xs': '0.6875rem', xs: '0.75rem', sm: '0.8125rem', base: '0.875rem', md: '0.9375rem', body: '1rem', lg: '1.125rem', title: '1.25rem', titleLg: '1.375rem', xl: '1.5rem', '2xl': '2rem', kpi: 'var(--text-kpi)' },
    radius: { xs: '6px', sm: '8px', md: '12px', lg: '12px', xl: '22px' },
    control: { h: '36px', touch: '44px' }
  };
  function cls(base, extra) { return extra ? base + ' ' + extra : base; }
  // A button: variant 'primary' (filled accent, one per view), 'secondary'
  // (outline), 'danger' (red outline; confirm dialogs fill it), 'ghost'.
  function btnProps(variant, extra) {
    extra = extra || {};
    var v = /^(primary|secondary|danger|ghost)$/.test(variant) ? variant : 'secondary';
    var out = {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    out.type = extra.type || 'button';
    out.className = cls('mx-btn mx-btn-' + v, extra.className);
    return out;
  }
  // One option of a pill row (wrap the row in .mx-pills).
  function pillProps(active, extra) {
    extra = extra || {};
    var out = {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    out.type = 'button';
    out['aria-pressed'] = !!active;
    out.className = cls('mx-pill', extra.className);
    return out;
  }

  // One look for "nothing here yet / not available / needs your Worker":
  // a title, one sentence, and optionally one next action. compact: inside a
  // card (no second frame). kind 'loading' is announced as a status with a
  // spinner next to its words (R5.2); kind 'error' is an alert with a "!".
  function EmptyState(props) {
    var e = React.createElement;
    var kind = props.kind || 'empty';
    return e('div', { className: 'mx-empty' + (props.compact ? ' is-compact' : ''), 'data-testid': props.testid, 'data-kind': kind, role: props.role || (kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined) },
      props.title ? e('div', { className: 'mx-empty-title' }, props.title) : null,
      props.text ? e('div', { className: 'mx-empty-text' },
        kind === 'loading' ? e('span', { className: 'ui-spinner', 'aria-hidden': 'true' }) : null,
        kind === 'error' ? e('span', { className: 'mx-empty-mark', 'aria-hidden': 'true' }, '!') : null,
        props.text) : null,
      props.action ? e('button', btnProps('secondary', { onClick: props.action.onClick }), props.action.label) : null,
      // several next steps: [{ label, onClick, variant, props }] (props: test hooks etc.)
      props.actions && props.actions.length ? e('div', { className: 'mx-empty-actions' }, props.actions.filter(Boolean).map(function (a, i) {
        var extra = {}; for (var k in (a.props || {})) if (Object.prototype.hasOwnProperty.call(a.props, k)) extra[k] = a.props[k];
        extra.key = i; extra.onClick = a.onClick;
        return e('button', btnProps(a.variant || 'secondary', extra), a.label);
      })) : null);
  }

  // Any view can open API Settings: it is an overlay of this store (the
  // renderer reads it as showApiSettings).
  function openApiSettings() { openOverlay('apiSettings'); }
  // The next action of a "needs your Worker" state.
  function workerAction() {
    return { label: __('openApiSettings', 'Open API Settings'), onClick: openApiSettings };
  }

  var api = {
    tokens: tokens, btnProps: btnProps, pillProps: pillProps, EmptyState: EmptyState,
    openApiSettings: openApiSettings, workerAction: workerAction,
    toasts: toasts,
    add: add, dismiss: dismiss, clear: clear, items: items,
    reduceAdd: reduceAdd, reduceDismiss: reduceDismiss,
    ToastContainer: ToastContainer,
    DEFAULT_TTL: DEFAULT_TTL, MAX: MAX,
    // overlays
    overlays: overlays,
    openOverlay: openOverlay, closeOverlay: closeOverlay, toggleOverlay: toggleOverlay,
    isOverlayOpen: isOverlayOpen, anyOverlayOpen: anyOverlayOpen,
    // modal dialogs
    Overlay: Overlay, dialogProps: dialogProps, trapTarget: trapTarget,
    confirm: confirm, answerConfirm: answerConfirm, confirmState: confirmState, ConfirmHost: ConfirmHost,
    pushOverlay: pushOverlay, popOverlay: popOverlay, isTopOverlay: isTopOverlay, topOverlay: topOverlay, overlayDepth: overlayDepth
  };
  if (typeof window !== 'undefined') window.MaerminUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
