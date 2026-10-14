// MAERMIN Worker — Web Push relay (P5-5.1)
//
// The browser encrypts every message to its own push subscription (RFC 8291,
// push-crypto.js) and hands this Worker only ciphertext, the push endpoint and
// a send time. The Worker stores that in KV (binding SYNC) and delivers it on
// the cron trigger with a VAPID signature (RFC 8292). It never sees a message
// in plaintext.
//
// Opt-in price rules: the app may also leave { symbol, op, threshold } with an
// already encrypted message; the cron checks the price and sends the message
// once. The Worker then sees that symbol and threshold - never a quantity or a
// value. Off unless the user switches it on.
//
// POST /?action=push  body:
//   { op: 'key' }                                   → { publicKey } (VAPID, created on first use)
//   { op: 'set', box, token, key, endpoint, messages: [{ at, body, ttl?, urgency? }],
//     prices: [{ kind: 'yahoo'|'coingecko', symbol, op, threshold, body }] }
//                                                   → { ok, messages, prices } (replaces the box)
//   { op: 'test', box, token, body }                → { ok, status } (sends now)
//   { op: 'delete', box, token }                    → { ok }
// Records: KV 'push:box:<box>' = { tokenHash, endpoint, messages, prices }, with
// list metadata { n: next send time (ms) or 0, p: number of price rules }.

const VAPID_KEY = 'push:vapid';
const BOX_PREFIX = 'push:box:';
export const PUSH_LIMITS = { messages: 100, prices: 20, bodyBytes: 4096, horizonDays: 400, sendsPerRun: 300 };
const DEFAULT_SUBJECT = 'https://github.com/Maermin/MAERMIN';

// The browser vendors' push services. Anything else is refused, so the relay
// can't be pointed at an arbitrary host.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
export function pushEndpointAllowed(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

function b64u(bytes) {
  let s = '';
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256(text) {
  return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))));
}

// The Worker's VAPID key pair, created once and kept in KV.
export async function getVapid(env) {
  let v = await env.SYNC.get(VAPID_KEY, { type: 'json' });
  if (v && v.publicKey && v.privateJwk) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey) };
  await env.SYNC.put(VAPID_KEY, JSON.stringify(v));
  // Two isolates may race on the first call: answer with what KV kept.
  const kept = await env.SYNC.get(VAPID_KEY, { type: 'json' });
  return kept && kept.publicKey ? kept : v;
}

// RFC 8292: Authorization: vapid t=<ES256 JWT>, k=<public key>.
export async function vapidHeader(endpoint, vapid, subject, nowSec) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(nowSec) + 12 * 3600, sub: subject || DEFAULT_SUBJECT });
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}

async function deliver(env, endpoint, body, opts, now) {
  const vapid = await getVapid(env);
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(endpoint, vapid, env.VAPID_SUBJECT, now / 1000),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: String(opts && opts.ttl > 0 ? Math.min(opts.ttl, 2419200) : 86400),
      Urgency: (opts && opts.urgency) || 'normal'
    },
    body: unb64u(body)
  });
  return r.status;
}

function metadata(box) {
  const n = box.messages.reduce((m, x) => (m === 0 || x.at < m ? x.at : m), 0);
  return { n, p: box.prices.length };
}
async function saveBox(env, id, box) {
  await env.SYNC.put(BOX_PREFIX + id, JSON.stringify(box), { metadata: metadata(box) });
}

const OPS = new Set(['gt', 'lt', 'gte', 'lte']);
function validBody(b) {
  if (typeof b !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b)) return false;
  const bytes = Math.floor(b.length * 3 / 4);
  return bytes >= 103 && bytes <= PUSH_LIMITS.bodyBytes;
}

// Returns { status, body } for POST /?action=push.
export async function handlePush(env, body, now, canCreate) {
  now = now || Date.now();
  const op = body && body.op;
  if (op === 'key') return { status: 200, body: { publicKey: (await getVapid(env)).publicKey } };
  const id = typeof body.box === 'string' ? body.box : '';
  const token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || token.length < 24 || token.length > 128) return { status: 400, body: { error: 'invalid box' } };
  const existing = await env.SYNC.get(BOX_PREFIX + id, { type: 'json' });
  const tokenHash = await sha256(token);
  if (existing && existing.tokenHash !== tokenHash) return { status: 403, body: { error: 'forbidden' } };

  if (op === 'delete') {
    if (existing) await env.SYNC.delete(BOX_PREFIX + id);
    return { status: 200, body: { ok: true } };
  }
  if (op === 'test') {
    if (!existing) return { status: 404, body: { error: 'unknown box' } };
    if (!validBody(body.body)) return { status: 400, body: { error: 'invalid message' } };
    const status = await deliver(env, existing.endpoint, body.body, { ttl: 600, urgency: 'high' }, now);
    if (status === 404 || status === 410) await env.SYNC.delete(BOX_PREFIX + id);
    return { status: 200, body: { ok: status >= 200 && status < 300, status } };
  }
  if (op !== 'set') return { status: 400, body: { error: 'unknown op' } };

  if (!pushEndpointAllowed(body.endpoint)) return { status: 400, body: { error: 'push endpoint not allowed' } };
  // The subscription must have been made with this Worker's current key.
  const vapid = await getVapid(env);
  if (body.key !== vapid.publicKey) return { status: 409, body: { error: 'resubscribe', publicKey: vapid.publicKey } };
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const prices = Array.isArray(body.prices) ? body.prices : [];
  if (msgs.length > PUSH_LIMITS.messages || prices.length > PUSH_LIMITS.prices) return { status: 413, body: { error: 'too many messages' } };
  const horizon = now + PUSH_LIMITS.horizonDays * 86400000;
  const messages = [];
  for (const m of msgs) {
    const at = Date.parse(m && m.at);
    if (!isFinite(at) || at > horizon || !validBody(m.body)) return { status: 400, body: { error: 'invalid message' } };
    if (at < now - 3600000) continue; // already past: drop
    messages.push({ at, body: m.body, ttl: Math.min(Math.max(parseInt(m.ttl, 10) || 86400, 60), 2419200), urgency: m.urgency === 'high' || m.urgency === 'low' ? m.urgency : 'normal' });
  }
  const rules = [];
  for (const p of prices) {
    const kind = p && p.kind === 'coingecko' ? 'coingecko' : 'yahoo';
    const symbol = String((p && p.symbol) || '');
    const threshold = Number(p && p.threshold);
    const okSym = kind === 'coingecko' ? /^[a-z0-9-]{1,64}$/.test(symbol) : /^[A-Za-z0-9.^=_-]{1,24}$/.test(symbol);
    if (!okSym || !OPS.has(p.op) || !isFinite(threshold) || !validBody(p.body)) return { status: 400, body: { error: 'invalid price rule' } };
    rules.push({ kind, symbol, op: p.op, threshold, body: p.body });
  }
  if (!existing && canCreate && !(await canCreate())) return { status: 429, body: { error: 'too many new boxes today' } };
  await saveBox(env, id, { tokenHash, endpoint: body.endpoint, messages, prices: rules, updated: now });
  return { status: 200, body: { ok: true, messages: messages.length, prices: rules.length } };
}

function crossed(price, op, threshold) {
  return op === 'gt' ? price > threshold : op === 'lt' ? price < threshold : op === 'gte' ? price >= threshold : price <= threshold;
}

// Cron: deliver due messages and check opt-in price rules.
// deps.price(kind, symbol) → Promise<number|null> (injectable for tests).
export async function runPushCron(env, now, deps) {
  now = now || Date.now();
  const out = { sent: 0, failed: 0, removed: 0, checked: 0 };
  if (!env || !env.SYNC || !env.SYNC.list) return out;
  const priceCache = new Map();
  const priceOf = async (kind, symbol) => {
    const k = kind + ':' + symbol;
    if (!priceCache.has(k)) priceCache.set(k, await deps.price(kind, symbol).catch(() => null));
    return priceCache.get(k);
  };
  let cursor;
  do {
    const page = await env.SYNC.list({ prefix: BOX_PREFIX, cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const k of page.keys) {
      const meta = k.metadata || {};
      if (!((meta.n && meta.n <= now) || meta.p > 0)) continue;
      if (out.sent + out.failed >= PUSH_LIMITS.sendsPerRun) return out;
      const id = k.name.slice(BOX_PREFIX.length);
      const box = await env.SYNC.get(k.name, { type: 'json' });
      if (!box) continue;
      let changed = false, gone = false;
      const keep = [];
      for (const m of box.messages) {
        if (m.at > now || gone) { keep.push(m); continue; }
        changed = true;
        if (m.at < now - m.ttl * 1000) continue; // missed its window
        const st = await deliver(env, box.endpoint, m.body, m, now).catch(() => 0);
        if (st >= 200 && st < 300) out.sent++; else out.failed++;
        if (st === 404 || st === 410) gone = true;
      }
      box.messages = keep;
      const rules = [];
      for (const r of box.prices) {
        if (gone) break;
        out.checked++;
        const p = await priceOf(r.kind, r.symbol);
        if (p == null || !crossed(p, r.op, r.threshold)) { rules.push(r); continue; }
        changed = true;
        const st = await deliver(env, box.endpoint, r.body, { ttl: 86400, urgency: 'high' }, now).catch(() => 0);
        if (st >= 200 && st < 300) out.sent++; else { out.failed++; if (st !== 404 && st !== 410) rules.push(r); }
        if (st === 404 || st === 410) gone = true;
      }
      box.prices = gone ? [] : rules;
      if (gone) { await env.SYNC.delete(k.name); out.removed++; }
      else if (changed) await saveBox(env, id, box);
    }
  } while (cursor);
  return out;
}
