// Worker push relay (P5-5.1): VAPID key and signature, the endpoint allowlist,
// box tokens, the cron delivery of due messages, expired subscriptions and the
// opt-in price rules - against the real Worker code with a mock KV and a mock
// push service. The Worker only ever handles ciphertext.
// Run: node test/worker-push.test.js
'use strict';
const nodeCrypto = require('node:crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = nodeCrypto.webcrypto;

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}

function kvEnv() {
  const kv = new Map();
  return {
    kv,
    SYNC: {
      get: async (k, o) => { if (!kv.has(k)) return null; const v = kv.get(k).value; return o && o.type === 'json' ? JSON.parse(v) : v; },
      put: async (k, v, o) => { kv.set(k, { value: v, metadata: (o && o.metadata) || null }); },
      delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: kv.get(name).metadata })), list_complete: true })
    }
  };
}

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const P = await import('../cf-worker/push.js');
  const PC = require('../push-crypto.js');
  const worker = W.default;
  const call = async (env, body, ip) => {
    const r = await worker.fetch(new Request('https://w.example/?action=push', { method: 'POST', headers: { 'CF-Connecting-IP': ip || '203.0.113.20', Origin: 'http://localhost:8080' }, body: JSON.stringify(body) }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = { p256dh: PC.toB64u(ua.getPublicKey()), auth: PC.toB64u(nodeCrypto.randomBytes(16)) };
  const cipher = async (t) => PC.toB64u(await PC.encrypt(t, sub));
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

  // Mock push service.
  const sent = [];
  let pushStatus = 201;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response('', { status: pushStatus }); };

  console.log('worker push:');
  ok('the route is listed in WORKER_ACTIONS', W.WORKER_ACTIONS.includes('push'));
  ok('endpoint allowlist: the browser push services only', P.pushEndpointAllowed(endpoint) && P.pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x')
    && P.pushEndpointAllowed('https://wns2-db5p.notify.windows.com/w/?token=x') && P.pushEndpointAllowed('https://web.push.apple.com/abc')
    && !P.pushEndpointAllowed('https://evil.example/fcm.googleapis.com') && !P.pushEndpointAllowed('http://fcm.googleapis.com/x') && !P.pushEndpointAllowed('https://fcm.googleapis.com:8443/x'));

  const env = kvEnv();
  let r = await call(env, { op: 'key' });
  const pub = r.body.publicKey;
  ok('op key: a P-256 VAPID public key, created once and kept', r.status === 200 && PC.fromB64u(pub).length === 65 && (await call(env, { op: 'key' })).body.publicKey === pub);

  const box = 'b' + nodeCrypto.randomBytes(12).toString('hex'), token = nodeCrypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const dueBody = await cipher(JSON.stringify({ title: 'A dividend is due' }));
  const laterBody = await cipher(JSON.stringify({ title: 'Later' }));
  r = await call(env, { op: 'set', box, token, key: pub, endpoint, messages: [{ at: new Date(now - 60000).toISOString(), body: dueBody }, { at: new Date(now + 86400000).toISOString(), body: laterBody }] });
  ok('op set stores the messages', r.status === 200 && r.body.messages === 2, r);
  const rec = JSON.parse(env.kv.get('push:box:' + box).value);
  ok('only ciphertext, the endpoint, times and a token hash are stored', rec.endpoint === endpoint && rec.messages[0].body === dueBody && !JSON.stringify(rec).includes(token) && !JSON.stringify(rec).includes('dividend'));
  ok('list metadata: the next send time', env.kv.get('push:box:' + box).metadata.n === rec.messages[0].at);

  ok('another token cannot replace or delete the box', (await call(env, { op: 'set', box, token: 'x'.repeat(30), key: pub, endpoint, messages: [] })).status === 403
    && (await call(env, { op: 'delete', box, token: 'x'.repeat(30) })).status === 403);
  ok('a foreign endpoint is refused', (await call(env, { op: 'set', box, token, key: pub, endpoint: 'https://evil.example/x', messages: [] })).status === 400);
  ok('a subscription made with another VAPID key must resubscribe (409)', (await call(env, { op: 'set', box, token, key: pub.slice(0, -2) + (pub.slice(-2) === 'AA' ? 'AB' : 'AA'), endpoint, messages: [] })).status === 409);
  ok('a message that is not aes128gcm-sized base64url is refused', (await call(env, { op: 'set', box, token, key: pub, endpoint, messages: [{ at: new Date(now).toISOString(), body: 'plain text!' }] })).status === 400);
  ok('more than 100 messages are refused', (await call(env, { op: 'set', box, token, key: pub, endpoint, messages: Array(101).fill({ at: new Date(now + 1e6).toISOString(), body: laterBody }) })).status === 413);

  // ---- cron ----------------------------------------------------------------------
  sent.length = 0;
  let out = await P.runPushCron(env, now, { price: async () => null });
  ok('cron sends the due message only', out.sent === 1 && sent.length === 1 && sent[0].url === endpoint, out);
  const h = sent[0].init.headers;
  ok('push request: aes128gcm, TTL, urgency', h['Content-Encoding'] === 'aes128gcm' && Number(h.TTL) > 0 && h.Urgency === 'normal');
  ok('the body is the stored ciphertext, unchanged', PC.toB64u(sent[0].init.body) === dueBody);
  // VAPID: verify the ES256 JWT with the public key.
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  const [hd, pl, sig] = m[1].split('.');
  const key = await crypto.subtle.importKey('raw', PC.fromB64u(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, PC.fromB64u(sig), new TextEncoder().encode(hd + '.' + pl));
  const claims = JSON.parse(Buffer.from(pl, 'base64url').toString());
  ok('VAPID: a valid ES256 signature, aud = push service origin, exp within 24 h, a sub', valid && m[2] === pub && claims.aud === 'https://fcm.googleapis.com' && claims.exp * 1000 - now <= 86400000 && claims.exp * 1000 > now && /^https:|^mailto:/.test(claims.sub), claims);
  ok('the sent message is removed; the later one stays', JSON.parse(env.kv.get('push:box:' + box).value).messages.length === 1);
  sent.length = 0;
  out = await P.runPushCron(env, now + 60000, { price: async () => null });
  ok('nothing is sent twice', out.sent === 0 && sent.length === 0);

  // An expired subscription (410) removes the box.
  pushStatus = 410;
  out = await P.runPushCron(env, now + 2 * 86400000 - 3600000, { price: async () => null });
  ok('410 Gone from the push service deletes the box', out.removed === 1 && !env.kv.has('push:box:' + box), out);
  pushStatus = 201;

  // ---- opt-in price rules -----------------------------------------------------------
  const box2 = 'c' + nodeCrypto.randomBytes(12).toString('hex');
  const alertBody = await cipher(JSON.stringify({ title: 'Price rule reached' }));
  r = await call(env, { op: 'set', box: box2, token, key: pub, endpoint, messages: [], prices: [{ kind: 'yahoo', symbol: 'AAPL', op: 'lte', threshold: 150, body: alertBody }, { kind: 'coingecko', symbol: 'bitcoin', op: 'gt', threshold: 100000, body: alertBody }] });
  ok('price rules stored (symbol and threshold, the message encrypted)', r.status === 200 && r.body.prices === 2, r);
  ok('an invalid price rule is refused', (await call(env, { op: 'set', box: box2, token, key: pub, endpoint, prices: [{ kind: 'yahoo', symbol: 'AAPL;rm', op: 'lte', threshold: 1, body: alertBody }] })).status === 400);
  sent.length = 0;
  const asked = [];
  out = await P.runPushCron(env, now, { price: async (kind, s) => { asked.push(kind + ':' + s); return s === 'AAPL' ? 149 : 90000; } });
  ok('cron: AAPL at 149 crosses ≤ 150 and is sent once; BTC stays armed', out.sent === 1 && JSON.parse(env.kv.get('push:box:' + box2).value).prices.length === 1 && asked.join() === 'yahoo:AAPL,coingecko:bitcoin', { out, asked });

  // ---- test and delete ------------------------------------------------------------
  sent.length = 0;
  r = await call(env, { op: 'test', box: box2, token, body: alertBody });
  ok('op test sends one message now', r.status === 200 && r.body.ok === true && sent.length === 1);
  r = await call(env, { op: 'delete', box: box2, token });
  ok('op delete removes the box', r.status === 200 && !env.kv.has('push:box:' + box2));

  // ---- shared price Worker and missing storage --------------------------------------
  const po = await worker.fetch(new Request('https://w.example/?action=push', { method: 'POST', body: '{"op":"key"}' }), { PRICE_ONLY: '1' }, { waitUntil() {} });
  ok('the shared price Worker refuses push (403)', po.status === 403);
  ok('without KV: 501', (await call({}, { op: 'key' })).status === 501);
  let cronRan = false;
  await worker.scheduled({}, { PRICE_ONLY: '1', SYNC: env.SYNC }, { waitUntil() { cronRan = true; } });
  ok('the shared price Worker runs no push cron', cronRan === false);

  globalThis.fetch = realFetch;
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
