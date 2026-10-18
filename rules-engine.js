// ============================================================================
// MAERMIN v10.x — Automation Rules  (window.MaerminRules)
// ----------------------------------------------------------------------------
// Roadmap feature #2. User-defined "if this, warn me" rules evaluated locally
// against the live portfolio — e.g. "BTC weight > 30%", "Crypto category > 50%",
// "tag:Speculative > 15%", "down more than 10% from peak", "total value < 5000",
// "BTC price ≥ 60000" (price alerts — these replaced the old standalone
// Price Alerts view; legacy 'maermin_alerts' entries are migrated on load).
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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_rules';
  var LEGACY_ALERTS_KEY = 'maermin_alerts'; // old Price Alerts store (migrated)
  var SCHEMA = 1;

  // metric → { label, needsTarget, unit, targetKind }. targetKind hints the UI
  // what to offer (a symbol, a category, a tag) for the target field.
  var METRICS = {
    symbol_weight:      { label: 'Symbol weight',         needsTarget: true,  unit: '%', targetKind: 'symbol' },
    category_weight:    { label: 'Category weight',       needsTarget: true,  unit: '%', targetKind: 'category' },
    tag_weight:         { label: 'Tag weight',            needsTarget: true,  unit: '%', targetKind: 'tag' },
    total_value:        { label: 'Total value',           needsTarget: false, unit: '',  targetKind: null },
    drop_from_peak_pct: { label: 'Drop from peak',        needsTarget: false, unit: '%', targetKind: null },
    // Price alert: the symbol's current price, in the same unit the app's
    // price map holds (what the old Price Alerts view compared against).
    symbol_price:       { label: 'Price',                 needsTarget: true,  unit: '',  targetKind: 'price' }
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
    // 'price' targets keep their casing: price-map keys can be ids (e.g. a
    // CoinGecko id) and are looked up case-insensitively in priceFor().
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
      dropFromPeakPct: isFinite(parseFloat(extra.dropFromPeakPct)) ? parseFloat(extra.dropFromPeakPct) : 0,
      prices: (extra.prices && typeof extra.prices === 'object') ? extra.prices : {}
    };
  }

  // Price for a symbol from the app's price map (exact, lower- or upper-case
  // key — the same lookup the old Price Alerts view used). null if unknown or
  // not positive, so a missing quote never triggers a rule.
  function priceFor(prices, sym) {
    if (!prices || !sym) return null;
    var k = normKey(sym);
    var v = prices[k];
    if (v == null) v = prices[k.toLowerCase()];
    if (v == null) v = prices[k.toUpperCase()];
    v = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(v) && v > 0 ? v : null;
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
      case 'symbol_price':       return priceFor(ctx.prices, rule.target);
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
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  // Metric id -> label in the UI language.
  function metricLabel(m) {
    return ({ symbol_weight: __('rlSymbolWeight', 'Symbol weight'), category_weight: __('rlCategoryWeight', 'Category weight'), tag_weight: __('rlTagWeight', 'Tag weight'), total_value: __('rlTotalValue', 'Total value'), drop_from_peak_pct: __('rlDropFromPeak', 'Drop from peak'), symbol_price: __('price', 'Price') })[m] || (METRICS[m] && METRICS[m].label) || m;
  }

  function describe(rule) {
    var spec = METRICS[rule.metric] || {};
    var subject = metricLabel(rule.metric);
    if (spec.needsTarget && rule.target) {
      if (rule.metric === 'symbol_weight') subject = __('rlWeightOf', '{name} weight', { name: rule.target });
      else if (rule.metric === 'category_weight') subject = __('rlWeightOf', '{name} weight', { name: I18N().category(rule.target) });
      else if (rule.metric === 'tag_weight') subject = __('rlWeightOf', '{name} weight', { name: 'tag:' + rule.target });
      else if (rule.metric === 'symbol_price') subject = __('rlPriceOf', '{name} price', { name: rule.target });
    }
    return subject + ' ' + (OPS[rule.op] || '?') + ' ' + I18N().num(rule.threshold, { min: 0, max: 4 }) + (spec.unit ? (spec.unit === '%' && I18N().lang() === 'de' ? ' %' : spec.unit) : '');
  }

  // Evaluate all rules. Returns [{ rule, actual, triggered, message }], with
  // triggered rules first. A disabled rule never triggers.
  function evaluate(state, context) {
    state = normalize(state);
    var ctx = context || { total: 0, byCategory: {}, bySymbol: {}, byTag: {}, dropFromPeakPct: 0, prices: {} };
    var out = state.rules.map(function (r) {
      var actual = actualFor(r, ctx);
      var triggered = !!(r.enabled && actual != null && isFinite(actual) && compare(actual, r.op, r.threshold));
      return { rule: r, actual: actual, triggered: triggered, message: describe(r) };
    });
    out.sort(function (a, b) { return (b.triggered ? 1 : 0) - (a.triggered ? 1 : 0); });
    return out;
  }

  // Convert legacy Price Alerts ({ id, symbol, condition:'above'|'below',
  // targetPrice, triggered }) into symbol_price rules. Pure. An alert that had
  // already fired was one-shot, so it arrives disabled (re-enable to re-arm)
  // instead of notifying again. Entries already migrated (same id) are skipped.
  function migrateLegacyAlerts(state, legacy) {
    state = normalize(state);
    var list = legacy;
    if (typeof legacy === 'string') { try { list = JSON.parse(legacy); } catch (e) { list = null; } }
    if (!Array.isArray(list)) return state;
    var have = {};
    state.rules.forEach(function (r) { have[r.id] = true; });
    list.forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      var id = 'pa-' + String(a.id != null ? a.id : (a.symbol + '-' + a.targetPrice));
      if (have[id]) return;
      var n = normalizeRule({
        id: id, name: '', metric: 'symbol_price', target: a.symbol,
        op: a.condition === 'below' ? 'lte' : 'gte', threshold: a.targetPrice,
        enabled: !a.triggered
      });
      if (n) { state.rules.push(n); have[id] = true; }
    });
    return state;
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, rules: [] };
    try {
      var state = normalize(s.getItem(STORAGE_KEY));
      // One-time fold-in of the old Price Alerts store (also covers restoring an
      // older backup that still carries it). The legacy key is only removed
      // once the merged rules were written successfully.
      var legacy = s.getItem(LEGACY_ALERTS_KEY);
      if (legacy != null) {
        state = migrateLegacyAlerts(state, legacy);
        if (save(state)) { try { s.removeItem(LEGACY_ALERTS_KEY); } catch (e) {} }
      }
      return state;
    } catch (e) { return { version: SCHEMA, rules: [] }; }
  }
  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, METRICS: METRICS, OPS: OPS,
    normalize: normalize,
    addRule: addRule, removeRule: removeRule, toggleRule: toggleRule,
    buildContext: buildContext, actualFor: actualFor, describe: describe, metricLabel: metricLabel, priceFor: priceFor,
    migrateLegacyAlerts: migrateLegacyAlerts, LEGACY_ALERTS_KEY: LEGACY_ALERTS_KEY,
    evaluate: evaluate,
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
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        // R5.1: the rule form on shared fields, rules as rows with a mark and words, shared buttons
        var UIC = window.MaerminComponents;
        var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var f0 = useState(function () { return { metric: 'symbol_weight', op: 'gt', threshold: '', target: '' }; });
        var form = f0[0], setForm = f0[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); }
        if (window.MaerminTrash) window.MaerminTrash.useReload(STORAGE_KEY, function () { setSt(API.load()); });
        function setF(patch) { setForm(Object.assign({}, form, patch)); }

        // Build evaluation context from props (positions [{symbol,category,valueEUR}],
        // byTag map, dropFromPeakPct). The renderer supplies these.
        var ctx = API.buildContext(props.positions || [], { byTag: props.byTag || {}, dropFromPeakPct: props.dropFromPeakPct || 0, prices: props.prices || {} });
        var results = API.evaluate(st, ctx);
        var triggered = results.filter(function (r) { return r.triggered; }).length;

        var spec = API.METRICS[form.metric] || {};
        var targetOptions = [];
        if (spec.targetKind === 'symbol') targetOptions = (props.symbols || []).slice();
        else if (spec.targetKind === 'category') targetOptions = (props.categories || ['crypto', 'stocks', 'skins', 'commodities']).slice();
        else if (spec.targetKind === 'tag') targetOptions = (props.tags || []).slice();
        // Price alerts may watch any symbol (not only holdings): free text with
        // the held symbols offered as suggestions.
        var priceTarget = spec.targetKind === 'price';

        function addCurrent() {
          var rule = { metric: form.metric, op: form.op, threshold: form.threshold, target: form.target, enabled: true };
          var next = API.addRule(st, rule);
          if (API.normalize(next).rules.length > st.rules.length) {
            mutate(next);
            setForm({ metric: form.metric, op: form.op, threshold: '', target: '' });
          }
        }

        function field(label, child) { return e('label', { className: 'ui-rl-field' }, e('span', { className: 'ui-field__label' }, label), child); }
        function sel(value, onChange, opts, placeholder) {
          return e('select', {
            value: value, onChange: function (ev) { onChange(ev.target.value); },
            className: ['ui-input', 'ui-select'].join(' ')
          }, (placeholder != null ? [e('option', { key: '_', value: '' }, placeholder)] : []).concat(
            opts.map(function (o) { return e('option', { key: o[0] != null ? o[0] : o, value: o[0] != null ? o[0] : o }, o[1] != null ? o[1] : o); })));
        }

        var ruleRows = results.map(function (res) {
          var r = res.rule;
          var actStr = res.actual == null ? '—' : ((r.metric === 'total_value' || r.metric === 'symbol_price') ? fmt(res.actual) : (API.METRICS[r.metric].unit === '%' ? window.MaerminI18n.pct(res.actual, 1) : window.MaerminI18n.num(res.actual, 1)));
          return e('li', { key: r.id, className: ['ui-rl-row', res.triggered ? 'is-hit' : '', r.enabled ? '' : 'is-off'].join(' ').trim() },
            e(UIC.Badge, { tone: res.triggered ? 'loss' : 'gain' }, res.triggered ? '! ' + __('rlTriggered', 'Triggered') : '✓ ' + __('rlOk', 'OK')),
            e('div', { className: 'ui-rows__main' },
              e('b', null, r.name || API.describe(r)),
              e('span', null, API.describe(r) + '  ·  ' + (t.rulesNow || 'now') + ' ' + actStr)),
            e(UIC.Chip, {
              pressed: !!r.enabled, 'aria-label': __('rlEnabledAria', 'Rule {name} on', { name: r.name || API.describe(r) }),
              onClick: function () { mutate(API.toggleRule(st, r.id)); }
            }, r.enabled ? (t.rulesOn || 'On') : (t.rulesOff || 'Off')),
            e(UIC.Button, {
              size: 'sm', variant: 'quiet',
              onClick: function () {
                window.MaerminUtils.confirmThen({
                  title: (t.rulesDeleteTitle || 'Delete the rule "{name}"?').replace('{name}', r.name || API.describe(r)),
                  confirmLabel: t.rulesDelete || 'Delete', cancelLabel: t.cancel || 'Cancel'
                }, function () {
                  mutate(API.removeRule(st, r.id));
                  if (window.MaerminTrash) window.MaerminTrash.trashed('rule', r.name || API.describe(r), r);
                });
              }
            }, t.rulesDelete || 'Delete'));
        });

        return e('div', { className: 'ui-rl' },
          e('p', { className: 'ui-view__lead' },
            t.rulesSubtitle || 'Local "warn me when…" rules on prices, concentration, allocation and drawdown — evaluated on every price refresh against your live portfolio. Rules carry into your backup.'),

          e(UIC.Card, { headingLevel: 'h3', title: __('rlNewTitle', 'New rule') },
            e('div', { className: 'ui-rl-form' },
              field(__('rlMetricLabel', 'Metric'), sel(form.metric, function (v) { setF({ metric: v, target: '' }); },
                Object.keys(API.METRICS).map(function (k) { return [k, API.metricLabel(k)]; }), null)),
              spec.needsTarget ? (
                priceTarget
                  ? field(t.rulesSymbol || 'symbol', e(React.Fragment, null,
                      e('input', { value: form.target, list: 'maermin-rule-price-symbols', onChange: function (ev) { setF({ target: ev.target.value }); }, placeholder: t.rulesSymbol || 'symbol', className: 'ui-input' }),
                      e('datalist', { id: 'maermin-rule-price-symbols' }, (props.symbols || []).map(function (sy) { return e('option', { key: sy, value: sy }); }))))
                : targetOptions.length
                  ? field(__('rlTargetLabel', 'Target'), sel(form.target, function (v) { setF({ target: v }); }, targetOptions, t.rulesPickTarget || 'target…'))
                  : field(__('rlTargetLabel', 'Target'), e('input', { value: form.target, onChange: function (ev) { setF({ target: ev.target.value }); }, placeholder: t.rulesTarget || 'target', className: 'ui-input' }))
              ) : null,
              field(__('rlConditionLabel', 'Condition'), sel(form.op, function (v) { setF({ op: v }); }, Object.keys(API.OPS).map(function (k) { return [k, API.OPS[k]]; }), null)),
              field(__('rlThresholdLabel', 'Threshold'), e('input', {
                type: 'number', value: form.threshold, onChange: function (ev) { setF({ threshold: ev.target.value }); },
                placeholder: API.METRICS[form.metric].unit === '%' ? '%' : '0', className: ['ui-input', 'ui-rl-num'].join(' ')
              })),
              e(UIC.Button, { variant: 'primary', onClick: addCurrent }, t.rulesAdd || 'Add rule'))),

          results.length
            ? e(UIC.Card, { headingLevel: 'h3', title: t.navRules || 'Alerts & Rules',
                subtitle: triggered
                  ? ('! ' + triggered + ' ' + (t.rulesTriggered || 'rule(s) currently triggered'))
                  : ('✓ ' + (t.rulesAllClear || 'All rules within limits')) },
                e('ul', { className: 'ui-rows' }, ruleRows))
            : e(UIC.EmptyState, { text: t.rulesEmpty || 'No rules yet. Add one above — e.g. a symbol weight above 30% to catch concentration.' }));
      } catch (err) {
        return e('div', { className: 'ui-view' }, e('p', { role: 'alert', className: ['ui-muted', 'is-error'].join(' ') }, __('rlViewError', 'Rules view error: ') + (err && err.message)));
      }
    };
  }
})();
