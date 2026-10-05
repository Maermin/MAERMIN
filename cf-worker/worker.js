/**
 * MAERMIN — Cloudflare Worker
 *
 * Endpoints:
 *   GET  /?action=yfsearch&q=Apple&type=stock  → Yahoo Finance symbol search
 *   GET  /?action=yf&symbol=AAPL&interval=1d&range=1y → YF historical data
 *   GET  /?action=screener&scrId=day_gainers   → Discovery: predefined screener / movers
 *   GET  /?action=screener&symbols=KO,PG       → Discovery: batch quote (dividend universe)
 *   GET  /?action=fundholdings&symbol=VWCE.DE  → ETF/fund look-through: top holdings,
 *                                                 sector weights, expense ratio (TER)
 *   GET  /?action=profile&symbol=AAPL          → equity sector / industry / country
 *                                                 (Strategy tab Sector & Country allocation)
 *   GET  /?action=fundamentals&symbol=KO       → dividend-safety fundamentals: payout
 *                                                 ratio, EPS, dividend rate/yield
 *   GET  /?action=skinprices                    → CS2 Steam Market prices, all items (USD,
 *                                                 CSGO Trader's daily price file)
 */

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    configureOrigins(env);

    if (request.method === 'OPTIONS') return res(null, 204, request);

    // ── Yahoo routes take market symbols only ────────────────────────────────
    // A CS2 skin name filed as a stock ("AK-47 | Redline (Field-Tested)") was
    // sent to the Yahoo routes on every refresh, bare and with six exchange
    // suffixes: hundreds of upstream 404s that also used up the rate limit, so
    // the skin price requests were refused with 429. Such a symbol is answered
    // here, without an upstream call and without counting against the limit.
    if (request.method === 'GET' && SYMBOL_ROUTES.has(action)) {
      const sym = (url.searchParams.get('symbol') || '').trim();
      if (sym && !isMarketSymbol(sym)) {
        return res(JSON.stringify({ error: 'not a market symbol', hint: 'CS2 items are priced through the skin price list (category CS2 Skins)' }), 400, request);
      }
    }

    // ── Best-effort rate limiting ────────────────────────────────────────────
    // A sliding per-IP cap protects the worker (and its upstream/billing) from
    // bursts and casual abuse of the open proxy/sync endpoints. In-memory per
    // isolate (no external dependency); not a hard global guarantee, but it
    // blunts floods. Tune RATE_LIMIT below. The skin price list has its own
    // budget, so a burst of stock or chart requests can never starve it.
    if (isRateLimited(request, rateBucket(request, action))) {
      return res(JSON.stringify({ error: 'rate limited — slow down' }), 429, request);
    }

    // ── E2E Encrypted Cloud Sync ─────────────────────────────────────────────
    // POST /?action=sync  body { op:'get'|'put', account, baseRev?, blob? }
    // Zero-knowledge: `account` is an opaque client-derived hash, `blob` is
    // AES-256-GCM ciphertext. The server stores/relays bytes only. Optimistic
    // concurrency: put with a stale baseRev → 409 + the server's current record
    // so the client can merge. Requires a KV namespace bound as env.SYNC.
    if (request.method === 'POST' && action === 'sync') {
      if (!env || (!env.SYNC && !env.SYNC_DO)) {
        return res(JSON.stringify({ error: 'sync storage not configured (bind KV namespace SYNC or Durable Object SYNC_DO)' }), 501, request);
      }
      let body;
      try { body = await request.json(); } catch { return res(JSON.stringify({ error: 'bad json' }), 400, request); }
      const account = typeof (body && body.account) === 'string' ? body.account : '';
      if (!/^[a-f0-9]{8,64}$/.test(account)) {
        return res(JSON.stringify({ error: 'invalid account' }), 400, request);
      }
      // Preferred: one Durable Object per account = atomic revision check.
      // KV is eventually consistent and has no compare-and-set, so two devices
      // writing at the same time can both "win" and one update is lost.
      if (env.SYNC_DO) {
        const stub = env.SYNC_DO.get(env.SYNC_DO.idFromName(account));
        const r = await stub.fetch('https://sync.internal/', { method: 'POST', body: JSON.stringify(body) });
        return res(await r.text(), r.status, request);
      }
      const key = 'sync:' + account;
      const out = await handleSyncOp({
        get: () => env.SYNC.get(key, { type: 'json' }),
        put: (rec) => env.SYNC.put(key, JSON.stringify(rec)),
      }, body);
      return res(JSON.stringify(out.body), out.status, request);
    }

    // ── Privacy-preserving share snapshots + anonymous benchmark ────────────
    // POST /?action=share  body { op:'publish', snapshot } | { op:'get', id }
    //                          | { op:'aggregate' }
    // Stores ONLY redacted snapshots: percentage weights and scores, validated
    // against a hard allowlist SERVER-SIDE as well (defense in depth - the
    // client already redacts). No account, no PII, random id, 90-day TTL.
    // The aggregate is a running count+sum of asset-class weights so the
    // anonymous benchmark never exposes individual snapshots. Requires the
    // same KV namespace as sync (env.SYNC).
    if (request.method === 'POST' && action === 'share') {
      if (!env || !env.SYNC) {
        return res(JSON.stringify({ error: 'share storage not configured (bind KV namespace SYNC)' }), 501, request);
      }
      let body;
      try { body = await request.json(); } catch { return res(JSON.stringify({ error: 'bad json' }), 400, request); }

      if (body.op === 'publish') {
        // Publishing writes to the namespace that sync uses, so it is limited
        // per client and per day (see shareClientKey / shareRoomOp).
        const clientKey = shareClientKey(request);
        const v = validateShareSnapshot(body.snapshot);
        if (env.SYNC_DO) {
          if (!v.ok) return res(JSON.stringify({ error: 'invalid snapshot: ' + v.error }), 400, request);
          const room = env.SYNC_DO.get(env.SYNC_DO.idFromName('share'));
          const acc = await (await room.fetch('https://share.internal/share', { method: 'POST',
            body: JSON.stringify({ op: 'publish', key: clientKey, classes: v.snapshot.assetClasses, dailyMax: env.SHARE_DAILY_MAX }) })).json();
          if (!acc || !acc.ok) return res(JSON.stringify({ error: 'too many shares - try again later' }), 429, request);
        } else {
          if (isPublishLimited(request) || isDailyBudgetSpent(env)) {
            return res(JSON.stringify({ error: 'too many shares - try again later' }), 429, request);
          }
          if (!v.ok) return res(JSON.stringify({ error: 'invalid snapshot: ' + v.error }), 400, request);
        }
        const id = [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, '0')).join('');
        await env.SYNC.put('share:' + id, JSON.stringify({ snapshot: v.snapshot, at: Date.now() }), { expirationTtl: 90 * 86400 });
        // Without the Durable Object: best-effort rolling aggregate in KV
        // (count + per-class weight sums only), one contribution per client a day.
        if (!env.SYNC_DO && takeContribution(clientKey, Date.now())) {
          try {
            const agg = (await env.SYNC.get('share:aggregate', { type: 'json' })) || { count: 0, sums: {} };
            agg.count += 1;
            for (const [cls, pct] of Object.entries(v.snapshot.assetClasses || {})) {
              agg.sums[cls] = (agg.sums[cls] || 0) + pct;
            }
            await env.SYNC.put('share:aggregate', JSON.stringify(agg));
          } catch { /* aggregate is best-effort */ }
        }
        return res(JSON.stringify({ ok: true, id }), 200, request);
      }

      if (body.op === 'get') {
        const id = String(body.id || '');
        if (!/^[a-f0-9]{10,32}$/.test(id)) return res(JSON.stringify({ error: 'invalid id' }), 400, request);
        const rec = await env.SYNC.get('share:' + id, { type: 'json' });
        if (!rec) return res(JSON.stringify({ error: 'not found' }), 404, request);
        return res(JSON.stringify({ snapshot: rec.snapshot, at: rec.at }), 200, request);
      }

      if (body.op === 'aggregate') {
        const agg = env.SYNC_DO
          ? await (await env.SYNC_DO.get(env.SYNC_DO.idFromName('share')).fetch('https://share.internal/share', { method: 'POST', body: JSON.stringify({ op: 'aggregate' }) })).json()
          : ((await env.SYNC.get('share:aggregate', { type: 'json' })) || { count: 0, sums: {} });
        const avg = {};
        if (agg.count > 0) {
          for (const [cls, sum] of Object.entries(agg.sums)) avg[cls] = Math.round((sum / agg.count) * 10) / 10;
        }
        return res(JSON.stringify({ count: agg.count, avgAssetClasses: avg }), 200, request);
      }

      return res(JSON.stringify({ error: 'unknown share op' }), 400, request);
    }

    // ── MCP read-only portfolio endpoint (WI-9) ──────────────────────────────
    // GET /?action=mcp&id=<shareId>  — an MCP-compatible, READ-ONLY view over the
    // exact same redacted share snapshot. It serves ONLY allowlist fields
    // (percentage weights by asset class / sector / region / currency + optional
    // scores) — never amounts, quantities or symbols. Same opt-in, time-limited
    // links as Share & Compare: an expired/unknown id is dead (404). The snapshot
    // is re-validated on the way out so nothing outside the allowlist can leak,
    // even if a record were ever tampered with.
    if (request.method === 'GET' && action === 'mcp') {
      if (!env || !env.SYNC) {
        return res(JSON.stringify({ error: 'mcp storage not configured (bind KV namespace SYNC)' }), 501, request);
      }
      const id = String(url.searchParams.get('id') || '');
      if (!/^[a-f0-9]{10,32}$/.test(id)) return res(JSON.stringify({ error: 'invalid id' }), 400, request);
      const rec = await env.SYNC.get('share:' + id, { type: 'json' });
      if (!rec || !rec.snapshot) return res(JSON.stringify({ error: 'link expired or not found' }), 404, request);
      const resource = mcpResource(rec.snapshot, { id, at: rec.at });
      if (!resource) return res(JSON.stringify({ error: 'snapshot not serveable' }), 404, request);
      return res(JSON.stringify(resource), 200, request);
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
      // Both go verbatim into the upstream URL and the cache key: allowlist them
      // (a value like "1y&x=y" or "1y#" would inject parameters / poison the cache).
      if (!YF_INTERVALS.has(interval) || !YF_RANGES.has(range)) {
        return res(JSON.stringify({ error: 'invalid interval or range' }), 400, request);
      }

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
        `?interval=${interval}&range=${range}&includeTimestamps=true&includePrePost=false&events=div,split`;

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

        // Corporate actions: surface Yahoo's split events (added via events=split
        // above) as a flat, normalised array. result.events.splits is an object
        // keyed by epoch second: { "<ts>": { date, numerator, denominator } }.
        // Empty array when Yahoo reports none. The `prices` shape is unchanged so
        // existing clients ignore this new field; a client that wants splits reads
        // it, and one running against an older Worker simply finds it absent.
        const splits = Object.values(result.events?.splits || {}).map(s => ({
          date: s.date != null ? new Date(s.date * 1000).toISOString().split('T')[0] : null,
          numerator: numOrNull(s.numerator),
          denominator: numOrNull(s.denominator),
        })).filter(s => s.date && s.numerator > 0 && s.denominator > 0)
          .sort((a, b) => (a.date < b.date ? -1 : 1));

        const payload = JSON.stringify({ symbol, currency, exchangeTz: exchTz, prices, splits });

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

    // ── Fund holdings (ETF/fund look-through) ────────────────────────────────
    // GET /?action=fundholdings&symbol=VWCE.DE
    // Proxies Yahoo Finance quoteSummary (modules topHoldings + fundProfile +
    // price) and normalises it for the client's look-through engine:
    //   { symbol, name, type, fund, ter, holdings:[{symbol,name,weight}],
    //     sectors:[{sector,weight}] }
    // weight / ter are FRACTIONS (0.045 = 4.5%). `fund:false` means Yahoo has
    // no holdings data for the symbol (e.g. a plain stock) — a valid answer,
    // not an error. Holdings change slowly → cached 24h. quoteSummary sometimes
    // demands Yahoo's cookie+crumb handshake; we retry once with a session.
    if (request.method === 'GET' && action === 'fundholdings') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/fundholdings/${encodeURIComponent(symbol)}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      try {
        const data = await fetchQuoteSummary(symbol, 'topHoldings,fundProfile,price');
        const r0 = data?.quoteSummary?.result?.[0];
        if (!r0) {
          return res(JSON.stringify({ error: 'No data from Yahoo Finance', symbol }), 404, request);
        }

        const top = r0.topHoldings || {};
        const profile = r0.fundProfile || {};
        const price = r0.price || {};

        const holdings = (top.holdings || []).map(h => ({
          symbol: h.symbol || null,
          name: h.holdingName || h.symbol || '',
          weight: numOrNull(h.holdingPercent?.raw ?? h.holdingPercent),
        })).filter(h => h.weight != null && h.weight > 0 && (h.symbol || h.name));

        // sectorWeightings arrive as [{ technology: { raw: 0.31 } }, …] with
        // Yahoo's snake_case keys — translate to the sector names the app's
        // equity metadata already uses so both breakdowns aggregate cleanly.
        const SECTOR_LABELS = {
          technology: 'Technology', healthcare: 'Healthcare', financial_services: 'Financials',
          consumer_cyclical: 'Consumer Discretionary', consumer_defensive: 'Consumer Staples',
          communication_services: 'Communication Services', industrials: 'Industrials',
          energy: 'Energy', basic_materials: 'Materials', utilities: 'Utilities', realestate: 'Real Estate',
        };
        const sectors = (top.sectorWeightings || []).map(o => {
          const k = Object.keys(o || {})[0];
          if (!k) return null;
          const w = numOrNull(o[k]?.raw ?? o[k]);
          return (w != null && w > 0) ? { sector: SECTOR_LABELS[k] || k, weight: w } : null;
        }).filter(Boolean);

        const fees = profile.feesExpensesInvestment || {};
        const ter = numOrNull(fees.annualReportExpenseRatio?.raw ?? fees.annualReportExpenseRatio)
          ?? numOrNull(fees.netExpRatio?.raw ?? fees.netExpRatio);

        const payload = JSON.stringify({
          symbol,
          name: price.shortName || price.longName || symbol,
          type: price.quoteType || null,
          fund: holdings.length > 0 || sectors.length > 0,
          ter,
          holdings,
          sectors,
        });
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }
        })));
        return res(payload, 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message, symbol }), 502, request);
      }
    }

    // ── Fundamentals (dividend quality / safety) ─────────────────────────────
    // GET /?action=fundamentals&symbol=KO
    // Proxies Yahoo Finance quoteSummary (modules summaryDetail +
    // defaultKeyStatistics + price) and normalises the handful of numbers the
    // dividend-safety scoring needs. All ratios are FRACTIONS (payoutRatio
    // 0.62 = 62%; Yahoo reports fiveYearAvgDividendYield in percent, so it is
    // divided by 100 here). Nulls mean Yahoo has no value — the client then
    // falls back to its history-based heuristic. Cached 6h.
    if (request.method === 'GET' && action === 'fundamentals') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/fundamentals/${encodeURIComponent(symbol)}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      try {
        const data = await fetchQuoteSummary(symbol, 'summaryDetail,defaultKeyStatistics,price');
        const r0 = data?.quoteSummary?.result?.[0];
        if (!r0) {
          return res(JSON.stringify({ error: 'No data from Yahoo Finance', symbol }), 404, request);
        }
        const sd = r0.summaryDetail || {};
        const ks = r0.defaultKeyStatistics || {};
        const price = r0.price || {};
        const raw = (x) => numOrNull(x?.raw ?? x);

        const fiveYear = raw(sd.fiveYearAvgDividendYield);
        // Yahoo gives dividend dates as epoch SECONDS in {raw}; surface them as
        // ISO dates so the Dividend Calendar & Forecast can schedule real ex/pay
        // dates and infer the payment frequency (dividendRate / lastDividendValue).
        const isoDate = (x) => { const s = raw(x); return s != null ? new Date(s * 1000).toISOString().split('T')[0] : null; };
        const payload = JSON.stringify({
          symbol,
          name: price.shortName || price.longName || symbol,
          currency: price.currency || sd.currency || 'USD',
          price: raw(price.regularMarketPrice),
          marketCap: raw(sd.marketCap),                  // in `currency`; client EUR-normalises (WI-5)
          dividendRate: raw(sd.dividendRate),            // annual DPS
          dividendYield: raw(sd.dividendYield),          // fraction
          fiveYearAvgDividendYield: fiveYear != null ? fiveYear / 100 : null,
          payoutRatio: raw(sd.payoutRatio),              // fraction
          trailingEps: raw(ks.trailingEps),
          forwardEps: raw(ks.forwardEps),
          exDividendDate: isoDate(sd.exDividendDate),    // next/last ex-date (ISO)
          dividendDate: isoDate(sd.dividendDate),        // pay date (ISO)
          lastDividendValue: raw(ks.lastDividendValue),  // last single payment → frequency
        });
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' }
        })));
        return res(payload, 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message, symbol }), 502, request);
      }
    }

    // GET /?action=earnings&symbol=AAPL
    // Proxies Yahoo Finance quoteSummary (calendarEvents + price) and returns the
    // next earnings date(s) plus the consensus EPS / revenue estimates — powers
    // the Earnings Calendar. Cached 6h (estimates move slowly intraday). Nulls
    // mean Yahoo has no value for that field; an older Worker simply lacks this
    // route, so the client gates on a 404/400 with an upgrade note.
    if (request.method === 'GET' && action === 'earnings') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/earnings/${encodeURIComponent(symbol)}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      try {
        const data = await fetchQuoteSummary(symbol, 'calendarEvents,price');
        const r0 = data?.quoteSummary?.result?.[0];
        if (!r0) return res(JSON.stringify({ error: 'No data from Yahoo Finance', symbol }), 404, request);
        const ce = r0.calendarEvents || {};
        const earn = ce.earnings || {};
        const price = r0.price || {};
        const raw = (x) => numOrNull(x?.raw ?? x);
        const isoDate = (x) => { const s = numOrNull(x?.raw ?? x); return s != null ? new Date(s * 1000).toISOString().split('T')[0] : null; };
        // earningsDate is an array of epoch-second {raw}; the first is the next
        // (or estimated) report date. A range means an unconfirmed estimate.
        const dates = Array.isArray(earn.earningsDate) ? earn.earningsDate.map(isoDate).filter(Boolean) : [];
        const payload = JSON.stringify({
          symbol,
          name: price.shortName || price.longName || symbol,
          currency: price.currency || 'USD',
          earningsDate: dates[0] || null,
          earningsDateEnd: dates.length > 1 ? dates[dates.length - 1] : null,
          isEstimate: dates.length > 1,
          epsEstimate: raw(earn.earningsAverage),
          epsLow: raw(earn.earningsLow),
          epsHigh: raw(earn.earningsHigh),
          revenueEstimate: raw(earn.revenueAverage),
        });
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' }
        })));
        return res(payload, 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message, symbol }), 502, request);
      }
    }

    // GET /?action=profile&symbol=AAPL
    // Proxies Yahoo Finance quoteSummary (assetProfile + price) and returns the
    // sector / industry / country a holding belongs to — powers the Strategy
    // tab's Sector & Country allocation WITHOUT requiring a user FMP key (Yahoo
    // is the same source already used for stock prices). Metadata is near-static,
    // so it is cached 30 days. Nulls mean Yahoo has no value for that field.
    if (request.method === 'GET' && action === 'profile') {
      const symbol = (url.searchParams.get('symbol') || '').trim();
      if (!symbol) return res(JSON.stringify({ error: 'symbol required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/profile/${encodeURIComponent(symbol)}`);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      try {
        const data = await fetchQuoteSummary(symbol, 'assetProfile,price');
        const r0 = data?.quoteSummary?.result?.[0];
        if (!r0) return res(JSON.stringify({ error: 'No data from Yahoo Finance', symbol }), 404, request);
        const ap = r0.assetProfile || {};
        const price = r0.price || {};
        const payload = JSON.stringify({
          symbol,
          name: price.shortName || price.longName || symbol,
          currency: price.currency || null,
          sector: ap.sector || null,        // e.g. "Technology"
          industry: ap.industry || null,    // e.g. "Software—Infrastructure"
          country: ap.country || null,      // e.g. "United States"
        });
        ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' }
        })));
        return res(payload, 200, request);
      } catch (e) {
        return res(JSON.stringify({ error: e.message, symbol }), 502, request);
      }
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

    // ── CS2 skin prices (all items, one request) ─────────────────────────────
    // GET /?action=skinprices → CSGO Trader's daily Steam Market price file:
    // { "<market_hash_name>": { last_24h, last_7d, last_30d, last_90d }, ... } (USD)
    // Steam and Skinport themselves block or throttle Cloudflare Workers; this
    // file is on Amazon S3/CloudFront, is rebuilt once a day and prices every
    // CS2 item in ONE call. The ~4 MB body is streamed through UNPARSED (the
    // free plan's CPU budget); the app parses it. Kept for an hour (KV when
    // bound as SYNC, else the edge cache); when the source fails, the last good
    // copy (up to 3 days old) is served with `X-Stale: 1`.
    if (request.method === 'GET' && action === 'skinprices') {
      const copy = skinPriceStore(env);
      const hit = await copy.get();
      if (hit && Date.now() - hit.fetchedAt < SKIN_PRICES_FRESH_MS) return passThrough(hit.response, request, false, hit.fetchedAt);
      try {
        const r = await fetchWithTimeout(SKIN_PRICES_URL, { headers: { 'Accept': 'application/json',
          'User-Agent': 'MAERMIN-Portfolio-Worker/1.0 (+https://github.com/Maermin/MAERMIN)' } }, 20000);
        if (!r.ok || !r.body) throw new Error('price file ' + r.status);
        const [toClient, toStore] = r.body.tee();
        const fetchedAt = Date.now();
        ctx.waitUntil(copy.put(toStore, fetchedAt));
        return passThrough(new Response(toClient), request, false, fetchedAt);
      } catch (e) {
        if (hit) return passThrough(hit.response, request, true, hit.fetchedAt);
        return res(JSON.stringify({ error: 'Skin prices unavailable: ' + (e && e.message) }), 502, request);
      }
    }

    // ── Broker proxy ─────────────────────────────────────────────────────────
    // POST /?action=brokerproxy  body: { method, url, headers, body }
    // Relays a CLIENT-SIGNED request to a whitelisted exchange host so the
    // browser can bypass the exchange's missing CORS headers. The API secret is
    // never transmitted — only the signature the client already computed. The
    // host whitelist keeps this from becoming an open SSRF proxy.
    if (request.method === 'POST' && action === 'brokerproxy') {
      let spec;
      try { spec = await request.json(); } catch { return res(JSON.stringify({ error: 'Invalid JSON body' }), 400, request); }
      let target;
      try { target = new URL(spec.url); } catch { return res(JSON.stringify({ error: 'Invalid url' }), 400, request); }
      const method = (spec.method || 'GET').toUpperCase();
      const verdict = brokerRelayAllowed(target, method);
      if (!verdict.ok) return res(JSON.stringify({ error: verdict.error }), 403, request);
      try {
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

    return res(JSON.stringify({ error: 'Unknown action' }), 400, request);
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Read-only relay policy. Host allowlist alone let anyone use this Worker as
// an anonymous relay for signed TRADING/withdrawal calls (any method, any path)
// - the read-only guarantee was client-side only. Now each host has explicit
// read endpoints + methods; everything else is refused server-side.
const BROKER_RELAY_POLICY = {
  'api.binance.com':           { GET: ['/api/v3/account', '/api/v3/myTrades', '/sapi/v1/account/apiRestrictions'] },
  'api.bitpanda.com':          { GET: ['/v1/trades', '/v1/wallets', '/v1/fiatwallets', '/v1/asset-wallets'] },
  'api.kraken.com':            { POST: ['/0/private/TradesHistory', '/0/private/Ledgers', '/0/private/Balance'] },
  'api.exchange.coinbase.com': { GET: ['/fills', '/accounts'] },
  'api.coinbase.com':          { GET: ['/api/v3/brokerage/orders/historical/fills', '/api/v3/brokerage/accounts', '/v2/accounts'] },
};
export function brokerRelayAllowed(target, method) {
  if (!target || target.protocol !== 'https:') return { ok: false, error: 'Host not allowed' };
  const policy = BROKER_RELAY_POLICY[target.hostname];
  if (!policy) return { ok: false, error: 'Host not allowed' };
  const paths = policy[String(method || 'GET').toUpperCase()];
  if (!paths) return { ok: false, error: 'Method not allowed (read-only relay)' };
  const path = target.pathname.replace(/\/+$/, '');
  const ok = paths.some((p) => path === p || path.startsWith(p + '/'));
  return ok ? { ok: true } : { ok: false, error: 'Endpoint not allowed (read-only relay)' };
}


function safeJson(text) { try { return JSON.parse(text); } catch { return text; } }

function numOrNull(x) { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : null; }

// ── Sync write-authorization (HMAC) ─────────────────────────────────────────
// PURE + exported for the Node harness (test/sync-auth.test.js). See the put
// handler above for the threat model. authKey is hex(HKDF(vaultKey,'sync-auth')).
export function hexToBytes(hex) {
  const s = String(hex || '');
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
// Constant-time hex compare so a forged MAC can't be tuned byte-by-byte.
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function syncMac(keyHex, message) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}
// Decide a put's authorization + the authKey to persist. PURE (no I/O):
//   current = existing KV record (or null); auth = { key?, mac? }
// Returns { ok:true, authKey } | { ok:false, status, error }.
export async function authorizeSyncPut(current, account, baseRev, blob, auth) {
  auth = auth || {};
  const registered = current && current.authKey;
  if (registered) {
    const expected = await syncMac(registered, account + '.' + baseRev + '.' + blob);
    if (typeof auth.mac !== 'string' || !timingSafeEqualHex(auth.mac, expected)) {
      return { ok: false, status: 403, error: 'unauthorized' };
    }
    return { ok: true, authKey: registered };
  }
  // No registered key. Register one ONLY at account creation (no current record)
  // — never "upgrade" an existing open record, which an account-id knower could
  // hijack. Legacy/open accounts stay open (backward compatible).
  let authKey = null;
  if (!current && typeof auth.key === 'string' && /^[a-f0-9]{64}$/.test(auth.key)) authKey = auth.key;
  return { ok: true, authKey };
}

// ── Sync operation (storage-agnostic) ──────────────────────────────────────
// store = { get(): Promise<record|null>, put(record): Promise }. Returns
// { status, body }. Used by the KV path and by the SyncRoom Durable Object.
export async function handleSyncOp(store, body) {
  body = body || {};
  const account = typeof body.account === 'string' ? body.account : '';
  if (body.op === 'get') {
    const rec = await store.get();
    if (!rec) return { status: 200, body: { rev: 0, blob: null } };
    return { status: 200, body: { rev: rec.rev, blob: rec.blob, updatedAt: rec.updatedAt } };
  }
  if (body.op === 'put') {
    if (typeof body.blob !== 'string' || body.blob.length > 4_000_000) {
      return { status: 413, body: { error: 'invalid blob (max 4 MB)' } };
    }
    const baseRev = Number(body.baseRev) || 0;
    const current = await store.get();
    // Write authorization (HMAC proof of vault possession): the first writer
    // registers an authKey (HKDF(vaultKey,'sync-auth')), every later write must
    // carry a valid HMAC over `account.baseRev.blob`. Legacy accounts stay open.
    const authz = await authorizeSyncPut(current, account, baseRev, body.blob, body.auth);
    if (!authz.ok) return { status: authz.status, body: { error: authz.error } };
    const serverRev = current ? current.rev : 0;
    if (serverRev !== baseRev) {
      return { status: 409, body: { conflict: true, serverRev, blob: current ? current.blob : null } };
    }
    const next = { rev: baseRev + 1, blob: body.blob, updatedAt: Date.now() };
    if (authz.authKey) next.authKey = authz.authKey;
    await store.put(next);
    return { status: 200, body: { ok: true, rev: next.rev } };
  }
  return { status: 400, body: { error: 'unknown sync op' } };
}

// Durable Object: one instance per sync account. blockConcurrencyWhile makes
// read-check-write atomic even across the awaits in the HMAC check. On first
// use it adopts an existing KV record so switching from KV loses nothing.
export class SyncRoom {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(request) {
    let body;
    try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 }); }
    // The instance named 'share' keeps the share counters and benchmark.
    if (new URL(request.url).pathname === '/share') {
      let shareOut;
      await this.state.blockConcurrencyWhile(async () => {
        const storage = this.state.storage;
        // First use: adopt the aggregate an older Worker kept in KV.
        if (!(await storage.get('agg')) && this.env && this.env.SYNC) {
          try { const old = await this.env.SYNC.get('share:aggregate', { type: 'json' }); if (old && old.count > 0) await storage.put('agg', old); } catch { /* best effort */ }
        }
        shareOut = await shareRoomOp(storage, body, Date.now());
      });
      return new Response(JSON.stringify(shareOut), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    let out;
    await this.state.blockConcurrencyWhile(async () => {
      const storage = this.state.storage;
      const env = this.env;
      const key = 'sync:' + String(body && body.account || '');
      out = await handleSyncOp({
        get: async () => {
          let rec = await storage.get('rec');
          if (!rec && env && env.SYNC) {
            rec = await env.SYNC.get(key, { type: 'json' });
            if (rec) await storage.put('rec', rec);
          }
          return rec || null;
        },
        put: (rec) => storage.put('rec', rec),
      }, body);
    });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } });
  }
}

const YF_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);
const YF_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);

// Server-side allowlist validation for share snapshots (defense in depth -
// the client redacts before sending, but the server never trusts that).
// Accepts ONLY percentage weights, short labels and bounded scores; rebuilds
// the object field by field so nothing outside the schema can ever be stored.
function validateShareSnapshot(s) {
  const pct = (x) => (typeof x === 'number' && isFinite(x) && x >= 0 && x <= 100) ? Math.round(x * 10) / 10 : null;
  const label = (x) => (typeof x === 'string' && x.length > 0 && x.length <= 40) ? x : null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'not an object' };
  if (s.v !== 1) return { ok: false, error: 'unknown version' };
  const out = { v: 1, assetClasses: {} };
  const CLASSES = ['crypto', 'stocks', 'skins', 'commodities'];
  if (!s.assetClasses || typeof s.assetClasses !== 'object') return { ok: false, error: 'assetClasses missing' };
  let total = 0;
  for (const cls of CLASSES) {
    if (s.assetClasses[cls] == null) continue;
    const p = pct(s.assetClasses[cls]);
    if (p === null) return { ok: false, error: 'bad weight for ' + cls };
    out.assetClasses[cls] = p;
    total += p;
  }
  if (Object.keys(out.assetClasses).length === 0 || total > 101) return { ok: false, error: 'weights implausible' };
  for (const key of ['sectors', 'regions', 'currencies']) {
    if (s[key] == null) continue;
    if (!Array.isArray(s[key]) || s[key].length > 8) return { ok: false, error: key + ' too long' };
    const rows = [];
    for (const row of s[key]) {
      const name = label(row && row.name);
      const p = pct(row && row.pct);
      if (name === null || p === null) return { ok: false, error: 'bad ' + key + ' row' };
      rows.push({ name, pct: p });
    }
    out[key] = rows;
  }
  if (s.metrics != null) {
    if (typeof s.metrics !== 'object') return { ok: false, error: 'bad metrics' };
    const m = {};
    if (s.metrics.healthScore != null) {
      const h = pct(s.metrics.healthScore);
      if (h === null) return { ok: false, error: 'bad healthScore' };
      m.healthScore = Math.round(h);
    }
    if (s.metrics.effectiveN != null) {
      const e2 = numOrNull(s.metrics.effectiveN);
      if (e2 === null || e2 < 0 || e2 > 1000) return { ok: false, error: 'bad effectiveN' };
      m.effectiveN = Math.round(e2 * 10) / 10;
    }
    if (Object.keys(m).length) out.metrics = m;
  }
  return { ok: true, snapshot: out };
}

// MCP read-only resource (WI-9). Re-runs the SAME allowlist validation as the
// share route, so the response can only ever contain percentage weights + scores
// — never amounts, quantities or symbols. Returns null for an invalid/empty
// snapshot (so an expired/garbage record serves nothing). Pure + exported for
// the Node worker test.
export function mcpResource(snapshot, meta) {
  const v = validateShareSnapshot(snapshot);
  if (!v.ok) return null;
  meta = meta || {};
  const s = v.snapshot; // already redacted to the allowlist
  return {
    // Minimal MCP-style resource descriptor over the redacted snapshot.
    protocol: 'mcp',
    type: 'resource',
    resource: {
      uri: 'maermin://portfolio/' + (meta.id || 'shared'),
      name: 'Portfolio allocation (redacted)',
      mimeType: 'application/json',
      description: 'Read-only, redacted portfolio allocation: percentage weights and optional scores only. No amounts, quantities or symbols.'
    },
    data: {
      v: 1,
      assetClasses: s.assetClasses || {},
      sectors: s.sectors || [],
      regions: s.regions || [],
      currencies: s.currencies || [],
      metrics: s.metrics || {}
    },
    publishedAt: meta.at || null,
    readOnly: true
  };
}

// Yahoo quoteSummary fetch. Unlike chart/quote/screener, the quoteSummary API
// intermittently rejects anonymous calls with 401/403 ("Invalid Crumb"); the
// documented workaround is a cookie + crumb handshake. We try the plain call
// first and only do the handshake (cached per isolate) when forced to.
let _yfSession = null; // { cookie, crumb, fetchedAt }
async function getYahooSession() {
  if (_yfSession && Date.now() - _yfSession.fetchedAt < 30 * 60 * 1000) return _yfSession;
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  // fc.yahoo.com 404s but still sets the consent cookie we need.
  const c = await fetchWithTimeout('https://fc.yahoo.com/', { headers });
  const cookie = (c.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('Yahoo session cookie unavailable');
  const cr = await fetchWithTimeout('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...headers, 'Cookie': cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.includes('<')) throw new Error('Yahoo crumb unavailable');
  _yfSession = { cookie, crumb, fetchedAt: Date.now() };
  return _yfSession;
}

async function fetchQuoteSummary(symbol, modules) {
  const base = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=${encodeURIComponent(modules)}`;
  const headers = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':          'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://finance.yahoo.com/',
  };
  let r = await fetchWithTimeout(base, { headers });
  if (r.status === 401 || r.status === 403) {
    const session = await getYahooSession();
    r = await fetchWithTimeout(base + `&crumb=${encodeURIComponent(session.crumb)}`, {
      headers: { ...headers, 'Cookie': session.cookie },
    });
  }
  if (!r.ok) throw new Error(`Yahoo Finance returned ${r.status}`);
  return r.json();
}

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

// Routes whose `symbol` goes to Yahoo Finance.
const SYMBOL_ROUTES = new Set(['yf', 'fundamentals', 'profile', 'earnings', 'fundholdings', 'dividends']);

// Could this be a Yahoo symbol (AAPL, SAP.DE, BRK-B, ^GDAXI, EURUSD=X, GC=F,
// 0700.HK, an ISIN)? Spaces, "|", "★" or "™" mean a CS2 market name. PURE and
// exported for the Node harness; same rule as MaerminTickers.isMarketSymbol.
export function isMarketSymbol(raw) {
  return /^[A-Za-z0-9^][A-Za-z0-9.\-=^_]{0,23}$/.test(String(raw == null ? '' : raw).trim());
}

// Which rate-limit budget a request draws from: the skin price list or
// everything else. PURE, exported for the harness.
export function rateBucket(request, action) {
  return action === 'skinprices' ? 'skins' : 'default';
}

// In-memory sliding-window rate limiter (per worker isolate). Keyed by client
// IP and budget. Best-effort: isolates don't share memory, but this still caps bursts.
const RATE_LIMIT = { windowMs: 60000, max: 120 };
const _rlHits = new Map(); // ip|bucket -> number[] (timestamps)
function isRateLimited(request, bucket) {
  const ip = (request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'anon') + '|' + (bucket || 'default');
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

// Share publishing: per-client limits and benchmark accounting.
// A client is its IP; an IPv6 client is its /64 (one connection gets a whole
// /64). With the SyncRoom Durable Object bound (SYNC_DO) the counters, a
// global daily budget and the benchmark aggregate live in ONE instance named
// 'share', so they hold across isolates and update atomically. Without it the
// same rules apply per isolate (best effort).
const PUBLISH_LIMIT = { windowMs: 3600000, max: 10, maxClients: 5000 };
const SHARE_DAILY_MAX_DEFAULT = 300; // publishes per UTC day (each costs one KV write)
export function shareClientKey(request) {
  const ip = String(request.headers.get('CF-Connecting-IP') || 'anon');
  if (ip.indexOf(':') === -1) return ip;
  const full = ip.split('::');
  const head = full[0] ? full[0].split(':') : [];
  const tail = full.length > 1 && full[1] ? full[1].split(':') : [];
  const groups = full.length > 1 ? head.concat(new Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), tail) : head;
  return groups.slice(0, 4).map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
function utcDay(now) { return new Date(now).toISOString().slice(0, 10); }
// Pure sliding-window check on a Map key -> timestamps. Only expired entries
// are evicted (oldest first beyond the size cap), so a flood of other clients
// can never reset the counters of active ones.
function hitAndCheck(map, key, now, limit) {
  const cutoff = now - limit.windowMs;
  const arr = (map.get(key) || []).filter((t) => t > cutoff);
  arr.push(now);
  map.delete(key); map.set(key, arr); // re-insert: Map order = least recently used first
  if (map.size > limit.maxClients) {
    for (const [k, v] of map) { if (!v.length || v[v.length - 1] <= cutoff) map.delete(k); }
    // Still too many: drop clients below the limit (least recently used
    // first); a client that IS limited stays limited.
    for (const [k, v] of map) { if (map.size <= limit.maxClients) break; if (k !== key && v.length < limit.max) map.delete(k); }
  }
  return arr.length > limit.max;
}
const _pubHits = new Map();
const _contrib = { day: '', keys: new Set() };
function isPublishLimited(request) {
  return hitAndCheck(_pubHits, shareClientKey(request), Date.now(), PUBLISH_LIMIT);
}
// One benchmark contribution per client and UTC day (per isolate without SYNC_DO).
function takeContribution(key, now) {
  const day = utcDay(now);
  if (_contrib.day !== day) { _contrib.day = day; _contrib.keys = new Set(); }
  if (_contrib.keys.has(key)) return false;
  _contrib.keys.add(key);
  return true;
}
// Daily publish budget per isolate (without SYNC_DO).
const _budget = { day: '', n: 0 };
function isDailyBudgetSpent(env) {
  const day = utcDay(Date.now());
  if (_budget.day !== day) { _budget.day = day; _budget.n = 0; }
  const max = Number(env && env.SHARE_DAILY_MAX) > 0 ? Number(env.SHARE_DAILY_MAX) : SHARE_DAILY_MAX_DEFAULT;
  if (_budget.n >= max) return true;
  _budget.n += 1;
  return false;
}
// Test helpers (the in-memory state is per isolate).
export function resetShareLimits() { _pubHits.clear(); _contrib.day = ''; _contrib.keys = new Set(); _budget.day = ''; _budget.n = 0; }
export function notePublishForTest(ip) { hitAndCheck(_pubHits, shareClientKey(new Request('https://x/', { headers: { 'CF-Connecting-IP': ip } })), Date.now(), PUBLISH_LIMIT); }

// The 'share' SyncRoom instance: atomic counters + benchmark aggregate.
// ops: { op:'publish', key, classes, dailyMax } -> { ok } | { limited, reason }
//      { op:'aggregate' } -> { count, sums }
async function shareRoomOp(storage, body, now) {
  if (body.op === 'aggregate') return (await storage.get('agg')) || { count: 0, sums: {} };
  if (body.op !== 'publish') return { error: 'unknown op' };
  const day = utcDay(now);
  const budget = (await storage.get('budget')) || { day, n: 0 };
  if (budget.day !== day) { budget.day = day; budget.n = 0; }
  const dailyMax = Number(body.dailyMax) > 0 ? Number(body.dailyMax) : SHARE_DAILY_MAX_DEFAULT;
  if (budget.n >= dailyMax) return { limited: true, reason: 'daily' };
  const hits = new Map(Object.entries((await storage.get('hits')) || {}));
  if (hitAndCheck(hits, String(body.key), now, PUBLISH_LIMIT)) {
    await storage.put('hits', Object.fromEntries(hits));
    return { limited: true, reason: 'client' };
  }
  budget.n += 1;
  const contrib = (await storage.get('contrib')) || { day, keys: {} };
  if (contrib.day !== day) { contrib.day = day; contrib.keys = {}; }
  if (!contrib.keys[body.key]) {
    contrib.keys[body.key] = 1;
    const agg = (await storage.get('agg')) || { count: 0, sums: {} };
    agg.count += 1;
    for (const [cls, pct] of Object.entries(body.classes || {})) agg.sums[cls] = (agg.sums[cls] || 0) + pct;
    await storage.put('agg', agg);
  }
  await storage.put('budget', budget);
  await storage.put('hits', Object.fromEntries(hits));
  await storage.put('contrib', contrib);
  return { ok: true };
}

// Origin allowlist. EXACT origins only: the old wildcard patterns
// (*.github.io, *.pages.dev, *.workers.dev) let anyone with a free page on
// those platforms read this Worker's responses. Defaults cover the official
// app + local development; set the ALLOWED_ORIGINS variable (comma separated)
// to add your own domain. 'null' is the origin of index.html opened locally
// (file://) - set ALLOW_NULL_ORIGIN = "false" if you only use the hosted app.
// A request with NO Origin header (curl / same-origin) gets '*'. CORS only
// gates what a browser may READ; write endpoints are protected server-side.
const DEFAULT_ORIGINS = ['https://maermin.github.io'];
let _originCfg = { list: DEFAULT_ORIGINS, allowNull: true };
export function configureOrigins(env) {
  const extra = String((env && env.ALLOWED_ORIGINS) || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  _originCfg = {
    list: DEFAULT_ORIGINS.concat(extra),
    allowNull: !(env && String(env.ALLOW_NULL_ORIGIN).toLowerCase() === 'false'),
  };
}
export function allowOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return '*';
  if (o === 'null') return _originCfg.allowNull ? 'null' : '';
  if (_originCfg.list.includes(o)) return o;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return o;
  return '';
}

// CS2 price file (CSGO Trader, Steam Market prices) and how long a copy is used.
const SKIN_PRICES_URL = 'https://prices.csgotrader.app/latest/steam.json';
const SKIN_PRICES_FRESH_MS = 60 * 60 * 1000;

// Where the last price file is kept: the KV namespace bound as SYNC when there
// is one (the edge cache does not keep anything for Workers on a workers.dev
// address), else the edge cache. Streamed in and out, never parsed.
// get() -> { response, fetchedAt } | null.
function skinPriceStore(env) {
  const KV_KEY = 'skinprices:steam-usd';
  if (env && env.SYNC && typeof env.SYNC.put === 'function') {
    return {
      async get() {
        const r = await env.SYNC.getWithMetadata(KV_KEY, { type: 'stream' });
        if (!r || !r.value) return null;
        return { response: new Response(r.value), fetchedAt: Number((r.metadata && r.metadata.fetchedAt) || 0) };
      },
      put: (stream, fetchedAt) => env.SYNC.put(KV_KEY, stream, { metadata: { fetchedAt }, expirationTtl: 3 * 86400 }),
    };
  }
  const key = new Request('https://cache.maermin/skinprices/steam-usd');
  return {
    async get() {
      const hit = await caches.default.match(key);
      return hit ? { response: hit, fetchedAt: Number(hit.headers.get('X-Fetched-At') || 0) } : null;
    },
    put: (stream, fetchedAt) => caches.default.put(key, new Response(stream, {
      headers: { 'Content-Type': 'application/json', 'X-Fetched-At': String(fetchedAt), 'Cache-Control': 'public, max-age=259200' },
    })),
  };
}

// Stream a cached/upstream Response to the client with the CORS headers of
// res(), without reading the body (the price file is never parsed here).
function passThrough(upstream, request, stale, fetchedAt) {
  const origin = allowOrigin(request);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Expose-Headers': 'X-Fetched-At, X-Stale',
      'Vary':         'Origin',
      'Content-Type': 'application/json',
      'X-Fetched-At': String(fetchedAt || Date.now()),
      ...(stale ? { 'X-Stale': '1' } : {}),
    },
  });
}

function res(body, status, request) {
  const origin = allowOrigin(request);
  return new Response(body, {
    status,
    headers: {
      // An empty value is not a valid ACAO -> the browser blocks the read.
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary':         'Origin',
      'Content-Type': 'application/json',
    },
  });
}
