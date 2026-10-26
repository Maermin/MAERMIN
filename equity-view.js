// ============================================================================
// MAERMIN — Employee equity page "Mitarbeiteraktien"  (window.MaerminEquityView)
// ----------------------------------------------------------------------------
// PLAN-EQUITY Package 1: the page frame on equity-model.js / equity-fx.js.
//   - totals: still held from vests/purchases, unvested pipeline, plans
//   - plans (employer, ticker, the four currency roles, plan admin, portfolio)
//   - grants per plan (RSU, PSU, ESPP, MATCH) and their tranches
//   - events entered by hand: FMV in the share currency, rates of the event
//     day filled from the FX pipeline (fallback days marked), any rate can be
//     overridden; each event becomes normal lots in the plan's portfolio
//   - settings: unvested in net worth, concentration warning threshold
// Schedules (RSU/PSU), ESPP and matching follow in packages 2-5.
//
// props: { state (the store, owned by renderer.js), transactions, portfolios, prices (EUR per symbol), formatPrice,
//          getCurrencySymbol, baseCurrency, taxJurisdiction, privacy, addToast,
//          usdHistory (the demo's USD->EUR sample history),
//          onChange(state) }   onChange syncs the lots (renderer.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function __(k, f, v) { return (W.MaerminI18n || require('./i18n.js')).t(k, f, v); }
  function E() { return W.MaerminEquity; }
  function FX() { return W.MaerminEquityFx; }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function today() { return W.MaerminUtils.todayISO(); }   // local day (audit-local-today)

  function typeLabel(t) {
    return t === 'RSU' ? __('eqTypeRSU', 'RSU (restricted stock units)')
      : t === 'PSU' ? __('eqTypePSU', 'PSU (performance share units)')
        : t === 'ESPP' ? __('eqTypeESPP', 'ESPP (employee stock purchase plan)')
          : t === 'MATCH' ? __('eqTypeMATCH', 'Match shares (employer)') : t;
  }
  function adminName(a) {
    return a === 'morgan_stanley' ? __('eqAdminMS', 'Morgan Stanley StockPlan Connect')
      : a === 'etrade' ? __('eqAdminEtrade', 'E*TRADE')
        : a === 'schwab' ? __('eqAdminSchwab', 'Charles Schwab')
          : a === 'fidelity' ? __('eqAdminFidelity', 'Fidelity NetBenefits') : __('eqAdminOther', 'Other');
  }
  function adminLabel(p) { return p.admin === 'other' ? (p.adminLabel || adminName('other')) : adminName(p.admin); }
  function regionName(code) {
    try { return new Intl.DisplayNames([W.MaerminI18n.locale()], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  }

  // One line for a stored rate: "1 USD = 0,9200 EUR · Ersatzkurs vom 13.03.2026"
  function fxText(from, to, e) {
    if (!e) return __('eqFxMissing', 'No {to} rate for this day', { to: to });
    var I = W.MaerminI18n;
    var line = __('eqFxLine', '1 {from} = {rate} {to}', { from: from, to: to, rate: I.num(e.rate, { min: 2, max: 6 }) });
    if (e.source === 'fallback') line += ' · ' + __('eqFxFallback', 'fallback rate from {date}', { date: I.date(e.date) });
    else if (e.source === 'approx') line += ' · ' + __('eqFxApprox', 'approximate (today\'s rate, no fixing near this day)');
    else if (e.source === 'manual') line += ' · ' + __('eqFxManual', 'entered by hand');
    return line;
  }
  function fxTone(e) { return !e ? 'loss' : e.source === 'approx' ? 'loss' : e.source === 'fallback' || e.source === 'manual' ? 'warning' : null; }

  // ---- plan form -----------------------------------------------------------------
  function PlanForm(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents;
    var p0 = props.plan || {};
    var _s = React.useState({
      employer: p0.employer || '', ticker: p0.ticker || '', quoteCurrency: p0.quoteCurrency || 'USD',
      salaryCurrency: p0.salaryCurrency || 'EUR', admin: p0.admin || 'other', adminLabel: p0.adminLabel || '',
      portfolioId: p0.portfolioId || ((props.portfolios || [])[0] || {}).id || '', taxCountry: p0.taxCountry || props.taxCountry || 'DE'
    });
    var f = _s[0], set = _s[1];
    var upd = function (k) { return function (e) { var v = e.target.value; set(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }; };
    var RC = W.MaerminReporting;
    var list = (RC && RC.all && RC.all()) || [];
    var share = String(f.quoteCurrency || '').trim();
    var major = FX() ? FX().majorOf(share).cur : share;
    var shareOk = !!major && (!RC || RC.isValid(major));
    var salaryOk = !RC || RC.isValid(String(f.salaryCurrency || '').toUpperCase());
    var can = f.ticker.trim() && shareOk && salaryOk;
    var save = function () {
      if (!can) return;
      props.onSave(Object.assign({}, p0, f, { id: p0.id || E().newId('plan'), ticker: f.ticker.trim(), shareCurrency: share, quoteCurrency: share, salaryCurrency: String(f.salaryCurrency).toUpperCase() }));
    };
    return h(UIC.Card, { title: p0.id ? __('eqPlanEdit', 'Edit plan') : __('eqPlanNew', 'New plan'), 'data-testid': 'eq-plan-form' },
      h('datalist', { id: 'eq-cur-list' }, list.map(function (c) { return h('option', { key: c, value: c }); })),
      h('div', { className: 'ui-form-grid' },
        h(UIC.Input, { label: __('eqEmployer', 'Employer'), value: f.employer, onChange: upd('employer'), autoComplete: 'off' }),
        h(UIC.Input, { label: __('eqTicker', 'Ticker'), value: f.ticker, onChange: upd('ticker'), autoComplete: 'off', hint: __('eqTickerHint', 'As listed, e.g. MSFT, SAP.DE, AZN.L') }),
        h(UIC.Input, { label: __('eqShareCurrency', 'Share currency'), value: f.quoteCurrency, onChange: upd('quoteCurrency'), list: 'eq-cur-list',
          error: shareOk ? null : __('eqCurrencyInvalid', 'Not an ISO 4217 currency code'),
          hint: major && major !== share.toUpperCase() ? __('eqMinorHint', 'Quoted in minor units: amounts are kept in {major}', { major: major }) : __('eqShareCurrencyHint', 'The listing currency of the ticker (GBX for pence quotes)') }),
        h(UIC.Input, { label: __('eqSalaryCurrency', 'Salary currency'), value: f.salaryCurrency, onChange: upd('salaryCurrency'), list: 'eq-cur-list',
          error: salaryOk ? null : __('eqCurrencyInvalid', 'Not an ISO 4217 currency code') }),
        h(UIC.Select, { label: __('eqAdmin', 'Plan administrator'), value: f.admin, onChange: upd('admin'),
          options: E().ADMINS.map(function (a) { return { value: a, label: adminName(a) }; }) }),
        f.admin === 'other' ? h(UIC.Input, { label: __('eqAdminName', 'Administrator name'), value: f.adminLabel, onChange: upd('adminLabel') }) : null,
        h(UIC.Select, { label: __('eqPortfolio', 'Portfolio for the shares'), value: f.portfolioId, onChange: upd('portfolioId'),
          options: (props.portfolios || []).map(function (p) { return { value: p.id, label: p.name }; }) }),
        h(UIC.Select, { label: __('eqTaxCountry', 'Tax country'), value: f.taxCountry, onChange: upd('taxCountry'),
          hint: __('eqTaxCurrencyIs', 'Tax currency: {cur}', { cur: FX().taxCurrency(f.taxCountry) || 'EUR' }),
          options: FX().TAX_COUNTRIES.map(function (c) { return { value: c, label: regionName(c) }; }) })),
      h('div', { className: 'ui-view__bar' },
        h(UIC.Button, { variant: 'primary', onClick: save, disabled: !can, 'data-testid': 'eq-plan-save' }, __('eqSave', 'Save')),
        h(UIC.Button, { variant: 'quiet', onClick: props.onCancel }, __('eqCancel', 'Cancel'))));
  }

  // ---- grant form ----------------------------------------------------------------
  function GrantForm(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents;
    var _s = React.useState({ type: 'RSU', name: '', grantDate: today(), units: '', withholding: 'sell_to_cover' });
    var f = _s[0], set = _s[1];
    var upd = function (k) { return function (e) { var v = e.target.value; set(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }; };
    var needsUnits = f.type === 'RSU' || f.type === 'PSU';
    var can = f.grantDate && (!needsUnits || num(f.units) > 0);
    return h('div', { className: 'ui-form-grid', 'data-testid': 'eq-grant-form' },
      h(UIC.Select, { label: __('eqGrantType', 'Type'), value: f.type, onChange: upd('type'),
        options: E().GRANT_TYPES.map(function (t) { return { value: t, label: typeLabel(t) }; }) }),
      h(UIC.Input, { label: __('eqGrantName', 'Name (optional)'), value: f.name, onChange: upd('name') }),
      h(UIC.Input, { label: __('eqGrantDate', 'Grant date'), type: 'date', value: f.grantDate, onChange: upd('grantDate') }),
      needsUnits ? h(UIC.Input, { label: f.type === 'PSU' ? __('eqTargetUnits', 'Target units') : __('eqUnits', 'Units'), inputMode: 'decimal', value: f.units, onChange: upd('units') }) : null,
      needsUnits ? h(UIC.Select, { label: __('eqWithholding', 'Tax withholding'), value: f.withholding, onChange: upd('withholding'),
        options: [
          { value: 'sell_to_cover', label: __('eqWhSellToCover', 'Sell-to-cover (shares sold)') },
          { value: 'payroll', label: __('eqWhPayroll', 'Through payroll (no shares withheld)') },
          { value: 'none', label: __('eqWhNone', 'None') }] }) : null,
      h('div', { className: 'ui-form-grid__action' },
        h(UIC.Button, { variant: 'primary', disabled: !can, 'data-testid': 'eq-grant-save', onClick: function () {
          props.onSave({ id: E().newId('grant'), planId: props.planId, type: f.type, name: f.name, grantDate: f.grantDate, units: needsUnits ? num(f.units) : null, withholding: f.withholding });
        } }, __('eqAddGrant', 'Add grant'))));
  }

  // ---- event form (manual vest / purchase / delivery) ----------------------------
  function EventForm(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n;
    var plan = props.plan, grants = props.grants;
    var _s = React.useState({ grantId: (grants[0] || {}).id || '', date: today(), fmv: '', gross: '', withheld: '', cover: '', override: '' });
    var f = _s[0], set = _s[1];
    var upd = function (k) { return function (e) { var v = e.target.value; set(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }; };
    var grant = grants.filter(function (g) { return g.id === f.grantId; })[0];
    var kind = grant && grant.type === 'ESPP' ? 'purchase' : grant && grant.type === 'MATCH' ? 'delivery' : 'vest';
    var taxCur = FX().taxCurrency(plan.taxCountry) || 'EUR';
    var targets = ['EUR', props.baseCurrency, taxCur, plan.salaryCurrency];
    var ov = num(f.override);
    var ctx = React.useMemo(function () {
      var c = props.usdHistory ? { usdHistory: props.usdHistory } : {};
      if (ov > 0) { c.overrides = {}; c.overrides[FX().overrideKey(plan.shareCurrency, 'EUR', f.date)] = { rate: ov }; }
      return c;
    }, [f.date, ov, plan.shareCurrency, props.usdHistory]);
    var rec = f.date ? FX().record(plan.shareCurrency, targets, f.date, ctx) : {};
    var fmv = num(f.fmv), gross = num(f.gross), withheld = num(f.withheld) || 0;
    var can = grant && f.date && fmv > 0 && gross > 0 && withheld <= gross && (plan.shareCurrency === 'EUR' || rec.EUR);
    var save = function () {
      if (!can) return;
      props.onSave({
        id: E().newId('ev'), kind: kind, grantId: grant.id, date: f.date, fmv: fmv, fmvSource: 'manual',
        shareCurrency: plan.shareCurrency, fx: rec, grossUnits: gross, withheldUnits: withheld, coverPrice: num(f.cover), source: 'manual'
      });
    };
    return h('div', { 'data-testid': 'eq-event-form' },
      h('div', { className: 'ui-form-grid' },
        h(UIC.Select, { label: __('eqGrant', 'Grant'), value: f.grantId, onChange: upd('grantId'),
          options: grants.map(function (g) { return { value: g.id, label: typeLabel(g.type) + (g.name ? ' · ' + g.name : '') + (g.grantDate ? ' · ' + I.date(g.grantDate) : '') }; }) }),
        h(UIC.Input, { label: kind === 'purchase' ? __('eqPurchaseDate', 'Purchase date') : __('eqVestDate', 'Vest date'), type: 'date', value: f.date, onChange: upd('date') }),
        h(UIC.Input, { label: __('eqFmv', 'FMV per share ({cur})', { cur: plan.shareCurrency }), inputMode: 'decimal', value: f.fmv, onChange: upd('fmv'),
          hint: __('eqFmvHint', 'Market value on that day; it becomes the cost basis') }),
        h(UIC.Input, { label: __('eqGrossUnits', 'Gross units'), inputMode: 'decimal', value: f.gross, onChange: upd('gross') }),
        kind === 'vest' && grant && grant.withholding === 'sell_to_cover' ? h(UIC.Input, { label: __('eqWithheldUnits', 'Units sold to cover taxes'), inputMode: 'decimal', value: f.withheld, onChange: upd('withheld') }) : null,
        kind === 'vest' && withheld > 0 ? h(UIC.Input, { label: __('eqCoverPrice', 'Sale price of those units ({cur})', { cur: plan.shareCurrency }), inputMode: 'decimal', value: f.cover, onChange: upd('cover'),
          hint: __('eqCoverHint', 'From the plan statement; empty = FMV') }) : null,
        plan.shareCurrency !== 'EUR' ? h(UIC.Input, { label: __('eqFxOverride', 'Own rate: EUR per 1 {cur} (optional)', { cur: plan.shareCurrency }), inputMode: 'decimal', value: f.override, onChange: upd('override'),
          hint: __('eqFxOverrideHint', 'e.g. the rate on your payslip; empty = rate of the day') }) : null),
      h('ul', { className: 'ui-note', 'aria-label': __('eqFxUsed', 'Rates used') },
        targets.filter(function (c, i, a) { return c && c !== plan.shareCurrency && a.indexOf(c) === i; }).map(function (c) {
          var e = rec[c], tone = fxTone(e);
          return h('li', { key: c, className: tone ? 'tone-' + tone : undefined, 'data-testid': 'eq-fx-' + c }, fxText(plan.shareCurrency, c, e));
        })),
      h('div', { className: 'ui-view__bar' },
        h(UIC.Button, { variant: 'primary', disabled: !can, onClick: save, 'data-testid': 'eq-event-save' }, __('eqAddEvent', 'Book event')),
        h(UIC.Button, { variant: 'quiet', onClick: props.onCancel }, __('eqCancel', 'Cancel'))));
  }

  // ---- plan card -------------------------------------------------------------------
  function PlanCard(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n;
    var st = props.state, plan = props.plan, M = E();
    var _g = React.useState(false), addGrant = _g[0], setAddGrant = _g[1];
    var _e = React.useState(false), addEvent = _e[0], setAddEvent = _e[1];
    var grants = M.grantsOf(st, plan.id);
    var taxCur = FX().taxCurrency(plan.taxCountry) || 'EUR';
    var money = function (v) { return props.privacy ? '••••••' : props.formatPrice(v) + ' ' + props.getCurrencySymbol(); };
    var held = props.held[plan.id] || 0;
    var rows = grants.map(function (g) {
      var tr = M.tranchesOf(st, g.id);
      var sum = function (s) { return tr.filter(function (t) { return t.status === s; }).reduce(function (a, t) { return a + t.units; }, 0); };
      return { id: g.id, grant: g, vested: sum('vested') + sum('settled'), unvested: sum('unvested'), forfeited: sum('forfeited'), events: M.eventsOf(st, g.id).length };
    });
    var events = st.events.filter(function (ev) { return grants.some(function (g) { return g.id === ev.grantId; }); }).slice().reverse();
    return h(UIC.Card, {
      title: (plan.employer || plan.ticker) + ' · ' + plan.ticker,
      subtitle: adminLabel(plan),
      'data-testid': 'eq-plan-' + plan.id,
      action: h('div', { className: 'ui-view__bar' },
        h(UIC.Button, { size: 'sm', onClick: function () { props.onEdit(plan); } }, __('eqEdit', 'Edit')),
        h(UIC.Button, { size: 'sm', variant: 'danger', onClick: function () { props.onDelete(plan); } }, __('eqDelete', 'Delete')))
    },
      h('div', { className: 'ui-kv-grid', 'data-testid': 'eq-roles' },
        [[__('eqShareCurrency', 'Share currency'), plan.quoteCurrency !== plan.shareCurrency ? plan.quoteCurrency + ' → ' + plan.shareCurrency : plan.shareCurrency],
          [__('eqSalaryCurrency', 'Salary currency'), plan.salaryCurrency],
          [__('eqBaseCurrency', 'Base currency'), props.baseCurrency],
          [__('eqTaxCurrency', 'Tax currency'), taxCur + ' (' + plan.taxCountry + ')'],
          [__('eqHeld', 'Held from this plan'), I.num(held, { min: 0, max: 4 }) + ' · ' + money(held * (props.priceEUR(plan) || 0))]
        ].map(function (kv, i) { return h('div', { key: i, className: 'ui-kv' }, h('span', null, kv[0]), h('b', { className: i === 4 ? 'num' : undefined }, kv[1])); })),
      h(UIC.Table, {
        caption: __('eqGrants', 'Grants'), 'data-testid': 'eq-grants',
        columns: [
          { key: 'type', label: __('eqGrantType', 'Type'), phone: 'title', render: function (r) { return typeLabel(r.grant.type) + (r.grant.name ? ' · ' + r.grant.name : ''); } },
          { key: 'date', label: __('eqGrantDate', 'Grant date'), phone: 'meta', render: function (r) { return r.grant.grantDate ? I.date(r.grant.grantDate) : '–'; } },
          { key: 'units', label: __('eqUnits', 'Units'), align: 'right', phone: 'value', render: function (r) { return r.grant.units != null ? I.num(r.grant.units, { min: 0, max: 4 }) : '–'; } },
          { key: 'vested', label: __('eqVested', 'Vested'), align: 'right', priority: 2, render: function (r) { return I.num(r.vested, { min: 0, max: 4 }); } },
          { key: 'unvested', label: __('eqUnvested', 'Unvested'), align: 'right', phone: 'sub', render: function (r) { return I.num(r.unvested, { min: 0, max: 4 }); } }
        ],
        rows: rows,
        rowActions: function (r) { return [{ label: __('eqDelete', 'Delete'), danger: true, onClick: function () { props.onDeleteGrant(r.grant); } }]; },
        empty: h('p', { className: 'ui-note' }, __('eqNoGrants', 'No grants yet.'))
      }),
      events.length ? h(UIC.Table, {
        caption: __('eqEvents', 'Vests and purchases'), 'data-testid': 'eq-events',
        columns: [
          { key: 'date', label: __('eqDate', 'Date'), phone: 'title', render: function (r) { return I.date(r.date) + ' · ' + (r.kind === 'purchase' ? __('eqKindPurchase', 'Purchase') : r.kind === 'delivery' ? __('eqKindDelivery', 'Delivery') : __('eqKindVest', 'Vest')); } },
          { key: 'units', label: __('eqNetUnits', 'Net units'), align: 'right', phone: 'value', render: function (r) { return I.num(r.netUnits, { min: 0, max: 4 }) + (r.withheldUnits ? ' (' + __('eqGrossShort', 'gross {n}', { n: I.num(r.grossUnits, { min: 0, max: 4 }) }) + ')' : ''); } },
          { key: 'fmv', label: __('eqFmvShort', 'FMV'), align: 'right', phone: 'meta', render: function (r) { return props.privacy ? '••••••' : I.moneyAuto(r.fmv, r.shareCurrency); } },
          { key: 'fx', label: __('eqFxEur', 'Rate to EUR'), priority: 2, phone: 'sub', render: function (r) {
            if (r.shareCurrency === 'EUR') return '–';
            var e = r.fx.EUR, tone = fxTone(e);
            return h('span', { className: tone ? 'tone-' + tone : undefined }, e ? I.num(e.rate, { min: 2, max: 6 }) + (e.source === 'fallback' ? ' · ' + __('eqFxFallbackShort', 'fallback {date}', { date: I.date(e.date) }) : e.source === 'manual' ? ' · ' + __('eqFxManualShort', 'manual') : e.source === 'approx' ? ' · ' + __('eqFxApproxShort', 'approx.') : '') : __('eqFxMissingShort', 'missing'));
          } }
        ],
        rows: events,
        rowActions: function (r) { return [{ label: __('eqDelete', 'Delete'), danger: true, onClick: function () { props.onDeleteEvent(r); } }]; }
      }) : null,
      addGrant ? h(GrantForm, { planId: plan.id, onSave: function (g) { props.onAddGrant(g); setAddGrant(false); } }) : null,
      addEvent && grants.length ? h(EventForm, { plan: plan, grants: grants, baseCurrency: props.baseCurrency, usdHistory: props.usdHistory, onCancel: function () { setAddEvent(false); },
        onSave: function (ev) { props.onAddEvent(ev); setAddEvent(false); } }) : null,
      h('div', { className: 'ui-view__bar' },
        !addGrant ? h(UIC.Button, { size: 'sm', onClick: function () { setAddGrant(true); }, 'data-testid': 'eq-add-grant' }, __('eqAddGrant', 'Add grant')) : null,
        grants.length && !addEvent ? h(UIC.Button, { size: 'sm', onClick: function () { setAddEvent(true); }, 'data-testid': 'eq-add-event' }, __('eqAddEvent', 'Book event')) : null));
  }

  // ---- the page --------------------------------------------------------------------
  function View(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, M = E();
    var st = props.state || M.normalize(null);
    var _f = React.useState(null), form = _f[0], setForm = _f[1];   // null | {} (new) | plan (edit)
    var commit = function (next) {
      var n = M.normalize(next);
      M.save(n);
      if (props.onChange) props.onChange(n);
    };
    var priceEUR = function (plan) { var p = props.prices || {}; var v = p[plan.ticker] || p[plan.ticker.toLowerCase()]; return num(v); };
    var ledger = React.useMemo(function () { return W.MaerminLedger ? W.MaerminLedger.build(props.transactions || [], { perPortfolio: true }) : null; }, [props.transactions]);
    var held = React.useMemo(function () { return M.heldByPlan(st, ledger); }, [st, ledger]);
    var pipe = M.pipeline(st, priceEUR, function (v) { return v; });
    var heldValue = st.plans.reduce(function (s, p) { return s + (held[p.id] || 0) * (priceEUR(p) || 0); }, 0);
    var money = function (v) { return props.privacy ? '••••••' : props.formatPrice(v) + ' ' + props.getCurrencySymbol(); };
    var missing = M.missingFx(st);
    var withList = function (key, list) { var o = Object.assign({}, st); o[key] = list; return o; };
    var confirmThen = function (title, fn) {
      W.MaerminUtils.confirmThen({ title: title, confirmLabel: __('eqDelete', 'Delete'), cancelLabel: __('cancel', 'Cancel') }, fn);
    };

    var savePlan = function (p) {
      var exists = st.plans.some(function (x) { return x.id === p.id; });
      commit(withList('plans', exists ? st.plans.map(function (x) { return x.id === p.id ? p : x; }) : st.plans.concat([p])));
      setForm(null);
    };
    var deletePlan = function (p) {
      confirmThen(__('eqDeletePlanConfirm', 'Delete the plan {name} with its grants and events? Its lots leave the transactions.', { name: p.employer || p.ticker }), function () {
        var gids = M.grantsOf(st, p.id).map(function (g) { return g.id; });
        var keep = function (x) { return gids.indexOf(x.grantId) === -1; };
        commit(Object.assign({}, st, { plans: st.plans.filter(function (x) { return x.id !== p.id; }), grants: st.grants.filter(function (g) { return g.planId !== p.id; }),
          tranches: st.tranches.filter(keep), events: st.events.filter(keep) }));
      });
    };
    var deleteGrant = function (g) {
      confirmThen(__('eqDeleteGrantConfirm', 'Delete this grant with its tranches and events?'), function () {
        var keep = function (x) { return x.grantId !== g.id; };
        commit(Object.assign({}, st, { grants: st.grants.filter(function (x) { return x.id !== g.id; }), tranches: st.tranches.filter(keep), events: st.events.filter(keep) }));
      });
    };
    var deleteEvent = function (ev) {
      confirmThen(__('eqDeleteEventConfirm', 'Delete this event? Its lots leave the transactions.'), function () {
        commit(withList('events', st.events.filter(function (x) { return x.id !== ev.id; })));
      });
    };
    var setSetting = function (k, v) { var s = Object.assign({}, st.settings); s[k] = v; commit(Object.assign({}, st, { settings: s })); };

    var cards = [
      h(UIC.Stat, { key: 'held', label: __('eqTotalHeld', 'Vested & held'), value: money(heldValue), sub: __('eqTotalHeldSub', 'From vests and purchases, after sales') }),
      h(UIC.Stat, { key: 'unvested', label: __('eqTotalUnvested', 'Unvested'), value: money(pipe.total.base),
        sub: st.settings.includeUnvested ? __('nwEquityIncluded', 'Included in net worth') : __('nwEquityExcluded', 'Not included in net worth (setting)') }),
      h(UIC.Stat, { key: 'plans', label: __('eqPlans', 'Plans'), value: String(st.plans.length) })
    ];

    return h('div', { className: 'ui-view', 'data-testid': 'equity-view' },
      h('div', { className: 'ui-view__bar' },
        h('p', { className: 'ui-view__lead' }, __('eqLead', 'RSU, PSU, ESPP and match shares from your employer. Every vest and purchase becomes a normal lot with its market value as cost basis.')),
        !form ? h(UIC.Button, { variant: 'primary', onClick: function () { setForm({}); }, 'data-testid': 'eq-add-plan' }, __('eqAddPlan', '+ Add plan')) : null),
      form ? h(PlanForm, { plan: form.id ? form : null, portfolios: props.portfolios, taxCountry: (props.taxJurisdiction || 'de').toUpperCase(), onSave: savePlan, onCancel: function () { setForm(null); } }) : null,
      !st.plans.length && !form ? h(UIC.EmptyState, { testid: 'eq-empty', title: __('eqEmptyTitle', 'No employee equity yet'),
        text: __('eqEmptyText', 'Add the plan of your employer (RSU, PSU or ESPP). Your salary and plan data stay encrypted on this device.'),
        action: { label: __('eqAddPlan', '+ Add plan'), onClick: function () { setForm({}); } } }) : null,
      st.plans.length ? h('div', { className: 'ui-ov-tiles' }, cards) : null,
      missing.length ? h('p', { className: ['ui-callout', 'ui-callout--warn'].join(' '), role: 'status', 'data-testid': 'eq-fx-missing' },
        __('eqMissingFx', '{n} {n:event has|events have} no EUR rate yet and no lot: enter the rate from your payslip or load rates through the Worker.', { n: missing.length })) : null,
      st.plans.map(function (p) {
        return h(PlanCard, { key: p.id, state: st, plan: p, held: held, priceEUR: priceEUR, baseCurrency: props.baseCurrency || 'EUR', privacy: props.privacy, usdHistory: props.usdHistory,
          formatPrice: props.formatPrice, getCurrencySymbol: props.getCurrencySymbol,
          onEdit: function (x) { setForm(x); }, onDelete: deletePlan, onDeleteGrant: deleteGrant, onDeleteEvent: deleteEvent,
          onAddGrant: function (g) { commit(withList('grants', st.grants.concat([g]))); },
          onAddEvent: function (ev) { commit(withList('events', st.events.concat([ev]))); if (props.addToast) props.addToast(__('eqEventBooked', 'Event booked: its lot is in your transactions.'), 'success'); } });
      }),
      st.plans.length ? h(UIC.Card, { title: __('eqSettings', 'Settings'), 'data-testid': 'eq-settings' },
        h('label', { className: 'ui-check' },
          h('input', { type: 'checkbox', checked: st.settings.includeUnvested, onChange: function (e) { setSetting('includeUnvested', e.target.checked); }, 'data-testid': 'eq-include-unvested' }),
          ' ', __('eqIncludeUnvested', 'Count unvested shares in net worth')),
        h('div', { className: 'ui-form-grid' },
          h(UIC.Input, { label: __('eqConcentration', 'Warn when employer stock exceeds (% of net worth)'), inputMode: 'decimal', value: String(st.settings.concentrationWarnPct),
            onChange: function (e) { var v = num(e.target.value); if (v > 0 && v <= 100) setSetting('concentrationWarnPct', v); } })),
        h('p', { className: 'ui-note' }, __('eqPrivacyNote', 'Plan, salary and income data are encrypted like your portfolio and leave the device only encrypted (backup, sync).'))) : null);
  }

  var api = { View: View, fxText: fxText };
  if (typeof window !== 'undefined') window.MaerminEquityView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
