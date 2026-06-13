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
  function gatherInputs(portfolio, prices, transactions) {
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
      var health = M && M.healthScore(portfolio, prices, {});
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
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var accent = theme.accent || '#f5a524', good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');

    var snapshot = null;
    try {
      var v = validateSnapshot(buildSnapshot(gatherInputs(props.portfolio, props.prices, props.transactions)));
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
        if (r.status === 501) throw new Error('Worker has no KV storage bound (see docs/WORKER.md)');
        return r.json();
      });
    }

    function publish() {
      if (!snapshot || !workerBase) return;
      // Validate one last time right before the wire - belt and braces.
      var v = validateSnapshot(snapshot);
      if (!v.ok) { setState({ busy: false, link: null, error: 'refused to publish: ' + v.error, unsupported: false }); return; }
      setState({ busy: true, link: null, error: null, unsupported: false });
      post({ op: 'publish', snapshot: v.snapshot }).then(function (j) {
        if (!j.ok || !j.id) throw new Error(j.error || 'publish failed');
        var base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : '';
        setState({ busy: false, link: base + '#share=' + j.id, error: null, unsupported: false });
      }).catch(function (ex) {
        setState({ busy: false, link: null, error: ex._unsupported ? null : ((ex && ex.message) || 'failed'), unsupported: !!ex._unsupported });
      });
    }

    function openShared() {
      var id = parseShareId(openInput);
      if (!id) { setTheirs({ error: 'No share id found in the input.' }); return; }
      post({ op: 'get', id: id }).then(function (j) {
        if (j.error) throw new Error(j.error);
        var v = validateSnapshot(j.snapshot);
        setTheirs(v.ok ? { snapshot: v.snapshot } : { error: 'shared snapshot failed validation' });
      }).catch(function (ex) { setTheirs({ error: ex._unsupported ? 'Worker does not support sharing yet.' : ((ex && ex.message) || 'failed') }); });
    }

    function loadAggregate() {
      post({ op: 'aggregate' }).then(function (j) {
        setAgg(j.error ? { error: j.error } : j);
      }).catch(function (ex) { setAgg({ error: ex._unsupported ? 'Worker does not support sharing yet.' : ((ex && ex.message) || 'failed') }); });
    }

    function weightTable(title, snap, color) {
      if (!snap) return null;
      return e('div', { style: { marginBottom: '0.8rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.3rem' } }, title),
        Object.keys(snap.assetClasses || {}).map(function (cls) {
          var pct = snap.assetClasses[cls];
          return e('div', { key: cls, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' } },
            e('span', { style: { color: text, fontSize: '0.78rem', width: '110px', textTransform: 'capitalize' } }, cls),
            e('div', { style: { flex: 1, background: inputBg, borderRadius: '5px', height: '9px', overflow: 'hidden' } },
              e('div', { style: { width: Math.min(100, pct) + '%', height: '100%', background: color || accent, borderRadius: '5px' } })),
            e('span', { style: { color: dim, fontSize: '0.76rem', width: '50px', textAlign: 'right' } }, pct.toFixed(1) + '%'));
        }),
        snap.metrics ? e('div', { style: { color: dim, fontSize: '0.74rem', marginTop: '0.3rem' } },
          (snap.metrics.healthScore != null ? 'Health ' + snap.metrics.healthScore + '/100  ' : '') +
          (snap.metrics.effectiveN != null ? 'Diversification ~' + snap.metrics.effectiveN + ' effective holdings' : '')) : null);
    }

    function compareTable(mine, other, otherLabel) {
      var rows = compare(mine, other);
      if (!rows.length) return null;
      return e('div', { style: { overflowX: 'auto', marginTop: '0.5rem' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null, ['Class', 'You', otherLabel, 'Diff'].map(function (h, i) {
            return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.35rem 0.45rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
          }))),
          e('tbody', null, rows.map(function (r) {
            return e('tr', { key: r.cls, style: { borderTop: '1px solid ' + border } },
              e('td', { style: { padding: '0.4rem 0.45rem', color: text, fontSize: '0.8rem', textTransform: 'capitalize' } }, r.cls),
              e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: text, fontSize: '0.78rem' } }, r.mine.toFixed(1) + '%'),
              e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, r.theirs.toFixed(1) + '%'),
              e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: r.diff >= 0 ? good : bad, fontSize: '0.78rem', fontWeight: 600 } }, (r.diff >= 0 ? '+' : '') + r.diff.toFixed(1) + '%'));
          }))));
    }

    var cardStyle = { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem 1.2rem', marginBottom: '1rem' };

    return e('div', { style: { padding: '1.25rem 1.5rem' } },
      e('h2', { style: { color: text, fontSize: '1.35rem', fontWeight: 800, margin: '0 0 0.3rem' } }, t.navShare || 'Share & Compare'),
      e('div', { style: { color: dim, fontSize: '0.82rem', marginBottom: '1rem', lineHeight: 1.5 } },
        'Share a redacted snapshot of your allocation - percentage weights and scores only. No amounts, no quantities, no symbols ever leave this device. Opt-in per click, links expire after 90 days.'),

      e('div', { style: cardStyle },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' } },
          e('h3', { style: { color: text, fontSize: '0.95rem', fontWeight: 700, margin: 0 } }, 'Your snapshot (exactly what would be shared)'),
          e('button', { onClick: function () { setShowRaw(!showRaw); }, style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid ' + border, background: inputBg, color: dim, cursor: 'pointer', fontSize: '0.72rem' } }, showRaw ? 'hide payload' : 'show raw payload')),
        snapshot
          ? e('div', null,
              weightTable('Asset classes', snapshot, accent),
              showRaw ? e('pre', { style: { background: inputBg, border: '1px solid ' + border, borderRadius: '8px', padding: '0.7rem', color: dim, fontSize: '0.7rem', overflowX: 'auto', whiteSpace: 'pre-wrap' } }, JSON.stringify(snapshot, null, 2)) : null,
              e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.6rem' } },
                e('button', { onClick: publish, disabled: state.busy || !workerBase, style: { padding: '0.45rem 1rem', borderRadius: '8px', border: 'none', cursor: workerBase ? 'pointer' : 'default', fontWeight: 700, fontSize: '0.8rem', background: accent, color: '#13110a', opacity: (state.busy || !workerBase) ? 0.6 : 1 } }, state.busy ? 'Publishing...' : 'Publish snapshot'),
                state.link ? e('code', { style: { color: good, fontSize: '0.74rem', wordBreak: 'break-all' } }, state.link) : null,
                state.error ? e('span', { style: { color: bad, fontSize: '0.76rem' } }, state.error) : null,
                !workerBase ? e('span', { style: { color: dim, fontSize: '0.76rem' } }, 'Add a Worker URL in API Settings to publish.') : null))
          : e('div', { style: { color: dim, fontSize: '0.82rem' } }, 'Add holdings first - the snapshot needs at least one position.'),
        state.unsupported ? e('div', { style: { color: warn, fontSize: '0.74rem', marginTop: '0.5rem' } },
          'Your Worker does not support sharing yet. Re-deploy the latest cf-worker/worker.js (action=share).') : null),

      e('div', { style: cardStyle },
        e('h3', { style: { color: text, fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.5rem' } }, 'Open a shared snapshot'),
        e('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
          e('input', { type: 'text', value: openInput, placeholder: 'Paste a share link or id', onChange: function (ev) { setOpenInput(ev.target.value); }, style: { flex: 1, minWidth: '220px', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', padding: '0.45rem 0.7rem', color: text, fontSize: '0.8rem' } }),
          e('button', { onClick: openShared, disabled: !workerBase, style: { padding: '0.45rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', background: inputBg, color: text, opacity: workerBase ? 1 : 0.5 } }, 'Open')),
        theirs && theirs.error ? e('div', { style: { color: bad, fontSize: '0.78rem', marginTop: '0.5rem' } }, theirs.error) : null,
        theirs && theirs.snapshot ? e('div', { style: { marginTop: '0.7rem' } },
          weightTable('Shared allocation', theirs.snapshot, '#3b82f6'),
          snapshot ? compareTable(snapshot, theirs.snapshot, 'Them') : null) : null),

      e('div', { style: cardStyle },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' } },
          e('h3', { style: { color: text, fontSize: '0.95rem', fontWeight: 700, margin: 0 } }, 'Anonymous benchmark'),
          e('button', { onClick: loadAggregate, disabled: !workerBase, style: { padding: '0.35rem 0.8rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.76rem', background: inputBg, color: text, opacity: workerBase ? 1 : 0.5 } }, 'Compare vs all shared snapshots')),
        agg && agg.error ? e('div', { style: { color: bad, fontSize: '0.78rem', marginTop: '0.5rem' } }, agg.error) : null,
        agg && !agg.error ? (agg.count > 0 && snapshot
          ? e('div', { style: { marginTop: '0.5rem' } },
              compareTable(snapshot, agg.avgAssetClasses, 'Avg of ' + agg.count),
              e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.4rem' } }, 'Average asset-class weights across ' + agg.count + ' shared snapshot(s). Individual snapshots are never exposed.'))
          : e('div', { style: { color: dim, fontSize: '0.78rem', marginTop: '0.5rem' } }, 'No shared snapshots in the aggregate yet.')) : null),

      e('div', { style: { color: dim, fontSize: '0.7rem', lineHeight: 1.5 } },
        'Privacy: snapshots are validated against a hard allowlist on this device AND on the Worker before storage - only percentages and scores can travel. Published snapshots carry a random id, no account, no IP-derived data, and expire after 90 days.'));
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
