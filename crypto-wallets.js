// ============================================================================
// MAERMIN — Crypto wallets by public address  (window.MaerminWallets)
// ----------------------------------------------------------------------------
// P5-3.6. Read-only tracking of PUBLIC addresses (Bitcoin; Ethereum, Arbitrum,
// Optimism, Base, Polygon; Solana) through the user's own Worker
// (`action=wallet`, cf-worker/wallets.js). No keys, no signing - an address
// can only be watched.
//
//   - Stored (maermin_wallets, sensitive: an address ties holdings to a
//     person): chain, address, label, the last balances (native + ERC-20).
//     Recent transactions are shown, not stored.
//   - Totals per symbol across all wallets, compared with MAERMIN's crypto
//     quantities. Nothing is booked automatically: a transfer is not a trade,
//     and booking one would invent a purchase price. Differences are for the
//     user (and P5-3.7's reconciliation) to settle.
//
// Pure parts Node-tested in test/crypto-wallets.test.js.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_wallets';
  var CHAIN_IDS = ['btc', 'eth', 'arb', 'op', 'base', 'polygon', 'sol'];
  // product names of the networks (not translated)
  var CHAIN_NAMES = Object.keys({ 'Bitcoin': 1, 'Ethereum': 1, 'Arbitrum One': 1, 'Optimism': 1, 'Base': 1, 'Polygon PoS': 1, 'Solana': 1 });
  function chainName(id) { var i = CHAIN_IDS.indexOf(id); return i > -1 ? CHAIN_NAMES[i] : id; }
  function str(x) { return String(x == null ? '' : x).trim(); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function uid() { return 'wl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function validAddress(chain, address) {
    var a = str(address);
    if (chain === 'btc') return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    if (CHAIN_IDS.indexOf(chain) > -1) return /^0x[0-9a-fA-F]{40}$/.test(a);
    return false;
  }
  function sameAddress(chain, a, b) { return chain === 'btc' || chain === 'sol' ? str(a) === str(b) : str(a).toLowerCase() === str(b).toLowerCase(); }

  // ---- state ------------------------------------------------------------------
  function cleanWallet(w) {
    if (!w || typeof w !== 'object' || CHAIN_IDS.indexOf(w.chain) < 0 || !validAddress(w.chain, w.address)) return null;
    var nat = w.native && str(w.native.symbol) ? { symbol: str(w.native.symbol).toUpperCase().slice(0, 12), amount: num(w.native.amount) } : null;
    return { id: str(w.id) || uid(), chain: w.chain, address: str(w.address), label: str(w.label).slice(0, 60), lastSync: str(w.lastSync) || null,
      // P5-3.7: the last failed read (the Data check names it)
      lastError: w.lastError && str(w.lastError.message) ? { date: str(w.lastError.date).slice(0, 10) || null, message: str(w.lastError.message).slice(0, 200) } : null,
      native: nat, tokens: (Array.isArray(w.tokens) ? w.tokens : []).slice(0, 50).map(function (t) {
        return { symbol: str(t.symbol).toUpperCase().slice(0, 16), name: str(t.name).slice(0, 60), amount: num(t.amount), contract: str(t.contract).slice(0, 64) };
      }).filter(function (t) { return t.symbol && t.amount > 0; }) };
  }
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    return { version: 1, wallets: (Array.isArray(o.wallets) ? o.wallets : []).map(cleanWallet).filter(Boolean).slice(0, 50) };
  }
  // → { state, error: null | 'invalid' | 'duplicate' }
  function addWallet(state, w) {
    state = normalize(state);
    if (!validAddress(w && w.chain, w && w.address)) return { state: state, error: 'invalid' };
    if (state.wallets.some(function (x) { return x.chain === w.chain && sameAddress(w.chain, x.address, w.address); })) return { state: state, error: 'duplicate' };
    state.wallets.push(cleanWallet(Object.assign({ id: uid() }, w)));
    return { state: state, error: null };
  }
  function removeWallet(state, id) { state = normalize(state); state.wallets = state.wallets.filter(function (w) { return w.id !== id; }); return state; }
  function applySnapshot(state, id, snap, today) {
    state = normalize(state);
    state.wallets = state.wallets.map(function (w) { return w.id === id ? cleanWallet(Object.assign({}, w, { native: snap.native, tokens: snap.tokens, lastSync: today, lastError: null })) || w : w; });
    return state;
  }
  function applyError(state, id, message, today) {
    state = normalize(state);
    state.wallets = state.wallets.map(function (w) { return w.id === id ? cleanWallet(Object.assign({}, w, { lastError: { date: today, message: message } })) || w : w; });
    return state;
  }

  // ---- totals and comparison --------------------------------------------------------
  function totals(state) {
    var t = {};
    normalize(state).wallets.forEach(function (w) {
      if (w.native && w.native.amount > 0) t[w.native.symbol] = (t[w.native.symbol] || 0) + w.native.amount;
      w.tokens.forEach(function (k) { t[k.symbol] = (t[k.symbol] || 0) + k.amount; });
    });
    Object.keys(t).forEach(function (k) { t[k] = Math.round(t[k] * 1e8) / 1e8; });
    return t;
  }
  function heldCrypto(transactions) {
    var q = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.category !== 'crypto' || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      var k = str(tx.symbol).toUpperCase();
      if (!k) return;
      q[k] = (q[k] || 0) + (tx.type === 'buy' ? 1 : -1) * num(tx.quantity);
    });
    return q;
  }
  function compare(state, transactions) {
    var t = totals(state), held = heldCrypto(transactions);
    return Object.keys(t).sort().map(function (sym) {
      var mine = held[sym];
      var known = mine !== undefined;
      var diff = known ? Math.round((t[sym] - mine) * 1e8) / 1e8 : null;
      return { symbol: sym, wallets: t[sym], maermin: known ? Math.round(mine * 1e8) / 1e8 : null, diff: diff, status: !known ? 'missing' : Math.abs(diff) < 1e-8 ? 'match' : 'differs' };
    });
  }

  // ---- browser glue ---------------------------------------------------------------------
  var _demo = null;
  function demoActive() { return !!(W.MaerminDemo && W.MaerminDemo.isActive && W.MaerminDemo.isActive()); }
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() { if (demoActive()) return _demo || (_demo = normalize(null)); var s = store(); try { return normalize(s ? s.getItem(STORAGE_KEY) : null); } catch (e) { return normalize(null); } }
  function save(state) { if (demoActive()) { _demo = normalize(state); return true; } var s = store(); if (!s) return false; try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; } }
  function fetchSnapshot(workerUrl, w, fetchImpl) {
    var base = str(workerUrl).replace(/\/+$/, '');
    return (fetchImpl || fetch)(base + '/?action=wallet&chain=' + encodeURIComponent(w.chain) + '&address=' + encodeURIComponent(w.address))
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (x) {
        if (x.status === 400 && x.body && x.body.error === 'Unknown action') throw new Error(__('wlOutdated', 'your Worker is older than 2026.10.9 - redeploy it'));
        if (x.status !== 200 || !x.body || !x.body.native) throw new Error((x.body && x.body.error) || ('HTTP ' + x.status));
        return x.body;
      });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, CHAIN_IDS: CHAIN_IDS, chainName: chainName, validAddress: validAddress,
    normalize: normalize, addWallet: addWallet, removeWallet: removeWallet, applySnapshot: applySnapshot, applyError: applyError,
    totals: totals, heldCrypto: heldCrypto, compare: compare, load: load, save: save, fetchSnapshot: fetchSnapshot
  };

  // --------------------------------------------------------------------------
  // React view: Data → Broker Import, below Exchange sync.
  // props: theme, workerUrl, existing (transactions)
  // --------------------------------------------------------------------------
  function Panel(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var theme = props.theme || {};
    var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7', border = theme.cardBorder || 'rgba(255,255,255,0.08)';
    var card = theme.card || '#10151f', inputBg = theme.inputBg || '#0c1018', accent = theme.accent || '#8b7cff';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b';
    var inputStyle = { padding: '0.5rem', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.82rem', minWidth: 0 };
    var btn = function (primary) { return { padding: '0.45rem 0.9rem', background: primary ? accent : 'none', color: primary ? '#ffffff' : dim, border: primary ? 'none' : '1px solid ' + border, borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }; };
    var s0 = useState(load), st = s0[0], setSt = s0[1];
    var f0 = useState({ chain: 'btc', address: '', label: '' }), form = f0[0], setForm = f0[1];
    var m0 = useState(''), msg = m0[0], setMsg = m0[1];
    var b0 = useState(false), busy = b0[0], setBusy = b0[1];
    var x0 = useState({}), txs = x0[0], setTxs = x0[1];
    var demo = demoActive();
    var fmt = function (n) { return W.MaerminI18n && W.MaerminI18n.num ? W.MaerminI18n.num(n, { min: 0, max: Math.abs(n) >= 100 ? 2 : 8 }) : String(n); };
    function mutate(next) { save(next); setSt(normalize(next)); return next; }

    function refresh(ids, base) {
      var state = base || st;
      var list = normalize(state).wallets.filter(function (w) { return !ids || ids.indexOf(w.id) > -1; });
      if (!list.length) return;
      setBusy(true); setMsg('');
      var today = (W.MaerminUtils && W.MaerminUtils.todayISO) ? W.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10);
      var errs = [], next = state, recent = {};
      list.reduce(function (p, w) {
        return p.then(function () {
          return fetchSnapshot(props.workerUrl, w).then(function (snap) { next = applySnapshot(next, w.id, snap, today); recent[w.id] = snap.txs || []; },
            function (err) { errs.push((w.label || chainName(w.chain)) + ': ' + err.message); next = applyError(next, w.id, err.message, today); });
        });
      }, Promise.resolve()).then(function () {
        mutate(next);
        setTxs(function (prev) { return Object.assign({}, prev, recent); });
        setBusy(false);
        setMsg(errs.length ? __('wlErrors', 'Not all wallets could be read: {list}', { list: errs.join('; ') }) : __('wlUpdated', 'Balances updated.'));
      });
    }
    function add() {
      var r = addWallet(st, { chain: form.chain, address: form.address, label: form.label });
      if (r.error === 'invalid') { setMsg(__('wlInvalid', 'This is not a valid {chain} address.', { chain: chainName(form.chain) })); return; }
      if (r.error === 'duplicate') { setMsg(__('wlDuplicate', 'This address is already in the list.')); return; }
      mutate(r.state);
      var added = r.state.wallets[r.state.wallets.length - 1];
      setForm({ chain: form.chain, address: '', label: '' });
      refresh([added.id], r.state);
    }

    if (!props.workerUrl || demo) {
      return e(window.MaerminUI.EmptyState, { testid: 'wallets', kind: demo ? 'demo' : 'worker', title: __('wlTitle', 'Crypto wallets (read-only)'), text: demo ? __('wlDemo', 'Not available in the demo.') : __('wlNeedWorker', 'Goes through your own Worker: add its URL in API Settings.') });
    }

    var rows = st.wallets.map(function (w) {
      var recent = txs[w.id];
      return e('div', { key: w.id, 'data-testid': 'wl-wallet', style: { padding: '0.6rem 0.75rem', background: inputBg, borderRadius: '8px', marginBottom: '0.45rem' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
          e('div', { style: { minWidth: 0 } },
            e('div', { style: { color: text, fontWeight: 600, fontSize: '0.82rem' } }, (w.label ? w.label + ' · ' : '') + chainName(w.chain)),
            e('div', { style: { color: dim, fontSize: '0.7rem', wordBreak: 'break-all' } }, w.address)),
          e('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } },
            w.native ? e('span', { 'data-testid': 'wl-native', style: { color: text, fontWeight: 700, fontSize: '0.84rem' } }, fmt(w.native.amount) + ' ' + w.native.symbol) : null,
            e('button', { style: btn(false), onClick: function () {
              W.MaerminUtils.confirmThen({ title: __('wlRemoveTitle', 'Stop watching this address?'), message: __('wlRemoveMsg', 'Only the entry here is removed; nothing in your portfolio changes.'), confirmLabel: __('wlRemove', 'Remove'), cancelLabel: __('cancel', 'Cancel') },
                function () { mutate(removeWallet(st, w.id)); });
            } }, __('wlRemove', 'Remove')))),
        w.tokens.length ? e('div', { 'data-testid': 'wl-tokens', style: { color: dim, fontSize: '0.74rem', marginTop: '0.3rem' } }, w.tokens.map(function (k) { return fmt(k.amount) + ' ' + k.symbol; }).join(' · ')) : null,
        e('div', { style: { color: dim, fontSize: '0.68rem', marginTop: '0.25rem' } }, w.lastSync ? __('wlAsOf', 'as of {date}', { date: w.lastSync }) : __('wlNotYet', 'not read yet')),
        recent && recent.length ? e('details', { style: { marginTop: '0.3rem' } },
          e('summary', { style: { color: dim, fontSize: '0.72rem', cursor: 'pointer' } }, __('wlRecent', 'Recent movements ({n})', { n: recent.length })),
          e('table', { 'data-testid': 'wl-txs', style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', color: text, marginTop: '0.25rem' } }, e('tbody', null, recent.slice(0, 15).map(function (t) {
            return e('tr', { key: t.hash, style: { borderTop: '1px solid ' + border } },
              e('td', { style: { padding: '0.2rem 0.3rem' } }, t.date || '…'),
              e('td', { style: { padding: '0.2rem 0.3rem', color: t.direction === 'in' ? good : t.direction === 'out' ? warn : dim } }, t.direction === 'in' ? __('wlIn', 'in') : t.direction === 'out' ? __('wlOut', 'out') : __('wlSelf', 'to itself')),
              e('td', { style: { padding: '0.2rem 0.3rem', textAlign: 'right' } }, fmt(t.amount) + ' ' + t.symbol + (t.fee ? ' (' + __('wlFee', 'fee {f}', { f: fmt(t.fee) }) + ')' : '')));
          })))) : null);
    });

    var cmp = compare(st, props.existing);
    return e('div', { 'data-testid': 'wallets', style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.25rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.2rem' } },
        e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem' } }, __('wlTitle', 'Crypto wallets (read-only)')),
        st.wallets.length ? e('button', { 'data-testid': 'wl-refresh', style: btn(true), disabled: busy, onClick: function () { refresh(null); } }, busy ? __('wlBusy', 'Reading…') : __('wlRefresh', 'Update balances')) : null),
      e('div', { style: { color: dim, fontSize: '0.76rem', marginBottom: '0.8rem', lineHeight: 1.5 } },
        __('wlSubtitle', 'Watch public addresses on Bitcoin, Ethereum, Arbitrum, Optimism, Base, Polygon and Solana. No keys: an address can only be read. The block explorers see the address and your Worker, not you. Balances are compared with MAERMIN; nothing is booked automatically - a transfer is not a trade.')),
      rows,
      cmp.length ? e('div', { 'data-testid': 'wl-compare', style: { marginTop: '0.4rem', overflowX: 'auto' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', marginBottom: '0.25rem' } }, __('wlCompare', 'All wallets together vs MAERMIN')),
        e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', color: text } }, e('tbody', null, cmp.map(function (c) {
          return e('tr', { key: c.symbol, style: { borderTop: '1px solid ' + border } },
            e('td', { style: { padding: '0.25rem 0.3rem', fontWeight: 600 } }, c.symbol),
            e('td', { style: { padding: '0.25rem 0.3rem', textAlign: 'right' } }, fmt(c.wallets)),
            e('td', { style: { padding: '0.25rem 0.3rem', textAlign: 'right', color: c.status === 'match' ? good : warn } },
              c.status === 'missing' ? __('bsNotInMaermin', 'not in MAERMIN') : c.status === 'match' ? __('bsMatches', 'matches') : __('bsDiffers', 'MAERMIN {q} ({d})', { q: fmt(c.maermin), d: (c.diff > 0 ? '+' : '') + fmt(c.diff) })));
        })))) : null,
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '0.5rem', marginTop: '0.7rem' } },
        e('select', { 'data-testid': 'wl-chain', 'aria-label': __('wlChain', 'Network'), value: form.chain, onChange: function (ev) { setForm(Object.assign({}, form, { chain: ev.target.value })); }, style: inputStyle },
          CHAIN_IDS.map(function (c) { return e('option', { key: c, value: c }, chainName(c)); })),
        e('input', { 'data-testid': 'wl-address', 'aria-label': __('wlAddress', 'Public address'), placeholder: __('wlAddress', 'Public address'), autoComplete: 'off', spellCheck: false, value: form.address, onChange: function (ev) { setForm(Object.assign({}, form, { address: ev.target.value.trim() })); }, style: Object.assign({}, inputStyle, { gridColumn: '1 / -1' }) }),
        e('input', { 'aria-label': __('wlLabel', 'Name (optional)'), placeholder: __('wlLabel', 'Name (optional)'), value: form.label, onChange: function (ev) { setForm(Object.assign({}, form, { label: ev.target.value })); }, style: inputStyle })),
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.3rem' } }, __('wlNoKeys', 'Only ever a public address - never a seed phrase or private key.')),
      e('div', null, e('button', { 'data-testid': 'wl-add', style: Object.assign(btn(true), { marginTop: '0.55rem' }), disabled: busy, onClick: add }, __('wlAdd', 'Watch address'))),
      msg ? e('div', { 'data-testid': 'wl-msg', role: 'status', style: { color: dim, fontSize: '0.76rem', marginTop: '0.5rem' } }, msg) : null);
  }
  api.Panel = Panel;

  if (typeof window !== 'undefined') window.MaerminWallets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
