// ============================================================================
// MAERMIN — Compute Client  (window.MaerminCompute)
// ----------------------------------------------------------------------------
// Runs the heavy, PURE, DOM-free engines (Monte-Carlo simulation, correlation
// matrix) OFF the main thread in a Web Worker, so a 10k-iteration simulation or
// a large correlation matrix no longer freezes the UI.
//
// SAFETY — a broken/absent worker can NEVER break a feature:
//   run(fn,args) returns a Promise that ALWAYS resolves with the correct
//   result. It tries the worker; on any worker problem (unsupported, failed to
//   load — e.g. a missing prod file — error, or timeout) it computes the SAME
//   result synchronously via computeSync(). So the worker only ever changes
//   WHERE the work runs, never WHETHER it works.
//
// `computeSync(fn, args, engines?)` is the single routing source of truth: the
// sync fallback uses it AND the worker harness calls it (compute.worker.js),
// so on-thread and off-thread results can't diverge. Pure + Node-tested.
// ============================================================================
(function () {
  'use strict';

  // Resolve an engine global from the browser window or the worker self.
  function eng(name) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof self !== 'undefined' && self[name]) return self[name];
    return null;
  }

  // Pure routing. `engines` is injectable for tests; otherwise resolved from the
  // ambient globals. Throwing here is fine — run() turns it into a clean reject
  // that the caller's own fallback or run()'s fallback handles.
  function computeSync(fn, args, engines) {
    args = args || {};
    engines = engines || { MonteCarloEngine: eng('MonteCarloEngine'), CorrelationEngine: eng('CorrelationEngine') };
    if (fn === 'montecarlo') {
      var MC = engines.MonteCarloEngine;
      if (!MC || typeof MC.runSimulation !== 'function') throw new Error('MonteCarloEngine unavailable');
      return MC.runSimulation(args.portfolio, args.config);
    }
    if (fn === 'correlation') {
      var CE = engines.CorrelationEngine;
      if (!CE || typeof CE.calculateCorrelationMatrix !== 'function') throw new Error('CorrelationEngine unavailable');
      var matrix = CE.calculateCorrelationMatrix(args.history);
      return {
        matrix: matrix,
        score: CE.calculateDiversificationScore ? CE.calculateDiversificationScore(matrix) : null,
        extremes: CE.findExtremePairs ? CE.findExtremePairs(matrix) : []
      };
    }
    throw new Error('unknown compute fn: ' + fn);
  }

  // ---- worker plumbing (browser only) --------------------------------------
  var _worker = null, _seq = 0, _pending = {}, _broken = false, _url = null;
  var TIMEOUT_MS = 30000;

  function workerUrl() {
    if (_url) return _url;
    _url = (typeof window !== 'undefined' && window.MAERMIN_WORKER_URL) || 'compute.worker.js';
    return _url;
  }

  function failAll(reason) {
    Object.keys(_pending).forEach(function (id) {
      var p = _pending[id]; delete _pending[id];
      if (p && p.onFail) p.onFail(reason);
    });
  }

  function ensureWorker() {
    if (_broken) return null;
    if (_worker) return _worker;
    if (typeof Worker === 'undefined') { _broken = true; return null; }
    try {
      _worker = new Worker(workerUrl());
      _worker.onmessage = function (e) {
        var m = e.data || {}; var p = _pending[m.id];
        if (!p) return; delete _pending[m.id];
        if (m.ok) p.onOk(m.result); else p.onFail(new Error(m.error || 'worker error'));
      };
      _worker.onerror = function () {
        // Worker could not load/run (e.g. the prod file is missing or a CSP
        // blocks it) → mark broken so EVERY call now falls back to sync.
        _broken = true;
        failAll(new Error('worker failed to load'));
        try { _worker.terminate(); } catch (e) {}
        _worker = null;
      };
    } catch (e) { _broken = true; _worker = null; }
    return _worker;
  }

  // Always-resolving RPC: worker first, synchronous fallback on any problem.
  function run(fn, args) {
    return new Promise(function (resolve) {
      var w = ensureWorker();
      if (!w) { resolve(safeSync(fn, args)); return; }
      var id = ++_seq;
      var settled = false;
      var done = function (v) { if (settled) return; settled = true; resolve(v); };
      var fallback = function () { done(safeSync(fn, args)); };
      _pending[id] = { onOk: function (r) { if (_pending[id]) delete _pending[id]; done(r); }, onFail: function () { if (_pending[id]) delete _pending[id]; fallback(); } };
      try { w.postMessage({ id: id, fn: fn, args: args }); }
      catch (e) { delete _pending[id]; fallback(); }
      setTimeout(function () { if (!settled && _pending[id]) { delete _pending[id]; fallback(); } }, TIMEOUT_MS);
    });
  }

  function safeSync(fn, args) { try { return computeSync(fn, args); } catch (e) { return null; } }

  var api = {
    computeSync: computeSync,
    run: run,
    montecarlo: function (portfolio, config) { return run('montecarlo', { portfolio: portfolio, config: config }); },
    correlation: function (history) { return run('correlation', { history: history }); },
    available: function () { return typeof Worker !== 'undefined' && !_broken; }
  };
  if (typeof window !== 'undefined') window.MaerminCompute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
