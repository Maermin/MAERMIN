// ============================================================================
// MAERMIN — Bring-your-own-key aggregators  (window.MaerminAggregators)
// ----------------------------------------------------------------------------
// P5-3.5. Two account aggregators with the user's OWN API keys, read-only,
// through the user's own Worker (the existing `action=brokerproxy` relay, with
// exact read endpoints per host - see BROKER_RELAY_POLICY in the Worker):
//
//   - GoCardless Bank Account Data (banks, PSD2): the secret id / key fetch a
//     short-lived token; the user links a bank on GoCardless's page (a
//     "requisition"); balances and transactions of the linked accounts follow.
//     Transactions become cash bookings only for ticked accounts, with the
//     rules and ids of bank-sync.js (source 'gocardless').
//   - SnapTrade (brokers): requests are signed in this browser with the
//     consumer key (HMAC-SHA256); only the signature goes through the Worker.
//     A read-only connection is made in SnapTrade's portal; accounts,
//     positions and activities follow. Trades, payouts and cash activities are
//     imported once each (source 'snaptrade' + the activity id); positions
//     are compared with MAERMIN by symbol.
//
// Keys live only in the vault (encrypted per provider, never in a backup or
// sync; re-encrypted on key rotation through auth.js). The stored metadata
// (maermin_aggregators, sensitive) holds no key or token. Pure parts are
// Node-tested in test/aggregators.test.js against synthetic upstreams through
// the real Worker relay.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function req(f) { try { return f(); } catch (e) { return null; } }
  var BS = W.MaerminBankSync || req(function () { return require('./bank-sync.js'); });

  var STORAGE_KEY = 'maermin_aggregators';
  var VAULT_PREFIX = 'maermin_agg_cred_';
  var PROVIDERS = ['gocardless', 'snaptrade'];
  // product names (not translated)
  var BRAND_NAMES = Object.keys({ 'GoCardless Bank Account Data': 1, 'SnapTrade': 1 });
  var GC = 'https://bankaccountdata.gocardless.com/api/v2';
  var ST = 'https://api.snaptrade.com/api/v1';

  function str(x) { return String(x == null ? '' : x).trim(); }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : null; }
  function AggError(message, code) { var e = new Error(message); e.code = code || null; return e; }

  // ---- relay through the user's Worker --------------------------------------
  function makeRelay(workerUrl, fetchImpl) {
    var base = str(workerUrl).replace(/\/+$/, '');
    return function (spec) {
      return (fetchImpl || fetch)(base + '/?action=brokerproxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || j.error) throw AggError((j && j.error) || 'relay failed', 'relay');
          if (!j.ok) throw AggError(errorDetail(j.data) || ('HTTP ' + j.status), j.status === 401 || j.status === 403 ? 'auth' : 'upstream');
          return j.data;
        });
    };
  }
  function errorDetail(d) {
    if (!d || typeof d !== 'object') return typeof d === 'string' ? d.slice(0, 200) : '';
    return str(d.detail || d.summary || d.message || d.error || (d.secret_key && d.secret_key.detail)).slice(0, 200);
  }

  // ---- GoCardless Bank Account Data -------------------------------------------
  function gcToken(creds, relay) {
    return relay({ method: 'POST', url: GC + '/token/new/', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret_id: creds.secretId, secret_key: creds.secretKey }) })
      .then(function (d) { if (!d || !d.access) throw AggError(__('agErrUpstream', 'unexpected answer from the provider'), 'auth'); return d.access; });
  }
  function gcAuth(token) { return { Authorization: /Bearer/.source + ' ' + token }; } // (the scheme name, not UI text)
  function gcInstitutions(token, country, relay) {
    return relay({ method: 'GET', url: GC + '/institutions/?country=' + encodeURIComponent(country || 'DE'), headers: gcAuth(token) })
      .then(function (d) { return (Array.isArray(d) ? d : []).map(function (i) { return { id: str(i.id), name: str(i.name) }; }).filter(function (i) { return i.id; }); });
  }
  function gcLink(token, institutionId, redirect, relay) {
    var body = { redirect: redirect, institution_id: institutionId, reference: 'maermin-' + Date.now().toString(36), user_language: 'DE' };
    return relay({ method: 'POST', url: GC + '/requisitions/', headers: Object.assign({ 'Content-Type': 'application/json' }, gcAuth(token)), body: JSON.stringify(body) })
      .then(function (d) { if (!d || !d.id || !d.link) throw AggError(__('agErrUpstream', 'unexpected answer from the provider'), 'upstream'); return { requisitionId: d.id, link: d.link }; });
  }
  function gcStatus(token, requisitionId, relay) {
    return relay({ method: 'GET', url: GC + '/requisitions/' + requisitionId + '/', headers: gcAuth(token) })
      .then(function (d) { return { status: str(d && d.status), accounts: (d && Array.isArray(d.accounts) ? d.accounts : []).map(str) }; });
  }
  // the booked balance (closingBooked, interimBooked, expected, first)
  function gcBalance(list) {
    var arr = Array.isArray(list) ? list : [];
    var pick = ['closingBooked', 'interimBooked', 'interimAvailable', 'expected'].map(function (t) { return arr.filter(function (b) { return b.balanceType === t; })[0]; }).filter(Boolean)[0] || arr[0];
    if (!pick || !pick.balanceAmount) return null;
    var v = num(pick.balanceAmount.amount);
    return v === null ? null : { amount: v, currency: str(pick.balanceAmount.currency) || 'EUR', date: str(pick.referenceDate) || null };
  }
  // GoCardless transactions → rows for bank-sync.js toBookings
  function gcRows(list) {
    return (Array.isArray(list) ? list : []).map(function (tr) {
      var amt = tr.transactionAmount || {};
      var purpose = str(tr.remittanceInformationUnstructured) || (Array.isArray(tr.remittanceInformationUnstructuredArray) ? tr.remittanceInformationUnstructuredArray.join(' ') : '') || str(tr.additionalInformation);
      var amount = num(amt.amount);
      return { id: str(tr.transactionId || tr.internalTransactionId) || null, date: str(tr.bookingDate || tr.valueDate).slice(0, 10), amount: amount === null ? 0 : amount,
        currency: str(amt.currency) || 'EUR', purpose: purpose, name: str(amount < 0 ? tr.creditorName : tr.debtorName), bookingText: str(tr.proprietaryBankTransactionCode) };
    });
  }
  function gcFetch(token, accountIds, relay) {
    var out = [];
    return (accountIds || []).reduce(function (p, id) {
      return p.then(function () {
        var acc = { id: id, iban: '', name: '', currency: 'EUR', balance: null, rows: [] };
        out.push(acc);
        var get = function (part) { return relay({ method: 'GET', url: GC + '/accounts/' + id + '/' + part + '/', headers: gcAuth(token) }); };
        return get('details').then(function (d) { var a = (d && d.account) || {}; acc.iban = str(a.iban); acc.name = str(a.name || a.product || a.ownerName); acc.currency = str(a.currency) || 'EUR'; })
          .then(function () { return get('balances'); }).then(function (d) { acc.balance = gcBalance(d && d.balances); })
          .then(function () { return get('transactions'); }).then(function (d) { acc.rows = gcRows(d && d.transactions && d.transactions.booked); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  // ---- SnapTrade ----------------------------------------------------------------
  // Signature: base64(HMAC-SHA256(consumerKey, canonical JSON of
  // { content, path, query })), keys sorted, no spaces; content = body or null.
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  }
  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'latin1').toString('base64');
  }
  function hmacB64(key, message) {
    var enc = new TextEncoder();
    var subtle = (typeof crypto !== 'undefined' && crypto.subtle) || (W.crypto && W.crypto.subtle);
    return subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return subtle.sign('HMAC', k, enc.encode(message)); }).then(b64);
  }
  function stSign(consumerKey, path, query, content) { return hmacB64(consumerKey, canonical({ content: content == null ? null : content, path: path, query: query })); }
  // creds = { clientId, consumerKey, userId?, userSecret? }; params: extra query
  function stRequest(creds, method, path, params, body, now) {
    var q = ['clientId=' + encodeURIComponent(creds.clientId), 'timestamp=' + Math.floor((now || Date.now()) / 1000)];
    if (creds.userId) q.push('userId=' + encodeURIComponent(creds.userId));
    if (creds.userSecret) q.push('userSecret=' + encodeURIComponent(creds.userSecret));
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') q.push(k + '=' + encodeURIComponent(params[k])); });
    var query = q.join('&'), fullPath = '/api/v1' + path;
    return stSign(creds.consumerKey, fullPath, query, body || null).then(function (sig) {
      var spec = { method: method, url: ST + path + '?' + query, headers: { Signature: sig } };
      if (body) { Object.assign(spec.headers, { 'Content-Type': 'application/json' }); spec.body = JSON.stringify(body); }
      return spec;
    });
  }
  function stRegister(creds, relay, userId) {
    var id = userId || ('maermin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    return stRequest({ clientId: creds.clientId, consumerKey: creds.consumerKey }, 'POST', '/snapTrade/registerUser', null, { userId: id }).then(relay)
      .then(function (d) { if (!d || !d.userSecret) throw AggError(__('agErrUpstream', 'unexpected answer from the provider'), 'upstream'); return { userId: str(d.userId) || id, userSecret: str(d.userSecret) }; });
  }
  function stLoginLink(creds, relay) {
    return stRequest(creds, 'POST', '/snapTrade/login', null, { connectionType: 'read' }).then(relay)
      .then(function (d) { var u = str(d && (d.redirectURI || d.loginRedirectURI)); if (!/^https:\/\//.test(u)) throw AggError(__('agErrUpstream', 'unexpected answer from the provider'), 'upstream'); return u; });
  }
  function stFetch(creds, relay, opts) {
    opts = opts || {};
    var out = { accounts: [], activities: [] };
    return stRequest(creds, 'GET', '/accounts').then(relay).then(function (list) {
      return (Array.isArray(list) ? list : []).reduce(function (p, a) {
        return p.then(function () {
          var bal = a.balance && a.balance.total ? { amount: num(a.balance.total.amount), currency: str(a.balance.total.currency) || 'EUR' } : null;
          var acc = { id: str(a.id), name: str(a.name), number: str(a.number).slice(-4), institution: str(a.institution_name), balance: bal && bal.amount !== null ? bal : null, positions: [] };
          out.accounts.push(acc);
          return stRequest(creds, 'GET', '/accounts/' + acc.id + '/positions').then(relay).then(function (ps) {
            acc.positions = (Array.isArray(ps) ? ps : []).map(stPosition).filter(Boolean);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      return stRequest(creds, 'GET', '/activities', { startDate: opts.startDate, endDate: opts.endDate }).then(relay);
    }).then(function (acts) { out.activities = Array.isArray(acts) ? acts : (acts && Array.isArray(acts.data) ? acts.data : []); return out; });
  }
  function stSymbolOf(sym) {
    // positions: { symbol: { symbol: { symbol, description, currency } } }; activities: { symbol: { symbol, description, currency } }
    var s = sym && sym.symbol && typeof sym.symbol === 'object' ? sym.symbol : sym;
    if (!s) return null;
    return { symbol: str(s.symbol || s.raw_symbol).toUpperCase(), name: str(s.description), currency: str(s.currency && (s.currency.code || s.currency)) || '' };
  }
  function stPosition(p) {
    var s = stSymbolOf(p && p.symbol);
    var q = num(p && p.units);
    if (!s || !s.symbol || q === null) return null;
    return { symbol: s.symbol, name: s.name, quantity: q, price: num(p.price), currency: s.currency || 'USD' };
  }
  var ST_TRADES = { BUY: 'buy', SELL: 'sell', REI: 'buy' };
  var ST_CASH = { CONTRIBUTION: 'deposit', DEPOSIT: 'deposit', WITHDRAWAL: 'withdrawal', FEE: 'fee', TAX: 'tax' };
  // activities → transactions (+ how many were left out, by type)
  function mapActivities(acts, opts) {
    opts = opts || {};
    var out = [], skipped = {};
    (acts || []).forEach(function (a) {
      if (!a || !a.id) return;
      var type = str(a.type).toUpperCase();
      var date = str(a.trade_date || a.settlement_date).slice(0, 10);
      var cur = str(a.currency && (a.currency.code || a.currency)) || 'USD';
      var s = stSymbolOf(a.symbol);
      var units = Math.abs(num(a.units) || 0), price = Math.abs(num(a.price) || 0), amount = Math.abs(num(a.amount) || 0), fee = Math.abs(num(a.fee) || 0);
      var base = { source: 'snaptrade', externalId: 'st-' + str(a.id), date: date, currency: cur, portfolioId: opts.portfolioId || undefined };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped[type || '?'] = (skipped[type || '?'] || 0) + 1; return; }
      if (ST_TRADES[type] && s && s.symbol && units > 0 && price > 0) {
        out.push(Object.assign(base, { category: 'stocks', type: ST_TRADES[type], symbol: s.symbol, symbolName: s.name, quantity: units, price: price, fees: fee }));
      } else if (type === 'DIVIDEND' && s && s.symbol && amount > 0) {
        // the share count when SnapTrade has it, else 1 × the amount
        var q = units > 0 ? units : 1;
        out.push(Object.assign(base, { category: 'stocks', type: 'dividend', symbol: s.symbol, symbolName: s.name, quantity: q, price: amount / q, fees: fee }));
      } else if (ST_CASH[type] && amount > 0) {
        out.push(Object.assign(base, { category: 'cashflow', type: ST_CASH[type], amount: amount }));
      } else skipped[type || '?'] = (skipped[type || '?'] || 0) + 1;
    });
    return { transactions: out, skipped: skipped };
  }
  function heldBySymbol(transactions) {
    var q = {};
    (transactions || []).forEach(function (t) {
      if (!t || (t.type !== 'buy' && t.type !== 'sell') || !t.symbol) return;
      var k = str(t.symbol).toUpperCase();
      q[k] = (q[k] || 0) + (t.type === 'buy' ? 1 : -1) * (Number(t.quantity) || 0);
    });
    return q;
  }
  function positionsDiff(positions, transactions) {
    var held = heldBySymbol(transactions);
    return (positions || []).map(function (p) {
      var mine = held[p.symbol];
      var known = mine !== undefined;
      var diff = known ? Math.round((p.quantity - mine) * 1e6) / 1e6 : null;
      return { symbol: p.symbol, name: p.name, broker: p.quantity, maermin: known ? Math.round(mine * 1e6) / 1e6 : null, diff: diff, status: !known ? 'missing' : diff === 0 ? 'match' : 'differs' };
    });
  }

  // ---- state (no keys, no tokens) ------------------------------------------------
  function cleanAcc(a) {
    if (!a || typeof a !== 'object' || !str(a.id)) return null;
    var bal = a.balance && num(a.balance.amount) !== null ? { amount: num(a.balance.amount), currency: str(a.balance.currency) || 'EUR', date: str(a.balance.date) || null } : null;
    return { id: str(a.id).slice(0, 64), iban: str(a.iban).slice(0, 34), name: str(a.name).slice(0, 80), institution: str(a.institution).slice(0, 80), currency: str(a.currency) || 'EUR', balance: bal, importBookings: !!a.importBookings };
  }
  // P5-3.7: the last failed sync of a provider (the Data check names it)
  function cleanErr(x) { return x && str(x.message) ? { date: str(x.date).slice(0, 10) || null, message: str(x.message).slice(0, 200) } : null; }
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var gc = o.gocardless || {}, st = o.snaptrade || {};
    return {
      version: 1,
      gocardless: { connected: !!gc.connected, requisitionId: /^[0-9a-f-]{36}$/.test(str(gc.requisitionId)) ? str(gc.requisitionId) : '', institutionId: str(gc.institutionId).slice(0, 80), institutionName: str(gc.institutionName).slice(0, 80),
        lastSync: str(gc.lastSync) || null, lastError: cleanErr(gc.lastError), accounts: (Array.isArray(gc.accounts) ? gc.accounts : []).map(cleanAcc).filter(Boolean).slice(0, 30) },
      snaptrade: { connected: !!st.connected, registered: !!st.registered, lastSync: str(st.lastSync) || null, lastError: cleanErr(st.lastError), accounts: (Array.isArray(st.accounts) ? st.accounts : []).map(cleanAcc).filter(Boolean).slice(0, 30) }
    };
  }
  var _demo = null;
  function demoActive() { return !!(W.MaerminDemo && W.MaerminDemo.isActive && W.MaerminDemo.isActive()); }
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() { if (demoActive()) return _demo || (_demo = normalize(null)); var s = store(); try { return normalize(s ? s.getItem(STORAGE_KEY) : null); } catch (e) { return normalize(null); } }
  function save(state) { if (demoActive()) { _demo = normalize(state); return true; } var s = store(); if (!s) return false; try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; } }

  // ---- keys in the vault -------------------------------------------------------------
  function vault() { var V = W.MaerminVault; if (!V || !V.isUnlocked || !V.isUnlocked()) throw AggError(__('agVaultLocked', 'Unlock the vault to use your API keys.'), 'locked'); return V; }
  function storeKeys(provider, creds) {
    return Promise.resolve().then(function () {
      if (PROVIDERS.indexOf(provider) < 0) throw AggError(__('agErrUpstream', 'unexpected answer from the provider'), 'provider');
      return vault().encryptJSON(creds, 'agg-cred:' + provider);
    }).then(function (env) { localStorage.setItem(VAULT_PREFIX + provider, JSON.stringify(env)); return true; });
  }
  function loadKeys(provider) {
    return Promise.resolve().then(function () {
      var raw = null;
      try { raw = JSON.parse(localStorage.getItem(VAULT_PREFIX + provider) || 'null'); } catch (e) { raw = null; }
      if (!raw) return null;
      return vault().decryptJSON(raw, 'agg-cred:' + provider);
    });
  }
  function removeKeys(provider) { try { localStorage.removeItem(VAULT_PREFIX + provider); } catch (e) { /* non-fatal */ } }
  function hasKeys(provider) { try { return !!localStorage.getItem(VAULT_PREFIX + provider); } catch (e) { return false; } }
  // key rotation (auth.js): decrypt with the old key, re-encrypt with the new one
  function exportAllCredentials() {
    var out = {};
    return Promise.all(PROVIDERS.map(function (p) { return loadKeys(p).then(function (c) { if (c) out[p] = c; }, function () { /* unreadable */ }); })).then(function () { return out; });
  }
  function importAllCredentials(map) {
    return Promise.all(Object.keys(map || {}).map(function (p) { return storeKeys(p, map[p]); })).then(function () { return true; });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, VAULT_PREFIX: VAULT_PREFIX, PROVIDERS: PROVIDERS,
    makeRelay: makeRelay, gcToken: gcToken, gcInstitutions: gcInstitutions, gcLink: gcLink, gcStatus: gcStatus, gcFetch: gcFetch, gcBalance: gcBalance, gcRows: gcRows,
    canonical: canonical, stSign: stSign, stRequest: stRequest, stRegister: stRegister, stLoginLink: stLoginLink, stFetch: stFetch,
    mapActivities: mapActivities, positionsDiff: positionsDiff, heldBySymbol: heldBySymbol,
    normalize: normalize, load: load, save: save,
    storeKeys: storeKeys, loadKeys: loadKeys, removeKeys: removeKeys, hasKeys: hasKeys, exportAllCredentials: exportAllCredentials, importAllCredentials: importAllCredentials
  };

  // --------------------------------------------------------------------------
  // React view: Data → Broker Import, below Bank sync.
  // props: theme, workerUrl, existing, portfolioId, onImport(rows), formatAmount?
  // --------------------------------------------------------------------------
  function Panel(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    // R4.6: Card, provider boxes, shared buttons / inputs and the table look
    var UIC = window.MaerminComponents;
    var btn = function (primary) { return ['ui-btn', primary ? 'ui-btn--primary' : 'ui-btn--secondary', 'ui-btn--sm'].join(' '); };
    var s0 = useState(load), st = s0[0], setSt = s0[1];
    var k0 = useState({ gcId: '', gcKey: '', stClient: '', stKey: '' }), keys = k0[0], setKeys = k0[1];
    var b0 = useState(''), busy = b0[0], setBusy = b0[1];
    var m0 = useState(''), msg = m0[0], setMsg = m0[1];
    var i0 = useState(null), insts = i0[0], setInsts = i0[1];
    var q0 = useState(''), instQuery = q0[0], setInstQuery = q0[1];
    var r0 = useState({}), results = r0[0], setResults = r0[1]; // in memory: rows, positions, activities
    var h0 = useState({ gocardless: hasKeys('gocardless'), snaptrade: hasKeys('snaptrade') }), have = h0[0], setHave = h0[1];
    var demo = demoActive();
    var today = function () { return (W.MaerminUtils && W.MaerminUtils.todayISO) ? W.MaerminUtils.todayISO() : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO(); };
    function mutate(next) { save(next); setSt(normalize(next)); }
    function relay() { return makeRelay(props.workerUrl); }
    // a failed sync is remembered for the Data check (P5-3.7); a pending bank approval is not a failure
    function failed(provider) {
      return function (err) {
        if (!(err && err.code === 'pending')) { var n = normalize(load()); n[provider] = Object.assign({}, n[provider], { lastError: { date: today(), message: (err && err.message) || String(err) } }); mutate(n); }
        fail(err);
      };
    }
    function fail(err) {
      setBusy('');
      var c = err && err.code;
      setMsg(c === 'auth' ? __('agErrAuth', 'The provider refused the keys or the access expired ({msg}).', { msg: err.message })
        : c === 'relay' ? __('agErrRelay', 'Your Worker refused the request ({msg}) - redeploy it if it is older than 2026.10.8.', { msg: err.message })
        : __('agFailed', 'Failed: {msg}', { msg: (err && err.message) || String(err) }));
    }
    function saveKeys(provider) {
      var creds = provider === 'gocardless' ? { secretId: str(keys.gcId), secretKey: str(keys.gcKey) } : { clientId: str(keys.stClient), consumerKey: str(keys.stKey) };
      if (provider === 'gocardless' ? !(creds.secretId && creds.secretKey) : !(creds.clientId && creds.consumerKey)) { setMsg(__('agNeedKeys', 'Enter both values.')); return; }
      storeKeys(provider, creds).then(function () {
        setKeys({ gcId: '', gcKey: '', stClient: '', stKey: '' });
        setHave(Object.assign({}, have, (function () { var o = {}; o[provider] = true; return o; })()));
        setMsg(__('agKeysStored', 'Keys encrypted in your vault.'));
      }, fail);
    }
    function forget(provider) {
      W.MaerminUtils.confirmThen({ title: __('agForgetTitle', 'Remove the keys and the connection?'), message: __('agForgetMsg', 'The keys are deleted from this vault. Bookings already imported stay.'), confirmLabel: __('agForget', 'Remove'), cancelLabel: __('cancel', 'Cancel') }, function () {
        removeKeys(provider);
        var n = normalize(st); n[provider] = normalize(null)[provider]; mutate(n);
        setHave(Object.assign({}, have, (function () { var o = {}; o[provider] = false; return o; })()));
      });
    }
    // GoCardless
    function gcLoadBanks() {
      setBusy('gc'); setMsg('');
      loadKeys('gocardless').then(function (c) { return gcToken(c, relay()); }).then(function (tok) { return gcInstitutions(tok, 'DE', relay()); })
        .then(function (list) { setInsts(list); setBusy(''); }, fail);
    }
    function gcConnect(inst) {
      setBusy('gc');
      var redirect = (W.location ? W.location.href.split('?')[0].split('#')[0] : 'https://maermin.github.io/MAERMIN/');
      loadKeys('gocardless').then(function (c) { return gcToken(c, relay()); }).then(function (tok) { return gcLink(tok, inst.id, redirect, relay()); }).then(function (l) {
        var n = normalize(st); n.gocardless = Object.assign({}, n.gocardless, { requisitionId: l.requisitionId, institutionId: inst.id, institutionName: inst.name, connected: false }); mutate(n);
        setInsts(null); setBusy('');
        setMsg(__('agGcOpened', 'Your bank\'s page opened in a new tab. Approve the access there, then press "Sync".'));
        if (W.open) W.open(l.link, '_blank', 'noopener');
      }, fail);
    }
    function gcSync() {
      setBusy('gc'); setMsg('');
      var tokRef;
      loadKeys('gocardless').then(function (c) { return gcToken(c, relay()); }).then(function (tok) { tokRef = tok; return gcStatus(tok, st.gocardless.requisitionId, relay()); }).then(function (s) {
        if (s.status !== 'LN' || !s.accounts.length) throw AggError(__('agGcNotLinked', 'The bank access is not approved yet (status {s}).', { s: s.status || '?' }), 'pending');
        return gcFetch(tokRef, s.accounts, relay());
      }).then(function (accs) {
        var ticks = {}; st.gocardless.accounts.forEach(function (a) { ticks[a.id] = a.importBookings; });
        var n = normalize(st);
        n.gocardless = Object.assign({}, n.gocardless, { connected: true, lastSync: today(), lastError: null, accounts: accs.map(function (a) { return { id: a.id, iban: a.iban, name: a.name, currency: a.currency, balance: a.balance, importBookings: !!ticks[a.id] }; }) });
        mutate(n);
        setResults(function (prev) { var o = Object.assign({}, prev); accs.forEach(function (a) { o['gc:' + a.id] = a.rows; }); return o; });
        setBusy(''); setMsg(__('agSynced', 'Sync finished.'));
      }, failed('gocardless'));
    }
    // SnapTrade
    function stCreds() {
      return loadKeys('snaptrade').then(function (c) {
        if (!c) throw AggError(__('agNeedKeys', 'Enter both values.'));
        if (c.userId && c.userSecret) return c;
        return stRegister(c, relay()).then(function (u) {
          var full = Object.assign({}, c, u);
          return storeKeys('snaptrade', full).then(function () { var n = normalize(st); n.snaptrade.registered = true; mutate(n); return full; });
        });
      });
    }
    function stConnect() {
      setBusy('st'); setMsg('');
      stCreds().then(function (c) { return stLoginLink(c, relay()); }).then(function (url) {
        setBusy(''); setMsg(__('agStOpened', 'SnapTrade\'s connection page opened in a new tab (read-only). Connect your broker there, then press "Sync".'));
        if (W.open) W.open(url, '_blank', 'noopener');
      }, fail);
    }
    function stSync() {
      setBusy('st'); setMsg('');
      var end = today(), start = (BS ? BS.sinceDate(end, 365 * 5) : '2020-01-01');
      stCreds().then(function (c) { return stFetch(c, relay(), { startDate: start, endDate: end }); }).then(function (res) {
        var n = normalize(st);
        n.snaptrade = Object.assign({}, n.snaptrade, { connected: res.accounts.length > 0, lastSync: today(), lastError: null, accounts: res.accounts.map(function (a) { return { id: a.id, name: a.name + (a.number ? ' …' + a.number : ''), institution: a.institution, balance: a.balance }; }) });
        mutate(n);
        setResults(function (prev) { return Object.assign({}, prev, { st: res }); });
        setBusy(''); setMsg(res.accounts.length ? __('agSynced', 'Sync finished.') : __('agStNone', 'No broker connected yet: press "Connect broker" first.'));
      }, failed('snaptrade'));
    }

    var card0 = function (testid, title, body) { return e('div', { 'data-testid': testid, className: 'ui-taxp__box' }, e('h4', { className: 'ui-dlg-sec__title' }, title), body); };
    var amount = function (b) { return b ? (props.formatAmount ? props.formatAmount(b.amount, b.currency) : b.amount.toFixed(2) + ' ' + b.currency) + (b.date ? ' · ' + b.date : '') : ''; };
    var keyForm = function (provider) {
      var gc = provider === 'gocardless';
      return e('div', { className: 'ui-ag-keys' },
        e('input', { 'data-testid': gc ? 'ag-gc-id' : 'ag-st-client', autoComplete: 'off', 'aria-label': gc ? __('agGcId', 'Secret ID') : __('agStClient', 'Client ID'), placeholder: gc ? __('agGcId', 'Secret ID') : __('agStClient', 'Client ID'), value: gc ? keys.gcId : keys.stClient, onChange: function (ev) { setKeys(Object.assign({}, keys, gc ? { gcId: ev.target.value } : { stClient: ev.target.value })); }, className: 'ui-input' }),
        e('input', { 'data-testid': gc ? 'ag-gc-key' : 'ag-st-key', type: 'password', autoComplete: 'off', 'aria-label': gc ? __('agGcKey', 'Secret key') : __('agStKey', 'Consumer key'), placeholder: gc ? __('agGcKey', 'Secret key') : __('agStKey', 'Consumer key'), value: gc ? keys.gcKey : keys.stKey, onChange: function (ev) { setKeys(Object.assign({}, keys, gc ? { gcKey: ev.target.value } : { stKey: ev.target.value })); }, className: 'ui-input' }),
        e('button', { 'data-testid': gc ? 'ag-gc-save' : 'ag-st-save', className: btn(true), onClick: function () { saveKeys(provider); } }, __('agSaveKeys', 'Save keys')));
    };

    if (!props.workerUrl || demo) {
      return e(window.MaerminUI.EmptyState, { testid: 'aggregators', kind: demo ? 'demo' : 'worker', action: demo ? undefined : window.MaerminUI.workerAction(), title: __('agTitle', 'Aggregators with your own API keys'), text: demo ? __('agDemo', 'Not available in the demo.') : __('agNeedWorker', 'Goes through your own Worker: add its URL in API Settings.') });
    }

    // GoCardless body
    var gcState = st.gocardless;
    var gcBody = [];
    gcBody.push(e('div', { key: 'n', className: 'ui-note' }, __('agGcNote', 'Banks across Europe through PSD2, with your own GoCardless Bank Account Data keys (free plan available). The secret key goes through your own Worker to fetch a short-lived token; GoCardless sees your bank data as your data processor.')));
    if (!have.gocardless) gcBody.push(e('div', { key: 'k' }, keyForm('gocardless')));
    else {
      gcBody.push(e('div', { key: 'a', className: 'ui-actions' },
        e('button', { 'data-testid': 'ag-gc-banks', className: btn(!gcState.requisitionId), disabled: !!busy, onClick: gcLoadBanks }, gcState.requisitionId ? __('agGcOther', 'Link another bank') : __('agGcLink', 'Link a bank')),
        gcState.requisitionId ? e('button', { 'data-testid': 'ag-gc-sync', className: btn(true), disabled: !!busy, onClick: gcSync }, busy === 'gc' ? __('agBusy', 'Working…') : __('agSync', 'Sync')) : null,
        e('button', { className: btn(false), onClick: function () { forget('gocardless'); } }, __('agForget', 'Remove'))));
      if (gcState.institutionName) gcBody.push(e('div', { key: 'i', className: 'ui-note' }, gcState.institutionName + ' · ' + (gcState.lastSync ? __('agLastSync', 'last sync {date}', { date: gcState.lastSync }) : __('agNotYet', 'waiting for your approval at the bank'))));
      if (insts) {
        var shown = insts.filter(function (i) { return !instQuery || i.name.toLowerCase().indexOf(instQuery.toLowerCase()) > -1; }).slice(0, 12);
        gcBody.push(e('div', { key: 'l', className: 'ui-ag-list' },
          e('input', { 'data-testid': 'ag-gc-search', 'aria-label': __('agGcSearch', 'Search your bank'), placeholder: __('agGcSearch', 'Search your bank'), value: instQuery, onChange: function (ev) { setInstQuery(ev.target.value); }, className: 'ui-input' }),
          shown.map(function (i) { return e('button', { key: i.id, 'data-testid': 'ag-gc-inst', className: [btn(false), 'ui-ag-inst'].join(' '), onClick: function () { gcConnect(i); } }, i.name); })));
      }
      gcState.accounts.forEach(function (a) {
        var rows = results['gc:' + a.id];
        var book = rows && BS ? BS.toBookings({ iban: a.iban, accountNo: a.id, currency: a.currency }, rows, { source: 'gocardless', portfolioId: props.portfolioId }) : null;
        var fresh = book ? BS.newOnly(book.rows, props.existing) : [];
        gcBody.push(e('div', { key: a.id, 'data-testid': 'ag-gc-account', className: 'ui-sync-account' },
          e('div', { className: ['ui-dlg-sec__head', 'ui-ag-acct'].join(' ') },
            e('span', null, (a.name || __('agAccount', 'Account')) + (a.iban ? ' · ' + a.iban : '')), e('span', { 'data-testid': 'ag-gc-balance' }, amount(a.balance))),
          book ? e('div', { className: ['ui-actions', 'ui-ag-tools'].join(' ') },
            e('label', { className: 'ui-check' },
              e('input', { type: 'checkbox', 'data-testid': 'ag-gc-tick', checked: a.importBookings, onChange: function (ev) {
                var n = normalize(st); n.gocardless.accounts = n.gocardless.accounts.map(function (x) { return x.id === a.id ? Object.assign({}, x, { importBookings: ev.target.checked }) : x; }); mutate(n);
              } }), __('bsImportTick', 'Book this account\'s transactions as cash bookings')),
            e('span', null, __('agNewN', '{n} new {n:booking|bookings}', { n: fresh.length }) + (book.skipped ? ' · ' + __('bsSkippedSec', '{n} securities {n:booking|bookings} left to the depot / PDF import', { n: book.skipped }) : '')),
            a.importBookings && fresh.length ? e('button', { 'data-testid': 'ag-gc-import', className: btn(true), onClick: function () { if (props.onImport) props.onImport(fresh); } }, __('bsImportN', 'Import {n}', { n: fresh.length })) : null,
            // P5-5.3: every booking of the account into the Budget
            typeof window !== 'undefined' && window.MaerminBudget && rows.length ? e('button', { 'data-testid': 'ag-gc-budget', className: btn(false), onClick: function () {
              var n = window.MaerminBudget.addBankRows({ iban: a.iban, accountNo: a.id, currency: a.currency }, rows, 'gocardless');
              if (props.addToast) props.addToast(__('bgAddedFromBank', '{n} bookings added to the Budget', { n: n }), 'success');
            } }, __('bgAddToBudget', 'Add to Budget')) : null) : null));
      });
    }

    // SnapTrade body
    var stState = st.snaptrade, stRes = results.st;
    var stBody = [];
    stBody.push(e('div', { key: 'n', className: 'ui-note' }, __('agStNote', 'Brokers through SnapTrade, with your own SnapTrade keys (read-only connections; free for a few connections). Requests are signed in this browser - the consumer key never leaves it; SnapTrade sees the connected accounts\' data.')));
    if (!have.snaptrade) stBody.push(e('div', { key: 'k' }, keyForm('snaptrade')));
    else {
      stBody.push(e('div', { key: 'a', className: 'ui-actions' },
        e('button', { 'data-testid': 'ag-st-connect', className: btn(!stState.connected), disabled: !!busy, onClick: stConnect }, __('agStConnect', 'Connect broker')),
        e('button', { 'data-testid': 'ag-st-sync', className: btn(true), disabled: !!busy, onClick: stSync }, busy === 'st' ? __('agBusy', 'Working…') : __('agSync', 'Sync')),
        e('button', { className: btn(false), onClick: function () { forget('snaptrade'); } }, __('agForget', 'Remove'))));
      if (stState.lastSync) stBody.push(e('div', { key: 'i', className: 'ui-note' }, __('agLastSync', 'last sync {date}', { date: stState.lastSync })));
      stState.accounts.forEach(function (a) {
        var live = stRes && stRes.accounts.filter(function (x) { return x.id === a.id; })[0];
        var diff = live ? positionsDiff(live.positions, props.existing) : null;
        stBody.push(e('div', { key: a.id, 'data-testid': 'ag-st-account', className: 'ui-sync-account' },
          e('div', { className: ['ui-dlg-sec__head', 'ui-ag-acct'].join(' ') },
            e('span', null, (a.institution ? a.institution + ' · ' : '') + a.name), e('span', null, amount(a.balance))),
          diff && diff.length ? e('table', { 'data-testid': 'ag-st-positions', className: ['ui-table', 'ui-table--dense', 'ui-table--tall'].join(' ') }, e('tbody', null, diff.map(function (d) {
            return e('tr', { key: d.symbol },
              e('th', { scope: 'row', className: 'is-sticky' }, d.symbol, e('span', { className: 'ui-tcell__sub' }, d.name)),
              e('td', null, String(d.broker)),
              e('td', { className: d.status === 'match' ? 'tone-gain' : 'tone-warning' },
                d.status === 'missing' ? '! ' + __('bsNotInMaermin', 'not in MAERMIN') : d.status === 'match' ? '✓ ' + __('bsMatches', 'matches') : '! ' + __('bsDiffers', 'MAERMIN {q} ({d})', { q: d.maermin, d: (d.diff > 0 ? '+' : '') + d.diff })));
          }))) : null));
      });
      if (stRes) {
        var mapped = mapActivities(stRes.activities, { portfolioId: props.portfolioId });
        var fresh = BS ? BS.newOnly(mapped.transactions, props.existing) : mapped.transactions;
        var skippedN = Object.keys(mapped.skipped).reduce(function (s, k) { return s + mapped.skipped[k]; }, 0);
        stBody.push(e('div', { key: 'x', className: ['ui-actions', 'ui-ag-tools'].join(' ') },
          e('span', { 'data-testid': 'ag-st-activities' }, __('agStActivities', '{n} new {n:activity|activities} (trades, payouts, cash)', { n: fresh.length }) + (skippedN ? ' · ' + __('agStSkipped', '{n} of other kinds not booked ({list})', { n: skippedN, list: Object.keys(mapped.skipped).join(', ') }) : '')),
          fresh.length ? e('button', { 'data-testid': 'ag-st-import', className: btn(true), onClick: function () { if (props.onImport) props.onImport(fresh); } }, __('bsImportN', 'Import {n}', { n: fresh.length })) : null));
      }
    }

    return e(UIC.Card, { 'data-testid': 'aggregators', className: 'ui-sync', headingLevel: 'h3', title: __('agTitle', 'Aggregators with your own API keys') },
      e('p', { className: 'ui-muted' }, __('agSubtitle', 'For banks and brokers without FinTS. You create the API keys at the provider; they are kept only in your vault (encrypted, never in a backup or sync) and used through your own Worker. Read-only.')),
      card0('ag-gocardless', BRAND_NAMES[0], gcBody),
      card0('ag-snaptrade', BRAND_NAMES[1], stBody),
      msg ? e('div', { 'data-testid': 'ag-msg', role: 'status', className: 'ui-note' }, msg) : null);
  }
  api.Panel = Panel;

  if (typeof window !== 'undefined') window.MaerminAggregators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
