# MAERMIN — Cloudflare Worker API

`cf-worker/worker.js` is a stateless proxy that gives the browser CORS-friendly
access to market data, plus two optional features (encrypted sync, broker relay).
It stores nothing except the opt-in sync blob (in a KV namespace you bind).

**Base URL:** your deployed Worker (e.g. `https://maermin.<you>.workers.dev`).
Configure it in the app under **API Settings → Cloudflare Worker**.

## Cross-cutting behaviour

- **CORS:** reflects the request `Origin`, `Vary: Origin`.
- **Rate limiting:** per-IP sliding window (default 120 req/min) → `429` when exceeded.
- **Timeouts:** every upstream `fetch` is wrapped with an 8s abort.
- **Caching:** Yahoo search/history responses are cached (`caches.default`, 5 min–1 h).

---

## Market data

### `GET /?action=yf&symbol=AAPL&interval=1d&range=1y`
Yahoo Finance historical candles. `interval` ∈ `1m…1mo`, `range` ∈ `1d…max`.

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
  "dividendRate": 1.94,                 // annual dividend per share
  "dividendYield": 0.032,               // fraction
  "fiveYearAvgDividendYield": 0.031,    // fraction (normalised from Yahoo's percent)
  "payoutRatio": 0.74,                  // fraction
  "trailingEps": 2.61,
  "forwardEps": 2.95
}
```

Nulls mean Yahoo has no value — the client falls back to its history-based
heuristic. Cached 6 h; same cookie+crumb retry and degradation contract as
`fundholdings`.

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

### `GET /?action=search&q=ak47+redline`
Steam Market CS2 skin search (USD, `currency=1`). Returns items with images.

### `GET /?action=steamhistory&name=<market_hash_name>`
CS2 price history. Primary source is the listing page's embedded `var line1`
graph (parsed by the exported, unit-tested `parseSteamLine1`). Some items -
notably Souvenir skins - redirect to a grouped page WITHOUT that graph; the
response then falls back to `priceoverview` (current price as a 2-point line,
one backoff retry on Steam's aggressive 429s). Returns
`{ prices: [{ts, date, price}], currency: 'USD', source: 'listing'|'overview',
note? }` - prices are ALWAYS USD (the client converts to EUR); legacy Workers
mislabelled the same USD numbers as `EUR` and lack `source`, which clients use
to keep converting against old deployments. Listing data caches 4 h,
overview-only lines 10 min.

### `POST /`  (body: JSON array of skin names, max 30)
Steam skin price lookup → `{ "<name>": <usdPrice> }`. Fetched in concurrent
batches. **Contract:** all skin prices are USD; the client converts USD→EUR.

---

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

Host whitelist: `api.binance.com`, `api.kraken.com`, `api.exchange.coinbase.com`,
`api.coinbase.com`. Anything else → `403`. HTTPS only.

---

## Deploy

Cloudflare Dashboard → Workers → Create → paste `cf-worker/worker.js` → Deploy.
For sync, create a KV namespace and bind it as `SYNC`. No secrets/env vars are
required for market data.
