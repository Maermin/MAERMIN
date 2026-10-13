// ============================================================================
// MAERMIN — Reconciliation and data health  (window.MaerminReconcile)
// ----------------------------------------------------------------------------
// P5-3.7. What the connected sources REPORT next to what MAERMIN COMPUTES:
//
//   - cash: a bank account (FinTS, GoCardless) linked by the user to a
//     portfolio → the bank balance vs that portfolio's clearing account on the
//     bank's balance date (EUR accounts; the clearing account is in EUR)
//   - depot: a FinTS depot statement vs MAERMIN's quantities per ISIN
//   - crypto: all watched wallets together vs MAERMIN's crypto quantities
//
// status: match (green) | differs (amber) | unlinked | currency | nocash (grey)
//
// And the health findings for the Data check (stable codes in data-check.js):
//   price-stale      a held position's price is older than 3 days or missing
//   transfer-broken  a transfer row whose other half is missing or different
//   sync-stale       a source not synced for 30 days
//   sync-failed      the last sync of a source failed (with its message)
//   recon-diff       a reported balance or quantity differs from MAERMIN's
//
// Links live in maermin_reconcile (sensitive, synced, in the backup). Pure
// parts Node-tested in test/reconcile.test.js.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function req(f) { try { return f(); } catch (e) { return null; } }
  var BS = W.MaerminBankSync || req(function () { return require('./bank-sync.js'); });
  var WL = W.MaerminWallets || req(function () { return require('./crypto-wallets.js'); });
  var LG = W.MaerminLedger || req(function () { return require('./ledger.js'); });

  var STORAGE_KEY = 'maermin_reconcile';
  // product names (not translated)
  var BRAND_NAMES = Object.keys({ 'GoCardless': 1, 'SnapTrade': 1 });
  var PRICE_STALE_DAYS = 3, SYNC_STALE_DAYS = 30;
  function str(x) { return String(x == null ? '' : x).trim(); }
  function daysBetween(a, b) { var x = Date.parse(str(a).slice(0, 10) + 'T00:00:00Z'), y = Date.parse(str(b).slice(0, 10) + 'T00:00:00Z'); return isFinite(x) && isFinite(y) ? Math.round((y - x) / 864e5) : null; }

  // ---- the sources, from the stored states ------------------------------------
  // states = { bank, aggregators, wallets, exchange } (each as its module stores it)
  function collect(states) {
    states = states || {};
    var cash = [], depots = [], syncs = [];
    ((states.bank && states.bank.connections) || []).forEach(function (c) {
      var label = c.label || c.blz;
      syncs.push({ key: 'fints:' + c.id, provider: 'fints', label: label, lastSync: c.lastSync, lastError: c.lastError || null });
      (c.accounts || []).forEach(function (a) {
        if (a.depot) { if (a.positions) depots.push({ key: 'fints:' + c.id + ':' + a.accountNo, provider: 'fints', label: label + ' · ' + (a.product || a.accountNo), positions: a.positions, date: a.positionsDate || c.lastSync }); }
        else if (a.balance) cash.push({ key: 'fints:' + c.id + ':' + a.accountNo, provider: 'fints', label: label + ' · ' + (a.iban || a.accountNo), balance: a.balance, lastSync: c.lastSync });
      });
    });
    var ag = states.aggregators || {};
    if (ag.gocardless && (ag.gocardless.requisitionId || ag.gocardless.lastSync || ag.gocardless.lastError)) {
      var gc = ag.gocardless;
      syncs.push({ key: 'gocardless', provider: 'gocardless', label: gc.institutionName || BRAND_NAMES[0], lastSync: gc.lastSync, lastError: gc.lastError || null });
      (gc.accounts || []).forEach(function (a) {
        if (a.balance) cash.push({ key: 'gocardless:' + a.id, provider: 'gocardless', label: (gc.institutionName ? gc.institutionName + ' · ' : '') + (a.iban || a.name || a.id), balance: a.balance, lastSync: gc.lastSync });
      });
    }
    if (ag.snaptrade && (ag.snaptrade.registered || ag.snaptrade.lastSync || ag.snaptrade.lastError)) {
      syncs.push({ key: 'snaptrade', provider: 'snaptrade', label: BRAND_NAMES[1], lastSync: ag.snaptrade.lastSync, lastError: ag.snaptrade.lastError || null });
    }
    ((states.wallets && states.wallets.wallets) || []).forEach(function (w) {
      syncs.push({ key: 'wallet:' + w.id, provider: 'wallet', label: w.label || (WL ? WL.chainName(w.chain) : w.chain), lastSync: w.lastSync, lastError: w.lastError || null });
    });
    ((states.exchange && states.exchange.connections) || []).forEach(function (c) {
      syncs.push({ key: 'exchange:' + c.id, provider: 'exchange', label: c.label || c.exchange, lastSync: c.lastSync, lastError: c.lastError || null });
    });
    return { cash: cash, depots: depots, syncs: syncs };
  }

  // the clearing balance at the end of `date` (series: [{ d, balance }], oldest first)
  function balanceAt(clearing, date) {
    var s = (clearing && clearing.series) || [], v = 0;
    for (var i = 0; i < s.length; i++) { if (s[i].d <= date) v = s[i].balance; else break; }
    return v;
  }
  // cash: [{ key, label, provider, reported, portfolioId, computed, diff, status }]
  function cashRows(cash, links, clearingByPf, today) {
    links = links || {};
    return (cash || []).map(function (c) {
      var pf = links[c.key] || null;
      var row = { key: c.key, label: c.label, provider: c.provider, reported: c.balance, portfolioId: pf, computed: null, diff: null, status: 'unlinked', lastSync: c.lastSync };
      if (!pf) return row;
      if ((c.balance.currency || 'EUR') !== 'EUR') { row.status = 'currency'; return row; }
      var cl = clearingByPf && clearingByPf[pf];
      if (!cl) { row.status = 'nocash'; return row; }
      var at = c.balance.date || c.lastSync || today;
      row.computed = Math.round(balanceAt(cl, at) * 100) / 100;
      row.diff = Math.round((c.balance.amount - row.computed) * 100) / 100;
      row.status = Math.abs(row.diff) < 0.01 ? 'match' : 'differs';
      return row;
    });
  }
  function depotRows(depots, transactions) {
    return (depots || []).map(function (d) {
      var diff = BS ? BS.depotDiff(d.positions, transactions) : [];
      var n = function (st) { return diff.filter(function (x) { return x.status === st; }).length; };
      return { key: d.key, label: d.label, provider: d.provider, date: d.date, rows: diff, match: n('match'), differs: n('differs'), missing: n('missing'), status: diff.length && n('match') === diff.length ? 'match' : 'differs' };
    });
  }
  function cryptoRows(walletsState, transactions) {
    return WL && walletsState && walletsState.wallets && walletsState.wallets.length ? WL.compare(walletsState, transactions) : [];
  }

  // ---- health findings ---------------------------------------------------------------
  // opts = { transactions, syncs, priceItems: [{ symbol, price, fetchedAt (ms) }],
  //          cash (cashRows), depots (depotRows), crypto (cryptoRows), now (ms) }
  function health(opts) {
    opts = opts || {};
    var now = opts.now || Date.now(), today = new Date(now).toISOString().slice(0, 10), out = [];
    (opts.priceItems || []).forEach(function (p) {
      var missing = !(p.price > 0);
      var ageDays = p.fetchedAt ? (now - p.fetchedAt) / 864e5 : null;
      if (missing || ageDays === null || ageDays > PRICE_STALE_DAYS) out.push({ kind: 'price-stale', severity: 'info', symbol: p.symbol, missing: missing, days: ageDays === null ? null : Math.floor(ageDays) });
    });
    var seen = {};
    var txs = opts.transactions || [];
    txs.forEach(function (tx) {
      if (!LG || !LG.isTransfer || !LG.isTransfer(tx)) return;
      var tid = tx.transferId || ('no-id:' + tx.id);
      if (seen[tid]) return;
      seen[tid] = true;
      var pair = tx.transferId ? LG.pairOf(txs, tx) : null;
      if (!pair) { out.push({ kind: 'transfer-broken', severity: 'warning', reason: 'missing', txId: tx.id, date: tx.date, amount: Number(tx.amount) || 0 }); return; }
      if (Math.abs((Number(tx.amount) || 0) - (Number(pair.amount) || 0)) > 0.005 || str(tx.currency || 'EUR') !== str(pair.currency || 'EUR') || str(tx.date) !== str(pair.date) || tx.type === pair.type)
        out.push({ kind: 'transfer-broken', severity: 'warning', reason: 'differs', txId: tx.id, date: tx.date, amount: Number(tx.amount) || 0 });
    });
    (opts.syncs || []).forEach(function (s) {
      if (s.lastError && s.lastError.message) { out.push({ kind: 'sync-failed', severity: 'info', source: s.label, provider: s.provider, date: s.lastError.date, message: s.lastError.message }); return; }
      var age = s.lastSync ? daysBetween(s.lastSync, today) : null;
      if (age !== null && age > SYNC_STALE_DAYS) out.push({ kind: 'sync-stale', severity: 'info', source: s.label, provider: s.provider, days: age });
    });
    (opts.cash || []).forEach(function (r) { if (r.status === 'differs') out.push({ kind: 'recon-diff', severity: 'info', what: 'cash', source: r.label, diff: r.diff, currency: 'EUR' }); });
    (opts.depots || []).forEach(function (d) { if (d.differs || d.missing) out.push({ kind: 'recon-diff', severity: 'info', what: 'depot', source: d.label, count: d.differs + d.missing }); });
    var cryptoOff = (opts.crypto || []).filter(function (c) { return c.status !== 'match'; });
    if (cryptoOff.length) out.push({ kind: 'recon-diff', severity: 'info', what: 'crypto', source: __('reconWallets', 'Crypto wallets'), count: cryptoOff.length });
    return out;
  }

  // ---- links (browser) ----------------------------------------------------------------
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    var links = {};
    if (o && o.links && typeof o.links === 'object') Object.keys(o.links).slice(0, 200).forEach(function (k) { var v = str(o.links[k]); if (v && k.length <= 160) links[k] = v.slice(0, 80); });
    return { version: 1, links: links };
  }
  var _demo = null;
  function demoActive() { return !!(W.MaerminDemo && W.MaerminDemo.isActive && W.MaerminDemo.isActive()); }
  function load() { if (demoActive()) return _demo || (_demo = normalize(null)); try { return normalize(localStorage.getItem(STORAGE_KEY)); } catch (e) { return normalize(null); } }
  function save(state) { if (demoActive()) { _demo = normalize(state); return true; } try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; } }
  // the stored states of the source modules (browser)
  function currentStates() {
    var get = function (m) { return m && m.load ? req(function () { return m.load(); }) : null; };
    return { bank: get(W.MaerminBankSync), aggregators: get(W.MaerminAggregators), wallets: get(W.MaerminWallets), exchange: get(W.MaerminExchangeSync) };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, PRICE_STALE_DAYS: PRICE_STALE_DAYS, SYNC_STALE_DAYS: SYNC_STALE_DAYS,
    collect: collect, balanceAt: balanceAt, cashRows: cashRows, depotRows: depotRows, cryptoRows: cryptoRows, health: health,
    normalize: normalize, load: load, save: save, currentStates: currentStates
  };

  // --------------------------------------------------------------------------
  // React view: Transactions → below the Data check.
  // props: theme, transactions, portfolios, clearingByPf, rev (re-read trigger),
  //        onOpenImport()
  // --------------------------------------------------------------------------
  function Panel(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var theme = props.theme || {};
    var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7', border = theme.cardBorder || 'rgba(255,255,255,0.08)';
    var inputBg = theme.inputBg || '#0c1018', good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b';
    var s0 = useState(load), links = s0[0], setLinks = s0[1];
    var states = currentStates();
    var src = collect(states);
    if (!src.cash.length && !src.depots.length && !(states.wallets && states.wallets.wallets && states.wallets.wallets.length)) return null;
    var today = new Date().toISOString().slice(0, 10);
    var cash = cashRows(src.cash, links.links, props.clearingByPf, today);
    var depots = depotRows(src.depots, props.transactions);
    var crypto = cryptoRows(states.wallets, props.transactions);
    var money = function (v) { return W.MaerminI18n ? W.MaerminI18n.money(v, 'EUR') : v.toFixed(2) + ' EUR'; };
    var colour = function (st) { return st === 'match' ? good : st === 'differs' ? warn : dim; };
    var statusText = function (r) {
      if (r.status === 'match') return __('bsMatches', 'matches');
      if (r.status === 'differs') return __('reconDiff', 'differs by {d}', { d: (r.diff > 0 ? '+' : '') + money(r.diff) });
      if (r.status === 'currency') return __('reconCurrency', 'not comparable: the clearing account is in EUR');
      if (r.status === 'nocash') return __('reconNoCash', 'the portfolio keeps no clearing account');
      return __('reconUnlinked', 'link a portfolio to compare');
    };
    var setLink = function (key, pf) { var n = normalize(links); if (pf) n.links[key] = pf; else delete n.links[key]; save(n); setLinks(n); };
    var th = { padding: '0.3rem 0.4rem', textAlign: 'left', color: dim, fontWeight: 600, fontSize: '0.72rem' };
    var td = { padding: '0.35rem 0.4rem', borderTop: '1px solid ' + border, verticalAlign: 'top' };
    return e('div', { 'data-testid': 'reconcile', style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.8rem', color: text } },
      e('div', { style: { fontWeight: 700, marginBottom: '0.15rem' } }, __('reconTitle', 'Reconciliation: reported vs MAERMIN')),
      e('div', { style: { color: dim, fontSize: '0.74rem', marginBottom: '0.5rem' } }, __('reconSubtitle', 'What your banks, depots and wallets last reported, next to what MAERMIN computes from your transactions. Differences are not fixed automatically: book the missing transactions.')),
      cash.length ? e('div', { style: { overflowX: 'auto' } }, e('table', { 'data-testid': 'rc-cash', style: { width: '100%', borderCollapse: 'collapse' } },
        e('thead', null, e('tr', null, e('th', { style: th }, __('reconAccount', 'Account')), e('th', { style: th }, __('reconReported', 'Reported')), e('th', { style: th }, __('reconPortfolio', 'Portfolio')), e('th', { style: th }, __('reconStatus', 'MAERMIN')))),
        e('tbody', null, cash.map(function (r) {
          return e('tr', { key: r.key, 'data-status': r.status },
            e('td', { style: td }, r.label),
            e('td', { style: td }, money(r.reported.amount) + (r.reported.currency !== 'EUR' ? ' (' + r.reported.currency + ')' : '') + (r.reported.date ? ' · ' + r.reported.date : '')),
            e('td', { style: td }, e('select', { 'data-testid': 'rc-link', 'aria-label': __('reconLinkLabel', 'Portfolio for {account}', { account: r.label }), value: r.portfolioId || '', onChange: function (ev) { setLink(r.key, ev.target.value); },
              style: { background: inputBg, color: text, border: '1px solid ' + border, borderRadius: '6px', padding: '0.2rem 0.3rem', fontSize: '0.74rem', maxWidth: '12rem' } },
              e('option', { value: '' }, __('reconNone', '—')),
              (props.portfolios || []).map(function (p) { return e('option', { key: p.id, value: p.id }, p.name || p.id); }))),
            e('td', { style: Object.assign({}, td, { color: colour(r.status) }) }, r.computed != null ? money(r.computed) + ' · ' : '', statusText(r)));
        })))) : null,
      depots.map(function (d) {
        return e('div', { key: d.key, 'data-testid': 'rc-depot', style: { marginTop: '0.45rem', color: colour(d.status) } },
          __('reconDepotLine', '{source} ({date}): {m} of {n} positions match, {d} differ, {x} not in MAERMIN', { source: d.label, date: d.date || '', m: d.match, n: d.rows.length, d: d.differs, x: d.missing }));
      }),
      crypto.length ? e('div', { 'data-testid': 'rc-crypto', style: { marginTop: '0.45rem', color: colour(crypto.every(function (c) { return c.status === 'match'; }) ? 'match' : 'differs') } },
        __('reconCryptoLine', 'Crypto wallets: {m} of {n} coins match', { m: crypto.filter(function (c) { return c.status === 'match'; }).length, n: crypto.length })) : null,
      props.onOpenImport ? e('button', { type: 'button', onClick: props.onOpenImport, style: { marginTop: '0.5rem', padding: '0.25rem 0.7rem', fontSize: '0.74rem', fontWeight: 600, borderRadius: '6px', cursor: 'pointer', background: 'transparent', color: theme.accent || '#8b7cff', border: '1px solid ' + (theme.accent || '#8b7cff') + '55' } }, __('dcOpenImport', 'Open the import')) : null);
  }
  api.Panel = Panel;

  if (typeof window !== 'undefined') window.MaerminReconcile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
