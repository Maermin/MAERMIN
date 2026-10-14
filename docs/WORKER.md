# MAERMIN — Cloudflare Worker API

`cf-worker/worker.js` is a stateless proxy that gives the browser CORS-friendly
access to market data, plus two optional features (encrypted sync, broker relay).
It stores nothing except the opt-in sync blob (in a KV namespace you bind).

**Base URL:** your deployed Worker (e.g. `https://maermin.<you>.workers.dev`).
Configure it in the app under **API Settings → Cloudflare Worker**.

## Cross-cutting behaviour

- **CORS:** exact-origin allowlist (`https://maermin.github.io`, `http://localhost` / `http://127.0.0.1` on any port, and `null` — the origin of `index.html` opened from disk) plus anything in the `ALLOWED_ORIGINS` variable (comma separated). Other browser origins get no `Access-Control-Allow-Origin`. `Vary: Origin`. If you only use the hosted app, set `ALLOW_NULL_ORIGIN = "false"` and `ALLOW_LOCALHOST = "false"` under `[vars]`: then only your listed origins can read answers in a browser.
- **Headers:** every answer carries `X-Content-Type-Options: nosniff`; JSON routes answer `application/json`, `news` answers `application/rss+xml`.
- **Errors:** an upstream failure never echoes its internal text. Yahoo `404` (no listing) and `429` (try later) keep their status; anything else is `502 { "error": "… unavailable", "upstreamStatus": <n> }`. An unexpected failure inside the Worker is `500 { "error": "internal error" }` with CORS headers.
- **Request bodies:** `POST` bodies must be a JSON object; the size is checked before parsing (sync 4.5 MB, share and broker relay 64 KB) → `413`.
- **Sync storage:** bind the `SyncRoom` Durable Object as `SYNC_DO` (see `wrangler.toml`) for atomic revision checks; a KV namespace `SYNC` alone still works but is eventually consistent. Blobs over 4 MB are rejected with `413`.
- **Share publishing:** throttled to 10 publishes per hour per IP.
- **Rate limiting:** per-IP sliding window (default 120 req/min, keyed on Cloudflare's `CF-Connecting-IP` only) → `429` when exceeded. The skin price list (`skinprices`) has its own 120 req/min budget, so a burst of stock or chart requests cannot block skin prices.
- **Symbol check:** the Yahoo routes (`yf`, `fundamentals`, `profile`, `earnings`, `fundholdings`, `news`) only take market symbols (`AAPL`, `SAP.DE`, `BRK-B`, `^GDAXI`, `EURUSD=X`, `GC=F`, ISINs). Anything else — e.g. a CS2 item name like `AK-47 | Redline (Field-Tested)` — gets `400 {"error":"not a market symbol"}` straight away, without an upstream call and without counting against the rate limit.
- **Timeouts:** every upstream `fetch` is wrapped with an 8s abort.
- **Caching:** Yahoo search/history responses are cached (`caches.default`, 5 min–1 h).

---

## Version

### `GET /?action=version`
`200 { "version": "2026.10.14", "actions": ["yf", "yfsearch", …], "storage": true }`. No upstream call and no rate limit.
`storage` says whether sync and share links can work (a KV namespace or the Durable Object is bound); the
app's connection test shows it.
`WORKER_VERSION` in `worker.js` and `EXPECTED_WORKER_VERSION` in `onboarding.js` name the same release
(`test/worker-version.test.js` enforces it); bump both when the app starts to rely on a Worker change.
The app checks the version once per Worker URL (and when API Settings opens or closes). An older Worker,
or one from before this route (it answers `400 Unknown action`), shows "Worker outdated → update".

---

## Market data

### `GET /?action=yf&symbol=AAPL&interval=1d&range=1y`
Yahoo Finance historical candles. `interval` ∈ `1m…1mo`, `range` ∈ `1d…max`.
`200 { symbol, currency, exchangeTz, prices: [{ ts, date, price }], splits: [{ date, numerator, denominator }], dividends: [{ date, amount }] }`.
`dividends` (since 2026.10.5) are the per-share payments in the listing currency, oldest first; the app's dividend backtest (Dividends → History) asks for `interval=1mo&range=10y`.

### `GET /?action=hicp&geo=DE`
Consumer prices for real returns (P5-2.9): Eurostat's HICP, dataset `prc_hicp_minr`
(all items, index 2015 = 100, monthly from 1996). `geo` is one of the euro area (`EA`)
and its members (`DE`, `AT`, `FR`, …); anything else is refused (`400`). Only the
region code is sent to Eurostat. `200 { geo, base: "2015=100", updated, source, months: [["2026-09", 136.9], …] }`,
cached for a day; `502` when Eurostat is unavailable.

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
Symbol search. `type` = `stock` (EQUITY/ETF/MUTUALFUND) or `crypto`; `q` at most 64 characters. Returns
`[{symbol, name, exchange, type, score}]`.

### `GET /?action=screener&scrId=day_gainers&count=25`  /  `GET /?action=screener&symbols=KO,PG`
Discovery screener, two modes with one normalised output shape: `scrId=` proxies
a Yahoo predefined screener (top movers / categories), `symbols=` is a batch
quote (curated dividend universe). Returns `{ scrId, symbols, quotes: [{symbol,
name, price, currency, changePercent, marketCap, dividendYield, type, exchange,
volume}] }`. `dividendYield` is a fraction (0.025 = 2.5%). Cached 2 min. `scrId` must be one of
Yahoo's predefined screeners the app uses (`day_gainers`, `day_losers`, `most_actives`,
`growth_technology_stocks`, `undervalued_growth_stocks`, `aggressive_small_caps`, and a few more); `symbols`
takes at most 60 market symbols.

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

### `GET /?action=research&symbol=AAPL` (P5-5.4)

The research page in one call: Yahoo Finance quoteSummary with the modules `price`, `summaryDetail`, `defaultKeyStatistics`, `financialData`, `recommendationTrend`, `earnings` and `assetProfile`. Cached for 6 hours. It is market data only (a symbol in, public figures out), so the shared price Worker serves it too.

```json
{ "symbol": "AAPL", "name": "Apple Inc.", "currency": "USD", "price": 250,
  "valuation": { "marketCap": 3.8e12, "trailingPE": 38.2, "forwardPE": 31.5, "peg": 2.4, "priceToBook": 55, "priceToSales": 9.1, "beta": 1.2, "high52": 260, "low52": 170, "dividendYield": 0.004, "payoutRatio": 0.15 },
  "financials": { "revenue": 4.0e11, "revenueGrowth": 0.06, "grossMargins": 0.46, "operatingMargins": 0.31, "profitMargins": 0.25, "returnOnEquity": 1.5, "debtToEquity": 150, "freeCashflow": 1.0e11 },
  "analysts": { "count": 41, "recommendationKey": "buy", "recommendationMean": 2.0, "targetMean": 270, "targetMedian": 275, "targetHigh": 320, "targetLow": 200,
    "trend": [{ "period": "0m", "strongBuy": 12, "buy": 20, "hold": 8, "sell": 1, "strongSell": 0 }] },
  "earnings": [{ "quarter": "4Q2025", "actual": 2.4, "estimate": 2.35 }],
  "profile": { "sector": "Technology", "industry": "Consumer Electronics", "country": "United States", "website": "https://www.apple.com", "employees": 164000, "summary": "… (at most 600 characters)" },
  "source": "Yahoo Finance", "fetchedAt": "…" }
```

- A missing value is `null`.
- An unknown symbol gets 404, and a CS2 item name gets 400 without an upstream call.
- **Licence:** Yahoo Finance data is for personal use. The app says so under the page and doesn't redistribute it.

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
Dividends view, plus the ex-dividend and pay dates for the **Events** feed (P5-5.5, Worker 2026.10.14). Proxies Yahoo Finance `quoteSummary` (`calendarEvents`,
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
  "revenueEstimate": 101200000000,   // in `currency`
  "exDividendDate": "2026-11-09",    // P5-5.5; null when Yahoo has none
  "dividendDate": "2026-11-13"       // P5-5.5; the next pay date, or null
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
// → { "rev": <n>, "blob": "<ciphertext|null>", "updatedAt": <ms>, "protected": <bool> }

// put (optimistic concurrency)
{ "op": "put", "account": "<hex>", "baseRev": <n>, "blob": "<ciphertext ≤4MB>",
  "auth": { "key": "<hex 64, first write only>", "mac": "<HMAC-SHA256 of account.baseRev.blob>" } }
// → { "ok": true, "rev": <n+1> }
// → 409 { "conflict": true, "serverRev": <n>, "blob": "<current>" }  // stale baseRev
// → 403 { "error": "unauthorized" }                                   // MAC does not match the registered key
// → 426 { "error": "sync needs a newer app …" }                       // new account without a write key
// → 429 { "error": "too many new sync accounts …" }                   // creation limit
```

**Write key.** A new account must register a write key (`auth.key`, derived from the vault key) with its
first write; every later write carries a MAC made with it. Apps since the write-auth release do this. An
older app gets `426` with an update hint instead of creating an account anyone could overwrite. An account
created before write keys existed stays writable as before until the app claims it: its next write sends
the key with a matching MAC (`get` reports `protected: false` for such accounts).

**Limits.** New accounts are limited per client (5 per day; an IPv6 client is its /64) and per UTC day
(`SYNC_DAILY_NEW_MAX`, default 200). With `SYNC_DO` the counters live in the `share` instance and hold
across isolates; without it they apply per isolate. Existing accounts are not affected.

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
// -> { "snapshot": {...}, "at": <ms> }   (served through the same allowlist; 404 if a stored
//    record does not pass it, e.g. one written by an older Worker with a looser schema)

// aggregate (anonymous benchmark)
{ "op": "aggregate" }
// -> { "count": <n>, "avgAssetClasses": { "stocks": 55.3, ... } }
```

The aggregate is a running count+sum of asset-class weights only - individual
snapshots are never exposed through it.

**Labels.** Sector and region rows are names (letters, spaces, `& , . ' ( ) / -`, no digits); currency rows
are ISO codes (`USD`). The rows of each list add up to at most 100 %.

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
Relays a read-only request to a whitelisted exchange endpoint, to bypass the
exchange's missing CORS headers. What travels depends on the exchange:

- **Binance** (and the signing exchanges once wired): the API **secret never leaves the
  browser** — only the key id and the signature the client already computed are sent.
- **Bitpanda**: there is no separate secret; the **API key itself** is the credential and
  goes through the Worker as a header with each request. Use your own Worker and a
  read-only key.

The Worker relays exact read endpoints only (no sub-paths, encoded paths, ports or user
info), forwards only the exchange's own authentication headers and does not follow
redirects.

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

## More exchanges in the broker relay (P5-3.8)

Read endpoints only, signed in the browser (the API secret never passes):

| Host | GET | Signature headers |
|---|---|---|
| `api.bitvavo.com` | `/v2/balance`, `/v2/trades` | `Bitvavo-Access-Key / -Signature / -Timestamp / -Window` |
| `api.bybit.com` | `/v5/user/query-api` (read-only check), `/v5/execution/list` | `X-BAPI-API-KEY / -TIMESTAMP / -RECV-WINDOW / -SIGN` |
| `api.kucoin.com` | `/api/v1/fills` | `KC-API-KEY / -SIGN / -TIMESTAMP / -PASSPHRASE / -KEY-VERSION` |
| `api.bitget.com` | `/api/v2/spot/account/assets`, `/api/v2/spot/trade/fills` | `ACCESS-KEY / -SIGN / -TIMESTAMP / -PASSPHRASE`, `locale` |

No order, withdrawal or transfer endpoint. Version 2026.10.10.

## Public crypto addresses (P5-3.6)

`GET /?action=wallet&chain=<btc|eth|arb|op|base|polygon|sol>&address=<public address>` →
`200 { chain, address, native: { symbol, amount }, tokens: [{ symbol, name, amount, contract }],
txs: [{ hash, date, direction, amount, symbol, fee }], source, updated }`.

| Chain | Explorer (no key) | Data |
|---|---|---|
| `btc` | mempool.space | balance, last 25 transactions (net per transaction, fee when sent) |
| `eth`, `arb`, `op`, `base`, `polygon` | Blockscout (`<chain>.blockscout.com`) | native balance, ERC-20 balances (≤ 50; NFTs, zero and non-ASCII symbols left out), last 50 transactions |
| `sol` | Solana public RPC | SOL balance |

The address is checked per chain before any call (`400 invalid address`); a never-used EVM address
is a zero balance. Answers are cached two minutes per address. Read-only: no key, no signing. The
explorers see the address and the Worker, not the user. The shared price Worker refuses the route.

## Aggregators with your own keys (optional, P5-3.5)

The broker relay (`action=brokerproxy`) also serves two account aggregators, with exact read
endpoints only (`BROKER_RELAY_POLICY`):

| Host | Allowed |
|---|---|
| `bankaccountdata.gocardless.com` | POST `/api/v2/token/new`, `/token/refresh`, `/requisitions` (a bank link); GET `/api/v2/institutions`, `/requisitions/<id>`, `/accounts/<id>/details`, `/balances`, `/transactions` |
| `api.snaptrade.com` | POST `/api/v1/snapTrade/registerUser`, `/snapTrade/login` (the read-only connection portal); GET `/api/v1/accounts`, `/activities`, `/accounts/<id>/positions`, `/balances` |

No trading, payment or delete endpoint. GoCardless: the user's secret id / key pass through the
Worker to fetch a short-lived token (as with Bitpanda's API key). SnapTrade: requests are signed in
the browser; only the signature passes (header `Signature`). Nothing is stored. Version 2026.10.8.

## Bank sync over FinTS (optional, P5-3.4)

`GET /?action=fintsbanks` → `{ banks, extraHosts, productId, productVersion }`: the FinTS servers this
Worker relays to (`cf-worker/fints-banks.js`) and the FinTS product id it is configured with.

`POST /?action=fints` `{ url, msg }` → `200 { status, msg }`: relays one FinTS message to the bank.
The browser (`fints.js`) builds every message itself - FinTS PIN/TAN puts the PIN and TAN inside the
message, so they pass through the Worker in memory for that one request; the Worker stores and logs
nothing. `msg` must be base64 (≤ 256 KB), `url` an https address of a listed bank: exact hosts
(Atruvia fints1 / fints2, DKB, comdirect, ING, Postbank, Consorsbank, Commerzbank) or the Sparkassen
pattern `banking-*.s-fints-pt-*.de`. Anything else → `403 { error: "Bank not allowed" }`; a
redirect from the bank is refused, not followed. The shared price Worker (`PRICE_ONLY`) refuses both.

| Variable | Effect |
|---|---|
| `FINTS_PRODUCT_ID` | The MAERMIN FinTS product id (registered with the Deutsche Kreditwirtschaft by the project owner). Without it the app shows "needs product id" and does not sync. Not stored in the repo. |
| `FINTS_PRODUCT_VERSION` | Product version sent with it (default `1`). |
| `FINTS_EXTRA_HOSTS` | More bank hosts, comma-separated exact host names (e.g. a bank not in the list). |

## Web push (optional, P5-5.1)

Reminders that reach a closed app. Needs the `SYNC` KV namespace and the cron trigger in `wrangler.toml` (`*/15 * * * *`); redeploy to get both.

- **The browser encrypts every message** to its own push subscription (RFC 8291, `push-crypto.js`). The Worker stores and forwards ciphertext only; it can't read a reminder.
- **VAPID:** the Worker creates its key pair on first use and keeps it in KV (`push:vapid`). Optional `VAPID_SUBJECT` (a `mailto:` or `https:` URL) for the JWT's `sub`; the default is the repository URL.
- **Endpoints:** only the browser vendors' push services (Google FCM, Mozilla, Microsoft WNS, Apple).

### `POST /?action=push`

| Body | Answer |
|---|---|
| `{ op: 'key' }` | `{ publicKey }`: the VAPID key to subscribe with |
| `{ op: 'set', box, token, key, endpoint, messages: [{ at, body, ttl?, urgency? }], prices?: [{ kind, symbol, op, threshold, body }] }` | `{ ok, messages, prices }`. Replaces the device's box. `body` is the aes128gcm ciphertext (base64url). A subscription made with another key gets 409 `resubscribe`. |
| `{ op: 'test', box, token, body }` | `{ ok, status }`: sends one message now |
| `{ op: 'delete', box, token }` | `{ ok }` |

- **Limits:** 100 messages and 20 price rules per box, 4 KB per message, send times at most 400 days ahead.
- **Token:** `box` is a random id. `token` is a random secret, stored only as a SHA-256 hash, and only it can replace or delete the box. New boxes count against the daily budget for new sync accounts (`SYNC_DAILY_NEW_MAX`).
- **Cron, every 15 minutes:**
  - sends due messages once;
  - drops a message that missed its TTL;
  - deletes a box whose push service answers 404 or 410 (the subscription is gone).
- **Opt-in price rules:** when the user switches them on, a price rule carries its `symbol` (a Yahoo symbol, or a CoinGecko id for `kind: 'coingecko'`), `op` and `threshold`.
  - The Worker checks the price every 15 minutes: Yahoo's regular market price in the quote currency, or CoinGecko's EUR price.
  - When the rule is reached, the Worker sends the prepared message once and removes the rule.
  - The Worker sees that symbol and threshold, never a quantity or a value.
- **Shared price Worker:** a `PRICE_ONLY` deployment refuses `push` and runs no cron.

## Deploy

**Deploy to Cloudflare button** (README): Cloudflare copies `cf-worker/` into a repository in your
GitHub account, creates the `SYNC` KV namespace (the binding in `wrangler.toml` has no id, so it is
provisioned automatically) and the `SyncRoom` Durable Object, and deploys. Later pushes to that
repository redeploy.

**By hand:** Cloudflare Dashboard → Workers → Create → paste `cf-worker/worker.js` → Deploy. For sync,
create a KV namespace and bind it as `SYNC`. Or `npx wrangler deploy` in `cf-worker/` (wrangler ≥ 4.45
provisions the KV namespace itself). No secrets/env vars are required for market data.

## Shared price Worker (`PRICE_ONLY`, P5-3.1)

The project owner can run the same code a second time as a **market-data-only** service, used by the
app only when a user has no Worker of their own (an own Worker always wins; users can switch it off
in Security & sync → Market data).

| Variable | Effect |
|---|---|
| `PRICE_ONLY = "1"` | Serves only `yf`, `yfsearch`, `screener`, `fundholdings`, `fundamentals`, `earnings`, `profile`, `news`, `skinprices`, `cg`, `hicp` and `version`. Every other route (`sync`, `share`, `mcp`, `brokerproxy`, `steaminv`, later FinTS / aggregators) answers `403 { error: "not available on the shared price service" }` before anything runs. `version` reports `priceOnly: true` and only these actions. |
| `PRICE_ONLY_RPM = "60"` | Requests per IP and minute (default 60), on top of the general limit. |
| `PRICE_ONLY_OFF = "1"` | Kill switch: every route answers `503 { error: "shared price service paused" }`; `version` says `paused: true`. |

Deploy it without the `SYNC` KV namespace and the Durable Object (no storage is needed). It logs
nothing; Cloudflare's edge cache keeps the market answers as on any Worker. It sees the symbols,
search terms and region codes the app asks about - never amounts, quantities or the vault. After
deploying, the owner sets its URL as `SHARED_URL` in `shared-worker.js`.
