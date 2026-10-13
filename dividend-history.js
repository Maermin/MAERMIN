// ============================================================================
// MAERMIN — Dividends depth  (window.MaerminDividendHistory)
// ----------------------------------------------------------------------------
// P5-2.5. Pure figures behind Dividends → History and the forecast months.
// Pure + dual-exported; tested in test/dividend-history.test.js.
//
//   amountOf(tx, basis)        a payment in its currency: 'gross' = shares ×
//                              amount per share (or the booked amount), 'net' =
//                              gross − withholding tax (the default)
//   matrix(txs, { toEUR(amount, tx), basis, today })
//     → { years: [first dividend year … this year], rows: [{ sym, byYear, total }],
//         totals: { year: EUR }, grand }
//   growth(txs, { today })     per share, so buying more is not growth
//     → { payments: [{ sym, date, dps, prevDate, prevDps, yoy }],
//         payers: [{ sym, years: { year: dps sum }, cagr3, cagr5, last }] }
//     yoy compares a payment with the payer's payment closest to one year
//     earlier (±60 days). CAGR n runs from the last complete year back n
//     years and needs a base year with at least as many payments as the last
//     one (a partly recorded first year would inflate it).
//   months(rates, { today, months })   the forecast per month, each
//     { y, m (0-11), amount, items: [{ sym, amount, source }] }; a payer with
//     history pays in its months, an estimated one evenly from this month
//   backtest(holdings [{ sym, shares }], history { sym: { currency,
//            divs: [{ date, amount }], closes: [[date, close]] } },
//            { years, today, toEUR(amount, currency, date) })
//     → { years: [{ y, income, startValue, yield, growth }], cagr, covered, missing }
//     Today's shares as if held through each complete past year: income =
//     shares × that year's market dividends, yield = income / value at the
//     prior year-end closes.
//
//   View                       Dividends → History: the matrix (gross / net),
//                              growth per payer and the backtest; the market
//                              data comes from the Worker `yf` route (monthly,
//                              10 years, symbols only) and stays in memory
// ============================================================================
(function () {
  'use strict';

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  function yearOf(d) { return parseInt(ymd(d).slice(0, 4), 10); }
  function todayISO(o) { return ymd(o && o.today) || new Date().toISOString().slice(0, 10); }
  function isDiv(tx) { return !!tx && tx.type === 'dividend' && !!tx.symbol && !!ymd(tx.date); }
  var DAY = 86400000;
  function days(a, b) { return (Date.parse(ymd(b) + 'T00:00:00Z') - Date.parse(ymd(a) + 'T00:00:00Z')) / DAY; }

  function amountOf(tx, basis) {
    if (!tx) return 0;
    var gross = (num(tx.quantity) * num(tx.price)) || num(tx.amount);
    return basis === 'gross' ? gross : gross - Math.max(0, num(tx.withholdingTax));
  }

  function matrix(txs, opts) {
    opts = opts || {};
    var toEUR = typeof opts.toEUR === 'function' ? opts.toEUR : function (a) { return a; };
    var bySym = Object.create(null), first = null; // keys are imported symbols (SEC-023)
    (txs || []).forEach(function (tx) {
      if (!isDiv(tx)) return;
      var key = String(tx.symbol).toUpperCase(), y = yearOf(tx.date);
      var r = bySym[key] || (bySym[key] = { sym: tx.symbol, byYear: {}, total: 0 });
      var a = num(toEUR(amountOf(tx, opts.basis), tx));
      r.byYear[y] = (r.byYear[y] || 0) + a;
      r.total += a;
      if (first === null || y < first) first = y;
    });
    var out = { years: [], rows: [], totals: {}, grand: 0 };
    if (first === null) return out;
    var last = Math.max(yearOf(todayISO(opts)), first);
    for (var y = first; y <= last; y++) { out.years.push(y); out.totals[y] = 0; }
    Object.keys(bySym).forEach(function (k) {
      var r = bySym[k];
      out.years.forEach(function (yy) { if (!r.byYear[yy]) r.byYear[yy] = 0; out.totals[yy] += r.byYear[yy] || 0; });
      out.grand += r.total;
      out.rows.push(r);
    });
    out.rows.sort(function (a, b) { return b.total - a.total; });
    return out;
  }

  function growth(txs, opts) {
    var today = todayISO(opts);
    var lastFull = yearOf(today) - 1;
    var bySym = Object.create(null);
    (txs || []).forEach(function (tx) {
      if (!isDiv(tx) || ymd(tx.date) > today) return;
      var q = num(tx.quantity), p = num(tx.price);
      if (!(q > 0 && p > 0)) return;
      var key = String(tx.symbol).toUpperCase();
      (bySym[key] || (bySym[key] = { sym: tx.symbol, list: [] })).list.push({ date: ymd(tx.date), dps: p });
    });
    var payments = [], payers = [];
    Object.keys(bySym).forEach(function (k) {
      var g = bySym[k], years = {}, count = {};
      g.list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      g.list.forEach(function (p) {
        var best = null, bestOff = Infinity;
        g.list.forEach(function (o) {
          var off = Math.abs(days(o.date, p.date) - 365);
          if (o.date < p.date && off <= 60 && off < bestOff) { best = o; bestOff = off; }
        });
        var row = { sym: g.sym, date: p.date, dps: p.dps, prevDate: best ? best.date : null, prevDps: best ? best.dps : null, yoy: best ? p.dps / best.dps - 1 : null };
        payments.push(row);
        var y = yearOf(p.date);
        years[y] = (years[y] || 0) + p.dps;
        count[y] = (count[y] || 0) + 1;
      });
      function cagr(n) {
        var a = years[lastFull - n], b = years[lastFull];
        if (!(a > 0 && b > 0) || (count[lastFull - n] || 0) < (count[lastFull] || 0)) return null;
        return Math.pow(b / a, 1 / n) - 1;
      }
      var mine = payments.filter(function (p) { return p.sym === g.sym; });
      payers.push({ sym: g.sym, years: years, cagr3: cagr(3), cagr5: cagr(5), last: mine[mine.length - 1] || null });
    });
    payments.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { payments: payments, payers: payers };
  }

  function months(rates, opts) {
    opts = opts || {};
    var n = opts.months > 0 ? Math.round(opts.months) : 24;
    var t = todayISO(opts), y0 = yearOf(t), m0 = parseInt(t.slice(5, 7), 10) - 1;
    var out = [];
    for (var i = 0; i < n; i++) {
      var mm = m0 + i;
      out.push({ y: y0 + Math.floor(mm / 12), m: mm % 12, amount: 0, items: [] });
    }
    (rates || []).forEach(function (f) {
      var ppy = f.paymentsPerYear || (f.frequency === 'monthly' ? 12 : f.frequency === 'quarterly' ? 4 : f.frequency === 'semi-annual' ? 2 : 1);
      var per = f.perPayment != null ? num(f.perPayment) : num(f.annualRate) / ppy;
      out.forEach(function (mo, i) {
        var pays = Array.isArray(f.months) && f.months.length ? f.months.indexOf(mo.m) > -1
          : ppy >= 12 ? true : ppy === 4 ? i % 3 === 0 : ppy === 2 ? i % 6 === 0 : i % 12 === 0;
        if (!pays) return;
        mo.amount += per;
        mo.items.push({ sym: f.sym, amount: per, source: f.source || 'history' });
      });
    });
    return out;
  }

  function backtest(holdings, history, opts) {
    opts = opts || {};
    history = history || {};
    var n = opts.years > 0 ? Math.round(opts.years) : 5;
    var toEUR = typeof opts.toEUR === 'function' ? opts.toEUR : function (a) { return a; };
    var last = yearOf(todayISO(opts)) - 1;
    var out = { years: [], cagr: null, covered: [], missing: [] };
    var held = [];
    (holdings || []).forEach(function (h) {
      if (!h || !(num(h.shares) > 0)) return;
      var hs = history[h.sym] || history[String(h.sym).toUpperCase()];
      if (!hs || !((hs.closes && hs.closes.length) || (hs.divs && hs.divs.length))) { out.missing.push(h.sym); return; }
      out.covered.push(h.sym);
      held.push({ shares: num(h.shares), h: hs, cur: hs.currency || 'EUR' });
    });
    if (!held.length) return out;
    function closeAt(hs, iso) {
      var c = null;
      (hs.closes || []).forEach(function (row) { if (row[0] <= iso && row[1] > 0 && (!c || row[0] >= c[0])) c = row; });
      return c;
    }
    var rows = [];
    for (var y = last - n + 1; y <= last; y++) {
      var income = 0, start = 0, priced = false;
      held.forEach(function (x) {
        (x.h.divs || []).forEach(function (d) {
          if (yearOf(d.date) === y) income += x.shares * num(toEUR(num(d.amount), x.cur, ymd(d.date)));
        });
        var c = closeAt(x.h, (y - 1) + '-12-31');
        if (c) { priced = true; start += x.shares * num(toEUR(c[1], x.cur, c[0])); }
      });
      rows.push({ y: y, income: income, startValue: priced ? start : null, yield: priced && start > 0 ? income / start : null, growth: null });
    }
    // leading years without any price and without income are before the history
    while (rows.length && rows[0].startValue === null && !(rows[0].income > 0)) rows.shift();
    rows.forEach(function (r, i) { var p = rows[i - 1]; r.growth = p && p.income > 0 ? r.income / p.income - 1 : null; });
    out.years = rows;
    var firstInc = null;
    rows.forEach(function (r) { if (firstInc === null && r.income > 0) firstInc = r; });
    var lastRow = rows[rows.length - 1];
    if (firstInc && lastRow && lastRow.y > firstInc.y && lastRow.income > 0) out.cagr = Math.pow(lastRow.income / firstInc.income, 1 / (lastRow.y - firstInc.y)) - 1;
    return out;
  }

  // --------------------------------------------------------------------------
  // React view: Dividends → History (matrix, growth, backtest)
  // --------------------------------------------------------------------------
  function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var _market = {}; // yf symbol → Worker answer; memory only (symbols, no amounts, leave the device)
  function getJson(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false, timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms || 15000);
      fetch(url).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { if (!done) { done = true; clearTimeout(timer); resolve(j); } }, function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    });
  }
  function holdingsOf(portfolio) {
    var by = {}, list = [];
    ((portfolio && portfolio.stocks) || []).forEach(function (p) {
      var sym = String(p.symbol || p.name || '').trim().toUpperCase(), q = num(p.amount);
      if (!sym || !(q > 0)) return;
      if (!by[sym]) { by[sym] = { sym: sym, shares: 0 }; list.push(by[sym]); }
      by[sym].shares += q;
    });
    return list;
  }

  function View(props) {
    var React = window.React, e = React.createElement;
    var theme = props.theme || {};
    var basis = props.basis === 'gross' ? 'gross' : 'net';
    var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
    var cur = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';
    var I = window.MaerminI18n;
    var txs = props.transactions || [];
    var FX = window.MaerminFxHistory, U = window.MaerminUtils;
    var toEURtx = function (amount, tx) {
      if (FX && FX.txToEUR) return FX.txToEUR(amount, tx.currency || 'EUR', tx.date, props.exchangeRate, props.fxAt).value;
      return U ? U.toEUR(amount, tx.currency || 'EUR', props.exchangeRate) : amount;
    };
    var toEURc = function (amount, c, d) {
      if (FX && FX.txToEUR) return FX.txToEUR(amount, c, d, props.exchangeRate, props.fxAt).value;
      return U ? U.toEUR(amount, c, props.exchangeRate) : amount;
    };
    var today = (U && U.todayISO) ? U.todayISO() : new Date().toISOString().slice(0, 10);
    var mx = React.useMemo(function () { return matrix(txs, { toEUR: toEURtx, basis: basis, today: today }); }, [txs, basis, props.exchangeRate, props.fxAt]);
    var gr = React.useMemo(function () { return growth(txs, { today: today }); }, [txs]);
    var holdings = React.useMemo(function () { return holdingsOf(props.portfolio); }, [props.portfolio]);
    var workerUrl = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var yrsState = React.useState(5), years = yrsState[0], setYears = yrsState[1];
    var mk = React.useState({ state: 'idle', rev: 0 }), market = mk[0], setMarket = mk[1];

    var CH = window.MaerminCloseHistory;
    var yfOf = function (sym) {
      var suffix = {};
      try { suffix = JSON.parse(localStorage.getItem('maermin_symbol_suffix') || '{}') || {}; } catch (err) {}
      return CH && CH.yfSymbol ? CH.yfSymbol('stocks', sym, suffix) : sym;
    };
    React.useEffect(function () {
      if (!workerUrl || !holdings.length) return undefined;
      var alive = true;
      var need = holdings.map(function (h) { return yfOf(h.sym); }).filter(function (y) { return !_market[y]; });
      if (!need.length) { setMarket({ state: 'ready', rev: Date.now() }); return undefined; }
      setMarket({ state: 'loading', rev: 0 });
      var queue = need.slice(), running = 0;
      function next() {
        if (!alive) return;
        if (!queue.length && !running) { setMarket({ state: 'ready', rev: Date.now() }); return; }
        while (running < 4 && queue.length) {
          (function (y) {
            running++;
            getJson(workerUrl + '?action=yf&symbol=' + encodeURIComponent(y) + '&interval=1mo&range=10y')
              .then(function (j) { _market[y] = j && typeof j === 'object' ? j : { failed: true }; }, function () { _market[y] = { failed: true }; })
              .then(function () { running--; next(); });
          })(queue.shift());
        }
      }
      next();
      return function () { alive = false; };
    }, [workerUrl, holdings]);

    var bt = React.useMemo(function () {
      var hist = {}, outdated = false;
      holdings.forEach(function (h) {
        var j = _market[yfOf(h.sym)];
        if (!j || j.failed) return;
        if (!Array.isArray(j.dividends)) { outdated = true; return; }
        hist[h.sym] = { currency: j.currency || 'USD', divs: j.dividends,
          closes: (j.prices || []).map(function (p) { return [p.date, num(p.price)]; }) };
      });
      var r = backtest(holdings, hist, { years: years, today: today, toEUR: toEURc });
      r.outdated = outdated;
      return r;
    }, [holdings, market.rev, years, props.exchangeRate, props.fxAt]);

    var text = theme.text, dim = theme.textSecondary, border = theme.cardBorder || 'rgba(127,127,127,0.2)';
    var pct = function (v, dec) { return v === null || v === undefined ? '–' : I.pct(v * 100, dec === undefined ? 1 : dec, true); };
    var tone = function (v) { return v > 1e-9 ? theme.success : v < -1e-9 ? theme.danger : dim; };
    var card = function (testid, title, sub, body, right) {
      return e('section', { 'data-testid': testid, style: { background: theme.card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1rem', minWidth: 0 } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' } },
          e('div', { style: { minWidth: 0, flex: '1 1 240px' } },
            e('h3', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', margin: 0 } }, title),
            sub && e('div', { style: { color: dim, fontSize: '0.78rem', marginTop: '0.2rem', lineHeight: 1.5 } }, sub)),
          right || null),
        body);
    };
    var th = function (label, i, left) {
      return e('th', { key: i, scope: 'col', style: { padding: '0.45rem 0.6rem', textAlign: left ? 'left' : 'right', color: dim, fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid ' + border, position: left ? 'sticky' : undefined, left: left ? 0 : undefined, background: left ? theme.card : undefined } }, label);
    };
    var tdS = function (extra) { return Object.assign({ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid ' + border, fontVariantNumeric: 'tabular-nums' }, extra || {}); };
    var symCell = function (label, bold) { return e('th', { scope: 'row', style: tdS({ textAlign: 'left', color: text, fontWeight: bold ? 800 : 700, position: 'sticky', left: 0, background: theme.card }) }, label); };
    var scroll = function (table) { return e('div', { style: { overflowX: 'auto', maxWidth: '100%' } }, table); };
    var basisNote = basis === 'gross' ? __('dhGrossNote', 'Before withholding tax.') : __('dhNetNote', 'After withholding tax.');
    var muted = function (msg) { return e('div', { style: { color: dim, fontSize: '0.85rem' } }, msg); };

    // ---- matrix ----
    var yearsDesc = mx.years.slice().reverse();
    var matrixBody = !mx.rows.length
      ? muted(__('dhEmpty', 'No dividends recorded yet. Book received dividends (or import them) to see them by year.'))
      : scroll(e('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' } },
          e('thead', null, e('tr', null, [th(__('dhSecurity', 'Security'), 's', true)].concat(yearsDesc.map(function (y) { return th(String(y), y); }), [th(__('dhTotal', 'Total'), 't')]))),
          e('tbody', null,
            mx.rows.map(function (r) {
              return e('tr', { key: r.sym, 'data-sym': r.sym }, symCell(r.sym),
                yearsDesc.map(function (y) { var v = r.byYear[y] || 0; return e('td', { key: y, 'data-y': y, 'data-v': v, style: tdS({ color: v > 0 ? text : dim }) }, v > 0 ? fmt(v) : '–'); }),
                e('td', { 'data-total': r.total, style: tdS({ color: text, fontWeight: 700 }) }, fmt(r.total)));
            }),
            e('tr', { key: '__total', 'data-row': 'total' }, symCell(__('dhTotal', 'Total'), true),
              yearsDesc.map(function (y) { return e('td', { key: y, 'data-y': y, 'data-v': mx.totals[y], style: tdS({ color: theme.success, fontWeight: 800 }) }, fmt(mx.totals[y])); }),
              e('td', { 'data-total': mx.grand, style: tdS({ color: theme.success, fontWeight: 800 }) }, fmt(mx.grand))))));

    // ---- growth ----
    var payers = gr.payers.slice().sort(function (a, b) { return a.sym < b.sym ? -1 : 1; });
    var dv = function (v) { return v === null || v === undefined ? '' : v; };
    var growthBody = !payers.length
      ? muted(__('dhGrowthEmpty', 'Growth needs dividends booked with shares and an amount per share.'))
      : scroll(e('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' } },
          e('thead', null, e('tr', null, th(__('dhSecurity', 'Security'), 0, true), th(__('dhLastPayment', 'Last payment'), 1), th(__('dhPerShare', 'Per share'), 2), th(__('dhYoy', 'vs. a year before'), 3), th(__('dhCagr', 'CAGR {n}Y', { n: 3 }), 4), th(__('dhCagr', 'CAGR {n}Y', { n: 5 }), 5))),
          e('tbody', null, payers.map(function (p) {
            var l = p.last || {};
            return e('tr', { key: p.sym, 'data-sym': p.sym }, symCell(p.sym),
              e('td', { style: tdS({ color: dim }) }, l.date ? I.date(l.date) : '–'),
              e('td', { style: tdS({ color: text }) }, l.dps ? I.num(l.dps, 4) : '–'),
              e('td', { 'data-k': 'yoy', 'data-v': dv(l.yoy), style: tdS({ color: tone(l.yoy || 0), fontWeight: 600 }) }, pct(l.yoy)),
              e('td', { 'data-k': 'cagr3', 'data-v': dv(p.cagr3), style: tdS({ color: tone(p.cagr3 || 0) }) }, pct(p.cagr3)),
              e('td', { 'data-k': 'cagr5', 'data-v': dv(p.cagr5), style: tdS({ color: tone(p.cagr5 || 0) }) }, pct(p.cagr5)));
          }))));

    // ---- backtest ----
    var yrBtn = function (n) {
      return e('button', { key: n, type: 'button', 'data-testid': 'bt-years-' + n, 'aria-pressed': years === n, onClick: function () { setYears(n); },
        style: { minHeight: '32px', padding: '0.3rem 0.7rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: years === n ? 700 : 500,
          background: years === n ? (theme.accentFill || theme.accent) : 'transparent', color: years === n ? '#fff' : dim } }, __('dhYears', '{n} years', { n: n }));
    };
    var DFX = window.MaerminDemoFixtures;
    var btRight = e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } }, DFX && DFX.badge ? DFX.badge(React, theme, workerUrl) : null, e('div', { role: 'group', 'aria-label': __('dhBacktestPeriod', 'Backtest period'), style: { display: 'flex', gap: '0.15rem', background: theme.inputBg, borderRadius: '8px', padding: '0.2rem' } }, [5, 10].map(yrBtn)));
    var btBody;
    if (!holdings.length) btBody = muted(__('dhBtNoHoldings', 'No stock or ETF holdings to test.'));
    else if (!workerUrl) btBody = muted(__('dhBtNeedWorker', 'The past dividends and prices of your holdings are loaded through your Worker - add its URL in API Settings.'));
    else if (market.state !== 'ready') btBody = muted(__('dhBtLoading', 'Loading past dividends and prices…'));
    else if (!bt.years.length) btBody = muted(bt.outdated
      ? __('dhBtOutdated', 'Your Worker does not send past dividends yet. Redeploy it with the current version to see the backtest.')
      : __('dhBtNone', 'No past dividends or prices found for your holdings.'));
    else {
      var lastY = bt.years[bt.years.length - 1];
      var stat = function (k) {
        return e('div', { key: k[3], 'data-stat': k[3], style: { background: theme.inputBg, borderRadius: '10px', padding: '0.6rem 0.75rem' } },
          e('div', { style: { color: dim, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, k[0]),
          e('div', { style: { color: k[2], fontWeight: 800, fontSize: '1.05rem', marginTop: '0.15rem' } }, k[1]));
      };
      btBody = e('div', null,
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '0.8rem' } },
          [[__('dhBtIncome', 'Income {y}', { y: lastY.y }), fmt(lastY.income) + ' ' + cur, text, 'income'],
           [__('dhBtYield', 'Yield {y}', { y: lastY.y }), lastY.yield === null ? '–' : I.pct(lastY.yield * 100, 2), text, 'yield'],
           [__('dhBtCagr', 'Growth p.a.'), pct(bt.cagr), tone(bt.cagr || 0), 'cagr']].map(stat)),
        scroll(e('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' } },
          e('thead', null, e('tr', null, th(__('dhYear', 'Year'), 0, true), th(__('dhBtIncomeCol', 'Income'), 1), th(__('dhBtStartValue', 'Value at start'), 2), th(__('dhBtYieldCol', 'Yield'), 3), th(__('dhYoy', 'vs. a year before'), 4))),
          e('tbody', null, bt.years.slice().reverse().map(function (r) {
            return e('tr', { key: r.y, 'data-y': r.y }, symCell(String(r.y)),
              e('td', { 'data-k': 'income', 'data-v': r.income, style: tdS({ color: text, fontWeight: 600 }) }, fmt(r.income) + ' ' + cur),
              e('td', { style: tdS({ color: dim }) }, r.startValue === null ? '–' : fmt(r.startValue) + ' ' + cur),
              e('td', { 'data-k': 'yield', style: tdS({ color: text }) }, r.yield === null ? '–' : I.pct(r.yield * 100, 2)),
              e('td', { 'data-k': 'growth', style: tdS({ color: tone(r.growth || 0) }) }, pct(r.growth)));
          })))),
        bt.missing.length > 0 && e('div', { style: { color: dim, fontSize: '0.76rem', marginTop: '0.6rem' } }, __('dhBtMissing', 'Not included (no market history): {list}.', { list: bt.missing.join(', ') })));
    }

    return e('div', { style: { padding: '1.5rem' }, 'data-testid': 'dividend-history' },
      e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.25rem' } }, __('dhTitle', 'Dividend history')),
      e('p', { style: { color: dim, fontSize: '0.82rem', margin: '0 0 1.25rem' } }, __('dhSubtitle', 'Your dividends by security and year, their growth, and what today\'s holdings would have paid in past years.')),
      card('div-matrix', __('dhMatrixTitle', 'Dividends by security and year'), __('dhMatrixSub', 'In {cur}, since your first dividend.', { cur: cur }) + ' ' + basisNote, matrixBody),
      card('div-growth', __('dhGrowthTitle', 'Dividend growth'), __('dhGrowthSub', 'Per share, before tax: each payer\'s latest payment against the one a year before, and the growth per year over the last 3 and 5 complete years.'), growthBody),
      card('div-backtest', __('dhBtTitle', 'Backtest of today\'s holdings'), __('dhBtSub', 'Your current shares as if held through each past year: the dividends they would have paid (before tax) and the yield on their value at the start of the year. Market data through your Worker; only symbols are sent.'), btBody, btRight));
  }

  var api = { amountOf: amountOf, matrix: matrix, growth: growth, months: months, backtest: backtest };
  api.View = View;
  if (typeof window !== 'undefined') window.MaerminDividendHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
