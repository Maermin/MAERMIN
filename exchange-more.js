// ============================================================================
// MAERMIN — More read-only exchange syncs  (registers into MaerminExchangeSync)
// ----------------------------------------------------------------------------
// P5-3.8. Bitvavo, Bybit, KuCoin and Bitget, with the same rules as the first
// four (exchange-sync.js): read-only API keys kept only in the vault, requests
// SIGNED IN THIS BROWSER and relayed by the user's Worker to exact read
// endpoints (BROKER_RELAY_POLICY), idempotent merge (exchange + trade id).
//
//   Bitvavo  balance → EUR markets of the held / known coins → trades per market
//   Bybit    the key must be read-only (/v5/user/query-api); spot executions in
//            7-day windows over the last 180 days
//   KuCoin   spot fills in 7-day windows over the last 180 days (passphrase)
//   Bitget   assets → USDT / USDC / EUR pairs of the held / known coins → fills
//            per pair (passphrase)
//
// A fee in the traded coin is valued at the trade price and, on a buy, taken
// off the quantity (the coin arrives net of it), as for Binance; a fee in a
// third asset is kept on the row with a note. Pure adapters and pullers are
// Node-tested in test/exchange-more.test.js against synthetic exchanges that
// check every signature.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var XS = W.MaerminExchangeSync || req(function () { return require('./exchange-sync.js'); });
  if (!XS) return;

  var DAY = 864e5, WINDOWS = 26; // 26 × 7 days ≈ 180 days
  function str(x) { return String(x == null ? '' : x).trim(); }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  // the trade's calendar day in the device's time zone (tax year, holding period)
  function tradeDay(ms) { var t = new Date(Number(ms)); return isNaN(t.getTime()) ? '' : t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }

  // ---- signing (Web Crypto) ---------------------------------------------------
  function subtle() { return (typeof crypto !== 'undefined' && crypto.subtle) || (W.crypto && W.crypto.subtle); }
  function hmac(secret, message) {
    var enc = new TextEncoder();
    return subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return subtle().sign('HMAC', k, enc.encode(message)); }).then(function (b) { return new Uint8Array(b); });
  }
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2); return s; }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'latin1').toString('base64'); }
  function hmacHex(secret, msg) { return hmac(secret, msg).then(hex); }
  function hmacB64(secret, msg) { return hmac(secret, msg).then(b64); }

  // ---- one row, with the fee rules ----------------------------------------------
  // side 'buy'|'sell'; fee in feeAsset (quote, base, or something else)
  function row(exchange, id, base, quote, side, qty, price, fee, feeAsset, ms) {
    base = str(base).toUpperCase(); quote = str(quote).toUpperCase(); feeAsset = str(feeAsset).toUpperCase();
    qty = Math.abs(num(qty)); price = Math.abs(num(price)); fee = Math.abs(num(fee));
    var fees = 0, extra = null;
    if (!fee || !feeAsset || feeAsset === quote) fees = fee;
    else if (feeAsset === base) { fees = fee * price; if (side === 'buy') qty = qty - fee; }
    else extra = { feeAsset: feeAsset, feeQuantity: fee };
    var r = { type: side === 'sell' ? 'sell' : 'buy', category: 'crypto', symbol: base, symbolName: base, quantity: Math.round(qty * 1e10) / 1e10, price: price,
      fees: Math.round(fees * 1e8) / 1e8, currency: XS.quoteCurrency(quote), date: tradeDay(ms), source: 'exchange-sync', exchange: exchange, externalId: str(id) };
    if (extra) { r.feeAsset = extra.feeAsset; r.feeQuantity = extra.feeQuantity; r.notes = __('exFeeNote', 'Fee paid in {asset}: {qty} (not in the cost basis - add it as fee if you want it counted)', { asset: extra.feeAsset, qty: extra.feeQuantity }); }
    return r;
  }
  function splitPair(sym) { var p = XS.parsePair(sym); return p.base && p.quote ? p : null; }
  // the coins held there or already known as crypto in MAERMIN
  function coinsOf(balances, existing) {
    var c = {};
    (balances || []).forEach(function (b) { if (b && b.coin && b.amount > 0) c[str(b.coin).toUpperCase()] = true; });
    (existing || []).forEach(function (t) { if (t && t.category === 'crypto' && t.symbol) c[str(t.symbol).toUpperCase()] = true; });
    return Object.keys(c).filter(function (k) { return /^[A-Z0-9]{2,12}$/.test(k) && ['EUR', 'USD', 'USDT', 'USDC'].indexOf(k) < 0; }).sort().slice(0, 40);
  }
  function windows(now, n) { var out = [], end = now; for (var i = 0; i < n; i++) { out.push([end - 7 * DAY + 1, end]); end -= 7 * DAY; } return out; }
  function seq(list, fn) { var all = []; return list.reduce(function (p, x) { return p.then(function () { return fn(x).then(function (r) { if (Array.isArray(r)) all = all.concat(r); }); }); }, Promise.resolve()).then(function () { return all; }); }

  // ---- Bitvavo -----------------------------------------------------------------------
  var BITVAVO = 'https://api.bitvavo.com';
  function bitvavoSigned(creds, pathQuery, now) {
    var ts = String(now || Date.now());
    return hmacHex(creds.apiSecret, ts + 'GET' + pathQuery).then(function (sig) {
      return { method: 'GET', url: BITVAVO + pathQuery, headers: { 'Bitvavo-Access-Key': creds.apiKey, 'Bitvavo-Access-Signature': sig, 'Bitvavo-Access-Timestamp': ts, 'Bitvavo-Access-Window': '10000' } };
    });
  }
  var bitvavo = {
    adapter: function (raw) {
      return (Array.isArray(raw) ? raw : []).map(function (tr) {
        var p = splitPair(tr.market);
        return p ? row('bitvavo', str(tr.market) + ':' + tr.id, p.base, p.quote, str(tr.side), tr.amount, tr.price, tr.fee, tr.feeCurrency, num(tr.timestamp)) : null;
      }).filter(Boolean);
    },
    pull: function (creds, relay, ctx) {
      return bitvavoSigned(creds, '/v2/balance').then(relay).then(function (bal) {
        var coins = coinsOf((Array.isArray(bal) ? bal : []).map(function (b) { return { coin: b.symbol, amount: num(b.available) + num(b.inOrder) }; }), ctx && ctx.existing);
        return seq(coins, function (c) {
          return bitvavoSigned(creds, '/v2/trades?market=' + c + '-EUR&limit=1000').then(relay).then(function (r) { return r; }, function () { return []; });
        });
      });
    }
  };

  // ---- Bybit (v5) ------------------------------------------------------------------------
  var BYBIT = 'https://api.bybit.com';
  function bybitSigned(creds, path, query, now) {
    var ts = String(now || Date.now()), rw = '10000';
    return hmacHex(creds.apiSecret, ts + creds.apiKey + rw + query).then(function (sig) {
      return { method: 'GET', url: BYBIT + path + (query ? '?' + query : ''), headers: { 'X-BAPI-API-KEY': creds.apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': rw, 'X-BAPI-SIGN': sig } };
    });
  }
  function bybitOk(d) { if (!d || d.retCode !== 0) throw new Error('Bybit: ' + ((d && d.retMsg) || 'error')); return d.result || {}; }
  var bybit = {
    adapter: function (raw) {
      return (Array.isArray(raw) ? raw : []).map(function (tr) {
        var p = splitPair(tr.symbol);
        if (!p) return null;
        var side = str(tr.side).toLowerCase() === 'sell' ? 'sell' : 'buy';
        // spot fees come off what you receive: the coin on a buy, the quote on a sell
        var feeAsset = str(tr.feeCurrency) || (side === 'buy' ? p.base : p.quote);
        return row('bybit', tr.execId, p.base, p.quote, side, tr.execQty, tr.execPrice, tr.execFee, feeAsset, num(tr.execTime));
      }).filter(Boolean);
    },
    pull: function (creds, relay, ctx) {
      var now = (ctx && ctx.now) || Date.now();
      return bybitSigned(creds, '/v5/user/query-api', '').then(relay).then(function (d) {
        var r = bybitOk(d);
        // readOnly: 1 = read only (P5-3.8: a key that may trade or withdraw is refused)
        if (Number(r.readOnly) !== 1) throw new Error(__('exNotReadOnly', '{name}: this API key is not read-only - create a read-only key', { name: NAMES[1] }));
        return seq(windows(now, WINDOWS), function (w) {
          return bybitSigned(creds, '/v5/execution/list', 'category=spot&limit=100&startTime=' + w[0] + '&endTime=' + w[1]).then(relay).then(function (x) { return bybitOk(x).list || []; });
        });
      });
    }
  };

  // ---- KuCoin ------------------------------------------------------------------------------
  var KUCOIN = 'https://api.kucoin.com';
  function kucoinSigned(creds, pathQuery, now) {
    var ts = String(now || Date.now());
    return Promise.all([hmacB64(creds.apiSecret, ts + 'GET' + pathQuery), hmacB64(creds.apiSecret, creds.passphrase)]).then(function (s) {
      return { method: 'GET', url: KUCOIN + pathQuery, headers: { 'KC-API-KEY': creds.apiKey, 'KC-API-SIGN': s[0], 'KC-API-TIMESTAMP': ts, 'KC-API-PASSPHRASE': s[1], 'KC-API-KEY-VERSION': '2' } };
    });
  }
  function kucoinOk(d) { if (!d || String(d.code) !== '200000') throw new Error('KuCoin: ' + ((d && d.msg) || 'error')); return d.data || {}; }
  var kucoin = {
    passphrase: true,
    adapter: function (raw) {
      return (Array.isArray(raw) ? raw : []).map(function (tr) {
        var p = splitPair(tr.symbol);
        return p ? row('kucoin', tr.tradeId + ':' + tr.orderId, p.base, p.quote, str(tr.side), tr.size, tr.price, tr.fee, tr.feeCurrency, num(tr.createdAt)) : null;
      }).filter(Boolean);
    },
    pull: function (creds, relay, ctx) {
      var now = (ctx && ctx.now) || Date.now();
      return seq(windows(now, WINDOWS), function (w) {
        return kucoinSigned(creds, '/api/v1/fills?tradeType=TRADE&pageSize=500&startAt=' + w[0] + '&endAt=' + w[1]).then(relay).then(function (x) { return kucoinOk(x).items || []; });
      });
    }
  };

  // ---- Bitget (v2) ---------------------------------------------------------------------------
  var BITGET = 'https://api.bitget.com';
  function bitgetSigned(creds, path, query, now) {
    var ts = String(now || Date.now());
    return hmacB64(creds.apiSecret, ts + 'GET' + path + (query ? '?' + query : '')).then(function (sig) {
      return { method: 'GET', url: BITGET + path + (query ? '?' + query : ''), headers: { 'ACCESS-KEY': creds.apiKey, 'ACCESS-SIGN': sig, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': creds.passphrase, locale: /en-US/.source } };
    });
  }
  function bitgetOk(d) { if (!d || String(d.code) !== '00000') throw new Error('Bitget: ' + ((d && d.msg) || 'error')); return d.data; }
  var bitget = {
    passphrase: true,
    adapter: function (raw) {
      return (Array.isArray(raw) ? raw : []).map(function (tr) {
        var p = splitPair(tr.symbol), fd = tr.feeDetail || {};
        return p ? row('bitget', tr.tradeId, p.base, p.quote, str(tr.side), tr.size, tr.priceAvg || tr.price, fd.totalFee, fd.feeCoin, num(tr.cTime)) : null;
      }).filter(Boolean);
    },
    pull: function (creds, relay, ctx) {
      return bitgetSigned(creds, '/api/v2/spot/account/assets', '').then(relay).then(function (d) {
        var coins = coinsOf((bitgetOk(d) || []).map(function (a) { return { coin: a.coin, amount: num(a.available) + num(a.frozen) + num(a.locked) }; }), ctx && ctx.existing);
        var pairs = [];
        coins.forEach(function (c) { ['USDT', 'USDC', 'EUR'].forEach(function (q) { pairs.push(c + q); }); });
        return seq(pairs, function (s) {
          return bitgetSigned(creds, '/api/v2/spot/trade/fills', 'symbol=' + s + '&limit=100').then(relay).then(function (x) { return bitgetOk(x) || []; }, function () { return []; });
        });
      });
    }
  };

  // product names (not translated); the first word is the id
  var NAMES = Object.keys({ 'Bitvavo': 1, 'Bybit': 1, 'KuCoin': 1, 'Bitget': 1 });
  var DEFS = [['bitvavo', 'api.bitvavo.com', bitvavo], ['bybit', 'api.bybit.com', bybit], ['kucoin', 'api.kucoin.com', kucoin], ['bitget', 'api.bitget.com', bitget]];
  DEFS.forEach(function (d, i) { XS.registerExchange(d[0], { label: NAMES[i], host: d[1], passphrase: !!d[2].passphrase, adapter: d[2].adapter, pull: d[2].pull }); });

  var api = { row: row, coinsOf: coinsOf, windows: windows, hmacHex: hmacHex, hmacB64: hmacB64, bitvavo: bitvavo, bybit: bybit, kucoin: kucoin, bitget: bitget,
    signed: { bitvavo: bitvavoSigned, bybit: bybitSigned, kucoin: kucoinSigned, bitget: bitgetSigned } };
  if (typeof window !== 'undefined') window.MaerminExchangeMore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
