/**
 * MAERMIN — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /?action=yfsearch&q=Apple&type=stock  → Yahoo Finance symbol search
 *   GET  /?action=yf&symbol=AAPL&interval=1d&range=1y → YF historical data
 *   GET  /?action=steamhistory&name=...        → Steam skin price (fallback to current)
 *   GET  /?action=search&q=...                 → Steam Market skin search
 *   POST /                                      → Steam skin price lookup
 */

const STEAM_IMG = 'https://community.akamai.steamstatic.com/economy/image';

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    if (request.method === 'OPTIONS') return res(null, 204, request);

    // ── Yahoo Finance Symbol Search ──────────────────────────────────────────
    // GET /?action=yfsearch&q=Apple
    // Returns: [{symbol, name, exchange, type, logoUrl}]
    if (request.method === 'GET' && action === 'yfsearch') {
      const q    = (url.searchParams.get('q') || '').trim();
      const type = url.searchParams.get('type') || 'stock'; // 'stock' | 'crypto'
      if (!q) return res(JSON.stringify([]), 200, request);

      const cacheKey = new Request(`https://cache.maermin/yfsearch/${encodeURIComponent(type)}/${encodeURIComponent(q.toLowerCase())}`);
      const cache    = caches.default;
      const cached   = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      try {
        const yfUrl = `https://query1.finance.yahoo.com/v1/finance/search` +
          `?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false` +
          `&quotesQueryId=tss_match_phrase_query&multiQuoteQueryId=multi_quote_single_token_query`;

        const r = await fetch(yfUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':          'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer':         'https://finance.yahoo.com/',
          },
        });

        if (!r.ok) return res(JSON.stringify([]), 200, request);

        const data   = await r.json();
        const quotes = (data?.finance?.result?.[0]?.quotes || data?.quotes || []);

        // Strictly filter by requested type
        const STOCK_TYPES  = new Set(['EQUITY', 'ETF', 'MUTUALFUND']);
        const CRYPTO_TYPES = new Set(['CRYPTOCURRENCY']);

        const results = quotes
          .filter(q => {
            if (!q.symbol) return false;
            if (type === 'crypto') return CRYPTO_TYPES.has(q.quoteType);
            return STOCK_TYPES.has(q.quoteType); // stocks: never show crypto
          })
          .slice(0, 8)
          .map(q => ({
            symbol:   q.symbol,
            name:     q.shortname || q.longname || q.symbol,
            exchange: q.exchange || q.fullExchangeName || '',
            type:     q.quoteType || 'EQUITY',
            score:    q.score || 0,
          }));

        const payload = JSON.stringify(results);
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
        })));

        return res(payload, 200, request);
      } catch(e) {
        return res(JSON.stringify([]), 200, request);
      }
    }

    // ── Yahoo Finance Historical Data ────────────────────────────────────────
    // GET /?action=yf&symbol=AAPL&interval=1d&range=1y
    // interval: 1m,2m,5m,15m,30m,60m,1h,1d,1wk,1mo
    // range:    1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,max
    if (request.method === 'GET' && action === 'yf') {
      const symbol   = url.searchParams.get('symbol') || '';
      const interval = url.searchParams.get('interval') || '1d';
      const range    = url.searchParams.get('range')    || '1y';

      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);

      // Cache key: symbol+interval+range
      const cacheKey = new Request(
        `https://cache.maermin/yf/${encodeURIComponent(symbol)}/${interval}/${range}`
      );
      const cache = caches.default;

      // Short-period data changes fast — cache 5 min; longer periods cache 1h
      const cacheTtl = ['1d','5d'].includes(range) ? 300 : 3600;

      let cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return res(body, 200, request);
      }

      const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=${interval}&range=${range}&includeTimestamps=true&includePrePost=false`;

      try {
        const r = await fetch(yfUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':          'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer':         'https://finance.yahoo.com/',
          },
        });

        if (!r.ok) {
          return res(JSON.stringify({ error: `Yahoo Finance returned ${r.status}`, symbol }), r.status, request);
        }

        const data = await r.json();
        const result = data?.chart?.result?.[0];

        if (!result) {
          return res(JSON.stringify({ error: 'No data from Yahoo Finance', symbol }), 404, request);
        }

        // Normalize response: extract timestamps + close prices
        const timestamps = result.timestamp || [];
        const closes     = result.indicators?.quote?.[0]?.close || [];
        const currency   = result.meta?.currency || 'USD';
        const exchTz     = result.meta?.exchangeTimezoneName || 'UTC';

        const prices = timestamps.map((ts, i) => ({
          ts,
          date: new Date(ts * 1000).toISOString().split('T')[0],
          price: closes[i] ?? null,
        })).filter(p => p.price !== null && !isNaN(p.price));

        const payload = JSON.stringify({ symbol, currency, exchangeTz: exchTz, prices });

        // Cache
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheTtl}` }
        })));

        return res(payload, 200, request);

      } catch (e) {
        return res(JSON.stringify({ error: e.message, symbol }), 502, request);
      }
    }

    // ── Steam Market Price History ────────────────────────────────────────
    // GET /?action=steamhistory&name=AK-47+|+Redline+(Field-Tested)
    // NOTE: Steam pricehistory requires a logged-in session cookie.
    // Without auth, Steam returns 400. We try anyway, but fall back gracefully.
    // The chart will show the current price as a flat line for CS2 items.
    if (request.method === 'GET' && action === 'steamhistory') {
      const name = url.searchParams.get('name') || '';
      if (!name) return res(JSON.stringify({ error: 'name required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/steamhist/${encodeURIComponent(name)}`);
      const cache    = caches.default;
      const cached   = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return res(body, 200, request);
      }

      // Try Steam pricehistory — works only with logged-in session (rare in Workers)
      // Fall back to current price from priceoverview which works without auth
      let prices = [];

      try {
        const histUrl = `https://steamcommunity.com/market/pricehistory/` +
          `?appid=730&market_hash_name=${encodeURIComponent(name)}&currency=3`; // EUR
        const r = await fetch(histUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept':          'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer':         'https://steamcommunity.com/market/',
            'Cookie':          'Steam_Language=english',
          },
        });

        if (r.ok) {
          const data = await r.json();
          if (data.success && data.prices?.length) {
            prices = data.prices.map(([dateStr, priceStr]) => {
              const cleanDate = dateStr.replace(/\s+\d+:\s+\+0$/, '').trim();
              const d = new Date(cleanDate);
              const ts = isNaN(d) ? 0 : Math.floor(d.getTime() / 1000);
              return { ts, date: d.toISOString().split('T')[0], price: parseFloat(priceStr) || 0 };
            }).filter(p => p.ts > 0 && p.price > 0).sort((a, b) => a.ts - b.ts);
          }
        }
      } catch(e) { /* ignore — try fallback */ }

      // Fallback: get current price from priceoverview (no auth needed)
      if (prices.length === 0) {
        try {
          const ovUrl = `https://steamcommunity.com/market/priceoverview/` +
            `?appid=730&currency=3&market_hash_name=${encodeURIComponent(name)}`;
          const r2 = await fetch(ovUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          });
          if (r2.ok) {
            const d2 = await r2.json();
            if (d2.success) {
              const raw   = d2.lowest_price || d2.median_price || '';
              const price = parseFloat(raw.replace(/[^0-9.,]/g, '').replace(',', '.'));
              if (price > 0) {
                // Return just current price — chart will show flat line
                const now = Math.floor(Date.now() / 1000);
                prices = [
                  { ts: now - 86400 * 30, date: new Date((now - 86400 * 30) * 1000).toISOString().split('T')[0], price },
                  { ts: now,              date: new Date(now * 1000).toISOString().split('T')[0],                 price },
                ];
              }
            }
          }
        } catch(e2) { /* ignore */ }
      }

      if (prices.length === 0) {
        return res(JSON.stringify({ error: 'No price data available for this skin', prices: [] }), 200, request);
      }

      const payload = JSON.stringify({ prices, currency: 'EUR' });
      ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
      })));
      return res(payload, 200, request);
    }

    if (request.method === 'GET' && action === 'search') {
      const q = url.searchParams.get('q') || '';
      if (!q) return res(JSON.stringify([]), 200, request);

      const searchUrl = `https://steamcommunity.com/market/search/render/?` +
        `query=${encodeURIComponent(q)}&appid=730&norender=1&count=24` +
        `&search_descriptions=0&sort_column=popular&sort_dir=desc&currency=3`;

      try {
        const r = await fetch(searchUrl, { headers: steamHeaders() });
        if (!r.ok) return res(JSON.stringify({ error: 'Steam search failed: ' + r.status }), r.status, request);

        const data  = await r.json();
        const items = (data.results || []).map(item => ({
          name:  item.hash_name || item.name,
          image: item.asset_description?.icon_url
            ? `${STEAM_IMG}/${item.asset_description.icon_url}/330x192`
            : null,
          price:     item.sell_price ? item.sell_price / 100 : null,
          priceText: item.sell_price_text || null,
          count:     item.sell_listings  || 0,
          rarity:    item.asset_description?.tags?.find(t => t.category === 'Rarity')?.localized_tag_name || null,
          rarityColor: item.asset_description?.tags?.find(t => t.category === 'Rarity')?.color
            ? '#' + item.asset_description.tags.find(t => t.category === 'Rarity').color : null,
          wear: item.asset_description?.tags?.find(t => t.category === 'Exterior')?.localized_tag_name || null,
        }));

        return res(JSON.stringify(items), 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message }), 502, request);
      }
    }

    // ── Steam Price Lookup (POST) ─────────────────────────────────────────────
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
          const r = await fetch(priceUrl, { headers: steamHeaders() });
          if (r.ok) {
            const d = await r.json();
            if (d.success) {
              const raw   = d.lowest_price || d.median_price || '';
              const price = parseFloat(raw.replace(/[^0-9.,]/g, '').replace(',', '.'));
              if (!isNaN(price) && price > 0) results[name] = price;
            }
          }
        } catch { /* skip */ }
        await sleep(1500);
      }

      return res(JSON.stringify(results), 200, request);
    }

    return res(JSON.stringify({ error: 'Unknown action' }), 400, request);
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function steamHeaders() {
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
