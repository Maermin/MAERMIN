// ============================================================================
// MAERMIN — Exchange read-only sync (crypto)  (window.MaerminExchangeSync)
// ----------------------------------------------------------------------------
// Competitive-gap WI-7. Read-only auto-sync of crypto trades from Binance,
// Kraken, Coinbase and Bitpanda over the EXISTING `action=brokerproxy` relay
// (the Worker only relays a CLIENT-SIGNED request; the secret never leaves the
// device). Hard security rules:
//
//   - API keys live ONLY in the encrypted vault (crypto-vault.js), never in
//     localStorage state, never in a URL query, never in a backup. The persisted
//     state (key maermin_exchange_sync) holds non-secret connection metadata only.
//   - Read-only keys only. validateReadOnly() rejects any write/trade/withdraw
//     scope the exchange reports.
//   - Manual trigger only (no background daemon) — stays client-side.
//   - Idempotent merge: imported trades carry source:'exchange-sync', exchange
//     and externalId markers, so a repeat sync never creates duplicates.
//
// The pure layer (adapters/mapTrades, dedupe, mergeSync, validateReadOnly,
// normalize) is Node-tested in test/exchange-sync.test.js. Signing + fetch are
// browser glue.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_exchange_sync';
  var VAULT_PREFIX = 'maermin_exchange_cred_'; // vault-encrypted credential blobs
  var SCHEMA = 1;

  var EXCHANGES = {
    binance:  { label: 'Binance',  host: 'api.binance.com' },
    kraken:   { label: 'Kraken',   host: 'api.kraken.com' },
    coinbase: { label: 'Coinbase', host: 'api.exchange.coinbase.com' },
    bitpanda: { label: 'Bitpanda', host: 'api.bitpanda.com' }
  };

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function str(x) { return String(x == null ? '' : x).trim(); }
  function uid() { return 'ex' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ymd(d) { return str(d).slice(0, 10); }
  // Trade timestamp -> calendar day in the device's time zone. The tax year
  // and the sec. 23 holding period follow the local day: the UTC date booked
  // a trade at 00:30 on 1 January (Berlin) into the previous year. A bare
  // 'YYYY-MM-DD' is kept as is.
  function tradeDay(d) {
    var s = str(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var t = new Date(s);
    if (isNaN(t.getTime())) return ymd(s);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }

  // ---- read-only scope guard ------------------------------------------------
  // Reject any permission that grants writing, trading or withdrawal. Accepts a
  // list of scope strings or a permissions object; returns { ok, violations }.
  var WRITE_SCOPES = ['trade', 'trading', 'withdraw', 'withdrawal', 'transfer', 'write', 'order', 'spot_trade', 'futures'];
  function validateReadOnly(scopes) {
    var list = [];
    if (Array.isArray(scopes)) list = scopes;
    else if (scopes && typeof scopes === 'object') {
      Object.keys(scopes).forEach(function (k) { if (scopes[k]) list.push(k); });
    } else if (typeof scopes === 'string') list = [scopes];
    var violations = list.map(str).filter(function (s) {
      var low = s.toLowerCase();
      return WRITE_SCOPES.some(function (w) { return low.indexOf(w) !== -1; });
    });
    return { ok: violations.length === 0, violations: violations };
  }

  // ---- symbol parsing -------------------------------------------------------
  // Split an exchange pair into { base, quote }. Handles 'BTCEUR', 'BTC-EUR',
  // 'XBT/EUR' (Kraken XBT = BTC). Only EUR/USD quotes are imported.
  var QUOTES = ['EUR', 'USD', 'USDT', 'USDC'];
  // Kraken's own asset codes (XBT = BTC, XDG = DOGE) and their legacy 4-letter
  // forms with the X prefix (XXBT, XETH, XXDG, ...).
  var KRAKEN_ASSETS = { XBT: 'BTC', XXBT: 'BTC', XDG: 'DOGE', XXDG: 'DOGE', XETH: 'ETH' };
  function normalizeBase(b) { b = str(b).toUpperCase(); return KRAKEN_ASSETS[b] || b; }
  function parsePair(pair) {
    var p = str(pair).toUpperCase().replace(/[\/\-_]/g, '');
    // Kraken's legacy pair names: X<asset>Z<fiat>, e.g. XXBTZEUR, XETHZUSD
    // (FINDINGS H-1). Only this exact 8-letter shape is unwrapped - stripping
    // an X or Z elsewhere would break real assets such as XTZ (Tezos) or XRP.
    var legacy = /^X([A-Z]{3})Z(EUR|USD)$/.exec(p);
    if (legacy) return { base: normalizeBase(legacy[1]), quote: legacy[2] };
    for (var i = 0; i < QUOTES.length; i++) {
      var q = QUOTES[i];
      if (p.length > q.length && p.slice(-q.length) === q) {
        return { base: normalizeBase(p.slice(0, p.length - q.length)), quote: q };
      }
    }
    return { base: normalizeBase(p), quote: '' };
  }
  // Stablecoin quotes are treated as USD for the canonical currency.
  function quoteCurrency(q) { return (q === 'EUR') ? 'EUR' : (q ? 'USD' : 'EUR'); }

  function tx(base, type, qty, price, fee, currency, date, exchange, externalId) {
    return {
      type: type, category: 'crypto', symbol: base, symbolName: base,
      quantity: num(qty), price: num(price), fees: num(fee),
      currency: currency, date: tradeDay(date),
      source: 'exchange-sync', exchange: exchange, externalId: str(externalId)
    };
  }

  // ---- per-exchange adapters: raw response -> normalized transactions --------
  var ADAPTERS = {
    // Binance GET /api/v3/myTrades -> [{symbol,id,price,qty,commission,commissionAsset,time,isBuyer}]
    binance: function (raw) {
      var arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.data) ? raw.data : []);
      var out = [];
      arr.forEach(function (tr) {
        var pr = parsePair(tr.symbol);
        if (!pr.base || !pr.quote) return;
        // The commission can be taken in the quote, in the traded coin or in a
        // third asset (BNB). FINDINGS M-2: a fee in the bought coin used to be
        // dropped, so the quantity was 0.1 % too high on every buy.
        var feeAsset = str(tr.commissionAsset).toUpperCase(), commission = num(tr.commission);
        var qty = num(tr.qty), price = num(tr.price), fee = 0, extra = null;
        if (feeAsset === pr.quote) fee = commission;
        else if (feeAsset === pr.base) {
          // Valued at the trade price so the cost (or proceeds) stay exact; on a
          // buy the coin arrives net of the fee.
          fee = commission * price;
          if (tr.isBuyer) qty = qty - commission;
        } else if (feeAsset && commission > 0) {
          // No price for the fee asset here: keep it on the row instead of losing it.
          extra = { feeAsset: feeAsset, feeQuantity: commission };
        }
        var row = tx(pr.base, tr.isBuyer ? 'buy' : 'sell', qty, price, fee, quoteCurrency(pr.quote),
          // Binance trade ids are only unique PER SYMBOL - qualify them.
          new Date(num(tr.time)).toISOString(), 'binance', str(tr.symbol).toUpperCase() + ':' + str(tr.id));
        if (extra) {
          row.feeAsset = extra.feeAsset; row.feeQuantity = extra.feeQuantity;
          row.notes = 'Fee paid in ' + extra.feeAsset + ': ' + extra.feeQuantity + ' (not in the cost basis - add it as fee if you want it counted)';
        }
        out.push(row);
      });
      return out;
    },
    // Kraken TradesHistory -> { result: { trades: { TXID: {pair,type,price,vol,fee,time} } } }
    kraken: function (raw) {
      var trades = raw && raw.result && raw.result.trades ? raw.result.trades : (raw && raw.trades) || {};
      var out = [];
      Object.keys(trades).forEach(function (txid) {
        var tr = trades[txid];
        var pr = parsePair(tr.pair);
        if (!pr.base || !pr.quote) return;
        out.push(tx(pr.base, str(tr.type) === 'sell' ? 'sell' : 'buy', tr.vol, tr.price, tr.fee,
          quoteCurrency(pr.quote), new Date(num(tr.time) * 1000).toISOString(), 'kraken', txid));
      });
      return out;
    },
    // Coinbase GET /fills -> [{trade_id,product_id:'BTC-EUR',side,size,price,fee,created_at}]
    coinbase: function (raw) {
      var arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.fills) ? raw.fills : []);
      var out = [];
      arr.forEach(function (fl) {
        var pr = parsePair(fl.product_id);
        if (!pr.base || !pr.quote) return;
        out.push(tx(pr.base, str(fl.side) === 'sell' ? 'sell' : 'buy', fl.size, fl.price, fl.fee,
          quoteCurrency(pr.quote), fl.created_at, 'coinbase', fl.trade_id));
      });
      return out;
    },
    // Bitpanda GET /trades -> { data: [{ id, attributes: { type, amount, price, currency, time:{date_iso8601} } }] }
    bitpanda: function (raw) {
      var arr = (raw && Array.isArray(raw.data)) ? raw.data : (Array.isArray(raw) ? raw : []);
      var out = [];
      arr.forEach(function (item) {
        var a = item.attributes || item;
        var base = normalizeBase(a.cryptocoin_symbol || a.symbol || a.base);
        if (!base) return;
        var quote = str(a.currency).toUpperCase() || 'EUR';
        var date = (a.time && (a.time.date_iso8601 || a.time)) || a.created_at;
        out.push(tx(base, str(a.type) === 'sell' ? 'sell' : 'buy', a.amount, a.price, a.fee || 0,
          quoteCurrency(quote === 'EUR' ? 'EUR' : 'USD'), date, 'bitpanda', item.id || a.id));
      });
      return out;
    }
  };

  function mapTrades(exchange, raw) {
    var fn = ADAPTERS[exchange];
    if (!fn) return [];
    try { return fn(raw).filter(function (t) { return t.symbol && t.quantity > 0; }); }
    catch (e) { return []; }
  }

  // ---- idempotent dedupe + merge --------------------------------------------
  function externalKey(t) { return str(t.source) + '|' + str(t.exchange) + '|' + str(t.externalId); }
  function sameDayKey(t) { return str(t.symbol) + '|' + str(t.type) + '|' + num(t.quantity) + '|' + num(t.price) + '|' + ymd(t.date); }

  // Drop candidates already present, by external marker first, then a same-day
  // (symbol, type, qty, price) fallback for trades imported another way.
  function dedupe(candidates, existing) {
    existing = Array.isArray(existing) ? existing : [];
    var extSet = {}, daySet = {};
    existing.forEach(function (t) {
      if (t.externalId) extSet[externalKey(t)] = true;
      // The same-day fallback only matches rows WITHOUT an exchange id (CSV /
      // manual entries of the same trade). Two synced fills with identical
      // symbol/qty/price on one day are distinct trades and must both import.
      else daySet[sameDayKey(t)] = true;
    });
    var unique = [], dropped = 0;
    (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
      var ek = externalKey(c);
      if (c.externalId ? extSet[ek] : false) { dropped++; return; }
      if (daySet[sameDayKey(c)]) { dropped++; delete daySet[sameDayKey(c)]; return; } // one manual row absorbs one fill
      if (c.externalId) extSet[ek] = true; // guard against duplicates WITHIN the batch
      else daySet[sameDayKey(c)] = true;
      unique.push(c);
    });
    return { unique: unique, dropped: dropped };
  }

  // Merge mapped trades into the transaction list, assigning ids + portfolioId.
  function mergeSync(existing, candidates, opts) {
    opts = opts || {};
    var d = dedupe(candidates, existing);
    var portfolioId = opts.portfolioId || null;
    var added = d.unique.map(function (c) {
      return Object.assign({}, c, {
        id: (typeof window !== 'undefined' && window.MaerminUtils && window.MaerminUtils.generateId) ? window.MaerminUtils.generateId() : uid(),
        portfolioId: portfolioId, auto: true,
        notes: 'Imported from ' + (EXCHANGES[c.exchange] ? EXCHANGES[c.exchange].label : c.exchange) + (c.notes ? ' · ' + c.notes : '')
      });
    });
    return { transactions: (Array.isArray(existing) ? existing : []).concat(added), added: added, skipped: d.dropped };
  }

  // Append synced rows to the CURRENT transaction list (call it inside the
  // setTransactions updater). A sync dedupes against the snapshot it started
  // from, so two overlapping runs would both add the same trades; this drops
  // every row whose exchange|externalId is already present.
  function appendNew(prev, added) {
    prev = Array.isArray(prev) ? prev : [];
    var seen = {};
    prev.forEach(function (t) { if (t && t.externalId) seen[externalKey(t)] = true; });
    var fresh = (Array.isArray(added) ? added : []).filter(function (t) {
      if (!t || !t.externalId) return true;
      var k = externalKey(t);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    return fresh.length ? prev.concat(fresh) : prev;
  }

  // After a cloud-sync merge, two devices may each have imported the same
  // exchange trade under their own ids. Deterministic survivor (smallest id,
  // as in MaerminSavingsExecutor.dedupeExecutions), so every device removes
  // the same rows. Only exchange-synced rows with an external id are touched.
  function dedupeImported(transactions) {
    var byKey = {};
    (transactions || []).forEach(function (t) {
      if (!t || t.source !== 'exchange-sync' || !t.externalId) return;
      var k = externalKey(t);
      (byKey[k] || (byKey[k] = [])).push(t);
    });
    var removeIds = {};
    Object.keys(byKey).forEach(function (k) {
      var list = byKey[k];
      if (list.length < 2) return;
      list.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
      list.slice(1).forEach(function (t) { removeIds[t.id] = true; });
    });
    var removed = Object.keys(removeIds).length;
    if (!removed) return { transactions: transactions || [], removed: 0 };
    return { transactions: (transactions || []).filter(function (t) { return !(t && removeIds[t.id]); }), removed: removed };
  }

  // One sync per connection at a time (the button is disabled too, but the
  // flag also covers a second Panel instance or a fast double click).
  var _inFlight = {};
  function beginSync(connId) {
    if (_inFlight[connId]) return false;
    _inFlight[connId] = true;
    return true;
  }
  function endSync(connId) { delete _inFlight[connId]; }
  function isSyncing(connId) { return !!_inFlight[connId]; }

  // ---- state (NO secrets) ---------------------------------------------------
  function normalizeConnection(c) {
    if (!c || typeof c !== 'object') return null;
    var exchange = EXCHANGES[c.exchange] ? c.exchange : null;
    if (!exchange) return null;
    return {
      id: c.id ? str(c.id) : uid(),
      exchange: exchange,
      label: str(c.label) || EXCHANGES[exchange].label,
      addedAt: str(c.addedAt) || ymd(new Date().toISOString()),
      lastSync: c.lastSync ? str(c.lastSync) : null
    };
  }
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.connections) ? obj.connections : (Array.isArray(obj) ? obj : []);
    var connections = [];
    list.forEach(function (c) { var n = normalizeConnection(c); if (n) connections.push(n); });
    return { version: SCHEMA, connections: connections };
  }
  function addConnection(state, conn) {
    state = normalize(state);
    var n = normalizeConnection(Object.assign({ id: uid() }, conn));
    if (n) state.connections.push(n);
    return state;
  }
  function removeConnection(state, id) {
    state = normalize(state);
    state.connections = state.connections.filter(function (c) { return c.id !== id; });
    return state;
  }

  // ---- localStorage + vault helpers (browser only) --------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, connections: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); } catch (e) { return { version: SCHEMA, connections: [] }; }
  }
  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }
  // Credentials are written ONLY through the vault, under a per-connection key.
  function storeCredentials(connId, creds) {
    if (typeof window === 'undefined' || !window.MaerminVault || !window.MaerminVault.isUnlocked()) {
      return Promise.reject(new Error('Vault locked — unlock to store exchange keys'));
    }
    return window.MaerminVault.encryptJSON(creds).then(function (env) {
      try { localStorage.setItem(VAULT_PREFIX + connId, JSON.stringify(env)); return true; }
      catch (e) { throw new Error('Failed to persist encrypted credentials'); }
    });
  }
  function loadCredentials(connId) {
    if (typeof window === 'undefined' || !window.MaerminVault || !window.MaerminVault.isUnlocked()) {
      return Promise.reject(new Error('Vault locked'));
    }
    var rawEnv;
    try { rawEnv = JSON.parse(localStorage.getItem(VAULT_PREFIX + connId) || 'null'); } catch (e) { rawEnv = null; }
    if (!rawEnv) return Promise.resolve(null);
    return window.MaerminVault.decryptJSON(rawEnv);
  }
  // Password change support: credentials are encrypted directly with the vault
  // key (not via storage.js), so they must be decrypted with the OLD key and
  // re-encrypted with the NEW one, or they become unreadable. Resolves
  // { connId: creds } for every stored connection (vault must be unlocked).
  function credentialIds() {
    var ids = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(VAULT_PREFIX) === 0) ids.push(k.slice(VAULT_PREFIX.length));
      }
    } catch (e) { /* no storage */ }
    return ids;
  }
  function exportAllCredentials() {
    var out = {};
    return Promise.all(credentialIds().map(function (id) {
      return loadCredentials(id).then(function (c) { if (c) out[id] = c; }, function () { /* unreadable: skip */ });
    })).then(function () { return out; });
  }
  function importAllCredentials(map) {
    return Promise.all(Object.keys(map || {}).map(function (id) { return storeCredentials(id, map[id]); }))
      .then(function () { return true; });
  }
  function removeCredentials(connId) {
    try { localStorage.removeItem(VAULT_PREFIX + connId); } catch (e) { /* non-fatal */ }
  }

  // ---- client-side signing + sync (browser only) ---------------------------
  // HMAC-SHA256 hex of `message` with `secret` via Web Crypto.
  function hmacSha256Hex(secret, message) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return crypto.subtle.sign('HMAC', key, enc.encode(message)); })
      .then(function (sig) {
        var bytes = new Uint8Array(sig), hex = '';
        for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
        return hex;
      });
  }

  // Build the CLIENT-SIGNED brokerproxy request spec for a read-only trades
  // pull. The secret is used only to compute the signature here; it is never put
  // in the relayed body. Supported live: Binance (HMAC query), Bitpanda (Bearer
  // header, no signing). Returns a Promise<{ method, url, headers }>.
  // Binance signed GET for `path` with extra query params (signature last).
  function binanceSigned(creds, path, params) {
    var qs = (params ? params + '&' : '') + 'timestamp=' + Date.now() + '&recvWindow=60000';
    return hmacSha256Hex(creds.apiSecret, qs).then(function (sig) {
      return { method: 'GET', url: 'https://api.binance.com' + path + '?' + qs + '&signature=' + sig, headers: { 'X-MBX-APIKEY': creds.apiKey } };
    });
  }
  // /api/v3/myTrades REQUIRES `symbol`, so the pull enumerates candidate pairs:
  // every asset with a balance or already held/traded as crypto, against the
  // quotes this importer understands. Pure + exported for tests.
  var BINANCE_QUOTES = ['EUR', 'USDT', 'USDC'];
  var BINANCE_MAX_PAIRS = 60;
  function binanceCandidatePairs(balances, existing) {
    var assets = {};
    (Array.isArray(balances) ? balances : []).forEach(function (b) {
      if (b && (num(b.free) > 0 || num(b.locked) > 0)) assets[str(b.asset).toUpperCase()] = true;
    });
    (Array.isArray(existing) ? existing : []).forEach(function (t) {
      if (t && t.category === 'crypto' && t.symbol) assets[str(t.symbol).toUpperCase()] = true;
    });
    var pairs = [];
    Object.keys(assets).sort().forEach(function (a) {
      if (!/^[A-Z0-9]{2,15}$/.test(a) || BINANCE_QUOTES.indexOf(a) > -1) return;
      BINANCE_QUOTES.forEach(function (q) { pairs.push(a + q); });
    });
    return pairs.slice(0, BINANCE_MAX_PAIRS);
  }

  function buildSignedRequest(exchange, creds) {
    var key = creds && creds.apiKey;
    if (exchange === 'binance') return binanceSigned(creds, '/api/v3/account', 'omitZeroBalances=true');
    if (exchange === 'bitpanda') {
      return Promise.resolve({ method: 'GET', url: 'https://api.bitpanda.com/v1/trades', headers: { 'X-API-KEY': key } });
    }
    // Kraken / Coinbase need a nonce/passphrase signing scheme — connection is
    // stored but the live pull is not wired yet (mappers are ready + tested).
    return Promise.reject(new Error('Live sync for ' + (EXCHANGES[exchange] ? EXCHANGES[exchange].label : exchange) + ' is not available yet'));
  }

  // Pull read-only trades for one connection and return mapped+deduped trades to
  // import. `ctx` = { workerUrl, existing, portfolioId, fetch }.
  function syncConnection(conn, ctx) {
    ctx = ctx || {};
    var fetchImpl = ctx.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!conn || !EXCHANGES[conn.exchange]) return Promise.reject(new Error('Unknown connection'));
    if (!ctx.workerUrl) return Promise.reject(new Error('A Worker URL is required to relay the request'));
    if (!fetchImpl) return Promise.reject(new Error('fetch unavailable'));
    var base = String(ctx.workerUrl).replace(/\/$/, '');
    function relay(spec) {
      return fetchImpl(base + (base.indexOf('?') > -1 ? '&' : '?') + 'action=brokerproxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec)
      }).then(function (r) { return r.json(); }).then(function (resp) {
        if (!resp || resp.error) throw new Error((resp && resp.error) || 'Relay failed');
        return resp;
      });
    }
    function checked(resp) {
      if (resp.ok === false || (resp.status && resp.status >= 400)) throw new Error('Exchange returned ' + resp.status);
      return resp.data;
    }
    var credsRef;
    return loadCredentials(conn.id).then(function (creds) {
      if (!creds || !creds.apiKey || !creds.apiSecret) throw new Error('No stored credentials for this connection');
      credsRef = creds;
      return buildSignedRequest(conn.exchange, creds);
    }).then(relay).then(function (resp) {
      var data = checked(resp);
      if (conn.exchange !== 'binance') return data;
      // Binance: account balances -> candidate pairs -> one myTrades call each,
      // sequentially (request weight). Unknown pairs (HTTP 400) are skipped.
      var pairs = binanceCandidatePairs(data && data.balances, ctx.existing);
      var all = [];
      return pairs.reduce(function (p, sym) {
        return p.then(function () {
          return binanceSigned(credsRef, '/api/v3/myTrades', 'symbol=' + sym + '&limit=1000').then(relay).then(function (r) {
            if (r.status === 400) return; // invalid symbol on Binance
            var rows = checked(r);
            if (Array.isArray(rows)) all = all.concat(rows);
          });
        });
      }, Promise.resolve()).then(function () { return all; });
    }).then(function (data) {
      var mapped = mapTrades(conn.exchange, data);
      var merged = mergeSync(ctx.existing || [], mapped, { portfolioId: ctx.portfolioId || null });
      return { added: merged.added, skipped: merged.skipped, transactions: merged.transactions, mappedCount: mapped.length };
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, VAULT_PREFIX: VAULT_PREFIX, SCHEMA: SCHEMA, EXCHANGES: EXCHANGES,
    buildSignedRequest: buildSignedRequest, syncConnection: syncConnection,
    validateReadOnly: validateReadOnly, parsePair: parsePair, quoteCurrency: quoteCurrency,
    ADAPTERS: ADAPTERS, mapTrades: mapTrades, dedupe: dedupe, mergeSync: mergeSync,
    appendNew: appendNew, dedupeImported: dedupeImported,
    beginSync: beginSync, endSync: endSync, isSyncing: isSyncing,
    normalize: normalize, addConnection: addConnection, removeConnection: removeConnection,
    load: load, save: save,
    storeCredentials: storeCredentials, loadCredentials: loadCredentials, removeCredentials: removeCredentials,
    exportAllCredentials: exportAllCredentials, importAllCredentials: importAllCredentials,
    binanceCandidatePairs: binanceCandidatePairs
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminExchangeSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — manage read-only exchange connections (Import area). Keys are
  // entered, encrypted into the vault and never shown again. Sync is manual and
  // hands mapped trades up to the caller's onImport(transactions) prop.
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      var useState = React.useState;
      try {
        var theme = props.theme || {};
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f', inputBg = theme.inputBg || '#0c1018';
        var inputBorder = theme.inputBorder || border, accent = theme.accent || '#8b7cff';

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var f0 = useState({ exchange: 'binance', label: '', apiKey: '', apiSecret: '' });
        var form = f0[0], setForm = f0[1];
        var m0 = useState(''); var msg = m0[0], setMsg = m0[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); }
        function setF(p) { setForm(Object.assign({}, form, p)); }

        function addConn() {
          if (!form.apiKey || !form.apiSecret) { setMsg(t.exNeedKeys || 'Enter a read-only API key and secret.'); return; }
          var next = API.addConnection(st, { exchange: form.exchange, label: form.label });
          var conn = API.normalize(next).connections.slice(-1)[0];
          API.storeCredentials(conn.id, { apiKey: form.apiKey, apiSecret: form.apiSecret }).then(function () {
            mutate(next);
            setForm({ exchange: 'binance', label: '', apiKey: '', apiSecret: '' });
            setMsg(t.exStored || 'Connection added. Keys encrypted in your vault.');
          }).catch(function (err) { setMsg((err && err.message) || 'Failed to store keys'); });
        }
        function removeConn(id) { API.removeCredentials(id); mutate(API.removeConnection(st, id)); }
        var b0 = useState({}); var busy = b0[0], setBusy = b0[1];
        function setConnBusy(id, on) {
          setBusy(function (prev) { var n = Object.assign({}, prev); if (on) n[id] = true; else delete n[id]; return n; });
        }
        function syncConn(c) {
          if (!API.beginSync(c.id)) return;
          setConnBusy(c.id, true);
          setMsg((t.exSyncing || 'Syncing') + ' ' + c.label + '…');
          API.syncConnection(c, { workerUrl: props.workerUrl, existing: props.existing || [], portfolioId: props.portfolioId, fetch: (typeof fetch !== 'undefined' ? fetch : null) })
            .finally(function () { API.endSync(c.id); setConnBusy(c.id, false); })
            .then(function (r) {
              if (props.onImport && r.added.length) props.onImport(r.added);
              var today = (window.MaerminUtils && window.MaerminUtils.todayISO) ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10);
              mutate(API.normalize({ version: API.SCHEMA, connections: API.normalize(st).connections.map(function (x) { return x.id === c.id ? Object.assign({}, x, { lastSync: today }) : x; }) }));
              setMsg(r.added.length + ' ' + (t.exImported || 'trade(s) imported') + (r.skipped ? ', ' + r.skipped + ' ' + (t.exSkipped || 'duplicate(s) skipped') : ''));
            })
            .catch(function (err) { setMsg((err && err.message) || 'Sync failed'); });
        }

        var rows = st.connections.map(function (c) {
          return e('div', { key: c.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: inputBg, borderRadius: '8px', marginBottom: '0.5rem' } },
            e('div', null,
              e('div', { style: { color: text, fontWeight: 600, fontSize: '0.85rem' } }, c.label),
              e('div', { style: { color: dim, fontSize: '0.72rem' } }, (API.EXCHANGES[c.exchange] || {}).label + (c.lastSync ? '  ·  ' + (t.exLastSync || 'last sync') + ' ' + c.lastSync : '  ·  ' + (t.exNeverSynced || 'never synced')))),
            e('div', { style: { display: 'flex', gap: '0.4rem' } },
              e('button', { onClick: function () { syncConn(c); }, disabled: !!busy[c.id], 'aria-busy': busy[c.id] ? 'true' : 'false', style: { background: accent, border: 'none', color: '#ffffff', cursor: busy[c.id] ? 'wait' : 'pointer', opacity: busy[c.id] ? 0.6 : 1, borderRadius: '7px', padding: '0.25rem 0.7rem', fontSize: '0.74rem', fontWeight: 700 } }, busy[c.id] ? ((t.exSyncing || 'Syncing') + '…') : (t.exSyncNow || 'Sync now')),
              e('button', { onClick: function () { removeConn(c.id); }, style: { background: 'none', border: '1px solid ' + inputBorder, color: dim, cursor: 'pointer', borderRadius: '7px', padding: '0.25rem 0.6rem', fontSize: '0.74rem' } }, t.exRemove || 'Remove')));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.25rem' } },
          e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.exTitle || 'Exchange sync (read-only)'),
          e('div', { style: { color: dim, fontSize: '0.76rem', marginBottom: '0.9rem' } }, t.exSubtitle || 'Import crypto trades read-only. Use read-only API keys — keys are encrypted in your vault and never leave the device unencrypted.'),
          rows,
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: '0.5rem', marginTop: '0.6rem' } },
            e('select', { value: form.exchange, onChange: function (ev) { setF({ exchange: ev.target.value }); }, style: { padding: '0.5rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.82rem' } },
              Object.keys(API.EXCHANGES).map(function (k) { return e('option', { key: k, value: k }, API.EXCHANGES[k].label); })),
            e('input', { value: form.label, onChange: function (ev) { setF({ label: ev.target.value }); }, placeholder: t.exLabel || 'Label (optional)', style: { padding: '0.5rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.82rem' } }),
            e('input', { value: form.apiKey, onChange: function (ev) { setF({ apiKey: ev.target.value }); }, placeholder: t.exApiKey || 'API key (read-only)', style: { padding: '0.5rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.82rem' } }),
            e('input', { value: form.apiSecret, type: 'password', onChange: function (ev) { setF({ apiSecret: ev.target.value }); }, placeholder: t.exApiSecret || 'API secret', style: { padding: '0.5rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.82rem' } })),
          e('button', { onClick: addConn, style: { marginTop: '0.6rem', padding: '0.5rem 1rem', background: accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } }, t.exAdd || 'Add connection'),
          msg ? e('div', { style: { color: dim, fontSize: '0.76rem', marginTop: '0.5rem' } }, msg) : null);
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Exchange sync error: ' + (err && err.message));
      }
    };
  }
})();
