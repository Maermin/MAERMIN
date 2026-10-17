// ============================================================================
// MAERMIN — Bank sync over FinTS  (window.MaerminBankSync)
// ----------------------------------------------------------------------------
// P5-3.4. Bank connections for fints.js: accounts, balances, transactions and
// depot statements, fetched through the user's own Worker (`action=fints`).
//
//   - Stored (maermin_bank_sync, sensitive: encrypted, synced, in the backup):
//     bank, FinTS URL, bank code, the login name only when the user asks for
//     it, the bank's system id and TAN method, and the last result (balances,
//     depot positions). PIN and TAN are never stored: they live in memory for
//     one sync and are dropped after it.
//   - Transactions become cash bookings (deposit, withdrawal, fee, tax, tax
//     refund, interest charge) only for the accounts the user ticks; securities
//     settlements and payouts are left to the depot / PDF import and counted.
//     Repeat syncs never book a row twice (source 'fints' + externalId).
//   - The depot statement is compared with MAERMIN's quantities per ISIN.
//
// Pure parts Node-tested in test/bank-sync.test.js; the dialog itself in
// test/fints.test.js against the synthetic bank.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function req(f) { try { return f(); } catch (e) { return null; } }
  var FINTS = W.MaerminFints || req(function () { return require('./fints.js'); });

  var STORAGE_KEY = 'maermin_bank_sync';
  var SCHEMA = 1;
  var DAYS = 90; // PSD2: the last 90 days usually need no extra TAN

  function str(x) { return String(x == null ? '' : x).trim(); }
  function num(x) { var n = Number(x); return isFinite(n) ? n : null; }
  function uid() { return 'fb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---- state (no PIN, no TAN) ------------------------------------------------
  function cleanAccount(a) {
    if (!a || typeof a !== 'object') return null;
    var bal = a.balance && num(a.balance.amount) !== null ? { amount: num(a.balance.amount), currency: str(a.balance.currency) || 'EUR', date: str(a.balance.date) || null } : null;
    var positions = Array.isArray(a.positions) ? a.positions.slice(0, 500).map(function (p) {
      return { isin: str(p.isin), name: str(p.name).slice(0, 120), quantity: num(p.quantity), price: num(p.price), priceCurrency: str(p.priceCurrency), value: num(p.value), valueCurrency: str(p.valueCurrency) };
    }).filter(function (p) { return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(p.isin); }) : null;
    return { accountNo: str(a.accountNo).slice(0, 34), iban: str(a.iban).slice(0, 34), currency: str(a.currency) || 'EUR', product: str(a.product).slice(0, 60),
      depot: !!a.depot, importBookings: !!a.importBookings, balance: bal, positions: positions, positionsDate: str(a.positionsDate) || null };
  }
  function cleanConnection(c) {
    if (!c || typeof c !== 'object' || !str(c.url) || !/^\d{8}$/.test(str(c.blz))) return null;
    var remember = !!c.rememberLogin;
    return {
      id: str(c.id) || uid(), label: str(c.label).slice(0, 60), bankId: str(c.bankId), url: str(c.url).slice(0, 300), blz: str(c.blz),
      rememberLogin: remember, login: remember ? str(c.login).slice(0, 60) : '',
      systemId: str(c.systemId).slice(0, 60), secFunc: /^9\d\d$/.test(str(c.secFunc)) ? str(c.secFunc) : '', methodName: str(c.methodName).slice(0, 60),
      lastSync: str(c.lastSync) || null,
      // P5-3.7: the last failed sync (the Data check names it), cleared by a good one
      lastError: c.lastError && str(c.lastError.message) ? { date: str(c.lastError.date).slice(0, 10) || null, message: str(c.lastError.message).slice(0, 200) } : null,
      accounts: (Array.isArray(c.accounts) ? c.accounts : []).map(cleanAccount).filter(Boolean).slice(0, 50)
    };
  }
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    return { version: SCHEMA, connections: (Array.isArray(o.connections) ? o.connections : []).map(cleanConnection).filter(Boolean).slice(0, 20) };
  }
  function addConnection(state, c) { state = normalize(state); var n = cleanConnection(Object.assign({ id: uid() }, c)); if (n) state.connections.push(n); return state; }
  function removeConnection(state, id) { state = normalize(state); state.connections = state.connections.filter(function (c) { return c.id !== id; }); return state; }
  function updateConnection(state, id, patch) {
    state = normalize(state);
    state.connections = state.connections.map(function (c) { return c.id === id ? cleanConnection(Object.assign({}, c, patch)) || c : c; });
    return state;
  }
  // The result of a sync, as stored: balances and depot positions, the
  // "import bookings" ticks carried over by account number.
  function applyResult(conn, result, today) {
    var ticks = {};
    (conn.accounts || []).forEach(function (a) { ticks[a.accountNo] = a.importBookings; });
    return Object.assign({}, conn, { lastSync: today, lastError: null, accounts: (result.accounts || []).map(function (a) { return cleanAccount(Object.assign({}, a, { importBookings: !!ticks[a.accountNo] })); }).filter(Boolean) });
  }

  // ---- transactions → cash bookings -------------------------------------------
  var SECURITIES_RX = /\b[A-Z]{2}[A-Z0-9]{9}\d\b|wertpapier|wp-abrechnung|depot.?abrechnung|\bkauf\b|\bverkauf\b|dividende|aussch(?:ü|ue)ttung|ertragsgutschrift|sparplan/i;
  function classify(row) {
    var text = [row.bookingText, row.purpose, row.name].join(' ');
    if (SECURITIES_RX.test(text)) return null;
    if (row.amount > 0) {
      if (/steuer/i.test(text) && /erstatt|gutschrift|korrektur/i.test(text)) return 'tax_refund';
      if (/(entgelt|geb(?:ü|ue)hr)/i.test(text) && /erstatt/i.test(text)) return 'fee_refund';
      return 'deposit';
    }
    if (/kapitalertrag|solidarit|kirchensteuer|abgeltung|steuer/i.test(text)) return 'tax';
    if (/sollzins|zinsbelastung|(?:ü|ue)berziehungszins|dispozins/i.test(text)) return 'interest_charge';
    if (/entgelt|geb(?:ü|ue)hr|kontof(?:ü|ue)hrung|depotentgelt|provision/i.test(text)) return 'fee';
    return 'withdrawal';
  }
  function fnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  // → { rows: [transactions], skipped: n (securities) }
  function toBookings(account, rows, opts) {
    opts = opts || {};
    var out = [], skipped = 0, seen = {};
    (rows || []).forEach(function (r) {
      if (!r || !(Math.abs(r.amount) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return;
      var type = classify(r);
      if (!type) { skipped++; return; }
      // a row with the provider's own id (P5-3.5 GoCardless) keeps it; FinTS rows have none
      var base = r.id ? 'id|' + r.id : [account.iban || account.accountNo, r.date, r.amount.toFixed(2), r.purpose, r.name].join('|');
      seen[base] = (seen[base] || 0) + 1;
      var note = [r.name, r.purpose || r.bookingText].filter(Boolean).join(' - ').slice(0, 140);
      out.push({ category: 'cashflow', type: type, amount: Math.round(Math.abs(r.amount) * 100) / 100, currency: r.currency || account.currency || 'EUR', date: r.date,
        notes: note, source: opts.source || 'fints', externalId: fnv(base) + '-' + seen[base], portfolioId: opts.portfolioId || undefined });
    });
    return { rows: out, skipped: skipped };
  }
  // New bookings only (a repeat sync of the same days books nothing twice).
  function newOnly(candidates, existing) {
    var have = {};
    (existing || []).forEach(function (t) { if (t && t.source && t.externalId) have[t.source + '|' + t.externalId] = true; });
    return (candidates || []).filter(function (c) { return !have[c.source + '|' + c.externalId]; });
  }

  // ---- depot statement vs MAERMIN -------------------------------------------------
  function heldByIsin(transactions) {
    var q = {};
    (transactions || []).forEach(function (t) {
      if (!t || (t.type !== 'buy' && t.type !== 'sell')) return;
      var isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(str(t.isin)) ? str(t.isin) : (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(str(t.symbol)) ? str(t.symbol) : '');
      if (!isin) return;
      q[isin] = (q[isin] || 0) + (t.type === 'buy' ? 1 : -1) * (Number(t.quantity) || 0);
    });
    return q;
  }
  function depotDiff(positions, transactions) {
    var held = heldByIsin(transactions);
    return (positions || []).map(function (p) {
      var mine = held[p.isin];
      var known = mine !== undefined;
      var diff = known ? Math.round(((p.quantity || 0) - mine) * 1e6) / 1e6 : null;
      return { isin: p.isin, name: p.name, bank: p.quantity, maermin: known ? Math.round(mine * 1e6) / 1e6 : null, diff: diff, status: !known ? 'missing' : diff === 0 ? 'match' : 'differs', value: p.value, valueCurrency: p.valueCurrency };
    });
  }

  // ---- storage (browser) -------------------------------------------------------
  var _demo = null;
  function demoActive() { return !!(W.MaerminDemo && W.MaerminDemo.isActive && W.MaerminDemo.isActive()); }
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    if (demoActive()) return _demo || (_demo = normalize(null));
    var s = store(); try { return normalize(s ? s.getItem(STORAGE_KEY) : null); } catch (e) { return normalize(null); }
  }
  function save(state) {
    if (demoActive()) { _demo = normalize(state); return true; }
    var s = store(); if (!s) return false; try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }
  // fints.js errors carry a code; the bank's own messages (9xxx) are shown as sent
  function errorText(err) {
    var code = err && err.code;
    if (code === 'cancelled') return __('bsErrCancelled', 'cancelled');
    if (code === 'timeout') return __('bsErrTimeout', 'the confirmation in your banking app timed out');
    if (code === 'nosystem') return __('bsErrNoSystem', 'the bank did not register this device');
    if (code === 'relay') return __('bsErrRelay', 'your Worker refused the request ({msg})', { msg: err.message });
    if (code === 'bank') return __('bsErrBank', 'the bank\'s server did not answer properly ({msg})', { msg: err.message });
    return (err && err.message) || String(err);
  }
  function sinceDate(today, days) { var d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (days || DAYS)); return d.toISOString().slice(0, 10); }
  function bankInfo(workerUrl, fetchImpl) {
    var base = str(workerUrl).replace(/\/+$/, '');
    return (fetchImpl || fetch)(base + '/?action=fintsbanks').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !Array.isArray(j.banks)) throw new Error('outdated');
      return j;
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, DAYS: DAYS,
    normalize: normalize, addConnection: addConnection, removeConnection: removeConnection, updateConnection: updateConnection, applyResult: applyResult,
    classify: classify, toBookings: toBookings, newOnly: newOnly, heldByIsin: heldByIsin, depotDiff: depotDiff, sinceDate: sinceDate,
    load: load, save: save, bankInfo: bankInfo
  };

  // --------------------------------------------------------------------------
  // React view: Data → Broker Import, below Exchange sync.
  // props: theme, workerUrl, existing (transactions), portfolioId, onImport(rows),
  //        formatAmount(value, currency)? (privacy mode masks it)
  // --------------------------------------------------------------------------
  function Panel(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
    var theme = props.theme || {};
    var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7', border = theme.cardBorder || 'rgba(255,255,255,0.08)';
    var card = theme.card || '#10151f', inputBg = theme.inputBg || '#0c1018', accent = theme.accent || '#8b7cff';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b';
    var inputStyle = { padding: '0.5rem', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.82rem', minWidth: 0 };
    var btn = function (primary) { return { padding: '0.45rem 0.9rem', background: primary ? accent : 'none', color: primary ? '#ffffff' : dim, border: primary ? 'none' : '1px solid ' + border, borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }; };

    var s0 = useState(load), st = s0[0], setSt = s0[1];
    var i0 = useState(null), info = i0[0], setInfo = i0[1];
    var f0 = useState({ bankId: '', url: '', blz: '', login: '', rememberLogin: false, label: '' }), form = f0[0], setForm = f0[1];
    var m0 = useState(''), msg = m0[0], setMsg = m0[1];
    var r0 = useState(null), run = r0[0], setRun = r0[1]; // { id, step, pin, login, methods, challenge, tan, status }
    var x0 = useState({}), results = x0[0], setResults = x0[1]; // id → fetch result (transactions in memory only)
    var tanRef = useRef(null), cancelRef = useRef(false);

    var demo = demoActive();
    useEffect(function () {
      if (!props.workerUrl || demo) return;
      var alive = true;
      bankInfo(props.workerUrl).then(function (j) { if (alive) setInfo(j); }, function () { if (alive) setInfo({ error: true }); });
      return function () { alive = false; };
    }, [props.workerUrl]);

    function mutate(next) { save(next); setSt(normalize(next)); }
    function setF(p) { setForm(Object.assign({}, form, p)); }
    var banks = (info && info.banks) || [];
    var bankOf = function (id) { return banks.filter(function (b) { return b.id === id; })[0] || null; };

    function addConn() {
      var b = bankOf(form.bankId);
      var url = str(form.url) || (b && b.url) || '';
      if (!b || !url || !/^\d{8}$/.test(str(form.blz))) { setMsg(__('bsNeedFields', 'Choose a bank, enter its FinTS address and the 8-digit bank code.')); return; }
      mutate(addConnection(st, { bankId: b.id, url: url, blz: str(form.blz), login: form.login, rememberLogin: form.rememberLogin, label: form.label || b.name }));
      setForm({ bankId: '', url: '', blz: '', login: '', rememberLogin: false, label: '' });
      setMsg(__('bsAdded', 'Bank added. The PIN is asked for at each sync and never stored.'));
    }

    function finish(c, cfg) {
      cancelRef.current = false;
      var today = (W.MaerminUtils && W.MaerminUtils.todayISO) ? W.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10);
      var hooks = {
        sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
        cancelled: function () { return cancelRef.current; },
        waiting: function (w) { setRun(function (p) { return p && Object.assign({}, p, { step: 'app', challenge: w.challenge, status: __('bsWaitApp', 'Confirm the access in your banking app…') }); }); },
        tan: function (c2) { return new Promise(function (resolve) { tanRef.current = resolve; setRun(function (p) { return p && Object.assign({}, p, { step: 'tan', challenge: c2.challenge, tan: '' }); }); }); }
      };
      setRun(function (p) { return Object.assign({}, p, { step: 'busy', pin: '', status: __('bsFetching', 'Fetching accounts, balances, transactions and depot…') }); });
      return FINTS.fetchAll(cfg, FINTS.workerTransport(props.workerUrl, c.url), hooks, { from: sinceDate(today) }).then(function (res) {
        var conn = applyResult(Object.assign({}, c, { systemId: cfg.systemId, secFunc: cfg.secFunc, methodName: cfg.methodName }), res, today);
        mutate(updateConnection(st, c.id, conn));
        setResults(function (prev) { var n = Object.assign({}, prev); n[c.id] = res; return n; });
        setRun(null);
        setMsg(res.warnings.length ? __('bsDoneWarn', 'Sync finished with notes: {list}', { list: res.warnings.join('; ') }) : __('bsDone', 'Sync finished.'));
      });
    }
    function start(c) {
      var login = c.rememberLogin && c.login ? c.login : str(run && run.login);
      if (!run || !run.pin || !login) { setMsg(__('bsNeedPin', 'Enter your login name and PIN.')); return; }
      if (!info || !info.productId) { setMsg(__('bsNoProduct', 'Bank sync needs the MAERMIN FinTS product id in your Worker (FINTS_PRODUCT_ID).')); return; }
      var cfg = { blz: c.blz, user: login, pin: run.pin, productId: info.productId, productVersion: info.productVersion || '1', systemId: c.systemId, secFunc: c.secFunc, methodName: c.methodName };
      var transport = FINTS.workerTransport(props.workerUrl, c.url);
      var fail = function (err) {
        setRun(null);
        setMsg(__('bsFailed', 'Bank sync failed: {msg}', { msg: errorText(err) }));
        if (!(err && err.code === 'cancelled')) mutate(updateConnection(load(), c.id, { lastError: { date: new Date().toISOString().slice(0, 10), message: errorText(err) } }));
      };
      setRun(Object.assign({}, run, { step: 'busy', status: __('bsConnecting', 'Connecting to the bank…') }));
      var ready = c.systemId && c.secFunc ? Promise.resolve(cfg) : FINTS.synchronize(cfg, transport).then(function (s) {
        cfg.systemId = s.systemId;
        if (!s.methods.length) throw new Error(__('bsNoMethod', 'the bank offers no TAN method for this login'));
        if (s.methods.length === 1) { cfg.secFunc = s.methods[0].secFunc; cfg.methodName = s.methods[0].name; return cfg; }
        return new Promise(function (resolve) {
          tanRef.current = function (m) { cfg.secFunc = m.secFunc; cfg.methodName = m.name; resolve(cfg); };
          setRun(function (p) { return Object.assign({}, p, { step: 'method', methods: s.methods }); });
        });
      });
      ready.then(function (cf) { return finish(c, cf); }).catch(fail);
    }

    if (!props.workerUrl || demo) {
      return e(window.MaerminUI.EmptyState, { testid: 'bank-sync', kind: demo ? 'demo' : 'worker', action: demo ? undefined : window.MaerminUI.workerAction(), title: __('bsTitle', 'Bank sync (FinTS)'), text: demo ? __('bsDemo', 'Not available in the demo.') : __('bsNeedWorker', 'Goes through your own Worker: add its URL in API Settings.') });
    }

    var connRows = st.connections.map(function (c) {
      var res = results[c.id];
      var active = run && run.id === c.id;
      var accounts = c.accounts.map(function (a) {
        var fetched = res && res.accounts.filter(function (x) { return x.accountNo === a.accountNo; })[0];
        var book = fetched && !a.depot ? toBookings(a, fetched.transactions, { portfolioId: props.portfolioId }) : null;
        var fresh = book ? newOnly(book.rows, props.existing) : [];
        var diff = a.depot && a.positions ? depotDiff(a.positions, props.existing) : null;
        return e('div', { key: a.accountNo, 'data-testid': 'bs-account', style: { padding: '0.55rem 0.7rem', background: inputBg, borderRadius: '8px', marginTop: '0.45rem' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', color: text, fontSize: '0.8rem', fontWeight: 600 } },
            e('span', null, (a.product || (a.depot ? __('bsDepot', 'Depot') : __('bsAccount', 'Account'))) + ' · ' + (a.iban || a.accountNo)),
            a.balance ? e('span', { 'data-testid': 'bs-balance' }, (props.formatAmount ? props.formatAmount(a.balance.amount, a.balance.currency) : a.balance.amount.toFixed(2) + ' ' + a.balance.currency) + (a.balance.date ? ' · ' + a.balance.date : '')) : null),
          book ? e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem', color: dim, fontSize: '0.74rem' } },
            e('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' } },
              e('input', { type: 'checkbox', 'data-testid': 'bs-import-tick', checked: a.importBookings, onChange: function (ev) {
                mutate(updateConnection(st, c.id, { accounts: c.accounts.map(function (x) { return x.accountNo === a.accountNo ? Object.assign({}, x, { importBookings: ev.target.checked }) : x; }) }));
              } }),
              __('bsImportTick', 'Book this account\'s transactions as cash bookings')),
            e('span', null, __('bsBookingsN', '{n} new {n:booking|bookings} since {date}', { n: fresh.length, date: sinceDate((c.lastSync || '').slice(0, 10) || new Date().toISOString().slice(0, 10)) }) +
              (book.skipped ? ' · ' + __('bsSkippedSec', '{n} securities {n:booking|bookings} left to the depot / PDF import', { n: book.skipped }) : '')),
            a.importBookings && fresh.length ? e('button', { 'data-testid': 'bs-import', style: btn(true), onClick: function () { if (props.onImport) props.onImport(fresh); } }, __('bsImportN', 'Import {n}', { n: fresh.length })) : null,
            // P5-5.3: every booking of the account (not only the cash ones) into the Budget
            W.MaerminBudget && fetched.transactions && fetched.transactions.length ? e('button', { 'data-testid': 'bs-budget', style: btn(false), onClick: function () {
              var n = W.MaerminBudget.addBankRows(a, fetched.transactions, 'fints');
              if (props.addToast) props.addToast(__('bgAddedFromBank', '{n} bookings added to the Budget', { n: n }), 'success');
            } }, __('bgAddToBudget', 'Add to Budget')) : null) : null,
          diff ? e('div', { 'data-testid': 'bs-depot', style: { marginTop: '0.4rem', overflowX: 'auto' } },
            e('div', { style: { color: dim, fontSize: '0.72rem', marginBottom: '0.25rem' } }, __('bsDepotAsOf', 'Depot statement of {date}: bank vs MAERMIN', { date: a.positionsDate || '' })),
            e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', color: text } },
              e('tbody', null, diff.map(function (d) {
                return e('tr', { key: d.isin, style: { borderTop: '1px solid ' + border } },
                  e('td', { style: { padding: '0.25rem 0.3rem' } }, d.name || d.isin, e('div', { style: { color: dim, fontSize: '0.68rem' } }, d.isin)),
                  e('td', { style: { padding: '0.25rem 0.3rem', textAlign: 'right' } }, String(d.bank)),
                  e('td', { style: { padding: '0.25rem 0.3rem', textAlign: 'right', color: d.status === 'match' ? good : warn } },
                    d.status === 'missing' ? __('bsNotInMaermin', 'not in MAERMIN') : d.status === 'match' ? __('bsMatches', 'matches') : __('bsDiffers', 'MAERMIN {q} ({d})', { q: d.maermin, d: (d.diff > 0 ? '+' : '') + d.diff })));
              })))) : null);
      });
      var runBox = null;
      if (active && run.step === 'pin') {
        runBox = e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' } },
          c.rememberLogin && c.login ? null : e('input', { 'aria-label': __('bsLogin', 'Login name'), placeholder: __('bsLogin', 'Login name'), autoComplete: 'off', value: run.login || '', onChange: function (ev) { setRun(Object.assign({}, run, { login: ev.target.value })); }, style: inputStyle }),
          e('input', { 'data-testid': 'bs-pin', type: 'password', autoComplete: 'off', 'aria-label': __('bsPin', 'PIN'), placeholder: __('bsPin', 'PIN'), value: run.pin || '', onChange: function (ev) { setRun(Object.assign({}, run, { pin: ev.target.value })); }, style: inputStyle }),
          e('button', { 'data-testid': 'bs-start', style: btn(true), onClick: function () { start(c); } }, __('bsStart', 'Start')),
          e('button', { style: btn(false), onClick: function () { setRun(null); } }, __('cancel', 'Cancel')));
      } else if (active && run.step === 'method') {
        runBox = e('div', { style: { marginTop: '0.5rem', color: text, fontSize: '0.78rem' } },
          e('div', { style: { marginBottom: '0.3rem' } }, __('bsChooseMethod', 'Choose your TAN method:')),
          run.methods.map(function (m) { return e('button', { key: m.secFunc, 'data-testid': 'bs-method', style: Object.assign(btn(false), { marginRight: '0.4rem', marginBottom: '0.3rem' }), onClick: function () { var f = tanRef.current; tanRef.current = null; if (f) f(m); } }, m.name); }));
      } else if (active && run.step === 'tan') {
        runBox = e('div', { style: { marginTop: '0.5rem' } },
          e('div', { 'data-testid': 'bs-challenge', style: { color: text, fontSize: '0.78rem', marginBottom: '0.35rem' } }, run.challenge || __('bsEnterTan', 'Enter the TAN.')),
          e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } },
            e('input', { 'data-testid': 'bs-tan', autoComplete: 'one-time-code', 'aria-label': __('bsTan', 'TAN'), placeholder: __('bsTan', 'TAN'), value: run.tan || '', onChange: function (ev) { setRun(Object.assign({}, run, { tan: ev.target.value })); }, style: inputStyle }),
            e('button', { 'data-testid': 'bs-send-tan', style: btn(true), onClick: function () { var f = tanRef.current; tanRef.current = null; var v = run.tan; setRun(Object.assign({}, run, { step: 'busy', tan: '' })); if (f) f(v); } }, __('bsSendTan', 'Send')),
            e('button', { style: btn(false), onClick: function () { var f = tanRef.current; tanRef.current = null; if (f) f(null); } }, __('cancel', 'Cancel'))));
      } else if (active) {
        runBox = e('div', { 'data-testid': 'bs-status', role: 'status', style: { marginTop: '0.5rem', color: dim, fontSize: '0.78rem' } }, run.status || '',
          run.step === 'app' ? e('button', { style: Object.assign(btn(false), { marginLeft: '0.5rem' }), onClick: function () { cancelRef.current = true; } }, __('cancel', 'Cancel')) : null);
      }
      return e('div', { key: c.id, 'data-testid': 'bs-connection', style: { padding: '0.7rem 0.8rem', border: '1px solid ' + border, borderRadius: '10px', marginBottom: '0.6rem' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } },
          e('div', null,
            e('div', { style: { color: text, fontWeight: 600, fontSize: '0.85rem' } }, c.label || c.blz),
            e('div', { style: { color: dim, fontSize: '0.72rem' } }, c.blz + (c.methodName ? ' · ' + c.methodName : '') + ' · ' + (c.lastSync ? __('bsLastSync', 'last sync {date}', { date: c.lastSync }) : __('bsNever', 'never synced')))),
          e('div', { style: { display: 'flex', gap: '0.4rem' } },
            e('button', { 'data-testid': 'bs-sync', disabled: !!run, style: Object.assign(btn(true), { opacity: run ? 0.6 : 1 }), onClick: function () { setMsg(''); setRun({ id: c.id, step: 'pin', pin: '', login: '' }); } }, __('bsSync', 'Sync')),
            e('button', { style: btn(false), onClick: function () {
              W.MaerminUtils.confirmThen({ title: __('bsRemoveTitle', 'Remove the bank "{name}"?', { name: c.label || c.blz }), message: __('bsRemoveMsg', 'Its stored settings and last balances are deleted. Bookings already imported stay.'), confirmLabel: __('bsRemove', 'Remove'), cancelLabel: __('cancel', 'Cancel') },
                function () { mutate(removeConnection(st, c.id)); });
            } }, __('bsRemove', 'Remove')))),
        runBox, accounts);
    });

    var picked = bankOf(form.bankId);
    return e('div', { 'data-testid': 'bank-sync', style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.25rem' } },
      e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, __('bsTitle', 'Bank sync (FinTS)')),
      e('div', { 'data-testid': 'bs-privacy', style: { color: dim, fontSize: '0.76rem', marginBottom: '0.8rem', lineHeight: 1.5 } },
        __('bsSubtitle', 'Balances, transactions and depot statements straight from your bank. This browser builds every FinTS message; your own Worker only passes it to the bank. The PIN and TANs are never stored, the login name only if you tick it.')),
      info && info.error ? e('div', { style: { color: warn, fontSize: '0.76rem', marginBottom: '0.6rem' } }, __('bsOutdated', 'Your Worker does not offer bank sync yet: redeploy it (version 2026.10.8 or later).')) : null,
      info && !info.error && !info.productId ? e('div', { 'data-testid': 'bs-no-product', style: { color: warn, fontSize: '0.76rem', marginBottom: '0.6rem' } }, __('bsNoProduct', 'Bank sync needs the MAERMIN FinTS product id in your Worker (FINTS_PRODUCT_ID).')) : null,
      connRows,
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '0.5rem', marginTop: '0.4rem' } },
        e('select', { 'data-testid': 'bs-bank', 'aria-label': __('bsBank', 'Bank'), value: form.bankId, onChange: function (ev) { var b = bankOf(ev.target.value); setF({ bankId: ev.target.value, url: b && b.url ? b.url : '' }); }, style: inputStyle },
          e('option', { value: '' }, __('bsChooseBank', 'Choose a bank…')),
          banks.map(function (b) { return e('option', { key: b.id, value: b.id }, b.name); })),
        e('input', { 'data-testid': 'bs-url', 'aria-label': __('bsUrl', 'FinTS address'), placeholder: (picked && picked.urlHint) || __('bsUrl', 'FinTS address'), value: form.url, readOnly: !!(picked && picked.url), onChange: function (ev) { setF({ url: ev.target.value }); }, style: inputStyle }),
        e('input', { 'data-testid': 'bs-blz', 'aria-label': __('bsBlz', 'Bank code (BLZ)'), placeholder: __('bsBlz', 'Bank code (BLZ)'), inputMode: 'numeric', value: form.blz, onChange: function (ev) { setF({ blz: ev.target.value.replace(/\D/g, '').slice(0, 8) }); }, style: inputStyle }),
        e('input', { 'aria-label': __('bsLabel', 'Name (optional)'), placeholder: __('bsLabel', 'Name (optional)'), value: form.label, onChange: function (ev) { setF({ label: ev.target.value }); }, style: inputStyle }),
        e('input', { 'data-testid': 'bs-login', 'aria-label': __('bsLogin', 'Login name'), placeholder: __('bsLogin', 'Login name'), autoComplete: 'off', value: form.login, onChange: function (ev) { setF({ login: ev.target.value }); }, style: inputStyle })),
      e('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: dim, fontSize: '0.74rem', marginTop: '0.45rem', cursor: 'pointer' } },
        e('input', { type: 'checkbox', 'data-testid': 'bs-remember', checked: form.rememberLogin, onChange: function (ev) { setF({ rememberLogin: ev.target.checked }); } }),
        __('bsRemember', 'Remember the login name (encrypted in your vault)')),
      picked && picked.confirmed === false ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.3rem' } }, __('bsUnconfirmed', 'This address comes from open-source FinTS clients; if the bank answers with an error, check it on your bank\'s help pages.')) : null,
      e('div', null, e('button', { 'data-testid': 'bs-add', style: Object.assign(btn(true), { marginTop: '0.6rem' }), onClick: addConn }, __('bsAdd', 'Add bank'))),
      msg ? e('div', { 'data-testid': 'bs-msg', role: 'status', style: { color: dim, fontSize: '0.76rem', marginTop: '0.5rem' } }, msg) : null);
  }
  api.Panel = Panel;

  if (typeof window !== 'undefined') window.MaerminBankSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
