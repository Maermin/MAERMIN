// ============================================================================
// MAERMIN — Event Bus  (window.MaerminBus)
// ----------------------------------------------------------------------------
// A tiny synchronous publish/subscribe primitive so modules can react to app
// events (e.g. "prices refreshed") WITHOUT the renderer wiring a bespoke
// useEffect per consumer or modules reaching into each other's globals. This is
// the decoupling foundation called out in the architecture review (Phase 5):
// producers emit, consumers subscribe, neither knows the other.
//
// Deliberately minimal and SAFE: a throwing subscriber can never break the
// emitter or other subscribers (each handler is isolated in try/catch). Pure,
// dependency-free, Node-tested.
// ============================================================================
(function () {
  'use strict';

  var handlers = Object.create(null); // event → [fn]

  // Subscribe. Returns an unsubscribe function.
  function on(event, fn) {
    if (typeof event !== 'string' || typeof fn !== 'function') return function () {};
    (handlers[event] || (handlers[event] = [])).push(fn);
    return function off() {
      var list = handlers[event];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    };
  }

  // Subscribe for a single delivery, then auto-unsubscribe.
  function once(event, fn) {
    var off = on(event, function (payload) { off(); fn(payload); });
    return off;
  }

  // Emit. Every subscriber runs; a thrower is isolated so it can't stop the rest
  // or the producer. Returns the number of handlers invoked.
  function emit(event, payload) {
    var list = handlers[event];
    if (!list || !list.length) return 0;
    // copy so an unsubscribe/subscribe during dispatch is well-defined
    var snapshot = list.slice();
    var n = 0;
    for (var i = 0; i < snapshot.length; i++) {
      n++; // count every handler invoked, even if it throws (isolated below)
      try { snapshot[i](payload); }
      catch (e) {
        try { if (typeof window !== 'undefined' && window.MaerminAuditLog) window.MaerminAuditLog.record('bus.error', event + ': ' + (e && e.message)); }
        catch (e2) {}
      }
    }
    return n;
  }

  function off(event, fn) {
    if (!event) { handlers = Object.create(null); return; }
    if (!fn) { delete handlers[event]; return; }
    var list = handlers[event];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  }

  function listenerCount(event) { return (handlers[event] || []).length; }

  var api = { on: on, once: once, emit: emit, off: off, listenerCount: listenerCount };
  if (typeof window !== 'undefined') window.MaerminBus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
