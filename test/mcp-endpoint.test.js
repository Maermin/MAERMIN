// Node harness for the MCP read-only endpoint (WI-9) exported from
// cf-worker/worker.js (ESM, dynamic import). Verifies: the resource exposes ONLY
// the redacted allowlist (percentage weights + scores), distinctive amounts /
// symbols never leak, and an expired/unknown link is dead (404).
// Run: node test/mcp-endpoint.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  console.log('mcp-endpoint (worker WI-9):');

  // A valid redacted snapshot PLUS hostile extra fields that must never survive.
  const snapshot = {
    v: 1,
    assetClasses: { crypto: 30, stocks: 60, commodities: 10 },
    sectors: [{ name: 'Technology', pct: 40 }, { name: 'Healthcare', pct: 20 }],
    regions: [{ name: 'USA', pct: 70 }],
    currencies: [{ name: 'USD', pct: 65 }],
    metrics: { healthScore: 82, effectiveN: 12.5 },
    // hostile fields — distinctive values that must be stripped by the allowlist
    totalValue: 1234567,
    holdings: [{ symbol: 'NVDA', amount: 4242, value: 999999 }],
    secretNote: 'SUPERSECRET'
  };

  // ---- pure mcpResource: allowlist only -------------------------------------
  const resource = W.mcpResource(snapshot, { id: 'abcdef0123', at: 1700000000000 });
  ok('resource is read-only', resource && resource.readOnly === true);
  ok('exposes asset-class weights', resource.data.assetClasses.stocks === 60);
  ok('exposes sector weights', resource.data.sectors[0].name === 'Technology');
  ok('exposes scores', resource.data.metrics.healthScore === 82);

  const serialized = JSON.stringify(resource);
  ok('no totalValue leak', serialized.indexOf('1234567') === -1);
  ok('no symbol leak', serialized.indexOf('NVDA') === -1);
  ok('no quantity/amount leak', serialized.indexOf('4242') === -1 && serialized.indexOf('999999') === -1);
  ok('no free-text note leak', serialized.indexOf('SUPERSECRET') === -1);
  ok('no holdings key at all', serialized.indexOf('holdings') === -1);

  // ---- invalid snapshot serves nothing --------------------------------------
  ok('invalid snapshot -> null', W.mcpResource({ v: 2 }) === null);
  ok('null snapshot -> null', W.mcpResource(null) === null);
  ok('empty assetClasses -> null', W.mcpResource({ v: 1, assetClasses: {} }) === null);

  // ---- fetch handler: valid id, expired id, bad id --------------------------
  const ctx = { waitUntil() {} };
  function envWith(map) { return { SYNC: { get: async (k) => (k in map ? map[k] : null) } }; }
  const validId = 'abcdef0123';
  const env = envWith({ ['share:' + validId]: { snapshot, at: 1700000000000 } });

  const okRes = await W.default.fetch(new Request('https://w/?action=mcp&id=' + validId), env, ctx);
  ok('valid id -> 200', okRes.status === 200);
  const okBody = await okRes.json();
  ok('handler returns the redacted data', okBody.data && okBody.data.assetClasses.crypto === 30);
  const okText = JSON.stringify(okBody);
  ok('handler response leaks no symbols/amounts', okText.indexOf('NVDA') === -1 && okText.indexOf('1234567') === -1);

  // expired / unknown link is dead
  const goneRes = await W.default.fetch(new Request('https://w/?action=mcp&id=ffffffffff'), envWith({}), ctx);
  ok('expired/unknown id -> 404', goneRes.status === 404);

  // malformed id rejected before any lookup
  const badRes = await W.default.fetch(new Request('https://w/?action=mcp&id=NOPE'), env, ctx);
  ok('malformed id -> 400', badRes.status === 400);

  // storage not configured -> 501
  const noKvRes = await W.default.fetch(new Request('https://w/?action=mcp&id=' + validId), {}, ctx);
  ok('no KV bound -> 501', noKvRes.status === 501);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
