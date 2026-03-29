/**
 * MAERMIN — Cloudflare Worker: Skinport CORS Proxy
 * Fetches Skinport server-side (bypasses browser CORS) and returns with CORS headers.
 * No API key needed. Free. Cached 10 min at Cloudflare edge.
 */

const ALLOWED_ORIGINS = [
  'https://maermin.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];

const SKINPORT_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=EUR&tradable=0';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return corsResponse(null, 204, origin);
    if (request.method !== 'GET')    return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405, origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin))
      return corsResponse(JSON.stringify({ error: 'Forbidden origin' }), 403, origin);

    try {
      const cacheKey = new Request(SKINPORT_URL);
      const cache    = caches.default;
      let cached     = await cache.match(cacheKey);

      if (cached) {
        const body = await cached.text();
        return corsResponse(body, 200, origin);
      }

      // Skinport blocks datacenter IPs unless the request looks like a real browser.
      // Send a full set of browser-like headers.
      const upstream = await fetch(SKINPORT_URL, {
        headers: {
          'Accept':          'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer':         'https://skinport.com/',
          'Origin':          'https://skinport.com',
          'sec-ch-ua':       '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile':'?0',
          'sec-ch-ua-platform':'"Windows"',
          'sec-fetch-dest':  'empty',
          'sec-fetch-mode':  'cors',
          'sec-fetch-site':  'same-site',
          'Connection':      'keep-alive',
        },
      });

      if (!upstream.ok) {
        return corsResponse(
          JSON.stringify({ error: `Skinport returned ${upstream.status}` }),
          upstream.status, origin
        );
      }

      const body = await upstream.text();

      // Cache 10 minutes
      const toCache = new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
      });
      ctx.waitUntil(cache.put(cacheKey, toCache));

      return corsResponse(body, 200, origin);

    } catch (err) {
      return corsResponse(JSON.stringify({ error: 'Fetch failed', detail: err.message }), 502, origin);
    }
  },
};

function corsResponse(body, status, origin, contentType = 'application/json') {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin':  allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary':         'Origin',
      'Content-Type': contentType,
    },
  });
}
