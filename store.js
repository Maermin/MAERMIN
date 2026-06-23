// ============================================================================
// MAERMIN — Minimal State Store  (window.MaerminStore)
// ----------------------------------------------------------------------------
// A tiny, dependency-free observable store (the Zustand pattern, ~Zustand-lite)
// that fits MAERMIN's "global IIFE on window, React via createElement, no
// bundler" model. It exists to move state out of the 4918-line renderer God
// component incrementally: a slice at a time gets its own store, components
// subscribe to just the slice they need, so a change to one slice no longer
// re-renders the whole app.
//
//   createStore(initial) -> { getState, setState, subscribe }
//       setState(partial | fn) shallow-merges and notifies ONLY on a real change.
//   useStore(store, selector?, isEqual?)  React binding via useSyncExternalStore
//       — re-renders the component only when the SELECTED slice changes.
//   shallowEqual(a, b)                    selector-equality helper.
//
// The store core is pure + Node-tested (test/store.test.js). useStore touches
// React only at call time, so the module loads fine headless.
// ============================================================================
(function () {
  'use strict';

  function shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
    }
    return true;
  }

  function createStore(initial) {
    var state = (initial && typeof initial === 'object') ? initial : {};
    var listeners = [];

    function getState() { return state; }

    function setState(partial, replace) {
      var next = (typeof partial === 'function') ? partial(state) : partial;
      if (next == null) return state;
      var merged;
      if (replace) {
        merged = next;
      } else {
        merged = {};
        var k;
        for (k in state) if (Object.prototype.hasOwnProperty.call(state, k)) merged[k] = state[k];
        for (k in next) if (Object.prototype.hasOwnProperty.call(next, k)) merged[k] = next[k];
      }
      if (shallowEqual(state, merged)) return state; // no-op: nothing changed
      var prev = state;
      state = merged;
      // copy listeners so a listener that (un)subscribes during dispatch is safe
      listeners.slice().forEach(function (l) { try { l(state, prev); } catch (e) {} });
      return state;
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function unsubscribe() {
        var i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    }

    return { getState: getState, setState: setState, subscribe: subscribe };
  }

  // React binding. Re-renders the calling component only when the selected slice
  // changes (per `isEqual`, default Object.is). Falls back to a one-shot read if
  // React 18's useSyncExternalStore is unavailable (should not happen in-app).
  function useStore(store, selector, isEqual) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    selector = selector || function (s) { return s; };
    if (!React || typeof React.useSyncExternalStore !== 'function') {
      return selector(store.getState());
    }
    isEqual = isEqual || Object.is;
    var ref = React.useRef({ has: false, val: undefined });
    var getSnapshot = function () {
      var nextVal = selector(store.getState());
      if (ref.current.has && isEqual(ref.current.val, nextVal)) return ref.current.val;
      ref.current.has = true; ref.current.val = nextVal;
      return nextVal;
    };
    return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  }

  var api = { createStore: createStore, useStore: useStore, shallowEqual: shallowEqual };
  if (typeof window !== 'undefined') window.MaerminStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
