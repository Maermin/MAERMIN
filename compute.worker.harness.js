// ============================================================================
// MAERMIN — Compute Worker Harness
// ----------------------------------------------------------------------------
// The postMessage RPC glue that runs INSIDE the Web Worker. Shared verbatim by
// the dev worker (compute.worker.js → importScripts) and the prod build (build.mjs
// concatenates it after the engines + compute-client.js). It deliberately holds
// NO routing logic of its own — it calls MaerminCompute.computeSync, the single
// source of truth shared with the main-thread fallback, so on/off-thread results
// can never diverge. Requires the engines + compute-client.js already loaded on
// the worker global (via the `self.window = self` shim).
// ============================================================================
self.onmessage = function (e) {
  var msg = e.data || {};
  try {
    var result = self.MaerminCompute.computeSync(msg.fn, msg.args);
    self.postMessage({ id: msg.id, ok: true, result: result });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
