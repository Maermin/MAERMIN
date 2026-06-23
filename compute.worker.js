// ============================================================================
// MAERMIN — Compute Worker (DEV entry)
// ----------------------------------------------------------------------------
// Loaded by MaerminCompute via `new Worker('compute.worker.js')` during local
// dev / unbundled hosting. It pulls in the PURE engines + the routing client +
// the RPC harness with importScripts. The `self.window = self` shim lets the
// engine files self-register on the worker global exactly as they do in the
// browser (they each do `if (typeof window !== 'undefined') window.X = ...`).
//
// The PRODUCTION worker is a single self-contained file emitted by build.mjs
// (engines + compute-client.js + harness concatenated + minified) — see build.mjs.
// Keep this file's dependency list in sync with the build's workerDeps.
// ============================================================================
self.window = self;
importScripts(
  'monte-carlo-engine.js',
  'correlation-engine.js',
  'compute-client.js',
  'compute.worker.harness.js'
);
