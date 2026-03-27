/**
 * MAERMIN — Cloudflare Worker: Pricempire CORS Proxy
 *
 * This Worker acts as a secure intermediary between the MAERMIN web app
 * (hosted on GitHub Pages) and the Pricempire API.
 *
 * Why needed:
 *   Pricempire does not set Access-Control-Allow-Origin headers, so browsers
 *   block direct requests from maermin.github.io. This Worker forwards the
 *   request server-side and adds CORS headers to the response.
 *
 * Security:
 *   The Pricempire API key is stored as a Worker Secret (never in browser).
 *   Only requests from maermin.github.io (or localhost for dev) are allowed.
 *
 * Setup:
 *   1. Deploy this Worker (see README or wrangler.toml)
 *   2. Add secret: wrangler secret put PRICEMPIRE_KEY
 *      → paste your Pricempire API key when prompted
 *   3. Copy the Worker URL and paste into MAERMIN ⚙ API Settings
 *
 * Free tier: 100,000 requests/day — more than enough for daily refreshes.
 */

const ALLOWED_ORIGINS = [
  'https://maermin.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];

const PRICEMPIRE_BASE = 'https://api.pricempire.com/v4/paid/items/prices';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // ── CORS preflight ─────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, origin);
    }

    // ── Only GET ───────────────────────────────────────────────────────────
    if (request.method !== 'GET') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, origin);
    }

    // ── Origin check (skip in dev with no origin) ──────────────────────────
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return corsResponse(JSON.stringify({ error: 'Forbidden origin' }), 403, origin);
    }

    // ── Forward to Pricempire ──────────────────────────────────────────────
    const apiKey = env.PRICEMPIRE_KEY;
    if (!apiKey) {
      return corsResponse(JSON.stringify({ error: 'PRICEMPIRE_KEY secret not set in Worker' }), 500, origin);
    }

    // Pass through query params from the client (sources, currency, app_id)
    const clientUrl   = new URL(request.url);
    const pricempireUrl = new URL(PRICEMPIRE_BASE);

    // Forward allowed params
    const ALLOWED_PARAMS = ['app_id', 'sources', 'currency', 'avg', 'median', 'inflation_threshold'];
    for (const [k, v] of clientUrl.searchParams.entries()) {
      if (ALLOWED_PARAMS.includes(k)) pricempireUrl.searchParams.set(k, v);
    }

    // Set defaults if not provided
    if (!pricempireUrl.searchParams.has('app_id'))   pricempireUrl.searchParams.set('app_id', '730');
    if (!pricempireUrl.searchParams.has('sources'))  pricempireUrl.searchParams.set('sources', 'dmarket,skinport,cs.money');
    if (!pricempireUrl.searchParams.has('currency')) pricempireUrl.searchParams.set('currency', 'EUR');

    // API key goes server-side — never exposed to browser
    pricempireUrl.searchParams.set('api_key', apiKey);

    try {
      const upstream = await fetch(pricempireUrl.toString(), {
        headers: {
          'Accept':     'application/json',
          'User-Agent': 'MAERMIN-Worker/1.0',
        },
        cf: { cacheTtl: 300 }, // Cache 5 minutes at Cloudflare edge
      });

      const body = await upstream.text();
      return corsResponse(body, upstream.status, origin, upstream.headers.get('Content-Type') || 'application/json');

    } catch (err) {
      return corsResponse(JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }), 502, origin);
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function corsResponse(body, status, origin, contentType = 'application/json') {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': contentType,
  };
  return new Response(body, { status, headers });
}
