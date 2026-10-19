// ============================================================================
// MAERMIN — Privacy-preserving share snapshots  (window.MaerminShare)
// ----------------------------------------------------------------------------
// The ONE sanctioned new surface of this round (Roadmap Epic 9, deliberately
// deferred until it could be done without breaking zero-knowledge): share a
// REDACTED portfolio snapshot and compare anonymously - never the portfolio.
//
// What a snapshot may contain - and NOTHING else:
//   - percentage weights by asset class, sector, region and currency,
//   - optional scores (health 0-100, diversification effectiveN).
// No absolute values, no position quantities, no symbols, no names, no ids.
// The redaction is enforced THREE times: buildSnapshot only ever computes
// percentages, validateSnapshot rebuilds the object against a hard allowlist
// before anything is sent, and the Worker validates again server-side.
// test/share-snapshot.test.js contains the leak proof: a portfolio with
// distinctive absolute numbers in every field produces a snapshot whose
// serialisation contains none of them.
//
// Sharing is OPT-IN per click, the exact payload is previewed before publish,
// and the Worker stores it under a random id with a 90-day TTL. The anonymous
// benchmark compares against a running count+sum aggregate - individual
// snapshots are never exposed through it. Old Workers (400/404) degrade with
// the usual upgrade note. All weights come from the existing engines
// (MaerminMetrics, MaerminEquityMeta, PortfolioHealth) - no parallel math.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }

  var CLASSES = ['crypto', 'stocks', 'skins', 'commodities'];

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  // ---- redaction core (PURE) -------------------------------------------------
  // inputs: { classValues: {cls: valueEUR}, sectorWeights: [{name, pct}],
  //           regionWeights: [{name, pct}], currencyRows: [{currency, pct}],
  //           healthScore?, effectiveN? }
  // Values enter as EUR amounts ONLY for the class split and leave as rounded
  // percentages - nothing absolute survives into the snapshot object.
  function buildSnapshot(inputs) {
    inputs = inputs || {};
    var classValues = inputs.classValues || {};
    var total = 0;
    CLASSES.forEach(function (c) { total += Math.max(0, num(classValues[c]) || 0); });
    if (total <= 0) return null;
    var snapshot = { v: 1, assetClasses: {} };
    CLASSES.forEach(function (c) {
      var v = Math.max(0, num(classValues[c]) || 0);
      if (v > 0) snapshot.assetClasses[c] = round1((v / total) * 100);
    });
    function takeRows(rows, nameKey) {
      var out = [];
      (rows || []).slice(0, 8).forEach(function (r) {
        var name = String((r && (r[nameKey] || r.name)) || '').slice(0, 40);
        var pct = num(r && r.pct);
        if (name && pct != null && pct >= 0 && pct <= 100) out.push({ name: name, pct: round1(pct) });
      });
      return out.length ? out : null;
    }
    var sectors = takeRows(inputs.sectorWeights, 'name');
    var regions = takeRows(inputs.regionWeights, 'name');
    var currencies = takeRows(inputs.currencyRows, 'currency');
    if (sectors) snapshot.sectors = sectors;
    if (regions) snapshot.regions = regions;
    if (currencies) snapshot.currencies = currencies;
    var metrics = {};
    var h = num(inputs.healthScore);
    if (h != null && h >= 0 && h <= 100) metrics.healthScore = Math.round(h);
    var e2 = num(inputs.effectiveN);
    if (e2 != null && e2 >= 0 && e2 <= 1000) metrics.effectiveN = round1(e2);
    if (Object.keys(metrics).length) snapshot.metrics = metrics;
    return snapshot;
  }

  // Strict allowlist validation - REBUILDS the snapshot field by field, so an
  // injected extra field can never travel. Mirrors the Worker-side validator.
  function validateSnapshot(s) {
    function pct(x) { var n = num(x); return (n != null && n >= 0 && n <= 100) ? round1(n) : null; }
    function label(x) { return (typeof x === 'string' && x.length > 0 && x.length <= 40) ? x : null; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, error: 'not an object' };
    if (s.v !== 1) return { ok: false, error: 'unknown version' };
    if (!s.assetClasses || typeof s.assetClasses !== 'object') return { ok: false, error: 'assetClasses missing' };
    var out = { v: 1, assetClasses: {} };
    var total = 0;
    for (var i = 0; i < CLASSES.length; i++) {
      var cls = CLASSES[i];
      if (s.assetClasses[cls] == null) continue;
      var p = pct(s.assetClasses[cls]);
      if (p === null) return { ok: false, error: 'bad weight for ' + cls };
      out.assetClasses[cls] = p;
      total += p;
    }
    if (!Object.keys(out.assetClasses).length || total > 101) return { ok: false, error: 'weights implausible' };
    var lists = ['sectors', 'regions', 'currencies'];
    for (var l = 0; l < lists.length; l++) {
      var key = lists[l];
      if (s[key] == null) continue;
      if (!Array.isArray(s[key]) || s[key].length > 8) return { ok: false, error: key + ' too long' };
      var rows = [];
      for (var r = 0; r < s[key].length; r++) {
        var name = label(s[key][r] && s[key][r].name);
        var p2 = pct(s[key][r] && s[key][r].pct);
        if (name === null || p2 === null) return { ok: false, error: 'bad ' + key + ' row' };
        rows.push({ name: name, pct: p2 });
      }
      out[key] = rows;
    }
    if (s.metrics != null) {
      if (typeof s.metrics !== 'object' || Array.isArray(s.metrics)) return { ok: false, error: 'bad metrics' };
      var m = {};
      if (s.metrics.healthScore != null) {
        var h = pct(s.metrics.healthScore);
        if (h === null) return { ok: false, error: 'bad healthScore' };
        m.healthScore = Math.round(h);
      }
      if (s.metrics.effectiveN != null) {
        var e2 = num(s.metrics.effectiveN);
        if (e2 === null || e2 < 0 || e2 > 1000) return { ok: false, error: 'bad effectiveN' };
        m.effectiveN = round1(e2);
      }
      if (Object.keys(m).length) out.metrics = m;
    }
    return { ok: true, snapshot: out };
  }

  // Compare two snapshots (or mine vs the aggregate's avgAssetClasses map).
  function compare(mine, theirs) {
    var a = (mine && mine.assetClasses) || {};
    var b = (theirs && theirs.assetClasses) || theirs || {};
    return CLASSES.map(function (cls) {
      var av = num(a[cls]) || 0, bv = num(b[cls]) || 0;
      return { cls: cls, mine: av, theirs: bv, diff: round1(av - bv) };
    }).filter(function (r) { return r.mine > 0 || r.theirs > 0; });
  }

  function parseShareId(input) {
    var s = String(input || '').trim();
    var m = s.match(/(?:#|\?|&)share=([a-f0-9]{10,32})/i) || s.match(/^([a-f0-9]{10,32})$/i);
    return m ? m[1].toLowerCase() : null;
  }

  // ---- browser glue: gather inputs from the existing engines -------------------
  // opts.priceHistory: the same input the Health view scores with, so the shared
  // and the shown health score are one number (AUDIT BUG-030).
  function gatherInputs(portfolio, prices, transactions, opts) {
    var w = (typeof window !== 'undefined') ? window : {};
    var inputs = { classValues: {} };
    portfolio = portfolio || {};
    prices = prices || {};
    CLASSES.forEach(function (cls) {
      var v = 0;
      (portfolio[cls] || []).forEach(function (p) {
        var s = p.symbol || p.name || '';
        var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || parseFloat(p.purchasePrice) || 0;
        v += (parseFloat(p.amount) || 0) * price;
      });
      inputs.classValues[cls] = v;
    });
    try {
      var meta = w.MaerminEquityMeta;
      if (meta) {
        var sectorVals = {}, regionVals = {}, stockTotal = 0;
        (portfolio.stocks || []).forEach(function (p) {
          var s = p.symbol || p.name || '';
          var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || parseFloat(p.purchasePrice) || 0;
          var v = (parseFloat(p.amount) || 0) * price;
          if (v <= 0) return;
          var m = meta.getMeta(s) || {};
          stockTotal += v;
          sectorVals[m.sector || 'Other'] = (sectorVals[m.sector || 'Other'] || 0) + v;
          regionVals[m.country || 'Other'] = (regionVals[m.country || 'Other'] || 0) + v;
        });
        var toRows = function (map) {
          return Object.keys(map).map(function (k) { return { name: k, pct: stockTotal > 0 ? (map[k] / stockTotal) * 100 : 0 }; })
            .sort(function (a, b) { return b.pct - a.pct; }).slice(0, 8);
        };
        if (stockTotal > 0) { inputs.sectorWeights = toRows(sectorVals); inputs.regionWeights = toRows(regionVals); }
      }
    } catch (e) {}
    try {
      var M = w.MaerminMetrics;
      var cur = M && M.computeCurrencyExposure(portfolio, prices, transactions);
      if (cur && cur.available) inputs.currencyRows = cur.rows.slice(0, 6);
      var health = M && M.healthScore(portfolio, prices, {}, { priceHistory: (opts && opts.priceHistory) || {}, transactions: transactions || [] });
      if (health && !health.empty) {
        inputs.healthScore = health.score;
        inputs.effectiveN = health.effectiveN;
      }
    } catch (e) {}
    return inputs;
  }

  // ---- React View (the sanctioned surface) --------------------------------------
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    // R4.6: the view on Card, chart-palette bars, the shared table look, inputs and buttons
    var UIC = window.MaerminComponents;
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');

    var snapshot = null;
    try {
      var v = validateSnapshot(buildSnapshot(gatherInputs(props.portfolio, props.prices, props.transactions, { priceHistory: props.priceHistory })));
      snapshot = v.ok ? v.snapshot : null;
    } catch (err) { snapshot = null; }

    var sState = React.useState({ busy: false, link: null, error: null, unsupported: false });
    var state = sState[0], setState = sState[1];
    var sShowRaw = React.useState(false); var showRaw = sShowRaw[0], setShowRaw = sShowRaw[1];
    var sOpenInput = React.useState(''); var openInput = sOpenInput[0], setOpenInput = sOpenInput[1];
    var sTheirs = React.useState(null); var theirs = sTheirs[0], setTheirs = sTheirs[1];
    var sAgg = React.useState(null); var agg = sAgg[0], setAgg = sAgg[1];

    function post(body) {
      return fetch(workerBase + '?action=share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (r) {
        if (r.status === 400 || r.status === 404) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!j.error || /unknown action/i.test(j.error || '')) { var er = new Error('unsupported'); er._unsupported = true; throw er; }
            throw new Error(j.error);
          });
        }
        if (r.status === 501) throw new Error(__('wkNoStorageShare', 'Your Worker has no storage, so share links are off. Redeploy it with the Deploy button, or add a KV namespace to it in the Cloudflare dashboard and bind it as SYNC.'));
        return r.json();
      });
    }

    function publish() {
      if (!snapshot || !workerBase) return;
      // Validate one last time right before the wire - belt and braces.
      var v = validateSnapshot(snapshot);
      if (!v.ok) { setState({ busy: false, link: null, error: __('shRefused', 'refused to publish: {msg}', { msg: v.error }), unsupported: false }); return; }
      setState({ busy: true, link: null, error: null, unsupported: false });
      post({ op: 'publish', snapshot: v.snapshot }).then(function (j) {
        if (!j.ok || !j.id) throw new Error(j.error || 'publish failed');
        var base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : '';
        // WI-9: same opt-in, time-limited id also backs a read-only MCP endpoint
        // (redacted allocation/scores only) an AI client can query.
        var mcp = workerBase.replace(/\?.*$/, '') + '?action=mcp&id=' + j.id;
        setState({ busy: false, link: base + '#share=' + j.id, mcp: mcp, error: null, unsupported: false });
      }).catch(function (ex) {
        setState({ busy: false, link: null, error: ex._unsupported ? null : ((ex && ex.message) || 'failed'), unsupported: !!ex._unsupported });
      });
    }

    function openShared() {
      var id = parseShareId(openInput);
      if (!id) { setTheirs({ error: __('shNoId', 'No share id found in the input.') }); return; }
      post({ op: 'get', id: id }).then(function (j) {
        if (j.error) throw new Error(j.error);
        var v = validateSnapshot(j.snapshot);
        setTheirs(v.ok ? { snapshot: v.snapshot } : { error: __('shInvalid', 'shared snapshot failed validation') });
      }).catch(function (ex) { setTheirs({ error: ex._unsupported ? __('shUnsupportedShort', 'Worker does not support sharing yet.') : ((ex && ex.message) || __('shFailed', 'failed')) }); });
    }

    function loadAggregate() {
      post({ op: 'aggregate' }).then(function (j) {
        setAgg(j.error ? { error: j.error } : j);
      }).catch(function (ex) { setAgg({ error: ex._unsupported ? __('shUnsupportedShort', 'Worker does not support sharing yet.') : ((ex && ex.message) || __('shFailed', 'failed')) }); });
    }

    function weightTable(title, snap, series) {
      if (!snap) return null;
      return e('div', { className: 'ui-sh-weights' },
        e(window.MaerminComponents.Heading, { className: 'ui-sublabel' }, title),
        e('ul', { className: 'ui-hbars' }, Object.keys(snap.assetClasses || {}).map(function (cls) {
          var pct = snap.assetClasses[cls];
          return e('li', { key: cls, className: 'ui-hbar' },
            e('span', { className: 'ui-hbar__label' }, I18N().category(cls)),
            e('span', { className: 'ui-hbar__track', 'aria-hidden': 'true' },
              e('span', { className: 'ui-hbar__fill', 'data-series': series || 1, style: { width: Math.min(100, pct) + '%' } })),
            e('span', { className: ['ui-hbar__value', 'num'].join(' ') }, I18N().pct(pct, 1)));
        })),
        snap.metrics ? e('p', { className: 'ui-note' },
          (snap.metrics.healthScore != null ? __('shHealth', 'Health {n}/100', { n: snap.metrics.healthScore }) + '  ' : '') +
          (snap.metrics.effectiveN != null ? __('shDiv', 'Diversification ~{n} effective holdings', { n: I18N().num(snap.metrics.effectiveN, { min: 0, max: 1 }) }) : '')) : null);
    }

    function compareTable(mine, other, otherLabel) {
      var rows = compare(mine, other);
      if (!rows.length) return null;
      return e(UIC.Table, { layout: 'table', caption: otherLabel, rowKey: function (r) { return r.cls; }, rows: rows, columns: [
        { key: 'cls', label: __('trClass', 'Class'), render: function (r) { return I18N().category(r.cls); } },
        { key: 'mine', label: __('shYou', 'You'), align: 'right', render: function (r) { return I18N().pct(r.mine, 1); } },
        { key: 'theirs', label: otherLabel, align: 'right', render: function (r) { return I18N().pct(r.theirs, 1); } },
        { key: 'diff', label: __('shDiff', 'Diff'), align: 'right', render: function (r) { return e(UIC.ToneChip, { value: r.diff, tone: Math.abs(r.diff) < 0.05 ? 'neutral' : null, text: I18N().pct(r.diff, 1, true) }); } }
      ] });
    }

    var err = function (msg) { return e('p', { className: ['ui-muted', 'is-error'].join(' '), role: 'status' }, msg); };

    return e('div', { className: 'ui-view', 'data-testid': 'share-view' },
      e('p', { className: 'ui-view__lead' },
        __('shIntro', 'Share a redacted snapshot of your allocation - percentage weights and scores only. No amounts, no quantities, no symbols ever leave this device. Opt-in per click, links expire after 90 days.')),

      e(UIC.Card, { title: __('shYours', 'Your snapshot (exactly what would be shared)'), headingLevel: 'h3',
        action: e(UIC.Button, { size: 'sm', variant: 'quiet', 'aria-pressed': showRaw, onClick: function () { setShowRaw(!showRaw); } }, showRaw ? __('shHidePayload', 'hide payload') : __('shShowPayload', 'show raw payload')) },
        snapshot
          ? e('div', null,
              weightTable(__('shAssetClasses', 'Asset classes'), snapshot, 1),
              showRaw ? e('pre', { className: 'ui-sh-raw' }, JSON.stringify(snapshot, null, 2)) : null,
              e('div', { className: 'ui-actions' },
                e(UIC.Button, { variant: 'primary', onClick: publish, disabled: !workerBase, loading: state.busy }, state.busy ? __('shPublishing', 'Publishing...') : __('shPublish', 'Publish snapshot')),
                !workerBase ? e('span', { className: 'ui-note' }, __('shNeedWorker', 'Add a Worker URL in API Settings to publish.')) : null),
              state.link ? e('p', { className: 'ui-sh-link' }, e('code', null, state.link)) : null,
              state.mcp ? e('p', { className: 'ui-sh-link' }, e('span', null, __('shMcp', 'MCP (AI read-only): ')), e('code', null, state.mcp)) : null,
              state.error ? err(state.error) : null)
          : e('p', { className: 'ui-muted' }, __('shNeedHoldings', 'Add holdings first - the snapshot needs at least one position.')),
        state.unsupported ? e('p', { className: ['ui-callout', 'ui-callout--warn'].join(' ') },
          __('shUnsupported', 'Your Worker does not support sharing yet. Re-deploy the latest cf-worker/worker.js (action=share).')) : null),

      e(UIC.Card, { title: __('shOpenShared', 'Open a shared snapshot'), headingLevel: 'h3' },
        e('div', { className: 'ui-ca-add' },
          e('input', { type: 'text', value: openInput, placeholder: __('shPastePh', 'Paste a share link or id'), 'aria-label': __('shPastePh', 'Paste a share link or id'), onChange: function (ev) { setOpenInput(ev.target.value); }, className: 'ui-input' }),
          e(UIC.Button, { onClick: openShared, disabled: !workerBase }, __('shOpen', 'Open'))),
        theirs && theirs.error ? err(theirs.error) : null,
        theirs && theirs.snapshot ? e('div', { className: 'ui-sh-theirs' },
          weightTable(__('shSharedAlloc', 'Shared allocation'), theirs.snapshot, 2),
          snapshot ? compareTable(snapshot, theirs.snapshot, __('shThem', 'Them')) : null) : null),

      e(UIC.Card, { title: __('shBenchmark', 'Anonymous benchmark'), headingLevel: 'h3',
        action: e(UIC.Button, { size: 'sm', onClick: loadAggregate, disabled: !workerBase }, __('shCompareAll', 'Compare vs all shared snapshots')) },
        agg && agg.error ? err(agg.error) : null,
        agg && !agg.error ? (agg.count > 0 && snapshot
          ? e('div', null,
              compareTable(snapshot, agg.avgAssetClasses, __('shAvgOf', 'Avg of {n}', { n: agg.count })),
              e('p', { className: 'ui-note' }, __('shAvgNote', 'Average asset-class weights across {n} shared {n:snapshot|snapshots}. Individual snapshots are never exposed.', { n: agg.count })))
          : e('p', { className: 'ui-muted' }, __('shNoAgg', 'No shared snapshots in the aggregate yet.'))) : null),

      e('p', { className: 'ui-note' },
        __('shPrivacy', 'Privacy: snapshots are validated against a hard allowlist on this device AND on the Worker before storage - only percentages and scores can travel. Published snapshots carry a random id, no account and no IP, and expire after 90 days. To limit abuse the Worker counts publishes per IP address for one day.')));
  }

  var api = {
    CLASSES: CLASSES,
    buildSnapshot: buildSnapshot,
    validateSnapshot: validateSnapshot,
    compare: compare,
    parseShareId: parseShareId,
    gatherInputs: gatherInputs,
    View: View
  };
  if (typeof window !== 'undefined') window.MaerminShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
