/**
 * MAERMIN — Cloudflare Worker: Steam Market Proxy
 *
 * Two endpoints:
 *   GET  /?action=search&q=ak47+redline   → search with images & prices
 *   POST /                                 → body: ["Skin Name", ...] → {name: price}
 *
 * Steam has no datacenter IP restrictions (only browser CORS).
 * No API key, no secrets. Free.
 */

const STEAM_IMG = 'https://community.akamai.steamstatic.com/economy/image';

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return res(null, 204, request);
    }

    // ── Search endpoint ──────────────────────────────────────────────────────
    if (request.method === 'GET' && action === 'search') {
      const q = url.searchParams.get('q') || '';
      if (!q) return res(JSON.stringify([]), 200, request);

      const searchUrl = `https://steamcommunity.com/market/search/render/?` +
        `query=${encodeURIComponent(q)}&appid=730&norender=1&count=24` +
        `&search_descriptions=0&sort_column=popular&sort_dir=desc&currency=3`;

      try {
        const r = await fetch(searchUrl, { headers: browserHeaders() });
        if (!r.ok) return res(JSON.stringify({ error: 'Steam search failed: ' + r.status }), r.status, request);

        const data = await r.json();
        const items = (data.results || []).map(item => ({
          name:  item.hash_name || item.name,
          image: item.asset_description?.icon_url
            ? `${STEAM_IMG}/${item.asset_description.icon_url}/330x192`
            : null,
          price:      item.sell_price     ? item.sell_price / 100     : null, // EUR
          priceText:  item.sell_price_text || null,
          count:      item.sell_listings  || 0,
          rarity:     item.asset_description?.tags?.find(t => t.category === 'Rarity')?.localized_tag_name || null,
          rarityColor: item.asset_description?.tags?.find(t => t.category === 'Rarity')?.color
            ? '#' + item.asset_description.tags.find(t => t.category === 'Rarity').color
            : null,
          wear: item.asset_description?.tags?.find(t => t.category === 'Exterior')?.localized_tag_name || null,
        }));

        return res(JSON.stringify(items), 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message }), 502, request);
      }
    }

    // ── Price lookup endpoint (POST: array of names) ─────────────────────────
    if (request.method === 'POST') {
      let names;
      try {
        names = await request.json();
        if (!Array.isArray(names)) throw new Error('expected array');
      } catch {
        return res(JSON.stringify({ error: 'Body must be JSON array of skin names' }), 400, request);
      }

      names = names.slice(0, 30);
      const results = {};

      for (const name of names) {
        if (!name || typeof name !== 'string') continue;
        try {
          const priceUrl = `https://steamcommunity.com/market/priceoverview/` +
            `?appid=730&currency=3&market_hash_name=${encodeURIComponent(name.trim())}`;
          const r = await fetch(priceUrl, { headers: browserHeaders() });
          if (r.ok) {
            const d = await r.json();
            if (d.success) {
              const raw   = d.lowest_price || d.median_price || '';
              const price = parseFloat(raw.replace(/[^0-9.,]/g, '').replace(',', '.'));
              if (!isNaN(price) && price > 0) results[name] = price;
            }
          }
        } catch { /* skip */ }
        await sleep(1500); // Steam rate limit
      }

      return res(JSON.stringify(results), 200, request);
    }

    return res(JSON.stringify({ error: 'Use GET ?action=search&q=... or POST array of names' }), 400, request);
  },
};

function browserHeaders() {
  return {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://steamcommunity.com/market/search?appid=730',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function res(body, status, request) {
  const origin = request.headers.get('Origin') || '*';
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin':  origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary':         'Origin',
      'Content-Type': 'application/json',
    },
  });
}
