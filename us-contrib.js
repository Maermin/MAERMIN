// ============================================================================
// MAERMIN — US retirement contribution limits  (window.MaerminUSContrib)
// ----------------------------------------------------------------------------
// P5-4.11. IRA, Roth IRA and 401(k) limits per tax year with the room left.
// Amounts from the IRS cost-of-living notices, checked on 2026-10-14:
//   Notice 2024-80 (2025 amounts, and the 2024 amounts they increase from)
//   Notice 2025-67, news release IR-2025-111 of 13.11.2025 (2026 amounts)
//   - § 402(g)(1) elective deferrals (401(k), traditional and Roth together)
//   - § 414(v)(2)(B)(i) catch-up from age 50; § 414(v)(2)(E)(i) (SECURE 2.0
//     § 109, from 2025) the higher catch-up in the year one turns 60 to 63
//   - § 219(b)(5)(A)/(B) IRA limit and its catch-up from age 50, shared by
//     traditional and Roth IRAs
//   - § 408A(c)(3) Roth IRA MAGI phase-out; the reduced amount per IRS
//     Publication 590-A: rounded up to the next $10, at least $200 while
//     MAGI is below the top of the range
// The 2027 amounts are not published yet (the IRS announces them in the
// autumn): 2027 uses the 2026 amounts, marked estimated.
// Contributions are the deposits (cash-flow bookings) into the portfolios the
// user marks as IRA / Roth IRA / 401(k), in USD. Not counted: transfers in
// (rollovers), employer money (entered per year), and IRA deposits made by
// 15 April that the user designates for the previous year.
// Not modelled: the § 415(c) overall limit, the IRA limit's cap at earned
// income, the deduction phase-out of a traditional IRA, the Roth catch-up
// wage rule. A planning aid, not tax advice.
// Settings: 'maermin_us_retirement' (encrypted, in the backup):
//   { birthYear, filing: 'single'|'mfj'|'mfs', magi: { YYYY: USD },
//     accounts: { portfolioId: 'ira'|'roth-ira'|'401k' },
//     priorYear: { portfolioId: { YYYY: USD } }, employer: { portfolioId: { YYYY: USD } } }
// Node-tested in test/us-contrib.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var SETTINGS_KEY = 'maermin_us_retirement';
  var TYPES = { ira: true, 'roth-ira': true, '401k': true };
  // k401: § 402(g); c50: § 414(v)(2)(B)(i); c60: § 414(v)(2)(E)(i);
  // ira / ira50: § 219(b)(5); roth: MAGI phase-out { single, mfj, mfs } = [from, to].
  var LIMITS = {
    2024: { k401: 23000, c50: 7500, c60: null, ira: 7000, ira50: 1000, roth: { single: [146000, 161000], mfj: [230000, 240000], mfs: [0, 10000] } },
    2025: { k401: 23500, c50: 7500, c60: 11250, ira: 7000, ira50: 1000, roth: { single: [150000, 165000], mfj: [236000, 246000], mfs: [0, 10000] } },
    2026: { k401: 24500, c50: 8000, c60: 11250, ira: 7500, ira50: 1100, roth: { single: [153000, 168000], mfj: [242000, 252000], mfs: [0, 10000] } }
  };
  var FIRST = 2024, LAST = 2026;
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function ymd(d) { return String(d || '').slice(0, 10); }

  function table(year) {
    var y = Math.min(Math.max(year, FIRST), LAST);
    return { t: LIMITS[y], estimated: year > LAST, source: y };
  }
  // Limits of a tax year for someone born in birthYear (age at year-end).
  function limitsFor(year, birthYear) {
    var x = table(year), t = x.t, age = birthYear ? year - birthYear : null;
    var catchUp = 0;
    if (age != null && age >= 50) catchUp = (t.c60 && age >= 60 && age <= 63) ? t.c60 : t.c50;
    return { year: year, age: age, estimated: x.estimated, sourceYear: x.source,
      k401: t.k401 + catchUp, k401Base: t.k401, k401CatchUp: catchUp,
      ira: t.ira + (age != null && age >= 50 ? t.ira50 : 0), iraBase: t.ira, roth: t.roth };
  }
  // Roth IRA limit after the MAGI phase-out (Publication 590-A).
  function rothLimit(year, limit, magi, filing) {
    var range = table(year).t.roth[filing === 'mfj' || filing === 'mfs' ? filing : 'single'];
    if (magi == null || magi < range[0]) return limit;
    if (magi >= range[1]) return 0;
    var reduced = limit - limit * (magi - range[0]) / (range[1] - range[0]);
    reduced = Math.ceil(Math.round(reduced * 100) / 1000) * 10;
    return Math.min(limit, Math.max(200, reduced));
  }

  function amounts(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (pid) {
      var m = {};
      Object.keys((raw[pid] && typeof raw[pid] === 'object') ? raw[pid] : {}).forEach(function (y) { var n = parseFloat(raw[pid][y]); if (/^\d{4}$/.test(y) && isFinite(n) && n >= 0) m[y] = n; });
      out[pid] = m;
    });
    return out;
  }
  function normalizeSettings(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    raw = raw && typeof raw === 'object' ? raw : {};
    var by = parseInt(raw.birthYear, 10), magi = {}, accounts = {};
    Object.keys(raw.magi || {}).forEach(function (y) { var n = parseFloat(raw.magi[y]); if (/^\d{4}$/.test(y) && isFinite(n)) magi[y] = n; });
    Object.keys(raw.accounts || {}).forEach(function (pid) { if (TYPES[raw.accounts[pid]]) accounts[pid] = raw.accounts[pid]; });
    return { birthYear: by > 1900 && by < 2100 ? by : null, filing: raw.filing === 'mfj' || raw.filing === 'mfs' ? raw.filing : 'single',
      magi: magi, accounts: accounts, priorYear: amounts(raw.priorYear), employer: amounts(raw.employer) };
  }
  function loadSettings() { try { return normalizeSettings(localStorage.getItem(SETTINGS_KEY)); } catch (e) { return normalizeSettings(null); } }
  function saveSettings(s) { var n = normalizeSettings(s); try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(n)); } catch (e) { /* non-fatal */ } return n; }

  // A deposit in USD (EUR via exchangeRate = EUR per 1 USD; others via fx-history).
  function usd(tx, rate) {
    var cur = String(tx.currency || 'USD').toUpperCase(), a = num(tx.amount);
    if (cur === 'USD') return a;
    if (!(rate > 0)) return 0;
    if (cur === 'EUR') return a / rate;
    var F = (typeof window !== 'undefined' && window.MaerminFxHistory) || (function () { try { return require('./fx-history.js'); } catch (e) { return null; } })();
    return F && F.txToEUR ? F.txToEUR(a, tx.currency, ymd(tx.date), rate).value / rate : 0;
  }

  // opts: { year, exchangeRate, today }
  function compute(transactions, settings, opts) {
    opts = opts || {};
    var s = normalizeSettings(settings || {});
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate);
    var today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
    var lim = limitsFor(year, s.birthYear);
    var Y = String(year), Yp = String(year - 1);
    var accounts = Object.keys(s.accounts).map(function (pid) {
      var deposits = 0;
      (transactions || []).forEach(function (tx) {
        if (tx && tx.type === 'deposit' && String(tx.portfolioId || 'default') === pid && ymd(tx.date).slice(0, 4) === Y) deposits += usd(tx, rate);
      });
      var pr = s.priorYear[pid] || {}, emp = (s.employer[pid] || {})[Y] || 0;
      // + early next-year deposits designated for this year; - this year's deposits designated for last year.
      var counted = Math.max(0, deposits + (pr[Y] || 0) - (pr[Yp] || 0) - (s.accounts[pid] === '401k' ? emp : 0));
      return { portfolioId: pid, type: s.accounts[pid], deposits: r2(deposits), employer: s.accounts[pid] === '401k' ? emp : 0, contributed: r2(counted) };
    });
    function sum(types) { return r2(accounts.filter(function (a) { return types[a.type]; }).reduce(function (t, a) { return t + a.contributed; }, 0)); }
    var iraC = sum({ ira: true, 'roth-ira': true }), rothC = sum({ 'roth-ira': true }), kC = sum({ '401k': true });
    var magi = s.magi[Y] != null ? s.magi[Y] : null;
    var rLim = rothLimit(year, lim.ira, magi, s.filing);
    var iraRemaining = Math.max(0, lim.ira - iraC);
    var deadlineIra = (year + 1) + '-04-15', deadlineK = year + '-12-31';
    return {
      year: year, limits: lim, filing: s.filing, accounts: accounts,
      ira: { limit: lim.ira, contributed: iraC, remaining: r2(iraRemaining), excess: r2(Math.max(0, iraC - lim.ira)),
        deadline: deadlineIra, open: today <= deadlineIra,
        roth: { limit: rLim, contributed: rothC, remaining: r2(Math.min(iraRemaining, Math.max(0, rLim - rothC))), excess: r2(Math.max(0, rothC - rLim)),
          magiMissing: magi == null, magi: magi, phaseOut: lim.roth[s.filing] } },
      k401: { limit: lim.k401, catchUp: lim.k401CatchUp, contributed: kC, employer: accounts.reduce(function (t, a) { return t + a.employer; }, 0),
        remaining: r2(Math.max(0, lim.k401 - kC)), excess: r2(Math.max(0, kC - lim.k401)), deadline: deadlineK, open: today <= deadlineK }
    };
  }

  // ---- panel (Tax view, USA) ---------------------------------------------------------
  // props: { theme, transactions, portfolios, exchangeRate, year, privacy }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b', bad = th.danger || '#ef4444', accent = th.accent || '#8b7cff';
    var money = function (v) { return props.privacy ? '••••••' : window.MaerminI18n.money(v, 'USD'); };
    var year = props.year || new Date().getFullYear(), Y = String(year);
    var s0 = useState(loadSettings); var st = s0[0], setSt = s0[1];
    function update(next) { setSt(saveSettings(next)); }
    var r = compute(props.transactions || [], st, { year: year, exchangeRate: props.exchangeRate });
    // R4.6: Card, meters on tokens (over the limit in words and the loss tone), small inputs with visible labels
    var UIC = window.MaerminComponents;
    var INPUT = ['ui-input', 'ui-input--sm'].join(' ');
    function setAmount(field, pid, v) {
      var n = Object.assign({}, st[field]); var m = Object.assign({}, n[pid] || {});
      if (isFinite(v) && v > 0) m[Y] = v; else delete m[Y];
      n[pid] = m; var next = Object.assign({}, st); next[field] = n; update(next);
    }
    function parse(v) { return parseFloat(String(v).replace(/,/g, '')); }
    function bar(tid, title, used, limit, extra) {
      var pct = limit > 0 ? Math.min(100, used / limit * 100) : 0, over = used > limit;
      return e('div', { 'data-testid': tid, className: 'ui-uc-bar' },
        e('div', { className: 'ui-meters__label' },
          e('b', null, title),
          e('span', { className: ['num', over ? 'tone-loss' : ''].join(' ').trim() }, (over ? '! ' : '') + __('ucUsedOf', '{used} of {limit}', { used: money(used), limit: money(limit) }))),
        e('span', { className: 'ui-meter', 'aria-hidden': 'true' },
          e('span', { className: 'ui-meter__fill', 'data-tone': over ? 'loss' : pct >= 100 ? 'gain' : 'accent', style: { width: pct + '%' } })),
        extra);
    }
    var bad = function (txt) { return e('p', { className: 'tone-loss' }, '! ' + txt); };
    var ira = r.ira, k = r.k401, pfs = props.portfolios || [];
    var hasIra = r.accounts.some(function (a) { return a.type !== '401k'; }), hasK = r.accounts.some(function (a) { return a.type === '401k'; });
    return e(UIC.Card, { 'data-testid': 'us-contrib-panel', className: 'ui-taxp', headingLevel: 'h3', title: __('ucTitle', 'Retirement contributions {y}', { y: year }),
      subtitle: __('ucIntro', 'Mark which portfolios are an IRA, a Roth IRA or a 401(k). Their deposits count as contributions against the IRS limits of the year; rollovers (transfers in) do not.') },
      r.limits.estimated ? e('p', { 'data-testid': 'uc-estimated', className: ['ui-callout', 'ui-callout--warn'].join(' ') }, __('ucEstimated', 'The IRS has not published the limits for {y} yet: the {s} amounts are shown.', { y: year, s: r.limits.sourceYear })) : null,
      hasIra ? bar('uc-ira', __('ucIra', 'IRA (traditional and Roth together)'), ira.contributed, ira.limit,
        e('div', { className: 'ui-uc-notes' },
          ira.excess > 0 ? bad(__('ucIraExcess', 'Excess contribution of {v}: withdraw it with its earnings by the filing deadline, or a 6 % excise tax applies each year.', { v: money(ira.excess) })) : null,
          e('p', null, __('ucRemaining', 'Room left: {v} · deadline {d}', { v: money(ira.remaining), d: window.MaerminI18n.date(ira.deadline) })),
          r.accounts.some(function (a) { return a.type === 'roth-ira'; }) ? e('p', { 'data-testid': 'uc-roth' },
            ira.roth.magiMissing ? __('ucRothNoMagi', 'Roth IRA: enter your MAGI for {y} to apply the income phase-out ({a} to {b}).', { y: year, a: money(ira.roth.phaseOut[0]), b: money(ira.roth.phaseOut[1]) })
              : __('ucRoth', 'Roth IRA limit at MAGI {m}: {l}; room left {v}', { m: money(ira.roth.magi), l: money(ira.roth.limit), v: money(ira.roth.remaining) }),
            ira.roth.excess > 0 ? e('span', { className: 'tone-loss' }, ' · ! ' + __('ucRothExcess', 'over the Roth limit by {v}', { v: money(ira.roth.excess) })) : null) : null)) : null,
      hasK ? bar('uc-401k', __('ucK401', '401(k) employee deferrals'), k.contributed, k.limit,
        e('div', { className: 'ui-uc-notes' },
          k.excess > 0 ? bad(__('ucKExcess', 'Excess deferral of {v}: ask the plan to return it by 15 April, or it is taxed twice.', { v: money(k.excess) })) : null,
          e('p', null, __('ucRemainingK', 'Room left: {v} · through payroll by {d}', { v: money(k.remaining), d: window.MaerminI18n.date(k.deadline) })),
          k.catchUp ? e('p', null, __('ucCatchUp', 'Includes a catch-up of {v}.', { v: money(k.catchUp) })) : null)) : null,
      !hasIra && !hasK ? e('p', { className: 'ui-muted' }, __('ucNone', 'No portfolio is marked as a retirement account yet.')) : null,
      e('div', { className: ['ui-form-grid', 'ui-taxp__sec'].join(' ') },
        e(UIC.Input, { 'data-testid': 'uc-birth', inputMode: 'numeric', label: __('ucBirthYear', 'Birth year'), defaultValue: st.birthYear || '',
          onBlur: function (ev) { update(Object.assign({}, st, { birthYear: ev.target.value })); } }),
        e(UIC.Select, { 'data-testid': 'uc-filing', label: __('ucFiling', 'Filing status'), value: st.filing, onChange: function (ev) { update(Object.assign({}, st, { filing: ev.target.value })); },
          options: [{ value: 'single', label: __('ucSingle', 'Single / head of household') }, { value: 'mfj', label: __('ucMfj', 'Married filing jointly') }, { value: 'mfs', label: __('ucMfs', 'Married filing separately') }] }),
        e(UIC.Input, { 'data-testid': 'uc-magi', key: 'magi' + Y, inputMode: 'decimal', label: __('ucMagi', 'MAGI {y}', { y: year }), defaultValue: st.magi[Y] != null ? String(st.magi[Y]) : '',
          onBlur: function (ev) { var v = parse(ev.target.value); var m = Object.assign({}, st.magi); if (isFinite(v)) m[Y] = v; else delete m[Y]; update(Object.assign({}, st, { magi: m })); } })),
      e('ul', { className: ['ui-rows', 'ui-taxp__sec'].join(' ') },
        pfs.map(function (p) {
          var type = st.accounts[p.id] || '', acc = r.accounts.filter(function (a) { return a.portfolioId === p.id; })[0];
          return e('li', { key: p.id, 'data-testid': 'uc-pf-' + p.id, className: ['ui-rows__row', 'ui-taxp__fund'].join(' ') },
            e('b', null, p.name || p.id),
            e('select', { className: [INPUT, 'ui-select'].join(' '), value: type, 'aria-label': __('ucAccountType', 'Account type') + ' ' + (p.name || p.id),
              onChange: function (ev) { var a = Object.assign({}, st.accounts); if (ev.target.value) a[p.id] = ev.target.value; else delete a[p.id]; update(Object.assign({}, st, { accounts: a })); } },
              e('option', { value: '' }, __('ucTaxable', 'Taxable account')), e('option', { value: 'ira' }, __('ucTypeIra', 'Traditional IRA')),
              e('option', { value: 'roth-ira' }, __('ucTypeRoth', 'Roth IRA')), e('option', { value: '401k' }, '401(k)')),
            acc ? e('span', { className: 'ui-note' }, __('ucDeposits', 'deposits {y}: {v}', { y: year, v: money(acc.deposits) })) : null,
            type === 'ira' || type === 'roth-ira' ? e('input', { key: 'pr' + p.id + Y, inputMode: 'decimal', className: [INPUT, 'ui-uc-amt'].join(' '),
              title: __('ucPriorHint', 'Deposited between 1 January and 15 April {n}, designated for {y}', { n: year + 1, y: year }),
              'aria-label': __('ucPriorHint', 'Deposited between 1 January and 15 April {n}, designated for {y}', { n: year + 1, y: year }),
              placeholder: __('ucPrior', 'for {y} in {n}', { y: year, n: year + 1 }), defaultValue: (st.priorYear[p.id] || {})[Y] || '',
              onBlur: function (ev) { setAmount('priorYear', p.id, parse(ev.target.value)); } }) : null,
            type === '401k' ? e('input', { key: 'em' + p.id + Y, inputMode: 'decimal', className: [INPUT, 'ui-uc-amt'].join(' '),
              placeholder: __('ucEmployer', 'employer {y}', { y: year }), title: __('ucEmployerHint', 'Employer contributions included in the deposits (they do not count against your limit)'),
              'aria-label': __('ucEmployerHint', 'Employer contributions included in the deposits (they do not count against your limit)'),
              defaultValue: (st.employer[p.id] || {})[Y] || '', onBlur: function (ev) { setAmount('employer', p.id, parse(ev.target.value)); } }) : null);
        })),
      e('p', { className: 'ui-note' },
        __('ucNote', 'Limits from IRS Notice 2024-80 and Notice 2025-67 (§ 402(g), § 414(v), § 219(b)(5), § 408A(c)(3) IRC); the Roth reduction per Publication 590-A. Not modelled: the overall § 415(c) limit, the IRA cap at your earned income, the traditional IRA deduction phase-out. Not tax advice.')));
  }

  var api = { SETTINGS_KEY: SETTINGS_KEY, LIMITS: LIMITS, limitsFor: limitsFor, rothLimit: rothLimit, compute: compute,
    normalizeSettings: normalizeSettings, loadSettings: loadSettings, saveSettings: saveSettings, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminUSContrib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
