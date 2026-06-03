/**
 * MAERMIN - Broker / Exchange API Connectors
 * ------------------------------------------------------------------
 * Read-only API sync for the crypto exchanges that expose a signed REST API
 * (Binance, Kraken, Coinbase Exchange). Each connector signs the request with
 * the user's API secret LOCALLY (the secret never leaves the page) and returns
 * trades normalised to the SAME transaction model the CSV importers produce:
 *
 *   { type:'buy'|'sell', symbol, quantity, price, fees, date:'YYYY-MM-DD',
 *     category:'crypto', notes }
 *
 * Exchanges don't send CORS headers for signed endpoints, so the request can be
 * relayed through the user's own Cloudflare Worker (action=brokerproxy) — only
 * the already-computed signature + key travel through it, never the secret. In
 * Electron (no browser CORS) the direct call works without a proxy.
 *
 * Brokers without a usable public API (Trade Republic, Scalable, IBKR) are
 * declared api:false — the wizard steers those to the existing CSV path.
 *
 * Exposes window.BrokerConnectors = {
 *   list(), get(id), fetchTransactions(id, creds),
 *   getProxy(), setProxy(url),
 *   // pure helpers (unit-tested):
 *   normalizeBinance, normalizeKraken, normalizeCoinbase,
 *   splitPair, splitKrakenPair, signBinance, signKraken, signCoinbase
 * }
 */
(function () {
  'use strict';

  var PROXY_KEY = 'maermin_broker_proxy';

  function getProxy() { try { return (localStorage.getItem(PROXY_KEY) || '').trim(); } catch (e) { return ''; } }
  function setProxy(u) { try { localStorage.setItem(PROXY_KEY, (u || '').trim()); } catch (e) {} }

  // ---- encoding helpers ---------------------------------------------------
  var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  function utf8(s) { return enc.encode(s); }
  function toHex(buf) { var b = new Uint8Array(buf), s = '', i; for (i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
  function b64encode(buf) { var b = new Uint8Array(buf), s = '', i; for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64decode(str) { var bin = atob(str), out = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function concatBytes(a, b) { var out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; }

  function subtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof window !== 'undefined' && window.crypto);
    if (!c || !c.subtle) throw new Error('WebCrypto not available');
    return c.subtle;
  }
  function sha256(bytes) { return subtle().digest('SHA-256', bytes).then(function (b) { return new Uint8Array(b); }); }
  function hmac(hash, keyBytes, msgBytes) {
    return subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: { name: hash } }, false, ['sign'])
      .then(function (k) { return subtle().sign('HMAC', k, msgBytes); });
  }

  // ---- pure pair / symbol helpers ----------------------------------------
  var QUOTES = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'EUR', 'USD', 'GBP', 'BTC', 'ETH', 'BNB'];
  function splitPair(sym, sep) {
    if (!sym) return '';
    if (sep && sym.indexOf(sep) !== -1) return sym.split(sep)[0].toLowerCase();
    var up = sym.toUpperCase();
    for (var i = 0; i < QUOTES.length; i++) {
      var q = QUOTES[i];
      if (up.length > q.length && up.slice(-q.length) === q) return up.slice(0, -q.length).toLowerCase();
    }
    return up.toLowerCase();
  }
  function normKrakenAsset(a) {
    var s = (a || '').toUpperCase();
    if (s.length === 4 && (s[0] === 'X' || s[0] === 'Z')) s = s.slice(1); // XXBT -> XBT, ZUSD -> USD
    if (s === 'XBT') s = 'BTC';
    return s;
  }
  function splitKrakenPair(pair) {
    var p = (pair || '').toUpperCase();
    var q = ['ZUSD', 'ZEUR', 'ZGBP', 'USDT', 'USDC', 'USD', 'EUR', 'GBP', 'XBT', 'BTC', 'ETH'];
    for (var i = 0; i < q.length; i++) {
      if (p.length > q[i].length && p.slice(-q[i].length) === q[i]) return normKrakenAsset(p.slice(0, -q[i].length)).toLowerCase();
    }
    return normKrakenAsset(p).toLowerCase();
  }
  function ymd(ms) { var d = new Date(ms); return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0]; }

  // ---- normalisers (pure) -------------------------------------------------
  function normalizeBinance(trades, pairSymbol) {
    return (trades || []).map(function (tr) {
      return {
        type: tr.isBuyer ? 'buy' : 'sell',
        symbol: splitPair(tr.symbol || pairSymbol || '', null),
        quantity: parseFloat(tr.qty) || 0,
        price: parseFloat(tr.price) || 0,
        fees: parseFloat(tr.commission) || 0,
        date: ymd(tr.time),
        category: 'crypto',
        notes: 'Binance'
      };
    }).filter(function (t) { return t.quantity > 0 && t.symbol; });
  }
  function normalizeKraken(result) {
    var trades = (result && result.trades) || {};
    return Object.keys(trades).map(function (id) {
      var tr = trades[id];
      return {
        type: tr.type === 'sell' ? 'sell' : 'buy',
        symbol: splitKrakenPair(tr.pair || ''),
        quantity: parseFloat(tr.vol) || 0,
        price: parseFloat(tr.price) || 0,
        fees: parseFloat(tr.fee) || 0,
        date: ymd((parseFloat(tr.time) || 0) * 1000),
        category: 'crypto',
        notes: 'Kraken'
      };
    }).filter(function (t) { return t.quantity > 0 && t.symbol; });
  }
  function normalizeCoinbase(fills) {
    return (fills || []).map(function (f) {
      var side = (f.side || '').toLowerCase();
      return {
        type: side === 'sell' ? 'sell' : 'buy',
        symbol: (f.product_id || '').split('-')[0].toLowerCase(),
        quantity: parseFloat(f.size) || 0,
        price: parseFloat(f.price) || 0,
        fees: parseFloat(f.fee) || 0,
        date: ymd(Date.parse(f.created_at)),
        category: 'crypto',
        notes: 'Coinbase'
      };
    }).filter(function (t) { return t.quantity > 0 && t.symbol; });
  }

  // ---- signed request builders -------------------------------------------
  // Each returns a transport spec { method, url, headers, body? }.
  function signBinance(creds, symbol, ts) {
    var query = 'symbol=' + encodeURIComponent(symbol) + '&recvWindow=60000&timestamp=' + ts;
    return hmac('SHA-256', utf8(creds.secret), utf8(query)).then(function (sig) {
      return {
        method: 'GET',
        url: 'https://api.binance.com/api/v3/myTrades?' + query + '&signature=' + toHex(sig),
        headers: { 'X-MBX-APIKEY': creds.key }
      };
    });
  }
  function signKraken(creds, nonce) {
    var path = '/0/private/TradesHistory';
    var postdata = 'nonce=' + nonce;
    return sha256(utf8(nonce + postdata)).then(function (sha) {
      var msg = concatBytes(utf8(path), sha);
      return hmac('SHA-512', b64decode(creds.secret), msg).then(function (sig) {
        return {
          method: 'POST',
          url: 'https://api.kraken.com' + path,
          headers: { 'API-Key': creds.key, 'API-Sign': b64encode(sig), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: postdata
        };
      });
    });
  }
  function signCoinbase(creds, product, ts) {
    var path = '/fills?product_id=' + encodeURIComponent(product) + '&limit=100';
    var prehash = ts + 'GET' + path + '';
    return hmac('SHA-256', b64decode(creds.secret), utf8(prehash)).then(function (sig) {
      return {
        method: 'GET',
        url: 'https://api.exchange.coinbase.com' + path,
        headers: {
          'CB-ACCESS-KEY': creds.key,
          'CB-ACCESS-SIGN': b64encode(sig),
          'CB-ACCESS-TIMESTAMP': ts,
          'CB-ACCESS-PASSPHRASE': creds.passphrase || ''
        }
      };
    });
  }

  function splitSymbols(s) {
    return (s || '').split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // ---- connector registry -------------------------------------------------
  var CONNECTORS = {
    binance: {
      id: 'binance', name: 'Binance', api: true,
      fields: [
        { key: 'key', label: 'API Key' },
        { key: 'secret', label: 'API Secret', secret: true },
        { key: 'symbols', label: 'Trading-Paare', placeholder: 'BTCUSDT, ETHUSDT' }
      ],
      buildRequests: function (creds) {
        var ts = Date.now();
        var syms = splitSymbols(creds.symbols);
        if (!syms.length) return Promise.reject(new Error('Mindestens ein Trading-Paar angeben (z.B. BTCUSDT)'));
        return Promise.all(syms.map(function (sym) {
          return signBinance(creds, sym, ts).then(function (spec) { return { spec: spec, symbol: sym }; });
        }));
      },
      extract: function (data, req) {
        if (data && data.code && data.msg) throw new Error('Binance: ' + data.msg);
        return normalizeBinance(Array.isArray(data) ? data : [], req.symbol);
      }
    },
    kraken: {
      id: 'kraken', name: 'Kraken', api: true,
      fields: [
        { key: 'key', label: 'API Key' },
        { key: 'secret', label: 'Private Key', secret: true }
      ],
      buildRequests: function (creds) {
        var nonce = String(Date.now() * 1000);
        return signKraken(creds, nonce).then(function (spec) { return [{ spec: spec }]; });
      },
      extract: function (data) {
        if (data && data.error && data.error.length) throw new Error('Kraken: ' + data.error.join(', '));
        return normalizeKraken(data && data.result);
      }
    },
    coinbase: {
      id: 'coinbase', name: 'Coinbase', api: true,
      fields: [
        { key: 'key', label: 'API Key' },
        { key: 'secret', label: 'API Secret', secret: true },
        { key: 'passphrase', label: 'Passphrase', secret: true },
        { key: 'symbols', label: 'Produkte', placeholder: 'BTC-USD, ETH-EUR' }
      ],
      buildRequests: function (creds) {
        var ts = Math.floor(Date.now() / 1000).toString();
        var syms = splitSymbols(creds.symbols);
        if (!syms.length) return Promise.reject(new Error('Mindestens ein Produkt angeben (z.B. BTC-USD)'));
        return Promise.all(syms.map(function (p) {
          return signCoinbase(creds, p, ts).then(function (spec) { return { spec: spec, symbol: p }; });
        }));
      },
      extract: function (data) {
        if (data && data.message && !Array.isArray(data)) throw new Error('Coinbase: ' + data.message);
        return normalizeCoinbase(Array.isArray(data) ? data : []);
      }
    },
    // No usable public API — handled by the existing CSV importers.
    tradeRepublic: { id: 'tradeRepublic', name: 'Trade Republic', api: false, note: 'No official API — please use CSV export.' },
    scalable: { id: 'scalable', name: 'Scalable Capital', api: false, note: 'No official API — please use CSV export.' },
    interactiveBrokers: { id: 'interactiveBrokers', name: 'Interactive Brokers', api: false, note: 'Requires a local Client Portal Gateway — please use the Activity Statement CSV.' }
  };

  function list() { return Object.keys(CONNECTORS).map(function (k) { var c = CONNECTORS[k]; return { id: c.id, name: c.name, api: !!c.api, fields: c.fields || [], note: c.note }; }); }
  function get(id) { return CONNECTORS[id] || null; }

  // ---- transport ----------------------------------------------------------
  function send(spec) {
    var proxy = getProxy();
    if (proxy) {
      var url = proxy + (proxy.indexOf('?') !== -1 ? '&' : '?') + 'action=brokerproxy';
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.error) throw new Error(j.error);
          if (j.ok === false) throw new Error('Exchange HTTP ' + j.status + (j.data && j.data.msg ? ': ' + j.data.msg : ''));
          return j.data;
        });
    }
    return fetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body })
      .then(function (r) { if (!r.ok) throw new Error('Exchange HTTP ' + r.status); return r.json(); });
  }

  function fetchTransactions(id, creds) {
    var c = CONNECTORS[id];
    if (!c || !c.api) return Promise.reject(new Error('No API connector for ' + id));
    return Promise.resolve(c.buildRequests(creds)).then(function (reqs) {
      var all = [];
      return reqs.reduce(function (chain, rq) {
        return chain.then(function () {
          return send(rq.spec).then(function (data) { all = all.concat(c.extract(data, rq)); });
        });
      }, Promise.resolve()).then(function () { return all; });
    });
  }

  var api = {
    list: list, get: get, fetchTransactions: fetchTransactions,
    getProxy: getProxy, setProxy: setProxy,
    normalizeBinance: normalizeBinance, normalizeKraken: normalizeKraken, normalizeCoinbase: normalizeCoinbase,
    splitPair: splitPair, splitKrakenPair: splitKrakenPair,
    signBinance: signBinance, signKraken: signKraken, signCoinbase: signCoinbase
  };
  if (typeof window !== 'undefined') window.BrokerConnectors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
