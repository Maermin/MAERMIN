// ============================================================================
// MAERMIN — Benchmark replay of the book's own cash flows  (window.MaerminBenchmarkReplay)
// ----------------------------------------------------------------------------
// P5-2.2. "What if every euro I put in and took out had gone into the index?"
// The period's start value and every money-in / money-out of the value-change
// attribution (value-attribution.js, the SAME definition of money moved) buy
// and sell benchmark units at that day's close; the result is compared with
// the book's own end value, in euros and as a money-weighted return a year
// (XIRR, returns-engine.js) over the same dates.
//
//   replay(attribution, closes)   attribution = MaerminValueAttribution.compute(...)
//     closes: [[iso, eur]…] of the benchmark, oldest first
//     → { available, from?, benchEnd, ownEnd, diff, ownXirr, benchXirr, shortfall } | null
//     A flow is booked at the last close on or before its day. Money before the
//     benchmark's first close → { available: false, from }. Taking out more than
//     the benchmark units are worth sells them all; the rest is `shortfall`.
//   toEurCloses(yfJson, { fxAt, exchangeRate })   Worker ?action=yf → [[iso, eur]]
//   rangeFor(startIso, todayIso)                   smallest allowed yf range covering it
//   PRESETS / symbolOf(key, reinvested)
//
// Presets: "dividends reinvested" uses the accumulating Xetra listing of a fund
// tracking the index (EUR, total return after fund costs); "price only" uses
// the price index proxy the Benchmark comparison already uses (USD, converted
// at the rate of each day). A held fund is replayed on its own daily closes.
//
// Pure layer dual-exported and Node-tested (test/benchmark-replay.test.js);
// Panel = the "Same money in an index" card in Analysis → Returns.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var DAY = 86400000;
  var PRESETS = [
    { key: 'msci_world', acc: 'EUNL.DE', price: 'URTH' },
    { key: 'ftse_all_world', acc: 'VWCE.DE', price: 'VT' },
    { key: 'sp500', acc: 'SXR8.DE', price: '^GSPC' },
    { key: 'nasdaq100', acc: 'SXRV.DE', price: '^NDX' }
  ];

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function req(load) { try { return load(); } catch (e) { return null; } }
  function returns() { return (typeof window !== 'undefined' && window.MaerminReturns) || req(function () { return require('./returns-engine.js'); }); }
  function fxh() { return (typeof window !== 'undefined' && window.MaerminFxHistory) || req(function () { return require('./fx-history.js'); }); }

  // Index names: the Benchmark comparison's list (portfolio-analytics.js).
  function labelOf(key) {
    var A = (typeof window !== 'undefined' && window.MaerminAnalytics) || req(function () { return require('./portfolio-analytics.js'); });
    var b = ((A && A.BENCHMARKS) || []).filter(function (x) { return x.key === key; })[0];
    return b ? b.label : key;
  }
  function symbolOf(key, reinvested) {
    var p = PRESETS.filter(function (x) { return x.key === key; })[0];
    return p ? (reinvested ? p.acc : p.price) : null;
  }

  function rangeFor(startIso, todayIso) {
    var days = (Date.parse(todayIso + 'T00:00:00Z') - Date.parse(startIso + 'T00:00:00Z')) / DAY;
    if (!(days <= 360)) {
      if (days <= 725) return '2y';
      if (days <= 1820) return '5y';
      if (days <= 3640) return '10y';
      return 'max';
    }
    return '1y';
  }

  function toEurCloses(json, opts) {
    opts = opts || {};
    var F = fxh(), cur = String((json && json.currency) || 'USD');
    var fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null, rate = num(opts.exchangeRate);
    var out = [];
    ((json && json.prices) || []).forEach(function (p) {
      var px = num(p && p.price), d = p && p.date;
      if (!(px > 0) || !d) return;
      var v = cur.toUpperCase() === 'EUR' ? px
        : (F && F.txToEUR) ? F.txToEUR(px, cur, d, rate, fxAt).value
        : (cur === 'USD' ? px * ((fxAt && fxAt(d)) || rate) : 0);
      if (v > 0) out.push([d, v]);
    });
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return out;
  }

  function replay(att, closes) {
    if (!att) return null;
    var cl = Array.isArray(closes) ? closes.filter(function (c) { return c && c[1] > 0; }) : [];
    var out = { available: false, from: cl.length ? cl[0][0] : null, benchEnd: null, ownEnd: att.endValue, diff: null, ownXirr: null, benchXirr: null, shortfall: 0 };
    if (!cl.length) return out;
    var i = -1;
    var priceOn = function (d) { // last close on or before d (dates come in order)
      while (i + 1 < cl.length && cl[i + 1][0] <= d) i++;
      return i >= 0 ? cl[i][1] : null;
    };
    var events = [];
    if (att.startValue > 0.005) events.push({ d: att.start, amount: att.startValue });
    (att.flows || []).forEach(function (f) { if (f && f.amount) events.push({ d: f.d, amount: f.amount }); });
    events.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var units = 0, shortfall = 0;
    for (var k = 0; k < events.length; k++) {
      var p = priceOn(events[k].d);
      if (!(p > 0)) return out; // money before the benchmark's history
      if (events[k].amount > 0) { units += events[k].amount / p; continue; }
      var want = -events[k].amount / p;
      if (want > units) { shortfall += (want - units) * p; units = 0; } else units -= want;
    }
    var pe = priceOn(att.end);
    if (!(pe > 0)) return out;
    out.available = true;
    out.benchEnd = units * pe;
    out.diff = att.endValue - out.benchEnd;
    out.shortfall = shortfall;
    var R = returns();
    if (R && R.xirr && events.length) {
      var base = events.map(function (e) { return { date: e.d, amount: -e.amount }; });
      var x = function (end) { var list = base.concat(end ? [{ date: att.end, amount: end }] : []); try { var v = R.xirr(list); return isFinite(v) ? v : null; } catch (e) { return null; } };
      out.ownXirr = x(att.endValue);
      out.benchXirr = x(out.benchEnd);
    }
    return out;
  }

  // ---- "Same money in an index" card --------------------------------------------
  // props: { transactions, series, clearings, live, splits, exchangeRate, fxAt,
  //          workerUrl, funds: [{ key, symbol }], today, theme, formatPrice }
  var _cache = {};
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var VA = typeof window !== 'undefined' ? window.MaerminValueAttribution : null;
    if (!React || !VA) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', bad = theme.danger || theme.negative || '#ef4444', warn = theme.warning || '#f59e0b', accent = theme.accent || '#3b82f6';
    var I18N = window.MaerminI18n;
    var money = function (v) { return I18N && I18N.money ? I18N.money(v) : (Math.round(v * 100) / 100).toFixed(2) + ' €'; };
    var pct = function (x) { return x == null ? '—' : I18N.pct(x * 100, 1); };
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var today = props.today || (window.MaerminUtils && window.MaerminUtils.todayISO ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10));
    var funds = props.funds || [];

    var sP = React.useState('MAX'), period = sP[0], setPeriod = sP[1];
    var sB = React.useState('msci_world'), sel = sB[0], setSel = sB[1];
    var sR = React.useState(true), reinvest = sR[0], setReinvest = sR[1];
    var fund = funds.filter(function (f) { return 'fund:' + f.key === sel; })[0] || null;
    var preset = PRESETS.filter(function (p) { return p.key === sel; })[0] || null;
    var label = fund ? fund.symbol : preset ? labelOf(preset.key) : '';

    var att = React.useMemo(function () {
      try {
        return VA.compute(props.transactions, props.series, { start: VA.periodStart(period, today, props.transactions), today: today,
          exchangeRate: props.exchangeRate, fxAt: props.fxAt, live: props.live, splits: props.splits, clearings: props.clearings || {} });
      } catch (err) { return null; }
    }, [props.transactions, props.series, props.clearings, props.live, props.splits, props.exchangeRate, props.fxAt, period, today]);

    // a held fund: its full Yahoo history through the Worker when there is one
    // (its own closes start a week before the first purchase), else its own closes
    var CH = window.MaerminCloseHistory;
    var symbol = fund ? (workerBase ? (CH && CH.yfSymbol ? CH.yfSymbol('stocks', fund.symbol) : fund.symbol) : null) : symbolOf(sel, reinvest);
    var range = att ? rangeFor(att.start, today) : '1y';
    var url = workerBase && symbol ? workerBase + '?action=yf&symbol=' + encodeURIComponent(symbol) + '&interval=1d&range=' + range : '';
    var sD = React.useState(url && _cache[url] ? _cache[url] : null), data = sD[0], setData = sD[1];
    var sL = React.useState(false), loading = sL[0], setLoading = sL[1];
    var sE = React.useState(null), err = sE[0], setErr = sE[1];
    React.useEffect(function () {
      if (!url) { setData(null); return; }
      if (_cache[url]) { setData(_cache[url]); setErr(null); return; }
      var cancelled = false; setData(null); setLoading(true); setErr(null);
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (cancelled) return;
          if (!j || j.error || !Array.isArray(j.prices)) setErr(__('avNoBenchData', 'No benchmark data'));
          else { _cache[url] = j; setData(j); }
          setLoading(false);
        })
        .catch(function (ex) { if (cancelled) return; setErr((ex && ex.name === 'AbortError') ? __('fxaTimedOut', 'Timed out') : __('fxaFetchFailed', 'Fetch failed')); setLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [url]);

    var closes = React.useMemo(function () {
      var fetched = data ? toEurCloses(data, { fxAt: props.fxAt, exchangeRate: props.exchangeRate }) : [];
      if (fetched.length || !fund) return fetched;
      var s = props.series && props.series[fund.key];
      return s ? s.closes : [];
    }, [fund, data, props.series, props.fxAt, props.exchangeRate]);
    var res = att && closes.length ? replay(att, closes) : null;
    var verdict = res && res.available && window.MaerminVerdicts && window.MaerminVerdicts.replay
      ? window.MaerminVerdicts.replay(res.ownXirr, res.benchXirr, res.diff, label) : null;

    var chip = function (key, text_, on, onClick, testid) {
      return e('button', { key: key, type: 'button', 'data-testid': testid, 'aria-pressed': on, onClick: onClick,
        style: { padding: '0.3rem 0.7rem', borderRadius: '999px', border: '1px solid ' + (on ? accent : border), background: on ? accent : 'transparent',
          color: on ? '#fff' : dim, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' } }, text_);
    };
    var tile = function (key, title, value, sub, color) {
      return e('div', { key: key, 'data-testid': 'br-' + key, style: { flex: '1 1 150px', background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, title),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: 700, marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' } }, value),
        sub ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.15rem' } }, sub) : null);
    };
    var noteEl = function (msg, color) { return e('div', { style: { color: color || dim, fontSize: '0.85rem' } }, msg); };

    var body;
    if (!att) body = noteEl(__('vaEmpty', 'Add transactions to see where your profit came from.'));
    else if (!fund && !workerBase) body = noteEl(__('brNeedWorker', 'Add a Worker URL in API Settings to replay your money into an index.'));
    else if (url && loading) body = noteEl(__('avLoadingBench', 'Loading {name}…', { name: label }));
    else if (!fund && err) body = noteEl(__('avBenchFailed', 'Could not load benchmark: {msg}', { msg: err }), bad);
    else if (!res || !res.available) body = noteEl(res && res.from ? __('brTooEarly', 'The {name} history starts on {date} - pick a shorter period.', { name: label, date: I18N.date ? I18N.date(res.from) : res.from })
      : __('brNoData', 'No price history for {name} yet.', { name: label }));
    else {
      var lead = res.diff >= 0;
      body = e('div', null,
        verdict ? e('div', { 'data-testid': 'verdict-replay', 'data-level': verdict.level, style: { color: verdict.level === 'good' ? good : verdict.level === 'neutral' ? text : verdict.level === 'warn' ? warn : bad,
          fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.7rem', lineHeight: 1.45 } }, verdict.text) : null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
          tile('own', __('brOwn', 'Your portfolio'), money(res.ownEnd), __('brXirr', '{pct} a year (money-weighted)', { pct: pct(res.ownXirr) })),
          tile('bench', __('brBench', 'Same money in {name}', { name: label }), money(res.benchEnd), __('brXirr', '{pct} a year (money-weighted)', { pct: pct(res.benchXirr) })),
          tile('diff', __('brDiff', 'Difference'), (lead ? '+' : '−') + money(Math.abs(res.diff)), lead ? __('brAhead', 'your portfolio is ahead') : __('brBehind', 'your portfolio is behind'), lead ? good : bad)),
        res.shortfall > 0.5 ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.5rem' } },
          __('brShortfall', 'You took out {amount} more than the index holding was worth at the time; that part is left out.', { amount: money(res.shortfall) })) : null,
        att.missing && att.missing.length ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.4rem' } },
          __('vaMissing', 'Not priced, so not measured: {list}.', { list: att.missing.map(function (m) { return m.symbol; }).join(', ') })) : null);
    }

    var periodChips = VA.PERIODS.map(function (p) {
      return chip(p, p === 'MAX' ? __('vaMax', 'Max') : p === 'YTD' ? __('vaYtd', 'YTD') : p, p === period, function () { setPeriod(p); }, 'br-period-' + p);
    });
    var benchChips = PRESETS.map(function (p) { return chip(p.key, labelOf(p.key), sel === p.key, function () { setSel(p.key); }, 'br-bench-' + p.key); })
      .concat(funds.map(function (f) { return chip('fund:' + f.key, f.symbol, sel === 'fund:' + f.key, function () { setSel('fund:' + f.key); }, 'br-fund-' + f.symbol); }));

    return e('div', { 'data-testid': 'benchmark-replay', style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      e('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '0.7rem' } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } }, __('brTitle', 'Same money in an index'), ' ',
          symbol && window.MaerminDemoFixtures ? window.MaerminDemoFixtures.badge(React, theme, workerBase) : null),
        e('div', { role: 'group', 'aria-label': __('vaPeriod', 'Period'), style: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem' } }, periodChips)),
      e('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', marginBottom: '0.9rem' } },
        e('div', { role: 'group', 'aria-label': __('brChoose', 'Index or fund'), style: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem' } }, benchChips),
        e('label', { style: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: fund ? dim : text, fontSize: '0.78rem', marginLeft: '0.4rem', opacity: fund ? 0.6 : 1 } },
          e('input', { type: 'checkbox', 'data-testid': 'br-reinvest', checked: fund ? false : reinvest, disabled: !!fund, onChange: function (ev) { setReinvest(!!ev.target.checked); } }),
          __('brReinvest', 'Dividends reinvested'))),
      body,
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.7rem', lineHeight: 1.5 } },
        fund ? __('brNoteFund', 'Your start value and every euro in and out (as in "Profit by source") bought or sold {name} at that day\'s close. A distributing fund is compared without its payouts.', { name: label })
          : reinvest ? __('brNoteAcc', 'Your start value and every euro in and out (as in "Profit by source") bought or sold the index at that day\'s close. Dividends reinvested: an accumulating fund on the index ({symbol}, after its costs).', { symbol: symbol })
            : __('brNotePrice', 'Your start value and every euro in and out (as in "Profit by source") bought or sold the index at that day\'s close. Price only ({symbol}): the index\'s dividends are left out, which flatters your portfolio.', { symbol: symbol })));
  }

  var api = { replay: replay, toEurCloses: toEurCloses, rangeFor: rangeFor, symbolOf: symbolOf, PRESETS: PRESETS, labelOf: labelOf, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminBenchmarkReplay = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
