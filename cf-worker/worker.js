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

        // Write authorization (HMAC proof of vault possession). The blob is
        // already zero-knowledge ciphertext, but writes used to be open: anyone
        // who learned the opaque account id could overwrite/wipe a vault. The
        // first writer registers an authKey (HKDF(vaultKey,'sync-auth'),
        // independent of the data key) and every later write must carry a valid
        // HMAC over `account.baseRev.blob`. Legacy accounts (no key) stay open.
        const authz = await authorizeSyncPut(current, account, baseRev, body.blob, body.auth);
        if (!authz.ok) return res(JSON.stringify({ error: authz.error }), authz.status, request);

        const serverRev = current ? current.rev : 0;
        if (serverRev !== baseRev) {
          // Conflict: caller's base is stale — hand back the server record to merge.
          return res(JSON.stringify({ conflict: true, serverRev, blob: current ? current.blob : null }), 409, request);
        }
        const next = { rev: baseRev + 1, blob: body.blob, updatedAt: Date.now() };
        if (authz.authKey) next.authKey = authz.authKey;
        await env.SYNC.put(key, JSON.stringify(next));
        return res(JSON.stringify({ ok: true, rev: next.rev }), 200, request);
      }

      return res(JSON.stringify({ error: 'unknown sync op' }), 400, request);
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
        const v = validateShareSnapshot(body.snapshot);
        if (!v.ok) return res(JSON.stringify({ error: 'invalid snapshot: ' + v.error }), 400, request);
        const id = [...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(16).padStart(2, '0')).join('');
        await env.SYNC.put('share:' + id, JSON.stringify({ snapshot: v.snapshot, at: Date.now() }), { expirationTtl: 90 * 86400 });
        // Best-effort rolling aggregate (count + per-class weight sums only).
        try {
          const agg = (await env.SYNC.get('share:aggregate', { type: 'json' })) || { count: 0, sums: {} };
          agg.count += 1;
          for (const [cls, pct] of Object.entries(v.snapshot.assetClasses || {})) {
            agg.sums[cls] = (agg.sums[cls] || 0) + pct;
          }
          await env.SYNC.put('share:aggregate', JSON.stringify(agg));
        } catch { /* aggregate is best-effort */ }
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
        const agg = (await env.SYNC.get('share:aggregate', { type: 'json' })) || { count: 0, sums: {} };
        const avg = {};
        if (agg.count > 0) {
          for (const [cls, sum] of Object.entries(agg.sums)) avg[cls] = Math.round((sum / agg.count) * 10) / 10;
        }
        return res(JSON.stringify({ count: agg.count, avgAssetClasses: avg }), 200, request);
      }

      return res(JSON.stringify({ error: 'unknown share op' }), 400, request);
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

    // ── Steam Market Price History ────────────────────────────────────────
    // GET /?action=steamhistory&name=AK-47+|+Redline+(Field-Tested)
    // Primary: the listing page embeds the price graph as "var line1" for
    // anonymous visitors. KNOWN GAP (diagnosed 2026-06): Steam REDIRECTS some
    // items (notably Souvenir skins) to a grouped item page WITHOUT line1, so
    // the scrape legitimately finds nothing there - that case is detected
    // explicitly (parseSteamLine1.found) instead of being treated like an
    // error. Fallback: priceoverview (current price as a 2-point line) with a
    // small backoff retry because Steam rate-limits it aggressively (429) for
    // datacenter IPs. CONTRACT: prices are USD (currency=1 everywhere); the
    // response says so honestly and the client converts (MaerminUtils.toEUR).
    if (request.method === 'GET' && action === 'steamhistory') {
      const name = url.searchParams.get('name') || '';
      if (!name) return res(JSON.stringify({ error: 'name required' }), 400, request);

      const cacheKey = new Request(`https://cache.maermin/steamhist3/${encodeURIComponent(name)}`);
      const cache    = caches.default;
      const cached   = await cache.match(cacheKey);
      if (cached) return res(await cached.text(), 200, request);

      let prices = [];
      let source = null;
      let note = null;

      // ── Primary: scrape the listing page HTML ─────────────────────────────
      try {
        const listingUrl = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
        const r = await fetchWithTimeout(listingUrl, {
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        }, 12000);

        if (r.ok) {
          const parsed = parseSteamLine1(await r.text());
          if (parsed.found && parsed.prices.length) {
            prices = parsed.prices;
            source = 'listing';
          } else if (!parsed.found) {
            // Grouped/redirected page or layout change - not an error per se.
            note = 'listing page has no price graph (grouped item page)';
            console.log(`[STEAM] no line1 for ${name} - falling back to priceoverview`);
          } else {
            note = 'price graph present but empty';
          }
        }
      } catch(e) {
        console.warn('[STEAM] Listing page scrape failed:', e.message);
      }

      // ── Fallback: current price from priceoverview (no auth, no history). ──
      // Retried once after a short pause on 429 - Steam throttles this endpoint
      // hard for datacenter IPs, which is exactly why Souvenir positions ended
      // up with "No price data" despite a live market.
      if (prices.length === 0) {
        const price = await fetchSteamOverviewPrice(name);
        if (price > 0) {
          const now = Math.floor(Date.now() / 1000);
          prices = [
            { ts: now - 86400 * 90, date: new Date((now - 86400 * 90) * 1000).toISOString().split('T')[0], price },
            { ts: now,              date: new Date(now * 1000).toISOString().split('T')[0],                 price },
          ];
          source = 'overview';
          console.log(`[STEAM] priceoverview fallback: ${name} → ${price}`);
        }
      }

      if (prices.length === 0) {
        return res(JSON.stringify({ error: 'No price data', prices: [], note }), 200, request);
      }

      // v10.x: seed the bulk price-lookup cache (POST /) with the current price
      // (the latest point). The chart resolves a skin's price here first; sharing
      // it means the price POST fills its map from cache instead of re-hitting
      // Steam's priceoverview, which 429-throttles the whole batch ("no price").
      try {
        const cur = prices[prices.length - 1] && prices[prices.length - 1].price;
        if (cur > 0) ctx.waitUntil(cache.put(
          new Request(`https://cache.maermin/steamprice/${encodeURIComponent(name)}`),
          new Response(String(cur), { headers: { 'Cache-Control': 'public, max-age=21600' } })));
      } catch (e) { /* cache seed is best-effort */ }

      const payload = JSON.stringify({ prices, currency: 'USD', source, note });
      // Cache: real history 4h; an overview-only 2-point line just 10 min so a
      // throttled phase does not pin a flat line for hours.
      const ttl = source === 'listing' ? 14400 : 600;
      ctx.waitUntil(cache.put(cacheKey, new Response(payload, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` }
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
      // Per-skin edge cache (30 min). Steam 429-throttles priceoverview hard for
      // datacenter (Cloudflare) IPs, so a freshly resolved price is precious:
      // cache each one and only hit Steam for the misses. This both fills more
      // of the map and shrinks the burst that triggers the throttling.
      const cache = caches.default;
      const priceKey = (n) => new Request(`https://cache.maermin/steamprice/${encodeURIComponent(n)}`);
      // Skin prices move slowly; a resolved price is precious because Steam
      // 429-throttles the Worker's Cloudflare IP. Cache for 6h so a daily user's
      // map stays filled and we only hit Steam for genuinely new/expired skins.
      const STEAM_PRICE_TTL = 21600;

      const toFetch = [];
      await Promise.all(names.map(async (name) => {
        if (!name || typeof name !== 'string') return;
        const trimmed = name.trim();
        const hit = await cache.match(priceKey(trimmed));
        if (hit) {
          const p = parseFloat(await hit.text());
          if (p > 0) { results[name] = p; return; }
        }
        // v10.x: before re-hitting Steam, reuse the chart's history cache
        // (steamhist3) — it resolves a skin's current price first and shares the
        // same normalised name, so this fills the map without a second Steam
        // burst (which is what 429s the batch into an empty "no price" result).
        try {
          const histHit = await cache.match(new Request(`https://cache.maermin/steamhist3/${encodeURIComponent(trimmed)}`));
          if (histHit) {
            const j = JSON.parse(await histHit.text());
            const pts = j && j.prices;
            const last = (pts && pts.length) ? pts[pts.length - 1].price : 0;
            if (last > 0) {
              results[name] = last;
              ctx.waitUntil(cache.put(priceKey(trimmed), new Response(String(last), { headers: { 'Cache-Control': `public, max-age=${STEAM_PRICE_TTL}` } })));
              return;
            }
          }
        } catch (e) { /* fall through to a fresh fetch */ }
        toFetch.push(name);
      }));

      // Fetch the cache misses in small concurrent batches instead of
      // one-at-a-time-with-1.5s-sleep (which took up to 45s for 30 skins).
      // Smaller batches + a longer gap keep us under Steam's burst limit, which
      // 429s a wide concurrent fan-out and returns an empty map ("no price").
      const BATCH = 3, GAP_MS = 700;
      const fetchOne = async (name) => {
        // Same robust overview path as steamhistory: shared parsing (handles
        // lowest_price-only Souvenir responses) + one backoff retry on 429.
        const price = await fetchSteamOverviewPrice(name.trim());
        if (price > 0) {
          results[name] = price;
          ctx.waitUntil(cache.put(priceKey(name.trim()), new Response(String(price), {
            headers: { 'Cache-Control': `public, max-age=${STEAM_PRICE_TTL}` },
          })));
        }
      };
      for (let i = 0; i < toFetch.length; i += BATCH) {
        await Promise.all(toFetch.slice(i, i + BATCH).map(fetchOne));
        if (i + BATCH < toFetch.length) await sleep(GAP_MS);
      }

      return res(JSON.stringify(results), 200, request);
    }

    return res(JSON.stringify({ error: 'Unknown action' }), 400, request);
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// Parse the "var line1" price graph embedded in a Steam listing page.
// PURE and exported for the Node harness (test/steam-history.test.js).
// Returns { found, prices }:
//   found:false             - the page has no line1 at all (grouped/redirected
//                             item page, e.g. Souvenir skins, or layout change)
//   found:true, prices:[]   - a graph variable exists but holds no usable rows
//   found:true, prices:[..] - [{ts, date, price(USD)}] sorted ascending
export function parseSteamLine1(html) {
  const text = String(html || '');
  // Tolerate an empty array too: /\[.*?\]/ instead of the old /\[\[.+?\]\]/,
  // which silently failed to match "var line1=[];" on sparse items.
  const match = text.match(/var line1\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return { found: false, prices: [] };
  let raw;
  try { raw = JSON.parse(match[1]); } catch { return { found: true, prices: [] }; }
  if (!Array.isArray(raw)) return { found: true, prices: [] };
  const prices = raw.map((row) => {
    if (!Array.isArray(row) || row.length < 2) return null;
    // Row: ["Dec 01 2021 01: +0", "12.50", "3"] - strip the hour suffix.
    const clean = String(row[0]).replace(/\s+\d+:\s+\+0$/, '').trim();
    const d = new Date(clean + ' UTC');
    if (isNaN(d.getTime())) return null;
    const price = parseFloat(row[1]) || 0;
    return price > 0 ? { ts: Math.floor(d.getTime() / 1000), date: d.toISOString().split('T')[0], price } : null;
  }).filter(Boolean).sort((a, b) => a.ts - b.ts);
  return { found: true, prices };
}

// Parse a priceoverview JSON body into a USD price. PURE and exported.
// Handles the real-world shapes: lowest_price only (Souvenir items often have
// no median_price), median_price only, both, or neither.
export function parseSteamOverview(body) {
  if (!body || body.success !== true) return 0;
  const raw = body.lowest_price || body.median_price || '';
  // Disambiguate the separator. With currency=1 Steam sends USD "$1,113.00"
  // where the comma is a THOUSANDS separator - the old `.replace(',', '.')`
  // turned that into 1.113 (off by 1000x, which is why pricey knives broke).
  // Still tolerate EU-format "12,34" (comma = decimal) for robustness.
  let s = String(raw).replace(/[^0-9.,]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '');                          // both -> comma is thousands
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.')     // trailing ,dd -> decimal
                            : s.replace(/,/g, '');      // otherwise thousands
  }
  const price = parseFloat(s);
  return (isFinite(price) && price > 0) ? price : 0;
}

// Lowest current ASK (USD) from the Steam listings *render* endpoint. PURE and
// exported. This is the fallback for ILLIQUID items (expensive knives, Doppler
// phases) where priceoverview returns nothing because there were no recent
// SALES — but there are active LISTINGS, whose asks live in `listinginfo`
// (converted_price + converted_fee, in integer cents at currency=1).
export function parseSteamListingRender(body) {
  if (!body || body.success !== true || !body.listinginfo || typeof body.listinginfo !== 'object') return 0;
  let lowest = 0;
  for (const id of Object.keys(body.listinginfo)) {
    const li = body.listinginfo[id];
    if (!li) continue;
    const cents = (parseInt(li.converted_price, 10) || 0) + (parseInt(li.converted_fee, 10) || 0);
    if (cents > 0) { const usd = cents / 100; if (lowest === 0 || usd < lowest) lowest = usd; }
  }
  return lowest;
}

// priceoverview with escalating backoff on 429/5xx - Steam throttles this
// endpoint aggressively for datacenter IPs.
async function fetchPriceOverviewOnly(name) {
  const ovUrl = `https://steamcommunity.com/market/priceoverview/` +
    `?appid=730&currency=1&market_hash_name=${encodeURIComponent(name)}`;
  const BACKOFF = [900, 2000];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(ovUrl, { headers: steamHeaders() });
      if (r.status === 429 || r.status >= 500) {
        if (attempt < BACKOFF.length) { await sleep(BACKOFF[attempt]); continue; }
        return 0;
      }
      if (!r.ok) return 0;
      return parseSteamOverview(await r.json());
    } catch {
      if (attempt < BACKOFF.length) { await sleep(400 * (attempt + 1)); continue; }
      return 0;
    }
  }
  return 0;
}

// Lowest current ask from the listings render endpoint (one backoff retry).
async function fetchSteamListingPrice(name) {
  const url = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}/render/` +
    `?start=0&count=10&currency=1&language=english&format=json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchWithTimeout(url, { headers: steamHeaders() }, 12000);
      if (r.status === 429 || r.status >= 500) { if (attempt < 1) { await sleep(1200); continue; } return 0; }
      if (!r.ok) return 0;
      return parseSteamListingRender(await r.json());
    } catch {
      if (attempt < 1) { await sleep(500); continue; }
      return 0;
    }
  }
  return 0;
}

// Best current USD price for a skin: priceoverview (recent sales) first, then
// the listings render endpoint (current lowest ask) for illiquid items that
// have no recent sales. Both callers (steamhistory fallback + POST) use this.
async function fetchSteamOverviewPrice(name) {
  const ov = await fetchPriceOverviewOnly(name);
  if (ov > 0) return ov;
  return await fetchSteamListingPrice(name);
}

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

// Origin allowlist — stops arbitrary third-party websites from using this open
// proxy / sync endpoint (abuse drives up Worker cost and gets the Worker's
// Cloudflare IP rate-limited/banned by Yahoo & Steam, which then breaks the app
// for everyone). Matches the deploy targets MAERMIN actually uses; add your
// custom domain here. A request with NO Origin header (curl / same-origin) is
// allowed; a browser request from a non-listed Origin gets 'null' (blocked).
const ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.github\.io$/i,
  /^https:\/\/([a-z0-9-]+\.)*pages\.dev$/i,
  /^https:\/\/([a-z0-9-]+\.)*workers\.dev$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];
function allowOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return '*';
  return ORIGIN_PATTERNS.some((re) => re.test(o)) ? o : 'null';
}

function res(body, status, request) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin':  allowOrigin(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary':         'Origin',
      'Content-Type': 'application/json',
    },
  });
}
