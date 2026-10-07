# MAERMIN — Cloudflare Worker API

`cf-worker/worker.js` is a stateless proxy that gives the browser CORS-friendly
access to market data, plus two optional features (encrypted sync, broker relay).
It stores nothing except the opt-in sync blob (in a KV namespace you bind).

**Base URL:** your deployed Worker (e.g. `https://maermin.<you>.workers.dev`).
Configure it in the app under **API Settings → Cloudflare Worker**.

## Cross-cutting behaviour

- **CORS:** exact-origin allowlist (`https://maermin.github.io`, localhost, the desktop app's `null` origin) plus anything in the `ALLOWED_ORIGINS` variable (comma separated). Other browser origins get no `Access-Control-Allow-Origin`. `Vary: Origin`.
- **Sync storage:** bind the `SyncRoom` Durable Object as `SYNC_DO` (see `wrangler.toml`) for atomic revision checks; a KV namespace `SYNC` alone still works but is eventually consistent. Blobs over 4 MB are rejected with `413`.
- **Share publishing:** throttled to 10 publishes per hour per IP.
- **Rate limiting:** per-IP sliding window (default 120 req/min) → `429` when exceeded. The skin price list (`skinprices`) has its own 120 req/min budget, so a burst of stock or chart requests cannot block skin prices.
- **Symbol check:** the Yahoo routes (`yf`, `fundamentals`, `profile`, `earnings`, `fundholdings`) only take market symbols (`AAPL`, `SAP.DE`, `BRK-B`, `^GDAXI`, `EURUSD=X`, `GC=F`, ISINs). Anything else — e.g. a CS2 item name like `AK-47 | Redline (Field-Tested)` — gets `400 {"error":"not a market symbol"}` straight away, without an upstream call and without counting against the rate limit.
- **Timeouts:** every upstream `fetch` is wrapped with an 8s abort.
- **Caching:** Yahoo search/history responses are cached (`caches.default`, 5 min–1 h).

---

## Version

### `GET /?action=version`
`200 { "version": "2026.10.1", "actions": ["yf", "yfsearch", …] }`. No upstream call and no rate limit.
`WORKER_VERSION` in `worker.js` and `EXPECTED_WORKER_VERSION` in `onboarding.js` name the same release
(`test/worker-version.test.js` enforces it); bump both when the app starts to rely on a Worker change.
The app checks the version once per Worker URL (and when API Settings opens or closes). An older Worker,
or one from before this route (it answers `400 Unknown action`), shows "Worker outdated → update".

---

## Market data

### `GET /?action=yf&symbol=AAPL&interval=1d&range=1y`
Yahoo Finance historical candles. `interval` ∈ `1m…1mo`, `range` ∈ `1d…max`.

### `GET /?action=cg&p=<endpoint>&…`
CoinGecko, so the browser never calls it (CoinGecko limits per IP and answers a
429 without CORS headers). Allowed endpoints and parameters:
`simple/price` (`ids`, `vs_currencies`, `include_24hr_change`; cached 60 s),
`search` (`query`; 1 day), `coins/<id>/market_chart` (`vs_currency`, `days`,
`interval`; 1 h), `coins/<id>/market_chart/range` (`vs_currency`, `from`, `to`; 1 h).
A 404 (unknown coin) is remembered for a day. On a 429 or upstream error the last
good answer (kept 2 days) is served with `X-Stale: 1`. Optional secret
`COINGECKO_API_KEY` (a free CoinGecko demo key) is sent as `x-cg-demo-api-key`.

`?action=yf` remembers a symbol Yahoo does not know for 6 h (`404`, `cached: true`).

### `GET /?action=yfsearch&q=Apple&type=stock`
Symbol search. `type` = `stock` (EQUITY/ETF/MUTUALFUND) or `crypto`. Returns
`[{symbol, name, exchange, type, score}]`.

### `GET /?action=screener&scrId=day_gainers&count=25`  /  `GET /?action=screener&symbols=KO,PG`
Discovery screener, two modes with one normalised output shape: `scrId=` proxies
a Yahoo predefined screener (top movers / categories), `symbols=` is a batch
quote (curated dividend universe). Returns `{ scrId, symbols, quotes: [{symbol,
name, price, currency, changePercent, marketCap, dividendYield, type, exchange,
volume}] }`. `dividendYield` is a fraction (0.025 = 2.5%). Cached 2 min.

### `GET /?action=fundholdings&symbol=VWCE.DE`
ETF/fund look-through. Proxies Yahoo Finance `quoteSummary` (modules
`topHoldings`, `fundProfile`, `price`) and normalises it for the client's
look-through engine:

```jsonc
{
  "symbol": "VWCE.DE",
  "name": "Vanguard FTSE All-World UCITS ETF",
  "type": "ETF",
  "fund": true,                 // false = no holdings data (e.g. a plain stock)
  "ter": 0.0022,                // expense ratio, fraction; null if unknown
  "holdings": [{ "symbol": "AAPL", "name": "Apple Inc", "weight": 0.041 }],
  "sectors":  [{ "sector": "Technology", "weight": 0.25 }]
}
```

`weight`/`ter` are fractions. `fund:false` is a valid answer, not an error.
Holdings change slowly → cached 24 h. quoteSummary occasionally demands Yahoo's
cookie+crumb handshake; the Worker retries once with a cached session. The
client degrades to a built-in snapshot of common ETFs when this route is
missing (older Worker → `400 {"error":"Unknown action"}`).

### `GET /?action=fundamentals&symbol=KO`
Dividend-safety fundamentals. Proxies Yahoo Finance `quoteSummary` (modules
`summaryDetail`, `defaultKeyStatistics`, `price`) and normalises the numbers
the dividend quality scoring needs:

```jsonc
{
  "symbol": "KO",
  "name": "The Coca-Cola Company",
  "currency": "USD",
  "price": 60.12,
  "marketCap": 258000000000,            // in `currency`; client EUR-normalises (WI-5 size buckets)
  "dividendRate": 1.94,                 // annual dividend per share
  "dividendYield": 0.032,               // fraction
  "fiveYearAvgDividendYield": 0.031,    // fraction (normalised from Yahoo's percent)
  "payoutRatio": 0.74,                  // fraction
  "trailingEps": 2.61,
  "forwardEps": 2.95,
  "exDividendDate": "2026-09-15",       // ISO; next/last ex-date
  "dividendDate": "2026-10-01",         // ISO; pay date
  "lastDividendValue": 0.485            // last single payment → infer frequency
}
```

Nulls mean Yahoo has no value — the client falls back to its history-based
heuristic. `marketCap` (in the security's own `currency`) additionally powers the
Strategy tab's **Company-size buckets** (`MaerminMarketCap`): the client
EUR-normalises it and bins Large (>= 10 bn) / Mid (2-10 bn) / Small (< 2 bn) /
Unknown. Cached 6 h; same cookie+crumb retry and degradation contract as
`fundholdings`. The dividend date/value fields feed the **Dividend Calendar &
Forecast** (`DividendDataService.fetchDividendFromWorker`) so any payer resolves
without an FMP key; frequency is inferred from `dividendRate / lastDividendValue`.

### `GET /?action=profile&symbol=AAPL`
Equity sector / industry / country for a holding — powers the Strategy tab's
Sector & Country allocation **without a user FMP key** (Yahoo is already the
stock-price source). Proxies Yahoo Finance `quoteSummary` (`assetProfile`,
`price`):

```jsonc
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "currency": "USD",
  "sector": "Technology",                // Yahoo taxonomy; client normalises to GICS labels
  "industry": "Consumer Electronics",
  "country": "United States"             // client maps to "USA" etc.
}
```

Metadata is near-static → cached 30 days. Nulls mean Yahoo has no value; the
client keeps the static-map / "Other" fallback. `MaerminEquityMeta` normalises
Yahoo's "Financial Services"→"Financials", "United States"→"USA", etc.

### `GET /?action=earnings&symbol=AAPL`
Next earnings date and consensus estimates for the **Earnings Calendar** in the
Dividends view. Proxies Yahoo Finance `quoteSummary` (`calendarEvents`,
`price`), same cookie+crumb retry as the other `quoteSummary` routes:

```jsonc
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "currency": "USD",
  "earningsDate": "2026-10-29",      // ISO; next (or estimated) report date
  "earningsDateEnd": null,           // set when Yahoo only gives a date range
  "isEstimate": false,               // true for a range = not yet confirmed
  "epsEstimate": 1.78, "epsLow": 1.70, "epsHigh": 1.85,
  "revenueEstimate": 101200000000    // in `currency`
}
```

Cached 6 h. Nulls mean Yahoo has no value; `404` when Yahoo returns nothing.

### `GET /?action=news&symbol=AAPL`
Yahoo Finance RSS headlines for one symbol (the **News Feed** view parses the
XML client-side and sanitises every link through `MaerminUtils.safeUrl`).
Returns the RSS XML as-is; an upstream error yields an empty `<rss>` channel,
not an HTTP error. Cached 15 min.

### `GET /?action=skinprices`
CS2 skin prices for every item in ONE request: CSGO Trader's daily Steam Market price file
(`https://prices.csgotrader.app/latest/steam.json`, Amazon S3/CloudFront):
`{ "<market_hash_name>": { last_24h, last_7d, last_30d, last_90d } }` (USD, ~34k items, ~4 MB).
Steam and Skinport block or throttle requests from Cloudflare Workers, so neither is asked
directly. The body is **streamed through unparsed** (the free plan's CPU budget); the app parses
it — price = 24 h average, else 7 / 30 / 90 days; the four averages also draw the CS2 trend in
the history chart. The last file is kept for an hour — in the KV namespace bound as `SYNC` when
there is one (key `skinprices:steam-usd`, 3-day TTL; the edge cache does not keep anything for
Workers on a `workers.dev` address), else in the edge cache. When the source fails, the last
good copy is served with `X-Stale: 1`; without one → `502 {"error":"Skin prices unavailable: …"}`.
`X-Fetched-At` carries the copy's age. Binding a KV namespace as `SYNC` is recommended.
**Contract:** all skin prices are USD; the client converts USD→EUR.

---

## Steam inventory (optional)

### `GET /?action=steaminv&profile=<SteamID64 | profile URL | custom URL name>`
Reads a **public** CS2 inventory without a key: a custom URL name is resolved through the profile's
XML (`steamcommunity.com/id/<name>/?xml=1`), then up to 5 pages of 2,000 items
(`/inventory/<id>/730/2`) are joined with their descriptions.
`200 { "steamid": "7656…", "items": [{ "assetid", "name" (market_hash_name), "marketable" }] }`.
Errors: `400` not a profile, `404` unknown custom URL, `403` private inventory, `429` Steam rate limit
(passed on — Steam throttles cloud IPs; the app then offers to paste the inventory JSON), `502` other.
Only `steamcommunity.com` is asked, with a validated id or name. Own rate-limit budget (`steam`).

## Encrypted cloud sync (optional)

Requires a KV namespace bound as `env.SYNC`. Zero-knowledge: the server only sees
an opaque account id (a hash derived client-side from the vault key) and an
AES-256-GCM ciphertext blob.

### `POST /?action=sync`
```jsonc
// get
{ "op": "get", "account": "<hex 8-64>" }
// → { "rev": <n>, "blob": "<ciphertext|null>", "updatedAt": <ms> }

// put (optimistic concurrency)
{ "op": "put", "account": "<hex>", "baseRev": <n>, "blob": "<ciphertext ≤4MB>" }
// → { "ok": true, "rev": <n+1> }
// → 409 { "conflict": true, "serverRev": <n>, "blob": "<current>" }  // stale baseRev
```

### `POST /?action=share`
Privacy-preserving share snapshots + anonymous benchmark. Requires the same KV
namespace as sync (`env.SYNC`). Stores ONLY redacted snapshots - percentage
weights and bounded scores, validated server-side against a hard allowlist
(`validateShareSnapshot`) in addition to the client-side redaction. Random id,
no account, no PII, 90-day TTL.

```jsonc
// publish
{ "op": "publish", "snapshot": { "v": 1, "assetClasses": { "stocks": 60.0, "crypto": 40.0 },
  "sectors": [{ "name": "Technology", "pct": 35.0 }], "metrics": { "healthScore": 82 } } }
// -> { "ok": true, "id": "<hex>" }   (400 on any field outside the allowlist)

// get
{ "op": "get", "id": "<hex>" }
// -> { "snapshot": {...}, "at": <ms> }

// aggregate (anonymous benchmark)
{ "op": "aggregate" }
// -> { "count": <n>, "avgAssetClasses": { "stocks": 55.3, ... } }
```

The aggregate is a running count+sum of asset-class weights only - individual
snapshots are never exposed through it.

**Limits.** Publishing is limited per client (10 per hour; an IPv6 client is
its /64) and per UTC day (`SHARE_DAILY_MAX`, default 300, set it under `[vars]`
to change it). Each client counts once per day in the aggregate; further
publishes still get a link. With the `SyncRoom` Durable Object bound as
`SYNC_DO` (recommended, see `wrangler.toml`), the counters and the aggregate
live in one Durable Object instance named `share`: they hold across Worker
isolates, update atomically, and a publish costs one KV write instead of two.
An aggregate kept in KV by an older Worker is adopted on first use. Without
`SYNC_DO` the same limits apply per isolate.

### `GET /?action=mcp&id=<shareId>`
MCP-compatible **read-only** view over the exact same redacted share snapshot
(WI-9). Same opt-in, time-limited link as `action=share`: an expired/unknown id
is dead (`404`). The stored snapshot is **re-validated through the same allowlist
on the way out** (`mcpResource` → `validateShareSnapshot`), so the response can
only ever contain percentage weights by asset class / sector / region / currency
plus optional bounded scores - **never amounts, quantities or symbols**.

```jsonc
// -> { "protocol": "mcp", "type": "resource", "readOnly": true,
//      "resource": { "uri": "maermin://portfolio/<id>", "name": "...", "mimeType": "application/json" },
//      "data": { "v": 1, "assetClasses": {...}, "sectors": [...], "regions": [...],
//                "currencies": [...], "metrics": { "healthScore": 82 } },
//      "publishedAt": <ms> }
```

An AI client points at this URL to read the redacted allocation/scores only;
nothing outside the allowlist is ever reachable. Tested in
`test/mcp-endpoint.test.js` (allowlist-only output, leak proof, dead expired id).

---

## Broker relay (optional)

### `POST /?action=brokerproxy`
Relays a **client-signed** request to a whitelisted exchange host, to bypass the
exchange's missing CORS headers. The API **secret never leaves the browser** —
only the signature the client already computed is sent.

```jsonc
{ "method": "GET", "url": "https://api.binance.com/...", "headers": { ... }, "body": "" }
// → { "status": <n>, "ok": <bool>, "data": <parsed|text> }
```

The relay is **read-only on the server side** (`BROKER_RELAY_POLICY` /
`brokerRelayAllowed`): each host has an explicit list of read endpoints and
methods, everything else → `403` (HTTPS only):

| Host | Method | Paths |
|---|---|---|
| `api.binance.com` | GET | `/api/v3/account`, `/api/v3/myTrades`, `/sapi/v1/account/apiRestrictions` |
| `api.bitpanda.com` | GET | `/v1/trades`, `/v1/wallets`, `/v1/fiatwallets`, `/v1/asset-wallets` |
| `api.kraken.com` | POST | `/0/private/TradesHistory`, `/0/private/Ledgers`, `/0/private/Balance` |
| `api.exchange.coinbase.com` | GET | `/fills`, `/accounts` |
| `api.coinbase.com` | GET | `/api/v3/brokerage/orders/historical/fills`, `/api/v3/brokerage/accounts`, `/v2/accounts` |

Order, trade, transfer and withdrawal endpoints can therefore never be relayed,
even with a signature produced outside the app.

Used by the **read-only exchange sync** (`MaerminExchangeSync`, WI-7): the client
signs a read-only trades request (Binance HMAC, Bitpanda Bearer key) and relays
it here; the secret stays in the encrypted vault and never reaches the Worker.
Imported trades are deduped idempotently (`source:'exchange-sync'` + externalId),
so a repeat sync never double-books. Read-only keys only — write/trade/withdraw
scopes are rejected client-side before any request is signed.

---

## Deploy

**Deploy to Cloudflare button** (README): Cloudflare copies `cf-worker/` into a repository in your
GitHub account, creates the `SYNC` KV namespace (the binding in `wrangler.toml` has no id, so it is
provisioned automatically) and the `SyncRoom` Durable Object, and deploys. Later pushes to that
repository redeploy.

**By hand:** Cloudflare Dashboard → Workers → Create → paste `cf-worker/worker.js` → Deploy. For sync,
create a KV namespace and bind it as `SYNC`. Or `npx wrangler deploy` in `cf-worker/` (wrangler ≥ 4.45
provisions the KV namespace itself). No secrets/env vars are required for market data.
