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

  // ---- catalogue ----------------------------------------------------------
  // Top-movers + screener categories map to Yahoo "predefined screener" ids
  // (scrId mode). The dividend screener uses a curated universe via the Worker's
  // batch-quote mode (symbols=...), which is steadier than a predefined list.
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
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#f5a524', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var ok = theme.success || theme.positive || '#22c55e', bad = theme.danger || theme.negative || '#ef4444';
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
          else setErr((ex && ex.name === 'AbortError') ? 'Timed out' : 'Fetch failed');
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
    function pill(active, label, onClick, key) {
      return e('button', { key: key || label, onClick: onClick, style: { padding: '0.4rem 0.85rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: active ? '700' : '500', background: active ? accent : inputBg, color: active ? '#13110a' : dim } }, label);
    }
    function compactMoney(v) {
      if (v == null) return '—';
      var abs = Math.abs(v);
      if (abs >= 1e12) return sym + (v / 1e12).toFixed(2) + 'T';
      if (abs >= 1e9) return sym + (v / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return sym + (v / 1e6).toFixed(1) + 'M';
      return sym + fmt(v);
    }
    function header(label, key, align) {
      var active = sort.key === key;
      var clickable = tab !== 'dividends' && SORT_KEYS.indexOf(key) !== -1;
      return e('th', {
        onClick: clickable ? function () { setSort({ key: key, dir: (active && sort.dir === 'desc') ? 'asc' : 'desc' }); } : undefined,
        style: { textAlign: align || 'right', padding: '0.5rem 0.6rem', color: active ? accent : dim, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', cursor: clickable ? 'pointer' : 'default', whiteSpace: 'nowrap' }
      }, label + (active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''));
    }

    var subControls;
    if (tab === 'movers') subControls = e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } }, MOVERS.map(function (m) { return pill(mover === m.id, m.label, function () { setMover(m.id); }, m.id); }));
    else if (tab === 'screener') subControls = e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } }, SCREENS.map(function (s) { return pill(screen === s.id, s.label, function () { setScreen(s.id); }, s.id); }));
    else subControls = e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
      e('span', { style: { color: dim, fontSize: '0.78rem' } }, 'Min yield'),
      [0, 0.02, 0.03, 0.04].map(function (y) { return pill(minYield === y, (y * 100).toFixed(0) + '%', function () { setMinYield(y); }, 'y' + y); })
    );

    var body;
    if (!workerBase) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '1rem 0' } }, 'Add a Worker URL in API Settings to use Discovery. It is read-only and never changes your portfolio.');
    } else if (unsupported) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '1rem 0', lineHeight: 1.6 } },
        e('div', { style: { color: theme.warning || '#f59e0b', fontWeight: 700, marginBottom: '0.3rem' } }, 'Your Worker doesn\'t support Discovery yet.'),
        'Re-deploy the latest ', e('code', { style: { color: accent } }, 'cf-worker/worker.js'), ' (it adds the ', e('code', { style: { color: accent } }, 'action=screener'), ' endpoint). Everything else keeps working without it.');
    } else if (loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '1rem 0' } }, 'Loading…');
    } else if (err) {
      body = e('div', { style: { color: bad, fontSize: '0.85rem', padding: '1rem 0' } }, 'Could not load: ' + err);
    } else if (!view.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '1rem 0' } }, 'No results match your filters.');
    } else {
      var rowsEl = view.map(function (r) {
        var chg = r.changePercent;
        return e('tr', { key: r.symbol, style: { borderTop: '1px solid ' + border } },
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'left' } },
            e('div', { style: { color: text, fontWeight: 700, fontSize: '0.85rem' } }, r.symbol),
            e('div', { style: { color: dim, fontSize: '0.72rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.name)),
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'left' } }, e('span', { style: { fontSize: '0.66rem', color: dim, border: '1px solid ' + border, borderRadius: '5px', padding: '0.1rem 0.35rem' } }, r.type)),
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'right', color: text, fontWeight: 600, fontSize: '0.82rem' } }, sym + fmt(r.priceEUR != null ? r.priceEUR : r.price)),
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'right', color: chg == null ? dim : (chg >= 0 ? ok : bad), fontWeight: 600, fontSize: '0.82rem' } }, chg == null ? '—' : ((chg >= 0 ? '+' : '') + chg.toFixed(2) + '%')),
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'right', color: dim, fontSize: '0.8rem' } }, compactMoney(r.marketCapEUR)),
          e('td', { style: { padding: '0.55rem 0.6rem', textAlign: 'right', color: r.dividendYield ? text : dim, fontSize: '0.8rem' } }, r.dividendYield != null ? (r.dividendYield * 100).toFixed(2) + '%' : '—'));
      });
      body = e('div', { style: { overflowX: 'auto', marginTop: '0.5rem' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null,
            header('Symbol', 'symbol', 'left'),
            e('th', { style: { textAlign: 'left', padding: '0.5rem 0.6rem', color: dim, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, 'Type'),
            header('Price', 'priceEUR'),
            header('Change', 'changePercent'),
            header('Mkt Cap', 'marketCapEUR'),
            header('Div Yield', 'dividendYield'))),
          e('tbody', null, rowsEl)),
        e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.6rem', lineHeight: 1.5 } },
          view.length + ' results · prices converted to ' + sym + ' at ingestion (1 USD = ' + Number(usdToEur).toFixed(3) + ' EUR) · read-only, sourced live via your Worker. Not investment advice.'));
    }

    return e('div', { style: { padding: '1.25rem 1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.3rem' } },
        e('h2', { style: { color: text, fontSize: '1.35rem', fontWeight: 800, margin: 0 } }, t.navDiscovery || 'Discovery'),
        e('input', { type: 'text', value: query, onChange: function (ev) { setQuery(ev.target.value); }, placeholder: 'Filter symbol / name…', style: { background: inputBg, border: '1px solid ' + border, borderRadius: '8px', padding: '0.45rem 0.7rem', color: text, fontSize: '0.82rem', minWidth: '180px' } })),
      e('div', { style: { color: dim, fontSize: '0.82rem', marginBottom: '0.9rem' } }, 'Read-only screener for ETFs, stocks & crypto. Discover, then add via the usual flow — Discovery never touches your holdings.'),
      e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.7rem' } }, TABS.map(function (x) { return pill(tab === x.id, x.label, function () { setTab(x.id); }, x.id); })),
      e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem 1.1rem' } },
        e('div', { style: { marginBottom: '0.5rem' } }, subControls),
        body)
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
