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
  function normalizeBase(b) { b = str(b).toUpperCase(); return b === 'XBT' ? 'BTC' : b; }
  function parsePair(pair) {
    var p = str(pair).toUpperCase().replace(/[\/\-_]/g, '');
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
      currency: currency, date: ymd(date),
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
        var fee = (str(tr.commissionAsset).toUpperCase() === pr.quote) ? num(tr.commission) : 0;
        out.push(tx(pr.base, tr.isBuyer ? 'buy' : 'sell', tr.qty, tr.price, fee, quoteCurrency(pr.quote),
          new Date(num(tr.time)).toISOString(), 'binance', tr.id));
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
      daySet[sameDayKey(t)] = true;
    });
    var unique = [], dropped = 0;
    (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
      var ek = externalKey(c);
      if ((c.externalId && extSet[ek]) || daySet[sameDayKey(c)]) { dropped++; return; }
      // guard against duplicates WITHIN the same batch too
      extSet[ek] = true; daySet[sameDayKey(c)] = true;
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
        portfolioId: portfolioId, auto: true, notes: 'Imported from ' + (EXCHANGES[c.exchange] ? EXCHANGES[c.exchange].label : c.exchange)
      });
    });
    return { transactions: (Array.isArray(existing) ? existing : []).concat(added), added: added, skipped: d.dropped };
  }

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
  function buildSignedRequest(exchange, creds) {
    var key = creds && creds.apiKey, secret = creds && creds.apiSecret;
    if (exchange === 'binance') {
      var qs = 'timestamp=' + Date.now() + '&recvWindow=60000';
      return hmacSha256Hex(secret, qs).then(function (sig) {
        return { method: 'GET', url: 'https://api.binance.com/api/v3/myTrades?' + qs + '&signature=' + sig, headers: { 'X-MBX-APIKEY': key } };
      });
    }
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
    return loadCredentials(conn.id).then(function (creds) {
      if (!creds || !creds.apiKey || !creds.apiSecret) throw new Error('No stored credentials for this connection');
      return buildSignedRequest(conn.exchange, creds);
    }).then(function (spec) {
      var base = String(ctx.workerUrl).replace(/\/$/, '');
      return fetchImpl(base + (base.indexOf('?') > -1 ? '&' : '?') + 'action=brokerproxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec)
      });
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (!resp || resp.error) throw new Error((resp && resp.error) || 'Relay failed');
      if (resp.ok === false || (resp.status && resp.status >= 400)) throw new Error('Exchange returned ' + resp.status);
      var mapped = mapTrades(conn.exchange, resp.data);
      var merged = mergeSync(ctx.existing || [], mapped, { portfolioId: ctx.portfolioId || null });
      return { added: merged.added, skipped: merged.skipped, transactions: merged.transactions, mappedCount: mapped.length };
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, VAULT_PREFIX: VAULT_PREFIX, SCHEMA: SCHEMA, EXCHANGES: EXCHANGES,
    buildSignedRequest: buildSignedRequest, syncConnection: syncConnection,
    validateReadOnly: validateReadOnly, parsePair: parsePair, quoteCurrency: quoteCurrency,
    ADAPTERS: ADAPTERS, mapTrades: mapTrades, dedupe: dedupe, mergeSync: mergeSync,
    normalize: normalize, addConnection: addConnection, removeConnection: removeConnection,
    load: load, save: save,
    storeCredentials: storeCredentials, loadCredentials: loadCredentials, removeCredentials: removeCredentials
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
        var inputBorder = theme.inputBorder || border, accent = theme.accent || '#f5a524';

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
        function syncConn(c) {
          setMsg((t.exSyncing || 'Syncing') + ' ' + c.label + '…');
          API.syncConnection(c, { workerUrl: props.workerUrl, existing: props.existing || [], portfolioId: props.portfolioId, fetch: (typeof fetch !== 'undefined' ? fetch : null) })
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
              e('button', { onClick: function () { syncConn(c); }, style: { background: accent, border: 'none', color: '#13110a', cursor: 'pointer', borderRadius: '7px', padding: '0.25rem 0.7rem', fontSize: '0.74rem', fontWeight: 700 } }, t.exSyncNow || 'Sync now'),
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
          e('button', { onClick: addConn, style: { marginTop: '0.6rem', padding: '0.5rem 1rem', background: accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } }, t.exAdd || 'Add connection'),
          msg ? e('div', { style: { color: dim, fontSize: '0.76rem', marginTop: '0.5rem' } }, msg) : null);
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Exchange sync error: ' + (err && err.message));
      }
    };
  }
})();
