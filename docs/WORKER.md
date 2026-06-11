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

### `GET /?action=search&q=ak47+redline`
Steam Market CS2 skin search (USD, `currency=1`). Returns items with images.

### `GET /?action=steamhistory&name=<market_hash_name>`
CS2 price history with current-price fallback (USD).

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
