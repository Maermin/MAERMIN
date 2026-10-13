// P5-3.4: the Worker's FinTS relay - only allowed bank hosts, only base64
// messages, no redirects, nothing stored; the bank list route; and the shared
// price Worker refuses both. The bank is the synthetic one (fints-bank-sim.js).
// Run: node test/worker-fints.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const B = await import('../cf-worker/fints-banks.js');
  const F = require('../fints.js');
  const { createBank } = require('./fints-bank-sim.js');
  const worker = W.default;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const bank = createBank();
  const upstream = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push({ url: u, init });
    if (u === 'https://fints.dkb.de/redirect') return new Response('', { status: 302, headers: { Location: 'https://evil.example/' } });
    if (/^https:\/\/(fints\.dkb\.de|banking-sn1\.s-fints-pt-sn\.de|fints\.mybank\.example)\//.test(u)) {
      return new Response(F.toB64(bank.handle(F.fromB64(init.body))).replace(/(.{76})/g, '$1\r\n'), { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('', { status: 500 });
  };
  let ip = 0;
  const call = async (env, q, init) => {
    const r = await worker.fetch(new Request('https://w.example.workers.dev/?' + q, Object.assign({ headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.1.0.' + (++ip) } }, init || {})), env, { waitUntil() {} });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const post = (env, body) => call(env, 'action=fints', { method: 'POST', body: JSON.stringify(body) });
  const msg = F.buildMessage({ blz: '12030000', user: 'demo-user', pin: '4711', msgNo: 1, segments: [F.SEG.HKIDN({ blz: '12030000', user: 'demo-user' }), F.SEG.HKVVB({ productId: 'P' }), F.SEG.HKSYN()] });

  console.log('allowlist:');
  const allowed = (u, env) => B.fintsUrlAllowed(u, env).ok;
  ok('a listed host (DKB)', allowed('https://fints.dkb.de/fints'));
  ok('a Sparkasse host by pattern', allowed('https://banking-sn1.s-fints-pt-sn.de/fints30'));
  ok('refused: another host, http, a port, user info, a look-alike', !allowed('https://evil.example/fints') && !allowed('http://fints.dkb.de/fints') && !allowed('https://fints.dkb.de:8443/fints') && !allowed('https://u:p@fints.dkb.de/fints') && !allowed('https://fints.dkb.de.evil.example/x') && !allowed('https://banking-x.s-fints-pt-x.de.evil.example/'));
  ok('FINTS_EXTRA_HOSTS adds exact hosts', allowed('https://fints.mybank.example/x', { FINTS_EXTRA_HOSTS: 'fints.mybank.example, bad host' }) && !allowed('https://other.mybank.example/x', { FINTS_EXTRA_HOSTS: 'fints.mybank.example' }));
  ok('every listed bank has a name and an https url or a pattern', B.FINTS_BANKS.every((b) => b.name && (b.hostPattern || (/^https:\/\//.test(b.url) && B.fintsUrlAllowed(b.url).ok))));

  console.log('\nroutes:');
  const banks = await call({ FINTS_PRODUCT_ID: 'ABC123' }, 'action=fintsbanks');
  ok('fintsbanks: the list and the product id', banks.status === 200 && banks.body.banks.length === B.FINTS_BANKS.length && banks.body.productId === 'ABC123' && banks.body.productVersion === '1', banks.body && banks.body.productId);
  ok('fintsbanks without a product id says so', (await call({}, 'action=fintsbanks')).body.productId === '');
  const r = await post({}, { url: 'https://fints.dkb.de/fints', msg: F.toB64(msg) });
  const answer = F.unwrap(F.parse(F.fromB64(r.body.msg)));
  ok('relays the message and returns the bank\'s answer (line breaks removed)', r.status === 200 && r.body.status === 200 && answer.some((s) => s.type === 'HISYN'), r.body);
  const last = upstream[upstream.length - 1];
  ok('the bank gets the base64 text as text/plain, no redirects followed', last.init.body === F.toB64(msg) && last.init.headers['Content-Type'] === 'text/plain' && last.init.redirect === 'manual');
  const before = upstream.length;
  const bad = await post({}, { url: 'https://evil.example/fints', msg: F.toB64(msg) });
  ok('another host: 403, no upstream call', bad.status === 403 && bad.body.error === 'Bank not allowed' && upstream.length === before, bad);
  const notB64 = await post({}, { url: 'https://fints.dkb.de/fints', msg: "HNHBK:1:3+0'" });
  ok('a message that is not base64: 400', notB64.status === 400 && notB64.body.error === 'Invalid message', notB64);
  const big = await post({}, { url: 'https://fints.dkb.de/fints', msg: 'A'.repeat(300000) });
  ok('a body over 256 KB is refused', big.status === 413 || big.status === 400, big.status);
  const red = await post({}, { url: 'https://fints.dkb.de/redirect', msg: F.toB64(msg) });
  ok('a redirect from the bank is refused, not followed', red.status === 200 && red.body.error === 'redirect refused' && red.body.msg === '', red.body);
  const getFints = await call({}, 'action=fints');
  ok('GET fints is unknown', getFints.status === 400);
  ok('version lists fints and fintsbanks (2026.10.7)', W.WORKER_VERSION === '2026.10.7' && W.WORKER_ACTIONS.indexOf('fints') > -1 && W.WORKER_ACTIONS.indexOf('fintsbanks') > -1);

  console.log('\nshared price Worker:');
  const po = await post({ PRICE_ONLY: '1' }, { url: 'https://fints.dkb.de/fints', msg: F.toB64(msg) });
  const pob = await call({ PRICE_ONLY: '1' }, 'action=fintsbanks');
  ok('PRICE_ONLY refuses fints and fintsbanks (403)', po.status === 403 && pob.status === 403);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
