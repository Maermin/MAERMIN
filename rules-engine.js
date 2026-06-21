// ============================================================================
// MAERMIN v10.x — Automation Rules  (window.MaerminRules)
// ----------------------------------------------------------------------------
// Roadmap feature #2. User-defined "if this, warn me" rules evaluated locally
// against the live portfolio — e.g. "BTC weight > 30%", "Crypto category > 50%",
// "tag:Speculative > 15%", "down more than 10% from peak", "total value < 5000".
// No backend, no background daemon: rules are evaluated on demand from a context
// the caller assembles, so it stays 100% client-side and instant.
//
// Persisted (key 'maermin_rules', carried in the full-vault backup). Shape:
//
//   { version: 1, rules: [ { id, name, metric, op, threshold, target, enabled } ] }
//
// The evaluator is pure (evaluate / buildContext / describe), so it is unit-tested
// headlessly in test/rules-engine.test.js with no browser or other module.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_rules';
  var SCHEMA = 1;

  // metric → { label, needsTarget, unit, targetKind }. targetKind hints the UI
  // what to offer (a symbol, a category, a tag) for the target field.
  var METRICS = {
    symbol_weight:      { label: 'Symbol weight',         needsTarget: true,  unit: '%', targetKind: 'symbol' },
    category_weight:    { label: 'Category weight',       needsTarget: true,  unit: '%', targetKind: 'category' },
    tag_weight:         { label: 'Tag weight',            needsTarget: true,  unit: '%', targetKind: 'tag' },
    total_value:        { label: 'Total value',           needsTarget: false, unit: '',  targetKind: null },
    drop_from_peak_pct: { label: 'Drop from peak',        needsTarget: false, unit: '%', targetKind: null }
  };
  var OPS = { gt: '>', lt: '<', gte: '≥', lte: '≤' };

  function normKey(s) { return String(s == null ? '' : s).trim(); }
  function normSym(s) { return normKey(s).toUpperCase(); }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function normalizeRule(r) {
    if (!r || typeof r !== 'object') return null;
    var metric = METRICS[r.metric] ? r.metric : null;
    if (!metric) return null;
    var op = OPS[r.op] ? r.op : 'gt';
    var threshold = parseFloat(r.threshold);
    if (!isFinite(threshold)) return null;
    var spec = METRICS[metric];
    var target = spec.needsTarget ? normKey(r.target) : '';
    if (spec.needsTarget && !target) return null;
    // Normalise target casing to match how the context is keyed.
    if (spec.targetKind === 'symbol') target = normSym(target);
    else if (spec.targetKind === 'category') target = target.toLowerCase();
    return {
      id: r.id ? String(r.id) : uid(),
      name: normKey(r.name),
      metric: metric, op: op, threshold: threshold, target: target,
      enabled: r.enabled !== false
    };
  }

  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.rules) ? obj.rules : (Array.isArray(obj) ? obj : []);
    var rules = [];
    list.forEach(function (r) { var n = normalizeRule(r); if (n) rules.push(n); });
    return { version: SCHEMA, rules: rules };
  }

  function addRule(state, rule) {
    state = normalize(state);
    var n = normalizeRule(Object.assign({ id: uid(), enabled: true }, rule));
    if (n) state.rules.push(n);
    return state;
  }
  function updateRule(state, id, patch) {
    state = normalize(state);
    state.rules = state.rules.map(function (r) {
      if (r.id !== id) return r;
      var merged = normalizeRule(Object.assign({}, r, patch, { id: r.id }));
      return merged || r;
    });
    return state;
  }
  function removeRule(state, id) {
    state = normalize(state);
    state.rules = state.rules.filter(function (r) { return r.id !== id; });
    return state;
  }
  function toggleRule(state, id) {
    state = normalize(state);
    state.rules = state.rules.map(function (r) {
      return r.id === id ? Object.assign({}, r, { enabled: !r.enabled }) : r;
    });
    return state;
  }

  // Build the evaluation context from priced positions [{symbol, category, valueEUR}]
  // plus optional extras: byTag (tag→value map) and dropFromPeakPct (number).
  function buildContext(positions, extra) {
    extra = extra || {};
    var total = 0, byCategory = {}, bySymbol = {};
    (Array.isArray(positions) ? positions : []).forEach(function (p) {
      var v = p && (typeof p.valueEUR === 'number' ? p.valueEUR : parseFloat(p.valueEUR));
      if (!isFinite(v)) return;
      var sym = normSym(p.symbol), cat = normKey(p.category).toLowerCase();
      total += v;
      if (sym) bySymbol[sym] = (bySymbol[sym] || 0) + v;
      if (cat) byCategory[cat] = (byCategory[cat] || 0) + v;
    });
    return {
      total: total,
      byCategory: byCategory,
      bySymbol: bySymbol,
      byTag: extra.byTag || {},
      dropFromPeakPct: isFinite(parseFloat(extra.dropFromPeakPct)) ? parseFloat(extra.dropFromPeakPct) : 0
    };
  }

  // Actual value of a rule's metric in the given context (or null if not computable).
  function actualFor(rule, ctx) {
    var total = ctx.total || 0;
    function weight(map, key) { return total > 0 ? ((map[key] || 0) / total) * 100 : null; }
    switch (rule.metric) {
      case 'symbol_weight':      return weight(ctx.bySymbol, rule.target);
      case 'category_weight':    return weight(ctx.byCategory, rule.target);
      case 'tag_weight':         return weight(ctx.byTag, rule.target);
      case 'total_value':        return total;
      case 'drop_from_peak_pct': return ctx.dropFromPeakPct;
      default:                   return null;
    }
  }

  function compare(actual, op, threshold) {
    switch (op) {
      case 'gt':  return actual > threshold;
      case 'lt':  return actual < threshold;
      case 'gte': return actual >= threshold;
      case 'lte': return actual <= threshold;
      default:    return false;
    }
  }

  // Human-readable rule text, e.g. "BTC weight > 30%".
  function describe(rule) {
    var spec = METRICS[rule.metric] || {};
    var subject = spec.label || rule.metric;
    if (spec.needsTarget && rule.target) {
      if (rule.metric === 'symbol_weight') subject = rule.target + ' weight';
      else if (rule.metric === 'category_weight') subject = rule.target + ' weight';
      else if (rule.metric === 'tag_weight') subject = 'tag:' + rule.target + ' weight';
    }
    return subject + ' ' + (OPS[rule.op] || '?') + ' ' + rule.threshold + (spec.unit || '');
  }

  // Evaluate all rules. Returns [{ rule, actual, triggered, message }], with
  // triggered rules first. A disabled rule never triggers.
  function evaluate(state, context) {
    state = normalize(state);
    var ctx = context || { total: 0, byCategory: {}, bySymbol: {}, byTag: {}, dropFromPeakPct: 0 };
    var out = state.rules.map(function (r) {
      var actual = actualFor(r, ctx);
      var triggered = !!(r.enabled && actual != null && isFinite(actual) && compare(actual, r.op, r.threshold));
      return { rule: r, actual: actual, triggered: triggered, message: describe(r) };
    });
    out.sort(function (a, b) { return (b.triggered ? 1 : 0) - (a.triggered ? 1 : 0); });
    return out;
  }

  function activeCount(state, context) {
    return evaluate(state, context).filter(function (x) { return x.triggered; }).length;
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, rules: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); } catch (e) { return { version: SCHEMA, rules: [] }; }
  }
  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, METRICS: METRICS, OPS: OPS,
    normalize: normalize,
    addRule: addRule, updateRule: updateRule, removeRule: removeRule, toggleRule: toggleRule,
    buildContext: buildContext, actualFor: actualFor, describe: describe,
    evaluate: evaluate, activeCount: activeCount,
    load: load, save: save
  };

  // View is attached below (rules-view.js-style, but kept in this module).
  api.View = makeView(api);

  if (typeof window !== 'undefined') window.MaerminRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view factory (kept in-module; only runs in the browser at render time)
  // --------------------------------------------------------------------------
  function makeView(API) {
    return function View(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      var useState = React.useState;
      try {
        var theme = props.theme || {};
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var inputBg = theme.inputBg || '#0c1018', inputBorder = theme.inputBorder || border;
        var accent = theme.accent || '#f5a524', accentText = theme.accentText || '#13110a';
        var up = theme.success || '#22c55e', down = theme.danger || '#ef4444';
        var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var f0 = useState(function () { return { metric: 'symbol_weight', op: 'gt', threshold: '', target: '' }; });
        var form = f0[0], setForm = f0[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); }
        function setF(patch) { setForm(Object.assign({}, form, patch)); }

        // Build evaluation context from props (positions [{symbol,category,valueEUR}],
        // byTag map, dropFromPeakPct). The renderer supplies these.
        var ctx = API.buildContext(props.positions || [], { byTag: props.byTag || {}, dropFromPeakPct: props.dropFromPeakPct || 0 });
        var results = API.evaluate(st, ctx);
        var triggered = results.filter(function (r) { return r.triggered; }).length;

        var spec = API.METRICS[form.metric] || {};
        var targetOptions = [];
        if (spec.targetKind === 'symbol') targetOptions = (props.symbols || []).slice();
        else if (spec.targetKind === 'category') targetOptions = (props.categories || ['crypto', 'stocks', 'skins', 'commodities']).slice();
        else if (spec.targetKind === 'tag') targetOptions = (props.tags || []).slice();

        function addCurrent() {
          var rule = { metric: form.metric, op: form.op, threshold: form.threshold, target: form.target, enabled: true };
          var next = API.addRule(st, rule);
          if (API.normalize(next).rules.length > st.rules.length) {
            mutate(next);
            setForm({ metric: form.metric, op: form.op, threshold: '', target: '' });
          }
        }

        function field(child) { return e('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.2rem' } }, child); }
        function sel(value, onChange, opts, placeholder) {
          return e('select', {
            value: value, onChange: function (ev) { onChange(ev.target.value); },
            style: { padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.82rem' }
          }, (placeholder != null ? [e('option', { key: '_', value: '' }, placeholder)] : []).concat(
            opts.map(function (o) { return e('option', { key: o[0] != null ? o[0] : o, value: o[0] != null ? o[0] : o }, o[1] != null ? o[1] : o); })));
        }

        var ruleRows = results.map(function (res) {
          var r = res.rule;
          var actStr = res.actual == null ? '—' : (r.metric === 'total_value' ? fmt(res.actual) : res.actual.toFixed(1) + (API.METRICS[r.metric].unit || ''));
          return e('div', {
            key: r.id,
            style: {
              display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 0.9rem',
              borderRadius: '12px', border: '1px solid ' + (res.triggered ? down : border),
              background: res.triggered ? 'rgba(239,68,68,0.06)' : card, marginBottom: '0.6rem'
            }
          },
            e('span', { 'aria-hidden': 'true', title: res.triggered ? 'Triggered' : 'OK', style: { color: res.triggered ? down : up, fontWeight: 800, fontSize: '1rem' } }, res.triggered ? '●' : '○'),
            e('div', { style: { flex: 1, minWidth: 0 } },
              e('div', { style: { color: text, fontWeight: 700, fontSize: '0.9rem' } }, r.name || API.describe(r)),
              e('div', { style: { color: dim, fontSize: '0.76rem', marginTop: '0.1rem' } },
                API.describe(r) + '  ·  ' + (t.rulesNow || 'now') + ' ' + actStr)),
            e('button', {
              onClick: function () { mutate(API.toggleRule(st, r.id)); },
              style: { padding: '0.3rem 0.6rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', border: '1px solid ' + inputBorder, background: 'transparent', color: r.enabled ? text : dim }
            }, r.enabled ? (t.rulesOn || 'On') : (t.rulesOff || 'Off')),
            e('button', {
              onClick: function () { mutate(API.removeRule(st, r.id)); },
              style: { padding: '0.3rem 0.6rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', border: '1px solid ' + inputBorder, background: 'transparent', color: text }
            }, t.rulesDelete || 'Delete'));
        });

        return e('div', { style: { padding: '1.5rem' } },
          e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } }, t.navRules || 'Alerts & Rules'),
          e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '62ch' } },
            t.rulesSubtitle || 'Local "warn me when…" rules on concentration, allocation and drawdown — evaluated instantly against your live portfolio. Rules carry into your backup.'),

          e('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap', background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem', marginBottom: '1.25rem' } },
            field(sel(form.metric, function (v) { setF({ metric: v, target: '' }); },
              Object.keys(API.METRICS).map(function (k) { return [k, API.METRICS[k].label]; }))),
            spec.needsTarget ? field(
              targetOptions.length
                ? sel(form.target, function (v) { setF({ target: v }); }, targetOptions, t.rulesPickTarget || 'target…')
                : e('input', { value: form.target, onChange: function (ev) { setF({ target: ev.target.value }); }, placeholder: t.rulesTarget || 'target', style: { padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.82rem', width: '120px' } })
            ) : null,
            field(sel(form.op, function (v) { setF({ op: v }); }, Object.keys(API.OPS).map(function (k) { return [k, API.OPS[k]]; }))),
            field(e('input', {
              type: 'number', value: form.threshold, onChange: function (ev) { setF({ threshold: ev.target.value }); },
              placeholder: API.METRICS[form.metric].unit === '%' ? '%' : '0',
              style: { width: '90px', padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.82rem' }
            })),
            e('button', {
              onClick: addCurrent,
              style: { padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer', borderRadius: '8px', border: 'none', background: accent, color: accentText }
            }, t.rulesAdd || 'Add rule')),

          results.length
            ? e('div', null,
                e('div', { style: { color: dim, fontSize: '0.78rem', marginBottom: '0.6rem' } },
                  triggered
                    ? (triggered + ' ' + (t.rulesTriggered || 'rule(s) currently triggered'))
                    : (t.rulesAllClear || 'All rules within limits')),
                ruleRows)
            : e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '2rem', textAlign: 'center', color: dim, fontSize: '0.9rem' } },
                t.rulesEmpty || 'No rules yet. Add one above — e.g. a symbol weight above 30% to catch concentration.'));
      } catch (err) {
        return e('div', { style: { padding: '1.5rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Rules view error: ' + (err && err.message));
      }
    };
  }
})();
