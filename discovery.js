// ============================================================================
// MAERMIN — Asset Discovery  (window.MaerminDiscovery)
// ----------------------------------------------------------------------------
// The ONE sanctioned new surface (Roadmap P5): a READ-ONLY screener for ETFs /
// stocks / crypto, top-movers, and a dividend screener. It is strictly optional
// and gated — it talks to an extended Worker endpoint (`action=screener`) and
// degrades to a clear "your Worker doesn't support this yet" note if the
// deployed Worker is older, so nothing breaks without it.
//
// Architecture: the Worker is the single data source (it proxies + normalises
// Yahoo Finance, like the existing `yf` action). Everything that can be tested
// without a browser — response parsing, EUR conversion at ingestion, filtering,
// sorting, the dividend screen, URL building — is pure and dual-exported for the
// Node harness. The React `View` is browser-only (React.createElement, no JSX)
// and just wires those pure pieces to fetch + state. No data is persisted and
// nothing sensitive is sent, so there are no new SENSITIVE_KEYS.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // ---- catalogue ----------------------------------------------------------
  // Top-movers + screener categories map to Yahoo "predefined screener" ids
  // (scrId mode). The dividend screener uses a curated universe via the Worker's
  // batch-quote mode (symbols=...), which is steadier than a predefined list.
  // Mover/screen labels in the UI language (the tables keep the English ids).
  function discLabel(l) {
    return ({ 'Top Gainers': __('dsGainers', 'Top Gainers'), 'Top Losers': __('dsLosers', 'Top Losers'), 'Most Active': __('dsActive', 'Most Active'), 'Growth Tech': __('dsGrowthTech', 'Growth Tech'), 'Undervalued Growth': __('dsUndervalued', 'Undervalued Growth'), 'Aggressive Small Caps': __('dsSmallCaps', 'Aggressive Small Caps') })[l] || l;
  }

  var MOVERS = [
    { id: 'gainers', label: 'Top Gainers', scrId: 'day_gainers' },
    { id: 'losers',  label: 'Top Losers',  scrId: 'day_losers' },
    { id: 'actives', label: 'Most Active',  scrId: 'most_actives' }
  ];

  var SCREENS = [
    { id: 'growth_tech',  label: 'Growth Tech',        scrId: 'growth_technology_stocks' },
    { id: 'undervalued',  label: 'Undervalued Growth', scrId: 'undervalued_growth_stocks' },
    { id: 'small_caps',   label: 'Aggressive Small Caps', scrId: 'aggressive_small_caps' },
    { id: 'most_active',  label: 'Most Active',        scrId: 'most_actives' }
  ];

  // Dividend stalwarts + high-yield dividend ETFs. Curated (not exhaustive) so
  // the dividend screen has a reliable universe even when Yahoo's predefined
  // dividend lists are unavailable.
  var DIVIDEND_UNIVERSE = [
    'KO', 'PG', 'JNJ', 'PEP', 'MCD', 'MMM', 'O', 'VZ', 'T', 'XOM',
    'CVX', 'ABBV', 'IBM', 'PFE', 'SCHD', 'VYM', 'HDV', 'DVY', 'NOBL'
  ];

  var SORT_KEYS = ['changePercent', 'priceEUR', 'marketCapEUR', 'dividendYield', 'symbol', 'volume'];

  // ---- pure helpers -------------------------------------------------------
  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // EUR is canonical: convert at ingestion. Reuse MaerminUtils.toEUR in the
  // browser (single source of truth); mirror its rule under Node so the pure
  // layer stays testable without the window global.
  function _toEUR(amount, currency, usdToEur) {
    var U = (typeof window !== 'undefined') && window.MaerminUtils;
    if (U && U.toEUR) return U.toEUR(amount, currency, usdToEur);
    var a = parseFloat(amount) || 0;
    return (currency === 'USD' && usdToEur > 0) ? a * usdToEur : a;
  }

  // Coerce one Worker-normalised quote into a clean row. Returns null for rows
  // we can't display (no symbol, or no usable price).
  function normalizeRow(raw) {
    if (!raw || !raw.symbol) return null;
    var price = num(raw.price);
    if (price === null || price <= 0) return null;
    return {
      symbol: String(raw.symbol),
      name: String(raw.name || raw.symbol),
      price: price,
      currency: raw.currency || 'USD',
      changePercent: num(raw.changePercent),       // e.g. 3.2 → +3.2%
      marketCap: num(raw.marketCap),
      dividendYield: num(raw.dividendYield),        // fraction, e.g. 0.025
      type: raw.type || 'EQUITY',
      exchange: raw.exchange || '',
      volume: num(raw.volume)
    };
  }

  // Parse the Worker JSON into { ok, rows, error }. An explicit `error` (incl.
  // an unknown action on an older Worker) → ok:false so the View can show the
  // graceful upgrade note. Missing/empty quotes is a valid empty result.
  function parseResponse(json) {
    if (!json || json.error) return { ok: false, rows: [], error: (json && json.error) || 'No response' };
    var raw = Array.isArray(json.quotes) ? json.quotes : [];
    var rows = [];
    for (var i = 0; i < raw.length; i++) {
      var r = normalizeRow(raw[i]);
      if (r) rows.push(r);
    }
    return { ok: true, rows: rows, error: null };
  }

  // Attach EUR-canonical price/market-cap (rounding stays at format time).
  function toEURRow(row, usdToEur) {
    var priceEUR = _toEUR(row.price, row.currency, usdToEur);
    var mcEUR = row.marketCap !== null ? _toEUR(row.marketCap, row.currency, usdToEur) : null;
    var out = {};
    for (var k in row) { if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k]; }
    out.priceEUR = priceEUR;
    out.marketCapEUR = mcEUR;
    return out;
  }

  // Filter on EUR-canonical values (run after toEURRow). All criteria optional.
  function applyFilters(rows, opts) {
    opts = opts || {};
    var q = (opts.query || '').trim().toLowerCase();
    return (rows || []).filter(function (r) {
      var p = (r.priceEUR != null ? r.priceEUR : r.price);
      if (opts.minPrice != null && p < opts.minPrice) return false;
      if (opts.maxPrice != null && p > opts.maxPrice) return false;
      if (opts.minMarketCap != null && (r.marketCapEUR == null || r.marketCapEUR < opts.minMarketCap)) return false;
      if (opts.minChange != null && (r.changePercent == null || r.changePercent < opts.minChange)) return false;
      if (q && (r.symbol.toLowerCase().indexOf(q) === -1 && r.name.toLowerCase().indexOf(q) === -1)) return false;
      return true;
    });
  }

  // Stable sort by a known key; nulls always sort last regardless of direction.
  function sortRows(rows, key, dir) {
    if (SORT_KEYS.indexOf(key) === -1) return (rows || []).slice();
    var sign = dir === 'asc' ? 1 : -1;
    return (rows || []).slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'symbol') return sign * String(av).localeCompare(String(bv));
      var an = (av == null) ? null : av, bn = (bv == null) ? null : bv;
      if (an === null && bn === null) return 0;
      if (an === null) return 1;   // nulls last
      if (bn === null) return -1;
      return sign * (an - bn);
    });
  }

  // Dividend screen: keep rows with a yield ≥ minYield (fraction), sorted desc.
  function dividendScreen(rows, opts) {
    opts = opts || {};
    var min = opts.minYield != null ? opts.minYield : 0;
    var kept = (rows || []).filter(function (r) { return r.dividendYield != null && r.dividendYield >= min; });
    return sortRows(kept, 'dividendYield', 'desc');
  }

  // Build the Worker screener URL. params: { scrId } | { symbols:[...] }, + count.
  function buildUrl(workerBase, params) {
    var base = String(workerBase || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    params = params || {};
    var qs = ['action=screener'];
    if (params.symbols && params.symbols.length) qs.push('symbols=' + encodeURIComponent([].concat(params.symbols).join(',')));
    else if (params.scrId) qs.push('scrId=' + encodeURIComponent(params.scrId));
    if (params.count) qs.push('count=' + encodeURIComponent(params.count));
    return base + '?' + qs.join('&');
  }

  // ---- React View (browser only) ------------------------------------------
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    // R4.4: the shared Segmented, Input, Table (sortable, phone rows) and tokens
    var UIC = window.MaerminComponents;
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var usdToEur = props.usdToEur || props.exchangeRate || 0.91;
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';

    var TABS = [
      { id: 'movers', label: t.discoveryMovers || 'Top Movers' },
      { id: 'screener', label: t.discoveryScreener || 'Screener' },
      { id: 'dividends', label: t.discoveryDividends || 'Dividends' }
    ];

    var sTab = React.useState('movers'); var tab = sTab[0], setTab = sTab[1];
    var sMover = React.useState('gainers'); var mover = sMover[0], setMover = sMover[1];
    var sScreen = React.useState('growth_tech'); var screen = sScreen[0], setScreen = sScreen[1];
    var sRows = React.useState([]); var rows = sRows[0], setRows = sRows[1];
    var sLoad = React.useState(false); var loading = sLoad[0], setLoading = sLoad[1];
    var sErr = React.useState(null); var err = sErr[0], setErr = sErr[1];
    var sUnsupported = React.useState(false); var unsupported = sUnsupported[0], setUnsupported = sUnsupported[1];
    var sMinYield = React.useState(0); var minYield = sMinYield[0], setMinYield = sMinYield[1];
    var sQuery = React.useState(''); var query = sQuery[0], setQuery = sQuery[1];
    var sSort = React.useState({ key: 'changePercent', dir: 'desc' }); var sort = sSort[0], setSort = sSort[1];

    // What to request for the active tab.
    function activeRequest() {
      if (tab === 'movers') { var m = MOVERS.filter(function (x) { return x.id === mover; })[0] || MOVERS[0]; return { scrId: m.scrId, count: 25 }; }
      if (tab === 'screener') { var s = SCREENS.filter(function (x) { return x.id === screen; })[0] || SCREENS[0]; return { scrId: s.scrId, count: 25 }; }
      return { symbols: DIVIDEND_UNIVERSE, count: DIVIDEND_UNIVERSE.length };
    }

    var reqKey = tab + ':' + mover + ':' + screen; // refetch trigger
    React.useEffect(function () {
      if (!workerBase) { setRows([]); setUnsupported(false); setErr(null); return; }
      var cancelled = false; setLoading(true); setErr(null); setUnsupported(false);
      var url = buildUrl(workerBase, activeRequest());
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 14000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          // An older Worker without the action 400s / 404s → treat as unsupported.
          if (r.status === 400 || r.status === 404 || r.status === 501) { var er = new Error('unsupported'); er._unsupported = true; throw er; }
          return r.json();
        })
        .then(function (j) {
          if (cancelled) return;
          var parsed = parseResponse(j);
          if (!parsed.ok) {
            if (/unknown|unsupported|action/i.test(parsed.error || '')) { setUnsupported(true); setRows([]); }
            else { setErr(parsed.error); setRows([]); }
          } else {
            setRows(parsed.rows.map(function (row) { return toEURRow(row, usdToEur); }));
          }
          setLoading(false);
        })
        .catch(function (ex) {
          if (cancelled) return;
          if (ex && ex._unsupported) { setUnsupported(true); setRows([]); }
          else setErr((ex && ex.name === 'AbortError') ? __('fxaTimedOut', 'Timed out') : __('fxaFetchFailed', 'Fetch failed'));
          setLoading(false);
        })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [reqKey, workerBase]);

    // Derive the visible rows from the fetched set (pure transforms).
    var view = rows;
    if (tab === 'dividends') view = dividendScreen(rows, { minYield: minYield });
    view = applyFilters(view, { query: query });
    if (tab !== 'dividends') view = sortRows(view, sort.key, sort.dir);

    // ---- presentational bits ----
    function compactMoney(v) {
      if (v == null) return '—';
      return window.MaerminI18n.compact(v) + ' ' + sym;
    }
    var seg = function (label, value, onChange, options) {
      return e(UIC.Segmented, { label: label, value: value, size: 'sm', onChange: onChange, options: options });
    };

    var subControls;
    if (tab === 'movers') subControls = seg(__('dsMovers', 'Movers'), mover, setMover, MOVERS.map(function (m) { return { value: m.id, label: discLabel(m.label) }; }));
    else if (tab === 'screener') subControls = seg(__('dsScreens', 'Screens'), screen, setScreen, SCREENS.map(function (s) { return { value: s.id, label: discLabel(s.label) }; }));
    else subControls = e('div', { className: ['ui-panel-tools', 'ui-panel-tools--flush'].join(' ') },
      e('span', { className: 'ui-muted' }, __('dsMinYield', 'Min yield')),
      seg(__('dsMinYield', 'Min yield'), minYield, setMinYield, [0, 0.02, 0.03, 0.04].map(function (y) { return { value: y, label: window.MaerminI18n.pct(y * 100, 0) }; })));

    var body;
    if (!workerBase) {
      body = window.MaerminUtils.workerNote(__('dsNeedWorker', 'Add a Worker URL in API Settings to use Discovery. It is read-only and never changes your portfolio.'));
    } else if (unsupported) {
      body = e('div', { className: ['ui-callout', 'ui-callout--warn'].join(' ') },
        e('strong', { className: 'ui-callout__title' }, '! ' + __('dsUnsupported', "Your Worker doesn't support Discovery yet.")),
        __('dsRedeploy1', 'Re-deploy the latest') + ' ', e('code', null, 'cf-worker/worker.js'), ' ' + __('dsRedeploy2', '(it adds the') + ' ', e('code', null, 'action=screener'), ' ' + __('dsRedeploy3', 'endpoint). Everything else keeps working without it.'));
    } else if (loading) {
      body = e(UIC.Skeleton, { shape: 'row', lines: 6 });
    } else if (err) {
      body = e('p', { className: ['ui-muted', 'is-error'].join(' ') }, __('dsLoadFailed', 'Could not load: {msg}', { msg: err }));
    } else if (!view.length) {
      body = e('p', { className: 'ui-muted' }, __('dsNoMatch', 'No results match your filters.'));
    } else {
      var sortable = tab !== 'dividends';
      var col = function (key, label, extra) { return Object.assign({ key: key, label: label, sortable: sortable && SORT_KEYS.indexOf(key) !== -1 }, extra || {}); };
      body = e('div', null,
        e(UIC.Table, {
          caption: t.navDiscovery || 'Discovery', rows: view, rowKey: function (r) { return r.symbol; },
          sort: sortable ? sort : null, onSort: sortable ? function (key, dir) { setSort({ key: key, dir: dir }); } : null,
          'data-testid': 'ds-table',
          columns: [
            col('symbol', __('symbol', 'Symbol'), { phone: 'title', render: function (r) { return e('span', { className: 'ui-ds-sym' }, e('b', null, r.symbol), e('span', { title: r.name }, r.name)); } }),
            col('type', __('type', 'Type'), { priority: 2, phone: 'meta', render: function (r) { return e(UIC.Badge, null, r.type); } }),
            col('priceEUR', __('price', 'Price'), { align: 'right', phone: 'value', render: function (r) { return fmt(r.priceEUR != null ? r.priceEUR : r.price) + ' ' + sym; } }),
            col('changePercent', __('wlChange', 'Change'), { align: 'right', phone: 'sub', render: function (r) { return r.changePercent == null ? '—' : e(UIC.ToneChip, { value: r.changePercent, text: window.MaerminI18n.pct(r.changePercent, 2, true) }); } }),
            col('marketCapEUR', __('dsMktCap', 'Mkt Cap'), { align: 'right', priority: 2, render: function (r) { return compactMoney(r.marketCapEUR); } }),
            col('dividendYield', __('dsDivYield', 'Div Yield'), { align: 'right', priority: 2, phone: 'meta', render: function (r) { return r.dividendYield != null ? window.MaerminI18n.pct(r.dividendYield * 100, 2) : '—'; } })
          ]
        }),
        e('p', { className: 'ui-note' },
          __('dsFooter', '{n} {n:result|results} · prices converted to {sym} at ingestion (1 USD = {rate} EUR) · read-only, sourced live via your Worker. Not investment advice.', { n: view.length, sym: sym, rate: window.MaerminI18n.num(usdToEur, 3) })));
    }

    return e('div', { className: 'ui-view', 'data-testid': 'discovery-view' },
      e('div', { className: 'ui-view__bar' },
        e('p', { className: 'ui-view__lead' }, __('dsIntro', 'Read-only screener for ETFs, stocks & crypto. Discover, then add via the usual flow — Discovery never touches your holdings.'), ' ',
          window.MaerminDemoFixtures && window.MaerminDemoFixtures.badge(React, theme, workerBase)),
        e('input', { type: 'search', value: query, onChange: function (ev) { setQuery(ev.target.value); }, placeholder: __('dsFilterPh', 'Filter symbol / name…'), 'aria-label': __('dsFilterPh', 'Filter symbol / name…'), className: ['ui-input', 'ui-ds-filter'].join(' ') })),
      e(UIC.Segmented, { label: t.navDiscovery || 'Discovery', value: tab, onChange: setTab, options: TABS.map(function (x) { return { value: x.id, label: x.label }; }) }),
      e(UIC.Card, { 'data-testid': 'ds-card', action: subControls, title: (TABS.filter(function (x) { return x.id === tab; })[0] || TABS[0]).label, headingLevel: 'h3' }, body)
    );
  }

  var api = {
    MOVERS: MOVERS,
    SCREENS: SCREENS,
    DIVIDEND_UNIVERSE: DIVIDEND_UNIVERSE,
    SORT_KEYS: SORT_KEYS,
    normalizeRow: normalizeRow,
    parseResponse: parseResponse,
    toEURRow: toEURRow,
    applyFilters: applyFilters,
    sortRows: sortRows,
    dividendScreen: dividendScreen,
    buildUrl: buildUrl,
    View: View
  };
  if (typeof window !== 'undefined') window.MaerminDiscovery = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
