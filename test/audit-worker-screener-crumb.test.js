// Audit 2026-10-09, BUG-031: the Worker's batch-quote mode (?action=screener&symbols=…,
// Discovery → Dividends) calls Yahoo's v7 quote endpoint without the cookie + crumb
// handshake the quoteSummary routes already use, so Yahoo answers 401 and Discovery
// shows "Could not load: Yahoo Finance returned 401" (seen against the test Worker,
// version 2026.10.3 = this repo). The upstream below demands a crumb like Yahoo does.
// FAILS on main @ 83a9976. Run: node test/audit-worker-screener-crumb.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
(async function run() {
  const W = await import('../cf-worker/worker.js');
  const store = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const v = store.get(req.url); return v === undefined ? undefined : new Response(v); },
    put: async (req, resp) => { store.set(req.url, await resp.text()); } } };
  const seen = [];
  globalThis.fetch = async (input) => {
    const u = String(input && input.url ? input.url : input);
    seen.push(u);
    if (/fc\.yahoo\.com|finance\.yahoo\.com\/?$/.test(u)) return new Response('', { status: 200, headers: { 'set-cookie': 'A3=d=abc; Path=/' } });
    if (/getcrumb/.test(u)) return new Response('crumb123', { status: 200 });
    if (/v7\/finance\/quote/.test(u)) {
      if (!/crumb=/.test(u)) return new Response('{"finance":{"error":{"code":"Unauthorized"}}}', { status: 401 });
      return new Response(JSON.stringify({ quoteResponse: { result: [{ symbol: 'KO', shortName: 'Coca-Cola', regularMarketPrice: 60, currency: 'USD', trailingAnnualDividendYield: 0.03, quoteType: 'EQUITY' }] } }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  const r = await W.default.fetch(new Request('https://w.example.dev/?action=screener&symbols=KO&count=1', { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.9.0.1' } }), {}, { waitUntil: (p) => p });
  const body = await r.text();
  console.log('worker ?action=screener&symbols=:');
  ok('batch quote succeeds when Yahoo requires a crumb', r.status === 200, r.status + ' ' + body.slice(0, 120));
  ok('a quote row comes back', /"KO"/.test(body));
  process.exit(failed ? 1 : 0);
})();
