// ============================================================================
// MAERMIN — Taxonomies  (window.MaerminTaxonomies)
// ----------------------------------------------------------------------------
// P5-2.10. Hierarchical classifications on top of tags and custom categories:
// a taxonomy is a tree of nodes (name, colour, optional target %) and an
// assignment of each held symbol to one node. Templates: asset classes, GICS
// sectors, MSCI regions, the Kommer world portfolio. Suggestions come from the
// app's own data (asset class, fund type, fund name, sector, country) and
// never overwrite an assignment. Used for the allocation tree and, on the top
// level, as targets for the rebalancing planner (rebalancing-planner.js).
//
// Stored under 'maermin_taxonomies' (names held symbols: encrypted, synced,
// in the backup):
//   { version: 1, list: [{ id, name, template, nodes: [Node], assign: { SYMBOL: nodeId } }] }
//   Node = { id, name, color, target (% or null), children: [Node] }
//
// Pure API (Node-tested, test/taxonomies.test.js): normalize, TEMPLATES,
// fromTemplate, add, put, remove, rename, get, addNode, renameNode, removeNode,
// setTarget, findNode, assign, suggest, allocation, planInput, exportJson,
// importJson; load / save (browser). `Panel` = Strategy → Taxonomies.
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function __(k, f, v) { return (W.MaerminI18n ? W.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var STORAGE_KEY = 'maermin_taxonomies';
  var FORMAT = 'maermin-taxonomy';
  var MAX_NODES = 500;
  var PALETTE = ['#8b7cff', '#3b82f6', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#a855f7', '#ef4444', '#eab308'];
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function sym(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function newId(p) { return (p || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---- templates -------------------------------------------------------------
  // Node ids are stable words so suggestions and imports can refer to them;
  // names are created in the UI language (the user can rename them).
  function leaf(id, name, target) { return { id: id, name: name, target: target == null ? null : target, children: [] }; }
  var TEMPLATES = [
    { id: 'asset-classes', nodes: function () {
      return [leaf('equity', __('txnEquity', 'Equity')), leaf('bonds', __('txnBonds', 'Bonds')), leaf('cash', __('txnCash', 'Cash')), leaf('real-estate', __('txnRealEstate', 'Real estate')),
        leaf('commodities', __('txnCommodities', 'Commodities')), leaf('crypto', __('txnCrypto', 'Crypto')), leaf('other', __('txnOther', 'Other'))];
    } },
    { id: 'gics', nodes: function () {
      return [leaf('information-technology', __('txnIt', 'Information Technology')), leaf('health-care', __('txnHealth', 'Health Care')), leaf('financials', __('txnFinancials', 'Financials')),
        leaf('consumer-discretionary', __('txnDiscretionary', 'Consumer Discretionary')), leaf('consumer-staples', __('txnStaples', 'Consumer Staples')), leaf('communication-services', __('txnComm', 'Communication Services')),
        leaf('industrials', __('txnIndustrials', 'Industrials')), leaf('energy', __('txnEnergy', 'Energy')), leaf('materials', __('txnMaterials', 'Materials')), leaf('utilities', __('txnUtilities', 'Utilities')), leaf('real-estate', __('txnRealEstateSector', 'Real Estate'))];
    } },
    { id: 'msci-regions', nodes: function () {
      var dev = leaf('developed', __('txnDeveloped', 'Developed markets'));
      dev.children = [leaf('north-america', __('txnNorthAmerica', 'North America')), leaf('europe', __('txnEurope', 'Europe & Middle East')), leaf('pacific', __('txnPacific', 'Pacific'))];
      return [dev, leaf('emerging', __('txnEmerging', 'Emerging markets'))];
    } },
    { id: 'kommer', nodes: function () {
      return [leaf('developed', __('txnDeveloped', 'Developed markets'), 70), leaf('emerging', __('txnEmerging', 'Emerging markets'), 30)];
    } }
  ];
  function templateName(id) {
    return id === 'asset-classes' ? __('txtAssetClasses', 'Asset classes') : id === 'gics' ? __('txtGics', 'GICS sectors')
      : id === 'msci-regions' ? __('txtRegions', 'MSCI regions') : id === 'kommer' ? __('txtKommer', 'Kommer world portfolio') : String(id || '');
  }
  function color(nodes) {
    var i = 0;
    (function paint(list) { list.forEach(function (n) { if (!n.color) n.color = PALETTE[i % PALETTE.length]; i++; paint(n.children); }); })(nodes);
    return nodes;
  }
  function fromTemplate(id) {
    var tpl = TEMPLATES.filter(function (x) { return x.id === id; })[0];
    if (!tpl) return null;
    return { id: newId('t'), name: templateName(tpl.id), template: tpl.id, nodes: color(tpl.nodes()), assign: {} };
  }

  // ---- normalize -------------------------------------------------------------
  function cleanNodes(list, seen, count) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      var name = String(n.name == null ? '' : n.name).trim().slice(0, 80);
      if (!name || count.n >= MAX_NODES) return;
      var id = String(n.id == null ? '' : n.id).trim().slice(0, 64) || newId();
      if (seen[id]) id = newId();
      seen[id] = true; count.n++;
      var target = n.target == null || n.target === '' ? null : Math.max(0, Math.min(100, num(n.target)));
      out.push({ id: id, name: name, color: /^#[0-9a-fA-F]{3,8}$/.test(String(n.color || '')) ? n.color : PALETTE[count.n % PALETTE.length],
        target: target, children: cleanNodes(n.children, seen, count) });
    });
    return out;
  }
  function cleanTaxonomy(src) {
    if (!src || typeof src !== 'object') return null;
    var name = String(src.name == null ? '' : src.name).trim().slice(0, 80);
    if (!name) return null;
    var seen = {}, count = { n: 0 };
    var nodes = cleanNodes(src.nodes, seen, count);
    var assigned = {};
    if (src.assign && typeof src.assign === 'object') Object.keys(src.assign).forEach(function (s) {
      var k = sym(s), v = String(src.assign[s]);
      if (k && seen[v]) assigned[k] = v;
    });
    return { id: String(src.id || '').trim() || newId('t'), name: name, template: src.template ? String(src.template) : null, nodes: nodes, assign: assigned };
  }
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    var list = [], ids = {};
    ((o && Array.isArray(o.list)) ? o.list : []).forEach(function (x) {
      var c = cleanTaxonomy(x);
      if (!c) return;
      if (ids[c.id]) c.id = newId('t');
      ids[c.id] = true;
      list.push(c);
    });
    return { version: 1, list: list };
  }

  // ---- editing (pure: every function returns a new object) --------------------
  function get(state, id) { return ((state && state.list) || []).filter(function (x) { return x.id === id; })[0] || null; }
  function add(state, tax) { var s = normalize(state); var c = cleanTaxonomy(tax); if (c) s.list.push(c); return s; }
  function put(state, tax) { var s = normalize(state); var c = cleanTaxonomy(tax); s.list = s.list.map(function (x) { return c && x.id === c.id ? c : x; }); return s; }
  function remove(state, id) { var s = normalize(state); s.list = s.list.filter(function (x) { return x.id !== id; }); return s; }
  function rename(state, id, name) { var s = normalize(state); var n = String(name || '').trim(); if (n) s.list.forEach(function (x) { if (x.id === id) x.name = n.slice(0, 80); }); return s; }
  function walk(nodes, fn, parent, depth) { (nodes || []).forEach(function (n) { fn(n, parent || null, depth || 0); walk(n.children, fn, n, (depth || 0) + 1); }); }
  function findNode(tax, id) { var hit = null; walk(tax && tax.nodes, function (n) { if (n.id === id) hit = n; }); return hit; }
  function addNode(tax, parentId, name) {
    var tt = clone(tax), n = String(name || '').trim();
    if (!n) return tt;
    var count = 0; walk(tt.nodes, function () { count++; });
    if (count >= MAX_NODES) return tt;
    var node = { id: newId(), name: n.slice(0, 80), color: PALETTE[count % PALETTE.length], target: null, children: [] };
    var p = parentId ? findNode(tt, parentId) : null;
    (p ? p.children : tt.nodes).push(node);
    return tt;
  }
  function renameNode(tax, id, name) { var tt = clone(tax), n = findNode(tt, id), v = String(name || '').trim(); if (n && v) n.name = v.slice(0, 80); return tt; }
  function setTarget(tax, id, pct) {
    var tt = clone(tax), n = findNode(tt, id);
    if (n) n.target = pct == null || pct === '' ? null : Math.max(0, Math.min(100, num(pct)));
    return tt;
  }
  function removeNode(tax, id) {
    var tt = clone(tax), gone = {};
    function cut(list) {
      return list.filter(function (n) {
        if (n.id === id) { walk([n], function (x) { gone[x.id] = true; }); return false; }
        n.children = cut(n.children);
        return true;
      });
    }
    tt.nodes = cut(tt.nodes);
    Object.keys(tt.assign).forEach(function (s) { if (gone[tt.assign[s]]) delete tt.assign[s]; });
    return tt;
  }
  function assign(tax, symbol, nodeId) {
    var tt = clone(tax), k = sym(symbol);
    if (!k) return tt;
    if (nodeId && findNode(tt, nodeId)) tt.assign[k] = nodeId; else delete tt.assign[k];
    return tt;
  }

  // ---- suggestions from the app's data ---------------------------------------
  var GICS_OF = {
    'technology': 'information-technology', 'information technology': 'information-technology',
    'healthcare': 'health-care', 'health care': 'health-care',
    'financials': 'financials', 'financial services': 'financials',
    'consumer discretionary': 'consumer-discretionary', 'consumer cyclical': 'consumer-discretionary',
    'consumer staples': 'consumer-staples', 'consumer defensive': 'consumer-staples',
    'communication services': 'communication-services', 'industrials': 'industrials', 'energy': 'energy',
    'materials': 'materials', 'basic materials': 'materials', 'utilities': 'utilities', 'real estate': 'real-estate'
  };
  var REGION_OF = {
    'usa': 'north-america', 'united states': 'north-america', 'canada': 'north-america',
    'germany': 'europe', 'uk': 'europe', 'united kingdom': 'europe', 'france': 'europe', 'netherlands': 'europe', 'switzerland': 'europe',
    'italy': 'europe', 'spain': 'europe', 'sweden': 'europe', 'denmark': 'europe', 'ireland': 'europe', 'finland': 'europe', 'norway': 'europe',
    'belgium': 'europe', 'austria': 'europe', 'portugal': 'europe', 'luxembourg': 'europe', 'israel': 'europe',
    'japan': 'pacific', 'australia': 'pacific', 'hong kong': 'pacific', 'singapore': 'pacific', 'new zealand': 'pacific',
    'china': 'emerging', 'taiwan': 'emerging', 'india': 'emerging', 'south korea': 'emerging', 'korea': 'emerging', 'brazil': 'emerging',
    'mexico': 'emerging', 'south africa': 'emerging', 'indonesia': 'emerging', 'saudi arabia': 'emerging', 'thailand': 'emerging',
    'malaysia': 'emerging', 'poland': 'emerging', 'chile': 'emerging', 'turkey': 'emerging', 'united arab emirates': 'emerging'
  };
  var RE_BOND = /\b(bond|bonds|anleihe|anleihen|treasury|treasuries|govt|government|aggregate|corporate|renten?)\b/i;
  var RE_CASH = /\b(money market|geldmarkt|overnight|ester|cash)\b/i;
  var RE_COMMODITY = /\b(gold|silver|silber|commodit(y|ies)|rohstoff|physical)\b/i;
  var RE_EM = /\b(emerging|em|schwellenl[aä]nder)\b/i;
  var RE_WORLD = /\b(world|welt|global|all[- ]?world|acwi|developed|s&p|nasdaq|stoxx|europe|msci|ftse|dax)\b/i;

  function suggestOne(template, h) {
    var cat = h.category || 'crypto', name = String(h.name || ''), ft = String(h.fundType || '');
    var fund = (!!ft && ft !== 'none') || h.sector === 'ETF';
    var country = String(h.country || '').toLowerCase(), sector = String(h.sector || '').toLowerCase();
    if (template === 'asset-classes') {
      if (cat === 'crypto') return 'crypto';
      if (cat === 'commodities') return 'commodities';
      if (cat === 'stocks') {
        if (/immobilien/.test(ft)) return 'real-estate';
        if (RE_BOND.test(name)) return 'bonds';
        if (RE_CASH.test(name) && fund) return 'cash';
        if (RE_COMMODITY.test(name) && fund) return 'commodities';
        return 'equity';
      }
      return 'other';
    }
    if (cat !== 'stocks') return null;
    if (template === 'gics') return fund ? null : (GICS_OF[sector] || null);
    if (template === 'msci-regions') return fund ? null : (REGION_OF[country] || null);
    if (template === 'kommer') {
      if (fund) {
        if (RE_BOND.test(name) || RE_CASH.test(name) || RE_COMMODITY.test(name) || /immobilien/.test(ft)) return null;
        if (RE_EM.test(name)) return 'emerging';
        return RE_WORLD.test(name) ? 'developed' : null;
      }
      var r = REGION_OF[country];
      return r ? (r === 'emerging' ? 'emerging' : 'developed') : null;
    }
    return null;
  }
  // holdings: [{ symbol, category, name, fundType, sector, country }] → { SYMBOL: nodeId } (new only)
  function suggest(tax, holdings) {
    var out = {};
    if (!tax || !tax.template) return out;
    (holdings || []).forEach(function (h) {
      var k = sym(h && h.symbol);
      if (!k || tax.assign[k]) return;
      var id = suggestOne(tax.template, h);
      if (id && findNode(tax, id)) out[k] = id;
    });
    return out;
  }

  // ---- allocation and rebalancing input ----------------------------------------
  // holdings: [{ symbol, value }] → { rows: [{ id, name, color, depth, value, pct, target, leaf }], unassigned, total }
  function allocation(tax, holdings) {
    var direct = {}, total = 0, un = { value: 0, symbols: [] };
    (holdings || []).forEach(function (h) {
      var v = num(h && h.value), k = sym(h && h.symbol);
      if (!(v > 0) || !k) return;
      total += v;
      var id = tax && tax.assign[k];
      if (id && findNode(tax, id)) direct[id] = (direct[id] || 0) + v;
      else { un.value += v; un.symbols.push(k); }
    });
    var rows = [];
    function sum(n, depth) {
      var row = { id: n.id, name: n.name, color: n.color, depth: depth, value: 0, pct: 0, target: n.target, leaf: !n.children.length };
      rows.push(row);
      var v = direct[n.id] || 0;
      n.children.forEach(function (c) { v += sum(c, depth + 1); });
      row.value = v;
      row.pct = total > 0 ? v / total * 100 : 0;
      return v;
    }
    ((tax && tax.nodes) || []).forEach(function (n) { sum(n, 0); });
    un.pct = total > 0 ? un.value / total * 100 : 0;
    return { rows: rows, unassigned: un, total: total };
  }
  // The planner's input for the top level: { state: { basis, targets }, actual: [{ key, value, sellable }] }
  function planInput(tax, holdings, noSell) {
    var al = allocation(tax, holdings);
    var keep = {};
    (noSell || []).forEach(function (s) { keep[sym(s)] = true; });
    var sell = {};
    (holdings || []).forEach(function (h) {
      var k = sym(h && h.symbol), id = tax.assign[k], v = num(h && h.value);
      if (!id || keep[k] || !(v > 0)) return;
      var top = null;
      tax.nodes.forEach(function (n) { if (n.id === id || findNode({ nodes: [n] }, id)) top = n.id; });
      if (top) sell[top] = (sell[top] || 0) + v;
    });
    var targets = {};
    tax.nodes.forEach(function (n) { if (n.target > 0) targets[n.id] = n.target; });
    return {
      state: { version: 1, basis: 'category', targets: targets },
      actual: al.rows.filter(function (r) { return r.depth === 0; }).map(function (r) { return { key: r.id, value: r.value, sellable: sell[r.id] || 0 }; })
    };
  }

  // ---- JSON import / export ------------------------------------------------------
  function exportJson(tax) {
    var c = cleanTaxonomy(tax);
    return JSON.stringify({ format: FORMAT, version: 1, exported: (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO(),
      taxonomy: { name: c.name, template: c.template, nodes: c.nodes, assign: c.assign } }, null, 2);
  }
  function importJson(text) {
    var o;
    try { o = JSON.parse(String(text || '')); } catch (e) { return { ok: false, error: 'json' }; }
    if (!o || o.format !== FORMAT || o.version !== 1 || !o.taxonomy || typeof o.taxonomy !== 'object') return { ok: false, error: 'format' };
    var n = 0; (function count(list) { (Array.isArray(list) ? list : []).forEach(function (x) { n++; if (x) count(x.children); }); })(o.taxonomy.nodes);
    if (n > MAX_NODES) return { ok: false, error: 'size' };
    var c = cleanTaxonomy({ id: newId('t'), name: o.taxonomy.name, template: o.taxonomy.template, nodes: o.taxonomy.nodes, assign: o.taxonomy.assign });
    return c ? { ok: true, taxonomy: c } : { ok: false, error: 'format' };
  }

  // ---- storage (browser) -------------------------------------------------------
  // the demo keeps its taxonomies in memory and never writes the user's storage
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

  // --------------------------------------------------------------------------
  // React view: Strategy → Taxonomies
  // props: holdings [{ symbol, name, category, value, fundType, sector, country }],
  //        noSell [SYMBOL], theme, formatPrice, getCurrencySymbol
  // --------------------------------------------------------------------------
  function Panel(props) {
    var React = W.React, e = React.createElement;
    var theme = props.theme || {};
    var I = W.MaerminI18n, U = W.MaerminUtils, RB = W.MaerminRebalance;
    var fmt = props.formatPrice || function (x) { return I.num(x, 2); };
    var cur = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';
    var money = function (v) { return fmt(v) + ' ' + cur; };
    var st = React.useState(function () { return load(); }), state = st[0], setStateRaw = st[1];
    var setState = function (next) { var n = normalize(next); save(n); setStateRaw(n); };
    var sel = React.useState(function () { var l = load().list; return l.length ? l[0].id : null; }), selId = sel[0], setSelId = sel[1];
    var tpl = React.useState('asset-classes'), template = tpl[0], setTemplate = tpl[1];
    var msgS = React.useState(''), msg = msgS[0], setMsg = msgS[1];
    var fileRef = React.useRef(null);
    var tax = get(state, selId) || state.list[0] || null;
    var holdings = props.holdings || [];
    var al = React.useMemo(function () { return tax ? allocation(tax, holdings) : null; }, [tax, holdings]);
    var planned = React.useMemo(function () {
      if (!tax || !RB || !RB.plan) return null;
      var inp = planInput(tax, holdings, props.noSell);
      if (!Object.keys(inp.state.targets).length) return null;
      var p = RB.plan(inp.state, inp.actual, { mode: 'full' }), by = {};
      p.rows.forEach(function (r) { by[r.key] = r; });
      return { rows: by, sum: RB.totalTargetPct ? RB.totalTargetPct(inp.state) : null };
    }, [tax, holdings, props.noSell]);
    var update = function (nt) { setState(put(state, nt)); };

    // R5.4: shared buttons, fields and the table look; the tree indent and node colours stay inline
    var BTN = ['ui-btn', 'ui-btn--secondary', 'ui-btn--sm'].join(' ');
    var btn = function (label, onClick, extra) {
      return e('button', Object.assign({ type: 'button', onClick: onClick, className: BTN }, extra || {}), e('span', { className: 'ui-btn__label' }, label));
    };
    var iconBtn = function (label, aria, onClick, testid) {
      return e('button', { type: 'button', 'aria-label': aria, title: aria, 'data-testid': testid, onClick: onClick,
        className: ['ui-icon-btn', 'ui-icon-btn--sm'].join(' ') }, e('span', { 'aria-hidden': 'true' }, label));
    };
    var SELECT = ['ui-input', 'ui-input--sm', 'ui-select', 'ui-tx-sel'].join(' ');
    var card = function (testid, title, sub, body, right) {
      return e('section', { 'data-testid': testid, className: ['ui-card', 'ui-card--pad'].join(' ') },
        e('div', { className: 'ui-tx-head' },
          e('div', { className: 'ui-tx-head__titles' },
            e(window.MaerminComponents.Heading, { className: 'ui-card__title' }, title),
            sub && e('p', { className: 'ui-card__subtitle' }, sub)),
          right || null),
        body);
    };
    var ask = function (title, fn) {
      if (U && U.confirmThen) U.confirmThen({ title: title, confirmLabel: __('remove', 'Remove'), cancelLabel: __('cancel', 'Cancel') }, fn); else fn();
    };
    var prompt1 = function (label, value) { try { return W.prompt ? W.prompt(label, value || '') : null; } catch (err) { return null; } };

    // ---- toolbar ----
    var create = function () {
      var created = fromTemplate(template);
      if (!created) return;
      var next = add(state, created);
      setState(next);
      setSelId(next.list[next.list.length - 1].id);
      setMsg('');
    };
    var doExport = function () {
      if (!tax) return;
      var blob = new Blob([exportJson(tax)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'maermin-taxonomy-' + tax.name.replace(/[^\w-]+/g, '-').toLowerCase() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    var doImport = function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      if (f.size > 1000000) { setMsg(__('txImportBad', 'This file is not a MAERMIN taxonomy.')); return; }
      f.text().then(function (txt) {
        var r = importJson(txt);
        if (!r.ok) { setMsg(__('txImportBad', 'This file is not a MAERMIN taxonomy.')); return; }
        var next = add(state, r.taxonomy);
        setState(next);
        setSelId(next.list[next.list.length - 1].id);
        setMsg(__('txImported', 'Imported "{name}".', { name: r.taxonomy.name }));
      });
    };
    var toolbar = e('div', { className: 'ui-tx-bar' },
      state.list.length > 0 && e('select', { 'data-testid': 'tx-select', 'aria-label': __('txChoose', 'Taxonomy'), value: tax ? tax.id : '', onChange: function (ev) { setSelId(ev.target.value); }, className: SELECT },
        state.list.map(function (x) { return e('option', { key: x.id, value: x.id }, x.name); })),
      e('select', { 'data-testid': 'tx-template', 'aria-label': __('txTemplate', 'Template'), value: template, onChange: function (ev) { setTemplate(ev.target.value); }, className: SELECT },
        TEMPLATES.map(function (x) { return e('option', { key: x.id, value: x.id }, templateName(x.id)); })),
      btn(__('txCreate', '+ New from template'), create, { 'data-testid': 'tx-create' }),
      btn(__('txImport', 'Import JSON'), function () { if (fileRef.current) fileRef.current.click(); }, { 'data-testid': 'tx-import' }),
      e('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', 'data-testid': 'tx-file', onChange: doImport, hidden: true }),
      tax && btn(__('txExport', 'Export JSON'), doExport, { 'data-testid': 'tx-export' }),
      tax && btn(__('txRename', 'Rename'), function () { var n = prompt1(__('txRenamePrompt', 'New name'), tax.name); if (n) setState(rename(state, tax.id, n)); }),
      tax && btn(__('txDelete', 'Delete'), function () { ask(__('txDeleteTitle', 'Delete the taxonomy "{name}"?', { name: tax.name }), function () { var next = remove(state, tax.id); setState(next); setSelId(next.list[0] ? next.list[0].id : null); }); }, { 'data-testid': 'tx-delete' }));
    var msgEl = msg ? e('p', { role: 'status', className: 'ui-muted' }, msg) : null;

    if (!tax) {
      return e('div', { 'data-testid': 'taxonomies', className: 'ui-stack' },
        card('tx-intro', __('txTitle', 'Taxonomies'), __('txIntro', 'Your own classification trees on top of asset classes, categories and tags - for example asset classes, GICS sectors, MSCI regions or the Kommer world portfolio. Start from a template or import a JSON file.'), e('div', { className: 'ui-tx-body' }, toolbar, msgEl)));
    }

    // ---- tree ----
    var th = function (label, i, left) { return e('th', { key: i, scope: 'col', className: left ? 'is-left' : undefined }, label || e('span', { className: 'sr-only' }, __('uiRowActions', 'Actions'))); };
    var targetInput = function (r) {
      return e('input', { key: r.id + ':' + r.target, type: 'text', inputMode: 'decimal', 'data-testid': 'tx-target-' + r.id, 'aria-label': __('txTargetAria', 'Target for {name} in %', { name: r.name }),
        defaultValue: r.target == null ? '' : I.num(r.target, { min: 0, max: 2 }),
        onBlur: function (ev) { var raw = ev.target.value.trim(); var v = raw === '' ? null : (U && U.parseDecimal ? U.parseDecimal(raw) : parseFloat(raw)); if (raw === '' || isFinite(v)) update(setTarget(tax, r.id, raw === '' ? null : v)); },
        onKeyDown: function (ev) { if (ev.key === 'Enter') ev.target.blur(); },
        className: ['ui-input', 'ui-input--sm', 'ui-tx-pct'].join(' ') });
    };
    var actionOf = function (r) {
      var p = planned && r.depth === 0 ? planned.rows[r.id] : null;
      if (!p || !p.action || p.action === 'hold' || !p.deltaValue) return e('span', { className: 'is-dim' }, p ? __('txHold', 'hold') : '');
      var buy = p.deltaValue > 0;
      return e('b', { 'data-action': buy ? 'buy' : 'sell', 'data-v': p.deltaValue, className: buy ? 'tone-gain' : 'tone-loss' },
        (buy ? '▲ ' + __('txBuy', 'buy {amount}', { amount: money(p.deltaValue) }) : '▼ ' + __('txSell', 'sell {amount}', { amount: money(-p.deltaValue) })));
    };
    var treeRows = al.rows.map(function (r) {
      return e('tr', { key: r.id, 'data-node': r.id, 'data-v': r.value, 'data-pct': r.pct, className: r.depth === 0 ? 'is-top' : undefined },
        e('th', { scope: 'row', className: ['is-left', 'ui-tx-node'].join(' '), style: { paddingLeft: (0.5 + r.depth * 1.1) + 'rem' } },
          e('span', { 'aria-hidden': true, className: 'ui-cat-dot', style: { background: r.color } }), r.name),
        e('td', { className: 'num' }, money(r.value)),
        e('td', { className: ['num', 'is-strong'].join(' ') }, I.pct(r.pct, 1)),
        e('td', null, r.depth === 0 ? targetInput(r) : ''),
        e('td', null, actionOf(r)),
        e('td', { className: 'ui-tx-acts' },
          iconBtn('+', __('txAddChild', 'Add a node under {name}', { name: r.name }), function () { var n = prompt1(__('txNodePrompt', 'Name of the new node'), ''); if (n) update(addNode(tax, r.id, n)); }, 'tx-add-' + r.id),
          iconBtn('✎', __('txRenameNode', 'Rename {name}', { name: r.name }), function () { var n = prompt1(__('txRenamePrompt', 'New name'), r.name); if (n) update(renameNode(tax, r.id, n)); }),
          iconBtn('×', __('txRemoveNode', 'Remove {name}', { name: r.name }), function () { ask(__('txRemoveNodeTitle', 'Remove "{name}" and everything below it?', { name: r.name }), function () { update(removeNode(tax, r.id)); }); }, 'tx-remove-' + r.id)));
    });
    treeRows.push(e('tr', { key: '__un', 'data-node': 'unassigned', 'data-v': al.unassigned.value, className: 'is-off' },
      e('th', { scope: 'row', className: ['is-left', 'ui-tx-node', 'is-dim'].join(' ') }, __('txUnassigned', 'Not assigned')),
      e('td', { className: 'num' }, money(al.unassigned.value)),
      e('td', { className: 'num' }, I.pct(al.unassigned.pct, 1)),
      e('td', null), e('td', null), e('td', null)));
    var sumT = planned && planned.sum;
    var sumOk = sumT != null && Math.abs(sumT - 100) < 0.01;
    var tree = e('div', { className: 'ui-tx-body' },
      e('div', { className: 'ui-table-wrap' },
        e('table', { className: ['ui-table', 'ui-table--dense', 'ui-tx-table'].join(' ') },
          e('thead', null, e('tr', null, th(__('txNode', 'Node'), 0, true), th(__('txValue', 'Value'), 1), th(__('txShare', 'Share'), 2), th(__('txTarget', 'Target %'), 3), th(__('txAction', 'To rebalance'), 4), th('', 5))),
          e('tbody', null, treeRows))),
      e('div', { className: 'ui-tx-bar' },
        btn(__('txAddTop', '+ Top-level node'), function () { var n = prompt1(__('txNodePrompt', 'Name of the new node'), ''); if (n) update(addNode(tax, null, n)); }, { 'data-testid': 'tx-add-top' }),
        sumT != null && e('span', { 'data-testid': 'tx-target-sum', className: ['ui-note', 'ui-note--flush', sumOk ? '' : 'tone-loss'].join(' ').trim() },
          (sumOk ? '✓ ' : '! ') + __('txTargetSum', 'Targets add up to {pct}.', { pct: I.pct(sumT, 1) }) + (sumOk ? '' : ' ' + __('txTargetSumHint', 'Set them to 100 % for a full plan.')))));

    // ---- assignments ----
    var flat = [];
    walk(tax.nodes, function (n, p, d) { flat.push({ id: n.id, label: new Array(d + 1).join('  ') + (d ? '└ ' : '') + n.name }); });
    var sugg = suggest(tax, holdings);
    var nSugg = Object.keys(sugg).length;
    var assignRows = holdings.filter(function (h) { return num(h.value) > 0; }).slice().sort(function (a, b) { return b.value - a.value; }).map(function (h) {
      var k = sym(h.symbol);
      return e('tr', { key: k, 'data-symbol': k },
        e('th', { scope: 'row', className: ['is-left', 'ui-tx-hold'].join(' ') }, h.symbol,
          h.name && h.name !== h.symbol ? e('span', { className: 'ui-tcell__sub' }, h.name) : null),
        e('td', { className: ['num', 'is-dim'].join(' ') }, money(h.value)),
        e('td', { className: 'is-left' },
          e('select', { 'data-testid': 'tx-assign-' + k, 'aria-label': __('txAssignAria', 'Node of {sym}', { sym: h.symbol }), value: tax.assign[k] || '', onChange: function (ev) { update(assign(tax, k, ev.target.value || null)); }, className: SELECT },
            e('option', { value: '' }, __('txUnassigned', 'Not assigned')),
            flat.map(function (n) { return e('option', { key: n.id, value: n.id }, n.label); }))));
    });
    var assignCard = card('tx-assign', __('txAssignTitle', 'Assign holdings'),
      __('txAssignSub', 'Each holding belongs to one node. "Fill from data" proposes nodes from the asset class, fund type and name, sector and country the app knows - it never changes an assignment you made.'),
      e('div', { className: ['ui-table-wrap', 'ui-table--tall'].join(' ') },
        e('table', { className: ['ui-table', 'ui-table--dense', 'ui-tx-table'].join(' ') },
          e('thead', null, e('tr', null, th(__('txHolding', 'Holding'), 0, true), th(__('txValue', 'Value'), 1), th(__('txNode', 'Node'), 2, true))),
          e('tbody', null, assignRows))),
      tax.template ? btn(nSugg ? __('txFill', 'Fill from data ({n})', { n: nSugg }) : __('txFillNone', 'Nothing to fill'), function () {
        var nt = tax; Object.keys(sugg).forEach(function (k) { nt = assign(nt, k, sugg[k]); }); update(nt);
      }, { 'data-testid': 'tx-fill', disabled: !nSugg }) : null);

    return e('div', { 'data-testid': 'taxonomies', className: 'ui-stack' },
      card('tx-tree', tax.name, (tax.template ? __('txFromTemplate', 'From the template "{name}".', { name: templateName(tax.template) }) + ' ' : '')
        + __('txTreeSub', 'Values at today\'s prices; a node adds up everything below it. Targets on the top level feed the rebalancing plan (tolerance ±5 percentage points).'),
        e('div', { className: 'ui-tx-body' }, toolbar, msgEl, tree)),
      assignCard);
  }

  var api = {
    Panel: Panel, templateName: templateName,
    STORAGE_KEY: STORAGE_KEY, FORMAT: FORMAT, TEMPLATES: TEMPLATES, normalize: normalize, fromTemplate: fromTemplate,
    add: add, put: put, remove: remove, rename: rename, get: get, addNode: addNode, renameNode: renameNode, removeNode: removeNode,
    setTarget: setTarget, findNode: findNode, assign: assign, suggest: suggest, allocation: allocation, planInput: planInput,
    exportJson: exportJson, importJson: importJson, load: load, save: save
  };
  if (typeof window !== 'undefined') window.MaerminTaxonomies = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
