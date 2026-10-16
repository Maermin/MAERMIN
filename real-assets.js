// ============================================================================
// MAERMIN — Real Assets & Property with Cashflows  (window.MaerminRealAssets)
// ----------------------------------------------------------------------------
// Competitive-gap WI-1. Net Worth so far knew real estate / valuables only as a
// single static number. This module models them as first-class assets with a
// valuation history, acquisition cost + fees, optional financing link to a
// Net-Worth liability account, and recurring/one-off cashflows (rent, running
// cost, renovation). All amounts are stored in the asset's own currency and
// converted to EUR at compute time via MaerminUtils.toEUR — EUR is canonical.
//
// Persisted (key 'maermin_real_assets', carried in the full-vault backup). Shape:
//
//   { version: 1, assets: [ {
//       id, name, kind,                 // kind: real_estate|vehicle|watch|collectible|other
//       currency,                       // EUR|USD (converted to EUR on read)
//       valuations: [{ date, value }],  // history; latest by date = current value
//       acquisitionCost, acquisitionFees,
//       financingAccountId,             // optional link to a maermin_networth_accounts liability
//       cashflows: [{ date, type, amount, recurring, intervalMonths }],
//       imageDataUrl, note
//   } ] }
//
// The pure layer (load/normalize/compute/describe) is dual-exported and unit-
// tested headlessly in test/real-assets.test.js. The React view is attached
// below and only runs in the browser.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_real_assets';
  var SCHEMA = 1;

  var KINDS = {
    real_estate:  { get label() { return __('nwProperty', 'Real Estate'); }, icon: '◉' },
    vehicle:      { get label() { return __('raVehicle', 'Vehicle'); }, icon: '◐' },
    watch:        { get label() { return __('raWatch', 'Watch'); }, icon: '◍' },
    collectible:  { get label() { return __('raCollectible', 'Collectible'); }, icon: '◇' },
    // P5-3.11: alternative assets (see TEMPLATES below)
    art:            { get label() { return __('raArt', 'Art'); }, icon: '◈' },
    p2p_loan:       { get label() { return __('raP2p', 'P2P loans'); }, icon: '⇄' },
    life_insurance: { get label() { return __('raLifeIns', 'Life insurance'); }, icon: '☂' },
    startup:        { get label() { return __('raStartup', 'Startup stake'); }, icon: '△' },
    other:        { get label() { return __('secOther', 'Other'); }, icon: '◌' }
  };

  // Cashflow types and their sign for cumulative net cashflow / yield math.
  // Income adds, costs subtract; 'other' takes the amount's own sign.
  var CASHFLOW_TYPES = {
    rental_income: { get label() { return __('raRental', 'Rental income'); }, sign: 1,  income: true },
    running_cost:  { get label() { return __('raRunning', 'Running cost'); }, sign: -1, income: false },
    renovation:    { get label() { return __('raRenovation', 'Renovation'); }, sign: -1, income: false },
    // P5-3.11: interest of a P2P loan, premium of a life insurance
    interest_income: { get label() { return __('raInterestIncome', 'Interest income'); }, sign: 1, income: true },
    premium:       { get label() { return __('raPremium', 'Premium'); }, sign: -1, income: false },
    other:         { get label() { return __('secOther', 'Other'); }, sign: 1,  income: false }
  };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function str(v) { return String(v == null ? '' : v).trim(); }
  function uid() { return 'ra' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // "12.500" / "12,500" / "7,5" / "7.5" -> number (NaN when empty)
  function amount(v) {
    if (typeof v === 'number') return v;
    var s = str(v).replace(/\s|%|€/g, '');
    if (!s) return NaN;
    var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c !== -1 && d !== -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c !== -1) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return parseFloat(s);
  }
  function isoDate(v) { var s = str(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
  function addMonths(iso, n) {
    var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + n, d = Number(iso.slice(8, 10));
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
  }

  // ---- P5-3.11: templates for alternative assets ------------------------------------
  // Each template fills the existing model (valuations, cost, cash flows) and
  // keeps its own fields in asset.details (only the listed keys survive).
  // fields: { key, type: 'text'|'number'|'date', req? }
  var TEMPLATES = [
    { id: 'art', kind: 'art', details: ['appraisalDate'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'appraisal', type: 'number', req: true }, { key: 'appraisalDate', type: 'date' },
        { key: 'purchasePrice', type: 'number' }, { key: 'purchaseDate', type: 'date' }, { key: 'insuranceYear', type: 'number' }] },
    { id: 'p2p_loan', kind: 'p2p_loan', details: ['platform', 'ratePct', 'termMonths', 'maturity'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'platform', type: 'text' }, { key: 'principal', type: 'number', req: true },
        { key: 'ratePct', type: 'number' }, { key: 'startDate', type: 'date' }, { key: 'termMonths', type: 'number' }] },
    { id: 'life_insurance', kind: 'life_insurance', details: ['maturity', 'guaranteedPct'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'surrenderValue', type: 'number', req: true }, { key: 'valueDate', type: 'date' },
        { key: 'premiumMonthly', type: 'number' }, { key: 'maturity', type: 'date' }, { key: 'guaranteedPct', type: 'number' }] },
    { id: 'vehicle', kind: 'vehicle', details: ['depreciationPct'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'purchasePrice', type: 'number', req: true }, { key: 'purchaseDate', type: 'date' },
        { key: 'depreciationPct', type: 'number' }] },
    { id: 'startup', kind: 'startup', details: ['shares', 'roundPrice', 'roundDate'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'shares', type: 'number', req: true }, { key: 'roundPrice', type: 'number', req: true },
        { key: 'roundDate', type: 'date' }, { key: 'invested', type: 'number' }, { key: 'investDate', type: 'date' }] },
    { id: 'collectible', kind: 'collectible', details: ['estimateDate'],
      fields: [{ key: 'name', type: 'text', req: true }, { key: 'estimate', type: 'number', req: true }, { key: 'estimateDate', type: 'date' },
        { key: 'purchasePrice', type: 'number' }, { key: 'purchaseDate', type: 'date' }, { key: 'insuranceYear', type: 'number' }] }
  ];
  var TEMPLATE_BY_KIND = {};
  TEMPLATES.forEach(function (t0) { TEMPLATE_BY_KIND[t0.kind] = t0; });
  function fieldLabel(key) {
    return ({
      name: __('raName', 'Name'), appraisal: __('raTplAppraisal', 'Appraised value'), appraisalDate: __('raTplAppraisalDate', 'Appraisal date'),
      purchasePrice: __('raCost', 'Purchase price'), purchaseDate: __('raTplPurchaseDate', 'Purchase date'), insuranceYear: __('raTplInsurance', 'Insurance / year'),
      platform: __('raTplPlatform', 'Platform'), principal: __('raTplPrincipal', 'Outstanding principal'), ratePct: __('raTplRate', 'Interest % p.a.'),
      startDate: __('raTplStart', 'Start date'), termMonths: __('raTplTerm', 'Term (months)'), surrenderValue: __('raTplSurrender', 'Surrender value'),
      valueDate: __('raTplValueDate', 'Value date'), premiumMonthly: __('raTplPremium', 'Premium / month'), maturity: __('raTplMaturity', 'Maturity'),
      guaranteedPct: __('raTplGuaranteed', 'Guaranteed rate %'), depreciationPct: __('raTplDepreciation', 'Depreciation % / year'),
      shares: __('raTplShares', 'Shares'), roundPrice: __('raTplRoundPrice', 'Price per share (last round)'), roundDate: __('raTplRoundDate', 'Round date'),
      invested: __('raTplInvested', 'Amount invested'), investDate: __('raTplInvestDate', 'Investment date'),
      estimate: __('raTplEstimate', 'Estimated value'), estimateDate: __('raTplEstimateDate', 'Estimate date')
    })[key] || key;
  }
  function templateLabel(id) {
    return ({ art: __('raArt', 'Art'), p2p_loan: __('raP2p', 'P2P loans'), life_insurance: __('raLifeIns', 'Life insurance'),
      vehicle: __('raVehicle', 'Vehicle'), startup: __('raStartup', 'Startup stake'), collectible: __('raCollectible', 'Collectible') })[id] || id;
  }

  // Build an asset from a template form (text values as typed). null when
  // the template is unknown or a required field is missing.
  function fromTemplate(id, form, today) {
    var tpl = TEMPLATES.filter(function (t0) { return t0.id === id; })[0];
    form = form || {};
    today = isoDate(today) || new Date().toISOString().slice(0, 10);
    if (!tpl || !str(form.name)) return null;
    var n = function (k) { return amount(form[k]); }, d = function (k, dflt) { return isoDate(form[k]) || dflt; };
    var bad = tpl.fields.some(function (f) { return f.req && f.type === 'number' && !(n(f.key) > 0); });
    if (bad) return null;
    var vals = [], flows = [], details = {}, cost = 0;
    var purchase = function () {
      if (n('purchasePrice') > 0) { cost = n('purchasePrice'); vals.push({ date: d('purchaseDate', today), value: cost }); }
    };
    var insurance = function () {
      if (n('insuranceYear') > 0) flows.push({ date: today, type: 'running_cost', amount: n('insuranceYear'), recurring: true, intervalMonths: 12 });
    };
    if (id === 'art') {
      purchase(); vals.push({ date: d('appraisalDate', today), value: n('appraisal') }); insurance();
      details.appraisalDate = d('appraisalDate', today);
    } else if (id === 'collectible') {
      purchase(); vals.push({ date: d('estimateDate', today), value: n('estimate') }); insurance();
      details.estimateDate = d('estimateDate', today);
    } else if (id === 'p2p_loan') {
      var start = d('startDate', today), rate = n('ratePct') > 0 ? n('ratePct') : 0, term = Math.round(n('termMonths'));
      cost = n('principal'); vals.push({ date: start, value: cost });
      if (rate > 0) flows.push({ date: start, type: 'interest_income', amount: Math.round(cost * rate / 100 / 12 * 100) / 100, recurring: true, intervalMonths: 1 });
      details.platform = str(form.platform); details.ratePct = rate;
      if (term > 0) { details.termMonths = term; details.maturity = addMonths(start, term); }
    } else if (id === 'life_insurance') {
      vals.push({ date: d('valueDate', today), value: n('surrenderValue') });
      if (n('premiumMonthly') > 0) flows.push({ date: today, type: 'premium', amount: n('premiumMonthly'), recurring: true, intervalMonths: 1 });
      if (isoDate(form.maturity)) details.maturity = isoDate(form.maturity);
      if (n('guaranteedPct') >= 0) details.guaranteedPct = n('guaranteedPct');
    } else if (id === 'vehicle') {
      purchase();
      if (n('depreciationPct') > 0 && n('depreciationPct') < 100) details.depreciationPct = n('depreciationPct') / 100;
    } else if (id === 'startup') {
      if (n('invested') > 0) { cost = n('invested'); vals.push({ date: d('investDate', today), value: cost }); }
      vals.push({ date: d('roundDate', today), value: Math.round(n('shares') * n('roundPrice') * 100) / 100 });
      details.shares = n('shares'); details.roundPrice = n('roundPrice'); details.roundDate = d('roundDate', today);
    }
    return normalizeAsset({ name: form.name, kind: tpl.kind, currency: form.currency, valuations: vals, acquisitionCost: cost,
      cashflows: flows, details: details, note: form.note });
  }
  function cleanDetails(kind, raw) {
    var tpl = TEMPLATE_BY_KIND[kind];
    if (!tpl || !raw || typeof raw !== 'object') return undefined;
    var out = {}, any = false;
    tpl.details.forEach(function (k) {
      var v = raw[k];
      if (v == null || v === '') return;
      out[k] = (typeof v === 'number' || k === 'platform' || /Date$|^maturity$/.test(k)) ? v : str(v);
      any = true;
    });
    return any ? out : undefined;
  }

  function normValuation(v) {
    if (!v || typeof v !== 'object') return null;
    var date = str(v.date);
    if (!date) return null;
    return { date: date, value: num(v.value) };
  }

  function normCashflow(c) {
    if (!c || typeof c !== 'object') return null;
    var date = str(c.date);
    if (!date) return null;
    var type = CASHFLOW_TYPES[c.type] ? c.type : 'other';
    var recurring = c.recurring === true;
    var interval = Math.max(1, Math.round(num(c.intervalMonths) || 1));
    return {
      date: date, type: type, amount: num(c.amount),
      recurring: recurring, intervalMonths: recurring ? interval : 1
    };
  }

  function normalizeAsset(a) {
    if (!a || typeof a !== 'object') return null;
    var name = str(a.name);
    if (!name) return null;
    var kind = KINDS[a.kind] ? a.kind : 'other';
    var currency = (str(a.currency).toUpperCase() === 'USD') ? 'USD' : 'EUR';
    var valuations = (Array.isArray(a.valuations) ? a.valuations : [])
      .map(normValuation).filter(Boolean)
      .sort(function (x, y) { return x.date < y.date ? -1 : (x.date > y.date ? 1 : 0); });
    var cashflows = (Array.isArray(a.cashflows) ? a.cashflows : [])
      .map(normCashflow).filter(Boolean);
    var out = {
      id: a.id ? str(a.id) : uid(),
      name: name,
      kind: kind,
      currency: currency,
      valuations: valuations,
      acquisitionCost: num(a.acquisitionCost),
      acquisitionFees: num(a.acquisitionFees),
      financingAccountId: a.financingAccountId ? str(a.financingAccountId) : null,
      cashflows: cashflows,
      imageDataUrl: typeof a.imageDataUrl === 'string' ? a.imageDataUrl : null,
      note: str(a.note)
    };
    var details = cleanDetails(kind, a.details);
    if (details) out.details = details;
    return out;
  }

  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.assets) ? obj.assets : (Array.isArray(obj) ? obj : []);
    var assets = [];
    list.forEach(function (a) { var n = normalizeAsset(a); if (n) assets.push(n); });
    return { version: SCHEMA, assets: assets };
  }

  // ---- pure compute ---------------------------------------------------------

  // Current (latest) valuation of an asset, in EUR. P5-3.11: an asset with a
  // yearly depreciation (vehicle template) loses that share per year from its
  // latest valuation on or before asOf (default today); a newer manual
  // valuation is the new base.
  function currentValue(asset, usdToEur, asOf) {
    if (!asset || !asset.valuations || !asset.valuations.length) return 0;
    var latest = asset.valuations[asset.valuations.length - 1];
    var dep = asset.details && num(asset.details.depreciationPct);
    if (dep > 0 && dep < 1) {
      var day = isoDate(asOf) || new Date().toISOString().slice(0, 10);
      var base = null;
      asset.valuations.forEach(function (v) { if (v.date <= day) base = v; });
      base = base || asset.valuations[0];
      var years = Math.max(0, (Date.parse(day + 'T00:00:00Z') - Date.parse(base.date + 'T00:00:00Z')) / 864e5 / 365);
      return toEUR(base.value * Math.pow(1 - dep, years), asset.currency, usdToEur);
    }
    return toEUR(latest.value, asset.currency, usdToEur);
  }

  function toEUR(amount, currency, usdToEur) {
    if (typeof window !== 'undefined' && window.MaerminUtils && window.MaerminUtils.toEUR) {
      return window.MaerminUtils.toEUR(amount, currency, usdToEur);
    }
    var a = num(amount);
    return (currency === 'USD' && usdToEur > 0) ? a * usdToEur : a;
  }

  // Outstanding debt of the linked financing account (a Net-Worth liability), EUR.
  // Accounts are the maermin_networth_accounts rows; value is treated as the
  // outstanding balance. Returns 0 when no financing is linked / found.
  function financingBalance(asset, accounts, usdToEur) {
    if (!asset || !asset.financingAccountId || !Array.isArray(accounts)) return 0;
    var acc = null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i] && str(accounts[i].id) === asset.financingAccountId) { acc = accounts[i]; break; }
    }
    if (!acc) return 0;
    return toEUR(acc.value, acc.currency || 'EUR', usdToEur);
  }

  // Net value = current value minus outstanding financing on the linked loan.
  function netValue(asset, accounts, usdToEur) {
    return currentValue(asset, usdToEur) - financingBalance(asset, accounts, usdToEur);
  }

  // Annualised cashflow for a predicate over CASHFLOW_TYPES. A recurring entry
  // contributes amount * (12 / intervalMonths); a one-off contributes its amount
  // once (already an annual figure for yield purposes).
  function annualizedCashflow(asset, predicate, usdToEur) {
    if (!asset || !asset.cashflows) return 0;
    var sum = 0;
    asset.cashflows.forEach(function (c) {
      var spec = CASHFLOW_TYPES[c.type];
      if (!spec || !predicate(spec, c)) return;
      var amt = toEUR(c.amount, asset.currency, usdToEur);
      sum += c.recurring ? amt * (12 / c.intervalMonths) : amt;
    });
    return sum;
  }

  function annualIncome(asset, usdToEur) {
    return annualizedCashflow(asset, function (s) { return s.income; }, usdToEur);
  }
  function annualCost(asset, usdToEur) {
    return annualizedCashflow(asset, function (s) { return !s.income && s.sign < 0; }, usdToEur);
  }

  // Net rental yield = (annual income - annual running cost) / current value.
  function netYield(asset, usdToEur) {
    var cv = currentValue(asset, usdToEur);
    if (cv <= 0) return 0;
    return (annualIncome(asset, usdToEur) - annualCost(asset, usdToEur)) / cv;
  }

  // Cumulative net cashflow to date (signed), EUR — every entry counts once.
  function cumulativeCashflow(asset, usdToEur) {
    if (!asset || !asset.cashflows) return 0;
    var sum = 0;
    asset.cashflows.forEach(function (c) {
      var spec = CASHFLOW_TYPES[c.type] || CASHFLOW_TYPES.other;
      sum += toEUR(c.amount, asset.currency, usdToEur) * spec.sign;
    });
    return sum;
  }

  // Total return vs total cost (price + acquisition fees), in EUR + percent.
  function totalReturn(asset, usdToEur) {
    var cost = toEUR(asset.acquisitionCost, asset.currency, usdToEur)
             + toEUR(asset.acquisitionFees, asset.currency, usdToEur);
    var end = currentValue(asset, usdToEur) + cumulativeCashflow(asset, usdToEur);
    var abs = end - cost;
    return { cost: cost, endValue: end, absolute: abs, percent: cost > 0 ? (abs / cost) * 100 : 0 };
  }

  // Valuation series (ascending) for charting, values in EUR.
  function valueSeries(asset, usdToEur) {
    if (!asset || !asset.valuations) return [];
    return asset.valuations.map(function (v) {
      return { date: v.date, value: toEUR(v.value, asset.currency, usdToEur) };
    });
  }

  // Portfolio-level aggregate across all real assets.
  function aggregate(state, accounts, usdToEur) {
    state = normalize(state);
    var grossValue = 0, debt = 0, net = 0, income = 0;
    state.assets.forEach(function (a) {
      grossValue += currentValue(a, usdToEur);
      debt += financingBalance(a, accounts, usdToEur);
      net += netValue(a, accounts, usdToEur);
      income += annualIncome(a, usdToEur);
    });
    return { count: state.assets.length, grossValue: grossValue, financingDebt: debt, netValue: net, annualIncome: income };
  }

  function describe(asset) {
    var k = KINDS[asset && asset.kind] || KINDS.other;
    return (asset && asset.name ? asset.name : __('colAsset', 'Asset')) + ' (' + k.label + ')';
  }

  // ---- CRUD on state --------------------------------------------------------
  function addAsset(state, asset) {
    state = normalize(state);
    var n = normalizeAsset(Object.assign({ id: uid() }, asset));
    if (n) state.assets.push(n);
    return state;
  }
  function removeAsset(state, id) {
    state = normalize(state);
    state.assets = state.assets.filter(function (a) { return a.id !== id; });
    return state;
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, assets: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); } catch (e) { return { version: SCHEMA, assets: [] }; }
  }
  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, KINDS: KINDS, CASHFLOW_TYPES: CASHFLOW_TYPES,
    TEMPLATES: TEMPLATES, fromTemplate: fromTemplate, fieldLabel: fieldLabel, templateLabel: templateLabel,
    normalize: normalize,
    currentValue: currentValue, financingBalance: financingBalance, netValue: netValue,
    annualIncome: annualIncome, annualCost: annualCost, netYield: netYield,
    cumulativeCashflow: cumulativeCashflow, totalReturn: totalReturn, valueSeries: valueSeries,
    aggregate: aggregate, describe: describe,
    addAsset: addAsset, removeAsset: removeAsset,
    load: load, save: save
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminRealAssets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view factory — a section folded into the Net Worth view (no new tab).
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      var useState = React.useState;
      try {
        var theme = props.theme || {};
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        var accounts = props.accounts || [];
        var rate = props.usdToEur || (props.prices && props.prices.usdToEur) || 1;
        var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
        var sym = (props.getCurrencySymbol ? props.getCurrencySymbol() : '');
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f', inputBg = theme.inputBg || '#0c1018';
        var inputBorder = theme.inputBorder || border, accent = theme.accent || '#8b7cff';
        var up = theme.success || '#22c55e', down = theme.danger || '#ef4444';

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var sa = useState(false); var showAdd = sa[0], setShowAdd = sa[1];
        var blank = { name: '', kind: 'real_estate', currency: 'EUR', value: '', acquisitionCost: '',
          acquisitionFees: '', financingAccountId: '', rentMonthly: '', costMonthly: '', note: '', template: '' };
        var er = useState(''); var tplError = er[0], setTplError = er[1];
        var f0 = useState(function () { return Object.assign({}, blank); });
        var form = f0[0], setForm = f0[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); if (props.onChange) props.onChange(API.normalize(next)); }
        if (window.MaerminTrash) window.MaerminTrash.useReload(STORAGE_KEY, function () { var n = API.load(); setSt(n); if (props.onChange) props.onChange(n); });
        function setF(patch) { setForm(Object.assign({}, form, patch)); }

        function addCurrent() {
          var today = (window.MaerminUtils && window.MaerminUtils.todayISO) ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10);
          // P5-3.11: a template builds the asset from its own fields
          if (form.template) {
            var built = API.fromTemplate(form.template, form, today);
            if (!built) { setTplError(__('raTplMissing', 'Fill in the name and the fields marked *.')); return; }
            mutate(API.addAsset(st, built));
            setTplError(''); setForm(Object.assign({}, blank)); setShowAdd(false);
            return;
          }
          if (!form.name) return;
          var cashflows = [];
          if (parseFloat(form.rentMonthly) > 0) cashflows.push({ date: today, type: 'rental_income', amount: parseFloat(form.rentMonthly), recurring: true, intervalMonths: 1 });
          if (parseFloat(form.costMonthly) > 0) cashflows.push({ date: today, type: 'running_cost', amount: parseFloat(form.costMonthly), recurring: true, intervalMonths: 1 });
          var asset = {
            name: form.name, kind: form.kind, currency: form.currency,
            valuations: [{ date: today, value: parseFloat(form.value) || 0 }],
            acquisitionCost: parseFloat(form.acquisitionCost) || 0,
            acquisitionFees: parseFloat(form.acquisitionFees) || 0,
            financingAccountId: form.financingAccountId || null,
            cashflows: cashflows, note: form.note
          };
          mutate(API.addAsset(st, asset));
          setForm(Object.assign({}, blank));
          setShowAdd(false);
        }

        var agg = API.aggregate(st, accounts, rate);
        var liabilityAccounts = accounts.filter(function (a) {
          return a && (a.type === 'loan' || a.type === 'credit' || a.type === 'other_liability');
        });

        function label(s) { return e('label', { style: { display: 'block', color: dim, fontSize: '0.7rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, s); }
        function inp(field, p) {
          p = p || {};
          return e('input', Object.assign({
            value: form[field], onChange: function (ev) { setF((function () { var o = {}; o[field] = ev.target.value; return o; })()); },
            style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }
          }, p));
        }

        var rows = st.assets.map(function (a) {
          var k = API.KINDS[a.kind] || API.KINDS.other;
          var cv = API.currentValue(a, rate);
          var nv = API.netValue(a, accounts, rate);
          var ny = API.netYield(a, rate);
          var tr = API.totalReturn(a, rate);
          return e('div', { key: a.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: inputBg, borderRadius: '8px', marginBottom: '0.5rem' } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 } },
              e('span', { style: { color: accent, fontSize: '0.95rem' } }, k.icon),
              e('div', { style: { minWidth: 0 } },
                e('div', { style: { color: text, fontWeight: 600, fontSize: '0.875rem' } }, a.name),
                e('div', { style: { color: dim, fontSize: '0.72rem' } },
                  k.label + (ny ? '  ·  ' + (t.raNetYield || 'Net yield') + ' ' + window.MaerminI18n.pct(ny * 100, 1) : '') +
                  '  ·  ' + (t.raTotalReturn || 'Total return') + ' ' + window.MaerminI18n.pct(tr.percent, 1, true)))),
            e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
              e('div', { style: { textAlign: 'right' } },
                e('div', { style: { color: up, fontWeight: 700, fontSize: '0.9rem' } }, fmt(nv) + ' ' + sym),
                a.financingAccountId ? e('div', { style: { color: dim, fontSize: '0.7rem' } }, (t.raGross || 'Gross') + ' ' + fmt(cv) + ' ' + sym) : null),
              e('button', { onClick: function () {
                  window.MaerminUtils.confirmThen({
                    title: (t.raRemoveTitle || 'Remove "{name}"?').replace('{name}', a.name),
                    message: t.raRemoveMessage || 'Its value, cash flows and history leave your net worth. It stays in the trash for 30 days.',
                    confirmLabel: t.remove || 'Remove', cancelLabel: t.cancel || 'Cancel'
                  }, function () {
                    mutate(API.removeAsset(st, a.id));
                    if (window.MaerminTrash) window.MaerminTrash.trashed('realAsset', a.name, a);
                  });
                },
                'aria-label': (t.raRemoveAria || 'Remove {name}').replace('{name}', a.name),
                style: { background: 'none', border: 'none', color: dim, cursor: 'pointer', fontSize: '0.9rem', padding: '0.25rem' } }, '×')));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.5rem' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' } },
            e('div', null,
              e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem' } }, t.raTitle || 'Real Assets & Property'),
              e('div', { style: { color: dim, fontSize: '0.76rem' } },
                agg.count + ' ' + (t.raAssets || 'assets') + '  ·  ' + (t.raNet || 'net') + ' ' + fmt(agg.netValue) + ' ' + sym +
                (agg.annualIncome ? '  ·  ' + (t.raIncomePa || 'income p.a.') + ' ' + fmt(agg.annualIncome) + ' ' + sym : ''))),
            e('button', { onClick: function () { setShowAdd(!showAdd); },
              style: { padding: '0.45rem 0.9rem', background: accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } }, t.raAdd || '+ Add Asset')),

          showAdd ? e('div', { style: { padding: '0.85rem', background: inputBg, borderRadius: '10px', marginBottom: '0.85rem' } },
            // P5-3.11: start from a template (art, P2P loans, life insurance, vehicles, startups, collectibles)
            e('div', { style: { marginBottom: '0.6rem' } }, label(__('raTemplate', 'Template')),
              e('select', { value: form.template, 'data-testid': 'ra-template', onChange: function (ev) { setTplError(''); setF({ template: ev.target.value }); },
                style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%', maxWidth: '320px' } },
                [e('option', { key: '_', value: '' }, __('raTplGeneric', 'Property, watch or other (free form)'))].concat(
                  API.TEMPLATES.map(function (tp) { return e('option', { key: tp.id, value: tp.id }, API.templateLabel(tp.id)); })))),
            form.template ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' } },
              API.TEMPLATES.filter(function (tp) { return tp.id === form.template; })[0].fields.map(function (f) {
                return e('div', { key: f.key }, label(API.fieldLabel(f.key) + (f.req ? ' *' : '')),
                  inp(f.key, { type: f.type === 'date' ? 'date' : 'text', inputMode: f.type === 'number' ? 'decimal' : undefined, 'data-testid': 'ra-f-' + f.key }));
              }).concat([e('div', { key: '_cur' }, label(t.raCurrency || 'Currency'),
                e('select', { value: form.currency, onChange: function (ev) { setF({ currency: ev.target.value }); },
                  style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%' } },
                  ['EUR', 'USD'].map(function (c) { return e('option', { key: c, value: c }, c); })))])) :
            e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' } },
              e('div', null, label(t.raName || 'Name'), inp('name', { placeholder: __('raNamePh', 'e.g. Apartment Berlin') })),
              e('div', null, label(t.raKind || 'Kind'),
                e('select', { value: form.kind, onChange: function (ev) { setF({ kind: ev.target.value }); },
                  style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%' } },
                  Object.keys(API.KINDS).map(function (kk) { return e('option', { key: kk, value: kk }, API.KINDS[kk].label); }))),
              e('div', null, label(t.raCurrency || 'Currency'),
                e('select', { value: form.currency, onChange: function (ev) { setF({ currency: ev.target.value }); },
                  style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%' } },
                  ['EUR', 'USD'].map(function (c) { return e('option', { key: c, value: c }, c); }))),
              e('div', null, label((t.raValue || 'Current value')), inp('value', { type: 'number', placeholder: '350000' })),
              e('div', null, label(t.raCost || 'Purchase price'), inp('acquisitionCost', { type: 'number', placeholder: '300000' })),
              e('div', null, label(t.raFees || 'Acquisition fees'), inp('acquisitionFees', { type: 'number', placeholder: '30000' })),
              e('div', null, label(t.raRent || 'Rent / month'), inp('rentMonthly', { type: 'number', placeholder: '1200' })),
              e('div', null, label(t.raRunCost || 'Cost / month'), inp('costMonthly', { type: 'number', placeholder: '250' })),
              e('div', null, label(t.raFinancing || 'Financing (liability)'),
                e('select', { value: form.financingAccountId, onChange: function (ev) { setF({ financingAccountId: ev.target.value }); },
                  style: { padding: '0.55rem 0.7rem', background: inputBg, border: '1px solid ' + inputBorder, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%' } },
                  [e('option', { key: '_', value: '' }, t.raNoFinancing || 'None')].concat(
                    liabilityAccounts.map(function (a) { return e('option', { key: a.id, value: a.id }, a.name); }))))),
            tplError ? e('div', { style: { color: (props.theme && props.theme.warning) || 'var(--warning)', fontSize: '0.78rem', marginTop: '0.5rem' } }, tplError) : null,
            e('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.75rem' } },
              e('button', { onClick: addCurrent, 'data-testid': 'ra-add', style: { padding: '0.5rem 1rem', background: accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' } }, t.raSave || 'Add'),
              e('button', { onClick: function () { setShowAdd(false); }, style: { padding: '0.5rem 1rem', background: inputBg, color: text, border: '1px solid ' + inputBorder, borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' } }, t.raCancel || 'Cancel'))) : null,

          st.assets.length ? e('div', null, rows)
            : (showAdd ? null : e('div', { style: { color: dim, fontSize: '0.84rem', padding: '0.5rem 0' } },
                t.raEmpty || 'No real assets yet. Add a property, vehicle or valuable to track its value, financing and rental cashflows.')));
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || 'var(--danger)' } }, __('raError', 'Real assets error: ') + (err && err.message));
      }
    };
  }
})();
