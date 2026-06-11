/**
 * MAERMIN — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /?action=yfsearch&q=Apple&type=stock  → Yahoo Finance symbol search
 *   GET  /?action=yf&symbol=AAPL&interval=1d&range=1y → YF historical data
 *   GET  /?action=screener&scrId=day_gainers   → Discovery: predefined screener / movers
 *   GET  /?action=screener&symbols=KO,PG       → Discovery: batch quote (dividend universe)
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

    // ── Best-effort rate limiting ────────────────────────────────────────────
    // A sliding per-IP cap protects the worker (and its upstream/billing) from
    // bursts and casual abuse of the open proxy/sync endpoints. In-memory per
    // isolate (no external dependency); not a hard global guarantee, but it
    // blunts floods. Tune RATE_LIMIT below.
    if (isRateLimited(request)) {
      return res(JSON.stringify({ error: 'rate limited — slow down' }), 429, request);
    }

    // ── E2E Encrypted Cloud Sync ─────────────────────────────────────────────
    // POST /?action=sync  body { op:'get'|'put', account, baseRev?, blob? }
    // Zero-knowledge: `account` is an opaque client-derived hash, `blob` is
    // AES-256-GCM ciphertext. The server stores/relays bytes only. Optimistic
    // concurrency: put with a stale baseRev → 409 + the server's current record
    // so the client can merge. Requires a KV namespace bound as env.SYNC.
    if (request.method === 'POST' && action === 'sync') {
      if (!env || !env.SYNC) {
        return res(JSON.stringify({ error: 'sync storage not configured (bind KV namespace SYNC)' }), 501, request);
      }
      let body;
      try { body = await request.json(); } catch { return res(JSON.stringify({ error: 'bad json' }), 400, request); }
      const account = typeof body.account === 'string' ? body.account : '';
      if (!/^[a-f0-9]{8,64}$/.test(account)) {
        return res(JSON.stringify({ error: 'invalid account' }), 400, request);
      }
      const key = 'sync:' + account;

      if (body.op === 'get') {
        const rec = await env.SYNC.get(key, { type: 'json' });
        if (!rec) return res(JSON.stringify({ rev: 0, blob: null }), 200, request);
        return res(JSON.stringify({ rev: rec.rev, blob: rec.blob, updatedAt: rec.updatedAt }), 200, request);
      }

      if (body.op === 'put') {
        if (typeof body.blob !== 'string' || body.blob.length > 4_000_000) {
          return res(JSON.stringify({ error: 'invalid blob' }), 400, request);
        }
        const baseRev = Number(body.baseRev) || 0;
        const current = await env.SYNC.get(key, { type: 'json' });
        const serverRev = current ? current.rev : 0;
        if (serverRev !== baseRev) {
          // Conflict: caller's base is stale — hand back the server record to merge.
          return res(JSON.stringify({ conflict: true, serverRev, blob: current ? current.blob : null }), 409, request);
        }
        const next = { rev: baseRev + 1, blob: body.blob, updatedAt: Date.now() };
        await env.SYNC.put(key, JSON.stringify(next));
        return res(JSON.stringify({ ok: true, rev: next.rev }), 200, request);
      }

      return res(JSON.stringify({ error: 'unknown sync op' }), 400, request);
    }

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

        const r = await fetchWithTimeout(yfUrl, {
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
        const r = await fetchWithTimeout(yfUrl, {
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

    // ── Discovery Screener (Roadmap P5) ──────────────────────────────────────
    // Read-only asset discovery. Two modes share one normalised output shape:
    //   GET /?action=screener&scrId=day_gainers&count=25  → Yahoo predefined screener
    //                                                        (top movers / categories)
    //   GET /?action=screener&symbols=KO,PG,JNJ           → Yahoo batch quote
    //                                                        (curated dividend universe)
    // Returns: { scrId, symbols, quotes:[{symbol,name,price,currency,changePercent,
    //            marketCap,dividendYield(fraction),type,exchange,volume}] }
    // dividendYield is normalised to a FRACTION (0.025 = 2.5%). Cached 2 min.
    if (request.method === 'GET' && action === 'screener') {
      const scrId   = (url.searchParams.get('scrId') || '').trim();
      const symbols = (url.searchParams.get('symbols') || '').trim();
      const count   = Math.min(50, Math.max(1, parseInt(url.searchParams.get('count'), 10) || 25));
      if (!scrId && !symbols) {
        return res(JSON.stringify({ error: 'scrId or symbols required' }), 400, request);
      }

      const cacheKey = new Request(
        `https://cache.maermin/screener/${encodeURIComponent(symbols ? 'q:' + symbols : 's:' + scrId)}/${count}`
      );
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      const yfUrl = symbols
        ? `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`
        : `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${encodeURIComponent(scrId)}&count=${count}&start=0`;

      try {
        const r = await fetchWithTimeout(yfUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept':          'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer':         'https://finance.yahoo.com/',
          },
        });
        if (!r.ok) {
          return res(JSON.stringify({ error: `Yahoo Finance returned ${r.status}` }), r.status, request);
        }

        const data = await r.json();
        const raw = symbols
          ? (data?.quoteResponse?.result || [])
          : (data?.finance?.result?.[0]?.quotes || []);

        const quotes = raw.map(q => ({
          symbol:        q.symbol,
          name:          q.shortName || q.longName || q.displayName || q.symbol,
          price:         numOrNull(q.regularMarketPrice),
          currency:      q.currency || 'USD',
          changePercent: numOrNull(q.regularMarketChangePercent),
          marketCap:     numOrNull(q.marketCap),
          // Prefer the trailing yield (already a fraction); fall back to the
          // percent-valued dividendYield and normalise it to a fraction.
          dividendYield: q.trailingAnnualDividendYield != null
                           ? numOrNull(q.trailingAnnualDividendYield)
                           : (numOrNull(q.dividendYield) != null ? numOrNull(q.dividendYield) / 100 : null),
          type:          q.quoteType || 'EQUITY',
          exchange:      q.fullExchangeName || q.exchange || '',
          volume:        numOrNull(q.regularMarketVolume),
        })).filter(q => q.symbol && q.price != null).slice(0, count);

        const payload = JSON.stringify({ scrId: scrId || null, symbols: symbols || null, quotes });
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' }
        })));
        return res(payload, 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message }), 502, request);
      }
    }

    // ── Steam Market Price History ────────────────────────────────────────
    // GET /?action=steamhistory&name=AK-47+|+Redline+(Field-Tested)
    // Extracts full price history from the Steam Market LISTING PAGE (no login needed).
    // The listing page embeds the complete price graph data as a JS variable "var line1"
    // even for anonymous visitors — same data that powers the chart on the Steam website.
    if (request.method === 'GET' && action === 'steamhistory') {
      const name = url.searchParams.get('name') || '';
      if (!name) return res(JSON.stringify({ error: 'name required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/steamhist2/${encodeURIComponent(name)}`);
      const cache    = caches.default;
      const cached   = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      let prices = [];

      // ── Primary: scrape the listing page HTML ─────────────────────────────
      // Steam embeds price history as: var line1=[["Dec 01 2021 01: +0","12.5","3"],...];
      // This is available WITHOUT login — it's what populates the price graph on the page.
      try {
        const listingUrl = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
        const r = await fetchWithTimeout(listingUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        });

        if (r.ok) {
          const html = await r.text();

          // Extract: var line1 = [["Jan 01 2023 01: +0","12.50","3"], ...];
          const match = html.match(/var line1\s*=\s*(\[\[.+?\]\])\s*;/s);
          if (match) {
            const raw = JSON.parse(match[1]);
            prices = raw.map(([dateStr, priceStr]) => {
              // dateStr format: "Dec 01 2021 01: +0"
              // Strip the time suffix and parse
              const clean = dateStr.replace(/\s+\d+:\s+\+0$/, '').trim(); // → "Dec 01 2021"
              const d = new Date(clean + ' UTC');
              if (isNaN(d.getTime())) return null;
              const ts    = Math.floor(d.getTime() / 1000);
              const price = parseFloat(priceStr) || 0;
              return price > 0 ? { ts, date: d.toISOString().split('T')[0], price } : null;
            }).filter(Boolean).sort((a, b) => a.ts - b.ts);

            console.log(`[STEAM] Listing page: ${name} → ${prices.length} price points`);
          }
        }
      } catch(e) {
        console.warn('[STEAM] Listing page scrape failed:', e.message);
      }

      // ── Fallback: current price from priceoverview (no auth, no history) ──
      if (prices.length === 0) {
        try {
          const ovUrl = `https://steamcommunity.com/market/priceoverview/` +
            `?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
          const r2 = await fetchWithTimeout(ovUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (r2.ok) {
            const d2 = await r2.json();
            if (d2.success) {
              const raw   = d2.lowest_price || d2.median_price || '';
              const price = parseFloat(raw.replace(/[^0-9.,]/g, '').replace(',', '.'));
              if (price > 0) {
                const now = Math.floor(Date.now() / 1000);
                prices = [
                  { ts: now - 86400 * 90, date: new Date((now - 86400 * 90) * 1000).toISOString().split('T')[0], price },
                  { ts: now,              date: new Date(now * 1000).toISOString().split('T')[0],                 price },
                ];
                console.log(`[STEAM] priceoverview fallback: ${name} → ${price}`);
              }
            }
          }
        } catch(e2) { /* ignore */ }
      }

      if (prices.length === 0) {
        return res(JSON.stringify({ error: 'No price data', prices: [] }), 200, request);
      }

      const payload = JSON.stringify({ prices, currency: 'EUR' });
      // Cache 4h — Steam price history changes slowly
      ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=14400' }
      })));
      return res(payload, 200, request);
    }

    // GET /?action=news&symbol=AAPL — Yahoo Finance RSS news for a symbol
    if (request.method === 'GET' && action === 'news') {
      const symbol = url.searchParams.get('symbol') || '';
      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);
      const cacheKey = new Request(`https://cache.maermin/news/${encodeURIComponent(symbol)}`);
      const cache    = caches.default;
      const cached   = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);
      try {
        const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
        const r = await fetchWithTimeout(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,text/xml' } });
        if (!r.ok) return res('<?xml version="1.0"?><rss><channel></channel></rss>', 200, request);
        const text = await r.text();
        ctx.waitUntil(cache.put(cacheKey, new Response(text, {
          headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'public, max-age=900' }
        })));
        return res(text, 200, request);
      } catch(e) { return res('<?xml version="1.0"?><rss><channel></channel></rss>', 200, request); }
    }

    if (request.method === 'GET' && action === 'search') {
      const q = url.searchParams.get('q') || '';
      if (!q) return res(JSON.stringify([]), 200, request);

      const searchUrl = `https://steamcommunity.com/market/search/render/?` +
        `query=${encodeURIComponent(q)}&appid=730&norender=1&count=24` +
        `&search_descriptions=0&sort_column=popular&sort_dir=desc&currency=1`;

      try {
        const r = await fetchWithTimeout(searchUrl, { headers: steamHeaders() });
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
    // ── Broker proxy ─────────────────────────────────────────────────────────
    // POST /?action=brokerproxy  body: { method, url, headers, body }
    // Relays a CLIENT-SIGNED request to a whitelisted exchange host so the
    // browser can bypass the exchange's missing CORS headers. The API secret is
    // never transmitted — only the signature the client already computed. The
    // host whitelist keeps this from becoming an open SSRF proxy.
    if (request.method === 'POST' && action === 'brokerproxy') {
      const ALLOWED = ['api.binance.com', 'api.kraken.com', 'api.exchange.coinbase.com', 'api.coinbase.com'];
      let spec;
      try { spec = await request.json(); } catch { return res(JSON.stringify({ error: 'Invalid JSON body' }), 400, request); }
      let target;
      try { target = new URL(spec.url); } catch { return res(JSON.stringify({ error: 'Invalid url' }), 400, request); }
      if (target.protocol !== 'https:' || !ALLOWED.includes(target.hostname)) {
        return res(JSON.stringify({ error: 'Host not allowed' }), 403, request);
      }
      try {
        const method = (spec.method || 'GET').toUpperCase();
        const r = await fetchWithTimeout(target.toString(), {
          method,
          headers: spec.headers || {},
          body: method === 'GET' || method === 'HEAD' ? undefined : (spec.body || ''),
        });
        const text = await r.text();
        return res(JSON.stringify({ status: r.status, ok: r.ok, data: safeJson(text) }), 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: 'Upstream fetch failed: ' + (e && e.message) }), 502, request);
      }
    }

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

      // CONTRACT: skin prices are returned in USD (Steam currency=1). The client
      // converts USD → its canonical EUR via the live FX rate (MaerminUtils.toEUR)
      // and then displays in the user's selected currency. Keep all skin price
      // endpoints (priceoverview, search, history) on currency=1 so the source
      // currency is unambiguous.
      //
      // Fetch in small concurrent batches instead of one-at-a-time-with-1.5s-sleep
      // (which took up to 45s for 30 skins). Batching keeps it polite to Steam
      // while cutting latency to a few seconds.
      const BATCH = 5, GAP_MS = 400;
      const fetchOne = async (name) => {
        if (!name || typeof name !== 'string') return;
        try {
          const priceUrl = `https://steamcommunity.com/market/priceoverview/` +
            `?appid=730&currency=1&market_hash_name=${encodeURIComponent(name.trim())}`;
          const r = await fetchWithTimeout(priceUrl, { headers: steamHeaders() });
          if (r.ok) {
            const d = await r.json();
            if (d.success) {
              const raw   = d.lowest_price || d.median_price || '';
              const price = parseFloat(raw.replace(/[^0-9.,]/g, '').replace(',', '.'));
              if (!isNaN(price) && price > 0) results[name] = price;
            }
          }
        } catch { /* skip */ }
      };
      for (let i = 0; i < names.length; i += BATCH) {
        await Promise.all(names.slice(i, i + BATCH).map(fetchOne));
        if (i + BATCH < names.length) await sleep(GAP_MS);
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

function safeJson(text) { try { return JSON.parse(text); } catch { return text; } }

function numOrNull(x) { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : null; }

// fetch with a hard timeout so a slow/hung upstream can't pin a request open.
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// In-memory sliding-window rate limiter (per worker isolate). Keyed by client
// IP. Best-effort: isolates don't share memory, but this still caps bursts.
const RATE_LIMIT = { windowMs: 60000, max: 120 };
const _rlHits = new Map(); // ip -> number[] (timestamps)
function isRateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'anon';
  const now = Date.now();
  const cutoff = now - RATE_LIMIT.windowMs;
  let arr = _rlHits.get(ip);
  if (!arr) { arr = []; _rlHits.set(ip, arr); }
  // drop timestamps outside the window
  while (arr.length && arr[0] < cutoff) arr.shift();
  arr.push(now);
  // opportunistic cleanup so the map can't grow unbounded
  if (_rlHits.size > 5000) {
    for (const [k, v] of _rlHits) { if (!v.length || v[v.length - 1] < cutoff) _rlHits.delete(k); }
  }
  return arr.length > RATE_LIMIT.max;
}

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
