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

  // ---- grant form (Package 2: RSU schedule) ------------------------------------------
  // A grant with a schedule gets its tranches from equity-vesting.js; past ones
  // become vests from the price and FX history, future ones stay projected.
  function V() { return W.MaerminEquityVesting; }
  var PRESET_IDS = ['4y_cliff_quarterly', '4y_cliff_monthly', '3y_yearly', '25_25_25_25', 'custom', 'manual'];
  function presetLabel(id) {
    return id === '4y_cliff_quarterly' ? __('eqPreset4yQ', '4 years, 1-year cliff, then quarterly')
      : id === '4y_cliff_monthly' ? __('eqPreset4yM', '4 years, 1-year cliff, then monthly')
        : id === '3y_yearly' ? __('eqPreset3y', '3 years, yearly')
          : id === '25_25_25_25' ? __('eqPreset25', '25 / 25 / 25 / 25 (yearly)')
            : id === 'custom' ? __('eqPresetCustom', 'Own tranches (uneven %)') : __('eqPresetManual', 'No schedule (book vests by hand)');
  }
  function roundingLabel(r) {
    return r === 'floor_trueup' ? __('eqRoundFloor', 'Round down per tranche, rest on the last')
      : r === 'floor_cumulative' ? __('eqRoundCumulative', 'Round down cumulatively (spreads the rest)')
        : r === 'round' ? __('eqRoundRound', 'Round per tranche, rest on the last') : __('eqRoundNone', 'Fractional units');
  }
  function GrantForm(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n;
    var g0 = props.grant || {}, s0 = g0.schedule || {};
    var _s = React.useState({
      type: g0.type || 'RSU', name: g0.name || '', grantDate: g0.grantDate || today(), units: g0.units != null ? String(g0.units) : '',
      withholding: g0.withholding || 'sell_to_cover', withholdingRate: g0.withholdingRate != null ? String(Math.round(g0.withholdingRate * 1000) / 10) : '',
      preset: g0.id && !g0.schedule ? 'manual' : (s0.custom ? 'custom' : s0.preset || '4y_cliff_quarterly'),
      start: s0.start || '', years: s0.years != null ? String(s0.years) : '', cliffMonths: s0.cliffMonths != null ? String(s0.cliffMonths) : '', freqMonths: s0.freqMonths != null ? String(s0.freqMonths) : '',
      custom: (s0.custom || [{ date: '', pct: '' }]).map(function (c) { return { date: c.date || '', pct: c.pct != null ? String(c.pct) : '' }; }),
      rounding: g0.rounding || 'floor_trueup', fmvSource: s0.fmvSource || 'close', dividendEquivalents: !!g0.dividendEquivalents,
      // PSU (Package 3): performance period, multiplier range, vesting afterwards
      perfStart: (g0.psu || {}).perfStart || '', perfEnd: (g0.psu || {}).perfEnd || '', settleDate: (g0.psu || {}).settleDate || '',
      multMin: String((g0.psu || {}).min != null ? g0.psu.min : 0), multTarget: String((g0.psu || {}).target != null ? g0.psu.target : 100), multMax: String((g0.psu || {}).max != null ? g0.psu.max : 200),
      post: ((g0.psu || {}).post || {}).preset || 'manual',
      // ESPP (Package 4)
      espp: (function () {
        var c = g0.contribution || {}, caps = c.caps || {}, k = c.customKinds || {};
        var str = function (v) { return v != null ? String(v) : ''; };
        return { anchor: c.anchor || '', periodMonths: str(c.periodMonths || 6), endDate: c.endDate || '', discountPct: str(c.discountPct != null ? c.discountPct : 15),
          lookback: c.lookback !== false, pct: str(((c.pctHistory || [])[0] || {}).pct != null ? c.pctHistory[0].pct : 10), eligible: c.eligible || 'base',
          kBonus: !!k.bonus, k13: !!k['13th'], kOther: !!k.other, midPeriodDecrease: !!c.midPeriodDecrease,
          capCurrency: caps.currency || '', capPeriod: str(caps.periodAmount), capYear: str(caps.yearAmount), capPeriodShares: str(caps.periodShares),
          capYearShares: str(caps.yearShares), capFmvYear: str(caps.offeringFmvYearAmount), capExcess: caps.excess || 'refund',
          fxMode: c.fxMode || 'purchase', leftover: c.leftover || 'carry', fractional: !!c.fractional, sellImmediately: !!c.sellImmediately };
      })()
    });
    var f = _s[0], set = _s[1];
    var put = function (k, v) { set(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); };
    var upd = function (k) { return function (e) { put(k, e.target.value); }; };
    var vesting = f.type === 'RSU' || f.type === 'MATCH';
    var needsUnits = f.type === 'RSU' || f.type === 'PSU' || f.type === 'MATCH';
    var schedule = null;
    if (vesting && f.preset !== 'manual') {
      schedule = f.preset === 'custom'
        ? { custom: f.custom.map(function (c) { return { date: c.date, pct: num(c.pct) }; }).filter(function (c) { return c.date && c.pct > 0; }) }
        : { preset: f.preset };
      if (f.preset !== 'custom') {
        if (num(f.years) > 0) schedule.years = num(f.years);
        if (num(f.cliffMonths) != null) schedule.cliffMonths = num(f.cliffMonths);
        if (num(f.freqMonths) > 0) schedule.freqMonths = num(f.freqMonths);
      }
      if (f.start) schedule.start = f.start;
      schedule.fmvSource = f.fmvSource;
    }
    var steps = schedule ? V().steps(schedule, f.grantDate) : [];
    var pct = V().pctSum(steps);
    var units = num(f.units);
    var alloc = steps.length && units > 0 ? V().allocate(units, steps.map(function (x) { return x.pct; }), f.rounding) : [];
    var customBad = f.preset === 'custom' && Math.abs(pct - 100) > 1e-6;
    var isPsu = f.type === 'PSU';
    var psuBad = isPsu && (!f.perfEnd || (f.perfStart && f.perfEnd < f.perfStart) || !(num(f.multMax) >= num(f.multTarget) && num(f.multTarget) >= num(f.multMin) && num(f.multMin) >= 0));
    var can = f.grantDate && (!needsUnits || units > 0) && !customBad && !psuBad && (!schedule || steps.length);
    var norm = schedule ? V().normalizeSchedule(schedule) : null;
    var e = f.espp;
    var putE = function (k, v) { put('espp', Object.assign({}, f.espp, (function () { var o = {}; o[k] = v; return o; })())); };
    var updE = function (k) { return function (ev) { putE(k, ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value); }; };
    var esppContribution = function () {
      var c0 = g0.contribution || {}, hist = (c0.pctHistory || []).slice(), anchor = e.anchor || f.grantDate;
      if (hist.length) hist[0] = { from: hist[0].from, pct: num(e.pct) }; else hist = [{ from: anchor, pct: num(e.pct) }];
      return Object.assign({}, c0, {
        anchor: anchor, periodMonths: num(e.periodMonths), endDate: e.endDate || null, discountPct: num(e.discountPct), lookback: !!e.lookback,
        pctHistory: hist, eligible: e.eligible, customKinds: { base: true, bonus: e.kBonus, '13th': e.k13, other: e.kOther }, midPeriodDecrease: !!e.midPeriodDecrease,
        caps: { currency: String(e.capCurrency || '').toUpperCase() || null, periodAmount: num(e.capPeriod), yearAmount: num(e.capYear), periodShares: num(e.capPeriodShares),
          yearShares: num(e.capYearShares), offeringFmvYearAmount: num(e.capFmvYear), excess: e.capExcess },
        fxMode: e.fxMode, leftover: e.leftover, fractional: !!e.fractional, sellImmediately: !!e.sellImmediately
      });
    };
    var esppBad = f.type === 'ESPP' && (!(num(e.periodMonths) > 0) || !(num(e.discountPct) >= 0 && num(e.discountPct) < 100) || !(num(e.pct) >= 0 && num(e.pct) <= 100));
    var save = function () {
      if (!can || esppBad) return;
      props.onSave(Object.assign({}, g0, {
        id: g0.id || E().newId('grant'), planId: props.planId, type: f.type, name: f.name, grantDate: f.grantDate,
        units: needsUnits ? units : null, withholding: f.withholding,
        withholdingRate: num(f.withholdingRate) != null ? num(f.withholdingRate) / 100 : null,
        schedule: schedule, rounding: f.rounding, dividendEquivalents: f.dividendEquivalents,
        contribution: f.type === 'ESPP' ? esppContribution() : (g0.contribution || null),
        psu: isPsu ? Object.assign({}, g0.psu || {}, {
          perfStart: f.perfStart || f.grantDate, perfEnd: f.perfEnd, settleDate: f.settleDate || null,
          min: num(f.multMin), target: num(f.multTarget), max: num(f.multMax),
          post: f.post !== 'manual' ? { preset: f.post } : null
        }) : null
      }));
    };
    var editRow = function (i, k) {
      return function (e) {
        var v = e.target.value;
        put('custom', f.custom.map(function (x, j) { if (j !== i) return x; var o = Object.assign({}, x); o[k] = v; return o; }));
      };
    };
    var showFields = vesting && f.preset !== 'manual';
    var showPeriods = showFields && f.preset !== 'custom';
    return h('div', { 'data-testid': 'eq-grant-form' },
      h('div', { className: 'ui-form-grid' },
        h(UIC.Select, { label: __('eqGrantType', 'Type'), value: f.type, onChange: upd('type'), disabled: !!g0.id,
          options: E().GRANT_TYPES.map(function (t) { return { value: t, label: typeLabel(t) }; }) }),
        h(UIC.Input, { label: __('eqGrantName', 'Name (optional)'), value: f.name, onChange: upd('name') }),
        h(UIC.Input, { label: __('eqGrantDate', 'Grant date'), type: 'date', value: f.grantDate, onChange: upd('grantDate') }),
        needsUnits ? h(UIC.Input, { label: f.type === 'PSU' ? __('eqTargetUnits', 'Target units') : __('eqUnits', 'Units'), inputMode: 'decimal', value: f.units, onChange: upd('units') }) : null,
        needsUnits ? h(UIC.Select, { label: __('eqWithholding', 'Tax withholding'), value: f.withholding, onChange: upd('withholding'),
          options: [
            { value: 'sell_to_cover', label: __('eqWhSellToCover', 'Sell-to-cover (shares sold)') },
            { value: 'payroll', label: __('eqWhPayroll', 'Through payroll (no shares withheld)') },
            { value: 'none', label: __('eqWhNone', 'None') }] }) : null,
        needsUnits && f.withholding === 'sell_to_cover' ? h(UIC.Input, { label: __('eqWhRate', 'Shares withheld (%)'), inputMode: 'decimal', value: f.withholdingRate, onChange: upd('withholdingRate'),
          hint: __('eqWhRateHint', 'Estimate for auto vests; enter the real number per vest from the statement') }) : null),
      vesting ? h('div', { className: 'ui-form-grid', 'data-testid': 'eq-schedule' },
        h(UIC.Select, { label: __('eqSchedule', 'Vesting schedule'), value: f.preset, onChange: upd('preset'),
          options: PRESET_IDS.map(function (p) { return { value: p, label: presetLabel(p) }; }) }),
        showFields ? h(UIC.Input, { label: __('eqVestStart', 'Vesting start (optional)'), type: 'date', value: f.start, onChange: upd('start'), hint: __('eqVestStartHint', 'Empty = grant date') }) : null,
        showPeriods ? h(UIC.Input, { label: __('eqYears', 'Years'), inputMode: 'decimal', value: f.years, placeholder: norm ? String(norm.years) : '', onChange: upd('years') }) : null,
        showPeriods ? h(UIC.Input, { label: __('eqCliff', 'Cliff (months)'), inputMode: 'numeric', value: f.cliffMonths, placeholder: norm ? String(norm.cliffMonths) : '', onChange: upd('cliffMonths') }) : null,
        showPeriods ? h(UIC.Input, { label: __('eqFreq', 'Then every (months)'), inputMode: 'numeric', value: f.freqMonths, placeholder: norm ? String(norm.freqMonths) : '', onChange: upd('freqMonths') }) : null,
        showFields ? h(UIC.Select, { label: __('eqRounding', 'Fractional units'), value: f.rounding, onChange: upd('rounding'),
          options: E().ROUNDING.map(function (r) { return { value: r, label: roundingLabel(r) }; }) }) : null,
        showFields ? h(UIC.Select, { label: __('eqFmvSource', 'Market value at vest'), value: f.fmvSource, onChange: upd('fmvSource'),
          options: [{ value: 'close', label: __('eqFmvClose', 'Close of the vest day') }, { value: 'prevClose', label: __('eqFmvPrevClose', 'Close of the day before') }] }) : null) : null,
      vesting && f.preset === 'custom' ? h('div', { 'data-testid': 'eq-custom-tranches' },
        f.custom.map(function (c, i) {
          return h('div', { key: i, className: 'ui-form-grid' },
            h(UIC.Input, { label: __('eqTrancheDate', 'Tranche {n}: date', { n: i + 1 }), type: 'date', value: c.date, onChange: editRow(i, 'date') }),
            h(UIC.Input, { label: __('eqTranchePct', 'Share of the grant (%)'), inputMode: 'decimal', value: c.pct, onChange: editRow(i, 'pct') }),
            h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { size: 'sm', variant: 'quiet', disabled: f.custom.length < 2,
              onClick: function () { put('custom', f.custom.filter(function (x, j) { return j !== i; })); } }, __('eqRemove', 'Remove'))));
        }),
        h('div', { className: 'ui-view__bar' },
          h(UIC.Button, { size: 'sm', onClick: function () { put('custom', f.custom.concat([{ date: '', pct: '' }])); } }, __('eqAddTranche', '+ Tranche')),
          h('span', { className: customBad ? 'tone-loss' : 'num', role: customBad ? 'alert' : undefined }, __('eqPctSum', 'Sum: {pct}', { pct: I.pct(pct, 2) })))) : null,
      f.type === 'ESPP' ? h('div', { 'data-testid': 'eq-espp-fields' },
        h('div', { className: 'ui-form-grid' },
          h(UIC.Input, { label: __('eqOfferingStart', 'First offering starts'), type: 'date', value: e.anchor, onChange: updE('anchor'), hint: __('eqVestStartHint', 'Empty = grant date') }),
          h(UIC.Input, { label: __('eqPeriodMonths', 'Offering length (months)'), inputMode: 'numeric', value: e.periodMonths, onChange: updE('periodMonths') }),
          h(UIC.Input, { label: __('eqEndDate', 'Enrolment ends (optional)'), type: 'date', value: e.endDate, onChange: updE('endDate') }),
          h(UIC.Input, { label: __('eqDiscount', 'Discount (%)'), inputMode: 'decimal', value: e.discountPct, onChange: updE('discountPct') }),
          h(UIC.Input, { label: __('eqContribPct', 'Contribution (% of pay)'), inputMode: 'decimal', value: e.pct, onChange: updE('pct') }),
          h(UIC.Select, { label: __('eqEligible', 'Eligible pay'), value: e.eligible, onChange: updE('eligible'), options: [
            { value: 'base', label: __('eqEligBase', 'Base salary only') }, { value: 'base_bonus', label: __('eqEligBaseBonus', 'Base salary + bonus') },
            { value: 'custom', label: __('eqEligCustom', 'Chosen pay types') }] }),
          h(UIC.Select, { label: __('eqFxMode', 'Converted to the share currency'), value: e.fxMode, onChange: updE('fxMode'), options: [
            { value: 'purchase', label: __('eqFxAtPurchase', 'at the purchase date') }, { value: 'monthly', label: __('eqFxMonthly', 'each month') }] }),
          h(UIC.Select, { label: __('eqLeftover', 'Cash left after the purchase'), value: e.leftover, onChange: updE('leftover'), options: [
            { value: 'carry', label: __('eqCarry', 'carried to the next offering') }, { value: 'refund', label: __('eqRefund', 'refunded') }] })),
        e.eligible === 'custom' ? h('div', { className: 'ui-view__bar' },
          [['kBonus', __('eqIncBonus', 'Bonus')], ['k13', __('eqInc13th', '13th salary')], ['kOther', __('eqIncOther', 'Other pay')]].map(function (x) {
            return h('label', { key: x[0], className: 'ui-check' }, h('input', { type: 'checkbox', checked: e[x[0]], onChange: updE(x[0]) }), ' ', x[1]);
          })) : null,
        h('div', { className: 'ui-view__bar' },
          [['lookback', __('eqLookback', 'Lookback (lower of start and purchase price)')], ['midPeriodDecrease', __('eqMidDecrease', 'Decrease allowed during an offering')],
            ['fractional', __('eqFractional', 'Fractional shares')], ['sellImmediately', __('eqSellImmediately', 'Sell right after each purchase')]].map(function (x) {
            return h('label', { key: x[0], className: 'ui-check' }, h('input', { type: 'checkbox', checked: e[x[0]], onChange: updE(x[0]) }), ' ', x[1]);
          })),
        h('div', { className: 'ui-form-grid' },
          h(UIC.Input, { label: __('eqCapPeriod', 'Cap per offering (amount)'), inputMode: 'decimal', value: e.capPeriod, onChange: updE('capPeriod') }),
          h(UIC.Input, { label: __('eqCapYear', 'Cap per year (amount)'), inputMode: 'decimal', value: e.capYear, onChange: updE('capYear') }),
          h(UIC.Input, { label: __('eqCapCurrency', 'Cap currency'), value: e.capCurrency, onChange: updE('capCurrency'), list: 'eq-cur-list', hint: __('eqCapCurrencyHint', 'Empty = salary currency') }),
          h(UIC.Input, { label: __('eqCapPeriodShares', 'Max shares per offering'), inputMode: 'decimal', value: e.capPeriodShares, onChange: updE('capPeriodShares') }),
          h(UIC.Input, { label: __('eqCapYearShares', 'Max shares per year'), inputMode: 'decimal', value: e.capYearShares, onChange: updE('capYearShares') }),
          h(UIC.Input, { label: __('eqCapFmv', 'Yearly limit at the offering-start price (optional)'), inputMode: 'decimal', value: e.capFmvYear, onChange: updE('capFmvYear'),
            hint: __('eqCapFmvHint', 'e.g. 25,000 for US plans under § 423, in the share currency') }),
          h(UIC.Select, { label: __('eqCapExcess', 'Pay over the cap'), value: e.capExcess, onChange: updE('capExcess'), options: [
            { value: 'refund', label: __('eqRefund', 'refunded') }, { value: 'carry', label: __('eqCarry', 'carried to the next offering') }] }))) : null,
      isPsu ? h('div', { className: 'ui-form-grid', 'data-testid': 'eq-psu-fields' },
        h(UIC.Input, { label: __('eqPerfStart', 'Performance period from'), type: 'date', value: f.perfStart, onChange: upd('perfStart'), hint: __('eqVestStartHint', 'Empty = grant date') }),
        h(UIC.Input, { label: __('eqPerfEnd', 'Performance period to'), type: 'date', value: f.perfEnd, onChange: upd('perfEnd'), error: psuBad && !f.perfEnd ? __('eqPerfEndNeeded', 'Needed for the settlement date') : null }),
        h(UIC.Input, { label: __('eqSettleDate', 'Settlement date (optional)'), type: 'date', value: f.settleDate, onChange: upd('settleDate'), hint: __('eqSettleDateHint', 'Empty = end of the period') }),
        h(UIC.Input, { label: __('eqMultMin', 'Minimum (%)'), inputMode: 'decimal', value: f.multMin, onChange: upd('multMin') }),
        h(UIC.Input, { label: __('eqMultTarget', 'Target (%)'), inputMode: 'decimal', value: f.multTarget, onChange: upd('multTarget') }),
        h(UIC.Input, { label: __('eqMultMax', 'Maximum (%)'), inputMode: 'decimal', value: f.multMax, onChange: upd('multMax') }),
        h(UIC.Select, { label: __('eqPostVest', 'Vesting after the period'), value: f.post, onChange: upd('post'),
          options: PRESET_IDS.filter(function (p) { return p !== 'custom'; }).map(function (p) { return { value: p, label: p === 'manual' ? __('eqPostNone', 'None: all at settlement') : presetLabel(p) }; }) })) : null,
      vesting ? h('label', { className: 'ui-check' },
        h('input', { type: 'checkbox', checked: f.dividendEquivalents, onChange: function (e) { put('dividendEquivalents', e.target.checked); } }),
        ' ', __('eqDivEq', 'Dividend equivalents on unvested units')) : null,
      alloc.length ? h(UIC.Table, {
        caption: __('eqPreview', 'Preview'), 'data-testid': 'eq-schedule-preview', layout: 'table',
        columns: [
          { key: 'n', label: '#', render: function (r) { return String(r.n); } },
          { key: 'date', label: __('eqDate', 'Date'), render: function (r) { return I.date(r.date); } },
          { key: 'pct', label: '%', align: 'right', render: function (r) { return I.pct(r.pct, 2); } },
          { key: 'units', label: __('eqUnits', 'Units'), align: 'right', render: function (r) { return I.num(r.units, { min: 0, max: 4 }); } },
          { key: 'state', label: __('eqStatus', 'Status'), render: function (r) { return r.date <= today() ? __('eqVested', 'Vested') : __('eqProjected', 'Projected'); } }
        ],
        rows: steps.map(function (s, i) { return { id: i, n: i + 1, date: s.date, pct: s.pct, units: alloc[i] }; })
      }) : null,
      h('div', { className: 'ui-view__bar' },
        h(UIC.Button, { variant: 'primary', disabled: !can || esppBad, 'data-testid': 'eq-grant-save', onClick: save }, g0.id ? __('eqSave', 'Save') : __('eqAddGrant', 'Add grant')),
        props.onCancel ? h(UIC.Button, { variant: 'quiet', onClick: props.onCancel }, __('eqCancel', 'Cancel')) : null));
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

  // ---- tranches of one grant (Package 2) ------------------------------------------------
  function TrancheList(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n, M = E();
    var g = props.grant;
    if (!g) return null;
    var tr = M.tranchesOf(props.state, g.id), evs = M.eventsOf(props.state, g.id);
    var evOf = function (t) { return evs.filter(function (e) { return e.trancheId === t.id; })[0]; };
    var status = function (t) {
      return t.status === 'forfeited' ? __('eqForfeited', 'Forfeited') : t.status === 'settled' ? __('eqSettled', 'Settled')
        : t.status === 'vested' ? __('eqVested', 'Vested') : t.projected ? __('eqProjected', 'Projected') : __('eqUnvested', 'Unvested');
    };
    var de = g.dividendEquivalents && W.MaerminEquityVesting
      ? W.MaerminEquityVesting.dividendEquivalents(tr, W.MaerminEquityVesting.dividendsFromTransactions(props.transactions, props.plan.ticker), today(), g.grantDate) : [];
    var deSum = de.reduce(function (a, x) { return a + x.amount; }, 0);
    return h('div', { 'data-testid': 'eq-tranches-' + g.id },
      h(UIC.Table, {
        caption: __('eqTranches', 'Tranches'),
        columns: [
          { key: 'date', label: __('eqDate', 'Date'), phone: 'title', render: function (t) { return I.date(t.date); } },
          { key: 'units', label: __('eqUnits', 'Units'), align: 'right', phone: 'value', render: function (t) { return I.num(t.units, { min: 0, max: 4 }); } },
          { key: 'status', label: __('eqStatus', 'Status'), phone: 'meta', render: function (t) { return status(t); } },
          { key: 'ev', label: __('eqFmvShort', 'FMV'), align: 'right', phone: 'sub', render: function (t) {
            var e = evOf(t);
            if (e) return props.privacy ? '••••••' : I.moneyAuto(e.fmv, e.shareCurrency) + (e.fmvDate && e.fmvDate !== e.date ? ' (' + I.date(e.fmvDate) + ')' : '');
            return t.status === 'vested' ? h('span', { className: 'tone-warning' }, __('eqNoPriceYet', 'no price yet - loads with the history, or book it by hand')) : '–';
          } }
        ],
        rows: tr,
        rowActions: function (t) {
          if (t.status === 'unvested') return [{ label: __('eqMarkForfeited', 'Mark as forfeited'), danger: true, onClick: function () { props.onSetStatus(t, 'forfeited'); } }];
          if (t.status === 'forfeited') return [{ label: __('eqUnforfeit', 'Not forfeited'), onClick: function () { props.onSetStatus(t, 'unvested'); } }];
          return [];
        }
      }),
      de.length ? h('p', { className: 'ui-note', 'data-testid': 'eq-div-eq' },
        __('eqDivEqSum', 'Dividend equivalents on unvested units: {n} {n:payout|payouts}, {amount} in total. Taxed as wage (not as a dividend); shown, not booked.', {
          n: de.length, amount: props.privacy ? '••••••' : I.moneyAuto(deSum, (W.MaerminEquityVesting.dividendsFromTransactions(props.transactions, props.plan.ticker)[0] || {}).currency || props.plan.shareCurrency) })) : null);
  }

  // ---- PSU: scenarios and settlement (Package 3) ----------------------------------------
  function PsuPanel(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n, EV = W.MaerminEquityVesting;
    var g = props.grant, p = EV.psuInfo(g);
    var _f = React.useState(null), form = _f[0], setForm = _f[1];   // null | { actual, date }
    var px = props.priceEUR(props.plan);
    var sc = EV.psuScenarios(g, px);
    var settled = p.actual != null;
    var label = { low: __('eqScenLow', 'Low'), target: __('eqScenTarget', 'Target'), high: __('eqScenHigh', 'High') };
    var units = function (u) { return I.num(u, { min: 0, max: 4 }); };
    return h('div', { className: 'ui-card', 'data-testid': 'eq-psu-' + g.id },
      h('b', null, typeLabel(g.type) + (g.name ? ' · ' + g.name : '')),
      h('p', { className: 'ui-note' },
        __('eqPsuPeriod', 'Performance period {from} – {to}; settlement {date}.', { from: p.perfStart ? I.date(p.perfStart) : '–', to: p.perfEnd ? I.date(p.perfEnd) : '–', date: p.vestDate ? I.date(p.vestDate) : '–' })),
      settled
        ? h('p', { 'data-testid': 'eq-psu-settled' }, __('eqPsuSettled', 'Settled at {pct}: {units} units instead of {target} target units.', { pct: I.pct(p.actual, 0), units: units(EV.psuSettledUnits(g)), target: units(g.units) }))
        : h('div', { className: 'ui-ov-tiles', 'data-testid': 'eq-psu-scenarios' }, sc.map(function (x) {
          return h(UIC.Stat, { key: x.key, label: label[x.key] + ' (' + I.pct(x.pct, 0) + ')', value: units(x.units) + ' ' + __('eqUnitsShort', 'units'),
            sub: x.value != null ? (props.privacy ? '••••••' : props.money(x.value)) + ' · ' + __('eqAtToday', 'at the current price') : __('eqNoPrice', 'no price') });
        })),
      form ? h('div', { className: 'ui-form-grid', 'data-testid': 'eq-psu-settle' },
        h(UIC.Input, { label: __('eqActualMult', 'Actual multiplier (%)'), inputMode: 'decimal', value: form.actual, onChange: function (e) { setForm(Object.assign({}, form, { actual: e.target.value })); },
          hint: __('eqActualMultHint', 'From the settlement letter, e.g. 120') }),
        h(UIC.Input, { label: __('eqSettleDate', 'Settlement date (optional)'), type: 'date', value: form.date, onChange: function (e) { setForm(Object.assign({}, form, { date: e.target.value })); } }),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'primary', disabled: !(num(form.actual) >= 0) || !form.date, 'data-testid': 'eq-psu-settle-save',
          onClick: function () { props.onSettle(g, num(form.actual), form.date); setForm(null); } }, __('eqSettle', 'Settle'))),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'quiet', onClick: function () { setForm(null); } }, __('eqCancel', 'Cancel')))) : null,
      !form ? h('div', { className: 'ui-view__bar' },
        h(UIC.Button, { size: 'sm', 'data-testid': 'eq-psu-settle-open', onClick: function () { setForm({ actual: settled ? String(p.actual) : '', date: p.vestDate || today() }); } },
          settled ? __('eqSettleEdit', 'Change settlement') : __('eqSettleOpen', 'Enter settlement')),
        settled ? h(UIC.Button, { size: 'sm', variant: 'quiet', onClick: function () { props.onSettle(g, null, null); } }, __('eqSettleUndo', 'Undo settlement')) : null) : null);
  }

  // ---- income timeline (Package 4) ---------------------------------------------------
  // Salary, bonus, 13th salary: what ESPP contributions are calculated from.
  function incomeKindLabel(k) {
    return k === 'base' ? __('eqIncBase', 'Base salary') : k === 'bonus' ? __('eqIncBonus', 'Bonus')
      : k === '13th' ? __('eqInc13th', '13th salary') : __('eqIncOther', 'Other pay');
  }
  function IncomeCard(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n;
    var entries = (props.income && props.income.entries) || [];
    var blank = { id: null, from: today(), to: '', kind: 'base', period: 'year', amount: '', currency: props.defaultCurrency || 'EUR', ftePct: '100', note: '' };
    var _f = React.useState(null), form = _f[0], setForm = _f[1];
    var upd = function (k) { return function (e) { var v = e.target.value; setForm(function (o) { var n = Object.assign({}, o); n[k] = v; if (k === 'kind') n.period = v === 'base' ? 'year' : 'once'; return n; }); }; };
    var RC = W.MaerminReporting;
    var save = function () {
      var e = { id: form.id || E().newId('inc'), from: form.from, to: form.to || null, kind: form.kind, period: form.period, amount: num(form.amount),
        currency: String(form.currency || '').toUpperCase(), ftePct: num(form.ftePct), note: form.note };
      var list = form.id ? entries.map(function (x) { return x.id === form.id ? e : x; }) : entries.concat([e]);
      props.onChange({ entries: list });
      setForm(null);
    };
    var can = form && form.from && num(form.amount) != null && num(form.amount) >= 0 && (!RC || RC.isValid(String(form.currency || '').toUpperCase()));
    var amountText = function (x) { return props.privacy ? '••••••' : I.moneyAuto(x.amount, x.currency) + (x.period === 'year' ? ' / ' + __('eqPerYear', 'year') : x.period === 'month' ? ' / ' + __('eqPerMonth', 'month') : ''); };
    return h(UIC.Card, { title: __('eqIncome', 'Income for ESPP'), subtitle: __('eqIncomeSub', 'Contributions are a % of this pay. Stays encrypted on your device.'), 'data-testid': 'eq-income',
      action: !form ? h(UIC.Button, { size: 'sm', onClick: function () { setForm(blank); }, 'data-testid': 'eq-income-add' }, __('eqIncomeAdd', '+ Pay')) : null },
      h(UIC.Table, {
        caption: __('eqIncome', 'Income for ESPP'),
        columns: [
          { key: 'from', label: __('eqFrom', 'From'), phone: 'title', render: function (x) { return I.date(x.from) + (x.to ? ' – ' + I.date(x.to) : ''); } },
          { key: 'kind', label: __('eqGrantType', 'Type'), phone: 'meta', render: function (x) { return incomeKindLabel(x.kind) + (x.ftePct !== 100 ? ' · ' + I.pct(x.ftePct, 0) : '') + (x.note ? ' · ' + x.note : ''); } },
          { key: 'amount', label: __('eqAmount', 'Amount'), align: 'right', phone: 'value', render: amountText }
        ],
        rows: entries,
        rowActions: function (x) {
          return [{ label: __('eqEdit', 'Edit'), onClick: function () { setForm(Object.assign({}, x, { to: x.to || '', amount: String(x.amount), ftePct: String(x.ftePct) })); } },
            { label: __('eqDelete', 'Delete'), danger: true, onClick: function () { props.onChange({ entries: entries.filter(function (y) { return y.id !== x.id; }) }); } }];
        },
        empty: h('p', { className: 'ui-note' }, __('eqIncomeEmpty', 'No pay entered yet: ESPP contributions need it (or enter each payslip deduction).'))
      }),
      form ? h('div', { className: 'ui-form-grid', 'data-testid': 'eq-income-form' },
        h(UIC.Select, { label: __('eqGrantType', 'Type'), value: form.kind, onChange: upd('kind'),
          options: E().INCOME_KINDS.map(function (k) { return { value: k, label: incomeKindLabel(k) }; }) }),
        h(UIC.Input, { label: form.period === 'once' ? __('eqPaidOn', 'Paid on') : __('eqFrom', 'From'), type: 'date', value: form.from, onChange: upd('from') }),
        form.period !== 'once' ? h(UIC.Input, { label: __('eqTo', 'Until (optional)'), type: 'date', value: form.to, onChange: upd('to') }) : null,
        h(UIC.Select, { label: __('eqPeriod', 'Amount per'), value: form.period, onChange: upd('period'),
          options: [{ value: 'year', label: __('eqPerYear', 'year') }, { value: 'month', label: __('eqPerMonth', 'month') }, { value: 'once', label: __('eqOnce', 'once') }] }),
        h(UIC.Input, { label: __('eqAmountGross', 'Gross amount'), inputMode: 'decimal', value: form.amount, onChange: upd('amount'), hint: form.kind === 'base' ? __('eqLeaveHint', 'Parental leave or unpaid time: an entry of 0 for that period') : null }),
        h(UIC.Input, { label: __('eqSalaryCurrency', 'Salary currency'), value: form.currency, onChange: upd('currency'), list: 'eq-cur-list' }),
        form.kind === 'base' ? h(UIC.Input, { label: __('eqFte', 'Working time (%)'), inputMode: 'decimal', value: form.ftePct, onChange: upd('ftePct') }) : null,
        h(UIC.Input, { label: __('eqNote', 'Note'), value: form.note, onChange: upd('note') }),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'primary', disabled: !can, onClick: save, 'data-testid': 'eq-income-save' }, __('eqSave', 'Save'))),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'quiet', onClick: function () { setForm(null); } }, __('eqCancel', 'Cancel')))) : null);
  }

  // ---- ESPP panel (Package 4) ----------------------------------------------------------
  function warnText(w, I) {
    var amt = I.moneyAuto(w.excess, w.currency);
    return w.kind === 'bonusOverCap' ? __('eqWarnBonusCap', '{month}: the bonus month passes the cap by {amount}', { month: w.month, amount: amt })
      : w.kind === 'overCap' ? __('eqWarnCap', '{month}: over the cap by {amount}', { month: w.month, amount: amt })
        : __('eqWarnShares', '{month}: share limit reached, {amount} not invested', { month: w.month, amount: amt });
  }
  function EsppPanel(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n, ES = W.MaerminEquityEspp;
    var g = props.grant, plan = props.plan;
    var sc = ES.schedule(props.state, g, props.equityOpts);
    var s = sc.settings;
    var _p = React.useState(null), pctForm = _p[0], setPctForm = _p[1];
    var hide = function (t) { return props.privacy ? '••••••' : t; };
    var money = function (v, c) { return hide(I.moneyAuto(v, c)); };
    var open = sc.open;
    var setContribution = function (patch) { props.onUpdateGrant(Object.assign({}, g, { contribution: Object.assign({}, g.contribution, patch) })); };
    var setActual = function (m, v) {
      var a = Object.assign({}, (g.contribution || {}).actuals || {});
      var n = num(v);
      if (n == null) delete a[m]; else a[m] = n;
      setContribution({ actuals: a });
    };
    var done = sc.offerings.filter(function (r) { return r.purchase; });
    var rc = done.length ? ES.returnOnCash(sc, plan, props.baseCurrency, props.equityOpts.fxCtx) : null;
    // lookback: the highest price the current offering can cost, and the gain it locks in
    var series = props.equityOpts.closes(plan.ticker);
    var startPx = open && W.MaerminEquityVesting.fmvOn(series, open.start, 'close');
    var maxPrice = open && s.lookback && startPx ? startPx.fmv * (1 - s.discountPct / 100) : null;
    var minGain = open && maxPrice && open.cash > 0 ? open.cash * s.discountPct / (100 - s.discountPct) : null;
    return h('div', { className: 'ui-card', 'data-testid': 'eq-espp-' + g.id },
      h('b', null, typeLabel(g.type) + (g.name ? ' · ' + g.name : '')),
      h('p', { className: 'ui-note' }, __('eqEsppTerms', '{pct} of pay · {disc} discount{lookback} · offerings of {months} months · cash {cur}', {
        pct: I.pct((s.pctHistory[s.pctHistory.length - 1] || { pct: 0 }).pct, 1), disc: I.pct(s.discountPct, 1),
        lookback: s.lookback ? ' ' + __('eqWithLookback', 'with lookback') : '', months: s.periodMonths, cur: sc.cashCurrency })),
      h('div', { className: 'ui-ov-tiles' },
        h(UIC.Stat, { label: __('nwEsppCash', 'ESPP cash'), value: money(sc.cash, sc.cashCurrency), sub: open ? __('eqOfferingRuns', 'Offering {from} – {to}', { from: I.date(open.start), to: I.date(open.end) }) : __('eqNoOpenOffering', 'No open offering') }),
        maxPrice ? h(UIC.Stat, { label: __('eqMaxPrice', 'Highest purchase price'), value: hide(I.moneyAuto(maxPrice, plan.shareCurrency)),
          sub: minGain ? __('eqMinGain', 'locks in at least {amount} if the price stays above the start', { amount: money(minGain, sc.cashCurrency) }) : null }) : null,
        (function () {
          var om = ownVsMatch(props.state, g);
          return om.matchVested + om.matchUnvested + om.matchForfeited > 0 || W.MaerminEquityMatch && W.MaerminEquityMatch.rules(plan).length
            ? h(UIC.Stat, { label: __('eqOwnVsMatch', 'Own / match shares'), value: I.num(om.own, { min: 0, max: 4 }) + ' / ' + I.num(om.matchVested + om.matchUnvested, { min: 0, max: 4 }), 'data-testid': 'eq-own-match',
              sub: __('eqMatchSplit', 'match: {v} vested, {u} unvested{f}', { v: I.num(om.matchVested, { min: 0, max: 4 }), u: I.num(om.matchUnvested, { min: 0, max: 4 }),
                f: om.matchForfeited ? ', ' + __('eqMatchForfeitedN', '{n} forfeited', { n: I.num(om.matchForfeited, { min: 0, max: 4 }) }) : '' }) }) : null;
        })(),
        rc && rc.salary != null ? h(UIC.Stat, { label: __('eqReturnOnCash', 'Return on contributed cash'), value: I.pct(rc.salary * 100, 1) + ' ' + __('eqPa', 'p.a.'),
          sub: (rc.base != null && props.baseCurrency !== sc.cashCurrency ? __('eqInBase', 'in {cur}: {pct} p.a.', { cur: props.baseCurrency, pct: I.pct(rc.base * 100, 1) }) + ' · ' : '')
            + __('eqReturnNote', 'annualised: each deduction is in the plan for a few months only') }) : null),
      open ? h(UIC.Table, {
        caption: __('eqOpenMonths', 'This offering'), 'data-testid': 'eq-espp-months', layout: 'table',
        columns: [
          { key: 'm', label: __('eqMonth', 'Month'), render: function (x) { return x.month; } },
          { key: 'el', label: __('eqEligiblePay', 'Eligible pay'), align: 'right', priority: 2, render: function (x) { return money(x.eligible, x.currency); } },
          { key: 'calc', label: __('eqCalculated', 'Calculated'), align: 'right', render: function (x) { return money(x.calculated, x.currency); } },
          { key: 'act', label: __('eqPayslip', 'Payslip'), align: 'right', render: function (x) {
            return h('input', { className: ['ui-input', 'num'].join(' '), inputMode: 'decimal', 'aria-label': __('eqPayslipFor', 'Deduction on the payslip for {month}', { month: x.month }),
              defaultValue: x.actual != null ? String(x.actual) : '', placeholder: String(x.calculated), size: 8,
              onBlur: function (e) { if (String(e.target.value) !== (x.actual != null ? String(x.actual) : '')) setActual(x.month, e.target.value); } });
          } },
          { key: 'st', label: __('eqStatus', 'Status'), render: function (x) { return x.withdrawn ? __('eqWithdrawn', 'Withdrawn') : x.confirmed ? __('eqConfirmed', 'Confirmed') : __('eqCalculatedShort', 'Calculated'); } }
        ],
        rows: open.months.map(function (x) { return Object.assign({ id: x.month }, x); }),
        empty: h('p', { className: 'ui-note' }, __('eqNoMonthYet', 'No payroll month in this offering yet.'))
      }) : null,
      open && (open.headroom.period != null || open.headroom.year != null) ? h('p', { className: 'ui-note', 'data-testid': 'eq-espp-headroom' },
        __('eqHeadroom', 'Room left under the cap: {period} this offering, {year} this year', {
          period: open.headroom.period != null ? money(open.headroom.period, open.headroom.currency) : '–', year: open.headroom.year != null ? money(open.headroom.year, open.headroom.currency) : '–' })) : null,
      sc.offerings.some(function (r) { return r.warnings.length; }) ? h('ul', { className: 'ui-note', 'data-testid': 'eq-espp-warnings' },
        sc.offerings.reduce(function (a, r) { return a.concat(r.warnings); }, []).map(function (w, i) { return h('li', { key: i, className: 'tone-warning' }, warnText(w, I) + (s.caps.excess === 'carry' ? ' · ' + __('eqCarried', 'carried over') : ' · ' + __('eqRefunded', 'refunded'))); })) : null,
      done.length ? h(UIC.Table, {
        caption: __('eqPurchases', 'Purchases'), 'data-testid': 'eq-espp-purchases',
        columns: [
          { key: 'end', label: __('eqPurchaseDate', 'Purchase date'), phone: 'title', render: function (r) { return I.date(r.end); } },
          { key: 'paid', label: __('eqContributed', 'Contributed'), align: 'right', priority: 2, render: function (r) { return money(r.contributed + r.carryIn, r.currency); } },
          { key: 'units', label: __('eqUnitsShort', 'units'), align: 'right', phone: 'value', render: function (r) { return I.num(r.purchase.units, { min: 0, max: 4 }); } },
          { key: 'price', label: __('eqPrice', 'Price'), align: 'right', phone: 'meta', render: function (r) { return hide(I.moneyAuto(r.purchase.price, plan.shareCurrency)) + ' / ' + hide(I.moneyAuto(r.purchase.fmvEnd, plan.shareCurrency)); } },
          { key: 'gain', label: __('eqDiscountGain', 'Discount + lookback'), align: 'right', priority: 2, render: function (r) {
            return r.purchase.manual ? '–' : hide(I.moneyAuto(r.purchase.discountAmount, plan.shareCurrency)) + ' + ' + hide(I.moneyAuto(r.purchase.lookbackGain, plan.shareCurrency)); } },
          { key: 'eff', label: __('eqEffDiscount', 'Eff. discount'), align: 'right', phone: 'sub', render: function (r) { return r.purchase.manual ? '–' : I.pct(r.purchase.effectiveDiscountPct, 1); } },
          { key: 'match', label: __('eqMatchCol', 'Match'), align: 'right', priority: 2, render: function (r) {
            var ev = props.state.events.filter(function (e) { return e.grantId === g.id && e.kind === 'purchase' && e.date === r.end; })[0];
            if (!ev || !W.MaerminEquityMatch) return '–';
            var ps = W.MaerminEquityMatch.purchaseSummary(props.state, ev);
            return ps.matchUnits ? I.num(ps.matchUnits, { min: 0, max: 4 }) + ' · ' + hide(I.moneyAuto(ps.matchValue, plan.shareCurrency)) : '–';
          } },
          { key: 'free', label: __('eqFreeValue', 'Free value / on own money'), align: 'right', priority: 3, render: function (r) {
            var ev = props.state.events.filter(function (e) { return e.grantId === g.id && e.kind === 'purchase' && e.date === r.end; })[0];
            if (!ev || !W.MaerminEquityMatch) return '–';
            var ps = W.MaerminEquityMatch.purchaseSummary(props.state, ev);
            return hide(I.moneyAuto(ps.free, plan.shareCurrency)) + (ps.returnOnOwn != null ? ' · ' + I.pct(ps.returnOnOwn * 100, 1) : '');
          } },
          { key: 'rest', label: __('eqRefundCarry', 'Refund / carry'), align: 'right', priority: 3, render: function (r) { return money(r.refund, r.currency) + ' / ' + money(r.carryOut, r.currency); } }
        ],
        rows: done.slice().reverse().map(function (r) { return Object.assign({ id: r.start }, r); })
      }) : null,
      sc.missing.length ? h('p', { className: 'ui-note tone-warning' }, __('eqEsppMissing', '{n} {n:purchase waits|purchases wait} for price or rate history.', { n: sc.missing.length })) : null,
      pctForm ? h('div', { className: 'ui-form-grid', 'data-testid': 'eq-espp-pct' },
        h(UIC.Input, { label: __('eqNewPct', 'New contribution (%)'), inputMode: 'decimal', value: pctForm.pct, onChange: function (e) { setPctForm(Object.assign({}, pctForm, { pct: e.target.value })); } }),
        h(UIC.Input, { label: __('eqFrom', 'From'), type: 'date', value: pctForm.from, onChange: function (e) { setPctForm(Object.assign({}, pctForm, { from: e.target.value })); },
          hint: s.midPeriodDecrease ? __('eqPctHintDecrease', 'A decrease counts from this month; an increase from the next offering') : __('eqPctHintOffering', 'Counts from the next offering start') }),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'primary', disabled: !(num(pctForm.pct) >= 0) || !pctForm.from,
          onClick: function () { setContribution({ pctHistory: ((g.contribution || {}).pctHistory || []).concat([{ from: pctForm.from, pct: num(pctForm.pct) }]) }); setPctForm(null); } }, __('eqSave', 'Save'))),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'quiet', onClick: function () { setPctForm(null); } }, __('eqCancel', 'Cancel')))) : null,
      h('div', { className: 'ui-view__bar' },
        !pctForm ? h(UIC.Button, { size: 'sm', onClick: function () { setPctForm({ pct: '', from: today() }); } }, __('eqChangePct', 'Change contribution %')) : null,
        open && !s.withdrawals.length ? h(UIC.Button, { size: 'sm', variant: 'danger', onClick: function () {
          W.MaerminUtils.confirmThen({ title: __('eqWithdrawConfirm', 'Withdraw from the ESPP? Contributions stop and this offering\'s cash is refunded.'), confirmLabel: __('eqWithdraw', 'Withdraw'), cancelLabel: __('cancel', 'Cancel') },
            function () { setContribution({ withdrawals: [{ date: today() }] }); });
        } }, __('eqWithdraw', 'Withdraw')) : null));
  }

  // ---- ESPP forecast (Package 4) -------------------------------------------------------
  // Estimates only: never stored, never lots. The chart shows the cash put in
  // against the value of all ESPP shares (P10-P90 band, P50 line), with a
  // marker on each purchase date.
  function ForecastChart(props) {
    var h = W.React.createElement, I = W.MaerminI18n;
    var sc = props.scenarios, p10 = sc.p10 || sc.flat, p50 = sc.p50 || sc.flat, p90 = sc.p90 || sc.flat;
    var rows = (p50 || {}).rows || [];
    if (!rows.length) return null;
    var w = 640, hgt = 220, pad = { l: 8, r: 8, t: 12, b: 24 };
    var vals = [0];
    [p10, p50, p90].forEach(function (s) { s.rows.forEach(function (r) { vals.push(r.cumValue || 0, r.cumInvested || 0); }); });
    var max = Math.max.apply(null, vals) || 1;
    var x = function (i) { return pad.l + (rows.length === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (rows.length - 1)); };
    var y = function (v) { return hgt - pad.b - (v / max) * (hgt - pad.t - pad.b); };
    var line = function (s, key) { return s.rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[key] || 0).toFixed(1); }).join(' '); };
    var band = p90.rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.cumValue || 0).toFixed(1); }).join(' ')
      + ' ' + p10.rows.slice().reverse().map(function (r, j) { var i = p10.rows.length - 1 - j; return 'L' + x(i).toFixed(1) + ' ' + y(r.cumValue || 0).toFixed(1); }).join(' ') + ' Z';
    return h('figure', { className: 'ui-chart', 'data-testid': 'eq-forecast-chart' },
      h('svg', { viewBox: '0 0 ' + w + ' ' + hgt, width: '100%', role: 'img', 'aria-label': __('eqChartLabel', 'Cash put in vs value of all ESPP shares (estimate)') },
        h('path', { d: band, fill: 'var(--chart-1)', opacity: 0.18, stroke: 'none' }),
        h('path', { d: line(p50, 'cumValue'), fill: 'none', stroke: 'var(--chart-1)', strokeWidth: 2 }),
        h('path', { d: line(p50, 'cumInvested'), fill: 'none', stroke: 'var(--text-dim)', strokeWidth: 2, strokeDasharray: '5 4' }),
        rows.map(function (r, i) {
          return h('g', { key: r.date },
            h('circle', { cx: x(i), cy: y(r.cumValue || 0), r: 3.5, fill: 'var(--chart-1)' }),
            h('text', { x: x(i), y: hgt - 6, textAnchor: i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle', fontSize: 11, fill: 'var(--text-dim)' }, I.date(r.date)));
        })),
      h('figcaption', { className: 'ui-chart__legend' },
        h('span', null, '— ' + __('eqLegendValue', 'value of all ESPP shares (P50; band P10–P90)')), ' ',
        h('span', null, '- - ' + __('eqLegendInvested', 'cash put in'))));
  }

  function EsppForecast(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n, FC = W.MaerminEquityForecast;
    var s0 = props.settings;
    var curPct = (s0.pctHistory[s0.pctHistory.length - 1] || { pct: 0 }).pct;
    var _c = React.useState({ horizon: '1y', pct: curPct, raise: 0, price: 0, fx: 0, band: 0, repeat: true, seed: 42 }), c = _c[0], setC = _c[1];
    var put = function (k, v) { setC(Object.assign({}, c, (function () { var o = {}; o[k] = v; return o; })())); };
    var f = React.useMemo(function () {
      try {
        return FC.espp(props.state, props.grant, Object.assign({}, props.equityOpts, {
          base: props.baseCurrency, horizon: c.horizon, pct: c.pct !== curPct ? c.pct : null, raisePct: c.raise, priceShiftPct: c.price,
          fxShiftPct: c.fx, fxBandPct: c.band, repeatOneOffs: c.repeat, seed: c.seed, paths: 600 }));
      } catch (e) { return null; }
    }, [props.state, props.grant, props.equityOpts, props.baseCurrency, c]);
    var by = {};
    ((f && f.scenarios) || []).forEach(function (s) { by[s.name] = s; });
    var money = function (v) { return props.privacy ? '••••••' : v == null ? '–' : I.moneyAuto(v, props.baseCurrency); };
    var units = function (u) { return I.num(u, { min: 0, max: 2 }); };
    var slider = function (k, label, min, max, step, fmt) {
      return h('label', { className: 'ui-field', key: k },
        h('span', { className: 'ui-field__label' }, label + ': ' + fmt(c[k])),
        h('input', { type: 'range', min: min, max: max, step: step, value: c[k], 'aria-label': label, onChange: function (e) { put(k, Number(e.target.value)); } }));
    };
    var pctFmt = function (v) { return I.pct(v, 0); };
    var signed = function (v) { return (v > 0 ? '+' : '') + I.pct(v, 0); };
    var names = ['flat', 'cagr-20', 'cagr10', 'cagr20', 'p10', 'p50', 'p90'];
    var nameLabel = function (n) {
      return n === 'flat' ? __('eqScenFlat', 'Price stays') : n.indexOf('cagr') === 0 ? __('eqScenCagr', '{pct} p.a.', { pct: signed(Number(n.slice(4))) })
        : n.toUpperCase() + ' ' + __('eqScenMc', '(simulation)');
    };
    var flat = by.flat;
    var discEff = flat && flat.rows.length ? flat.rows.reduce(function (a, r) { return a + r.effectiveDiscountPct; }, 0) / flat.rows.length : null;
    return h('div', { className: 'ui-card', 'data-testid': 'eq-forecast-' + props.grant.id },
      h('b', null, __('eqForecast', 'Forecast')), ' ', h(UIC.Badge, { tone: 'warning' }, __('eqEstimate', 'Estimate')),
      h('p', { className: 'ui-note' }, __('eqForecastNote', 'Future contributions from your income timeline; prices flat, at a yearly rate or simulated from the stock\'s own history (seeded, reproducible). Nothing here is booked.')),
      h(UIC.Segmented, { label: __('eqHorizon', 'Horizon'), value: c.horizon, onChange: function (v) { put('horizon', v); }, options: [
        { value: 'period', label: __('eqHorizonPeriod', 'This offering') }, { value: '1y', label: __('eqHorizon1', '1 year') },
        { value: '3y', label: __('eqHorizon3', '3 years') }, { value: '5y', label: __('eqHorizon5', '5 years') }] }),
      h('div', { className: 'ui-form-grid', 'data-testid': 'eq-whatif' },
        slider('pct', __('eqWhatPct', 'Contribution'), 0, 25, 1, pctFmt),
        slider('raise', __('eqWhatRaise', 'Raise per year'), 0, 10, 0.5, pctFmt),
        slider('price', __('eqWhatPrice', 'Share price now'), -50, 50, 5, signed),
        slider('fx', __('eqWhatFx', 'Share currency now'), -20, 20, 1, signed),
        slider('band', __('eqWhatBand', 'FX band ± per year'), 0, 10, 1, pctFmt)),
      h('label', { className: 'ui-check' }, h('input', { type: 'checkbox', checked: c.repeat, onChange: function (e) { put('repeat', e.target.checked); } }), ' ', __('eqRepeatBonus', 'Repeat last year\'s bonus months')),
      !f || f.missing ? h('p', { className: 'ui-note tone-warning' }, __('eqForecastNoPrice', 'No current price for the share yet: the forecast needs its price history.')) : null,
      f && !f.mc && f.scenarios && f.scenarios.length ? h('p', { className: 'ui-note' }, __('eqNoMc', 'Less than 2 years of price history: no simulation, only the yearly-rate scenarios.')) : null,
      flat ? h('div', { className: 'ui-ov-tiles' },
        h(UIC.Stat, { label: __('eqFcInvested', 'Cash put in'), value: money(flat.invested), sub: __('eqFcPurchases', '{n} {n:purchase|purchases} until {date}', { n: flat.rows.length, date: I.date(f.end) }) }),
        h(UIC.Stat, { label: __('eqFcShares', 'Shares bought'), value: units(flat.units) + (by.p10 ? ' (' + units(by.p90.units) + ' – ' + units(by.p10.units) + ')' : ''), sub: __('eqFcSharesSub', 'flat price (range: P90 – P10 price)') }),
        h(UIC.Stat, { label: __('eqFcValue', 'Value of these shares'), value: money(by.p50 ? by.p50.value : flat.value), sub: by.p10 ? __('eqFcBand', 'P10 {lo} – P90 {hi}', { lo: money(by.p10.value), hi: money(by.p90.value) }) : __('eqScenFlat', 'Price stays') }),
        discEff != null ? h(UIC.Stat, { label: __('eqEffDiscountAvg', 'Effective discount'), value: I.pct(discEff, 1), sub: props.matchPct ? __('eqInclMatch', 'incl. match: {pct}', { pct: I.pct(props.matchPct(discEff), 1) }) : __('eqLookbackIncl', 'incl. lookback, flat price') }) : null,
        flat.warnings ? h(UIC.Stat, { label: __('eqFcCap', 'Cap'), value: String(flat.warnings), sub: __('eqFcCapSub', 'months over the cap (see the plan settings)') }) : null) : null,
      f && f.fx ? h('p', { className: 'ui-note', 'data-testid': 'eq-fx-band' }, __('eqFxBandText', 'FX band ±{pct} p.a. (flat price): {lo} – {hi}', { pct: I.pct(f.fx.pct, 0), lo: money(Math.min(f.fx.low.value, f.fx.high.value)), hi: money(Math.max(f.fx.low.value, f.fx.high.value)) })) : null,
      flat ? h(ForecastChart, { scenarios: by }) : null,
      flat ? h(UIC.Table, {
        caption: __('eqFcTable', 'Purchases by scenario'), 'data-testid': 'eq-forecast-table',
        columns: [{ key: 'n', label: __('eqScenario', 'Scenario'), phone: 'title', render: function (s) { return nameLabel(s.name); } },
          { key: 'units', label: __('eqFcShares', 'Shares bought'), align: 'right', phone: 'value', render: function (s) { return units(s.units); } },
          { key: 'inv', label: __('eqFcInvested', 'Cash put in'), align: 'right', priority: 2, render: function (s) { return money(s.invested); } },
          { key: 'val', label: __('eqFcValueEnd', 'Value at the end'), align: 'right', phone: 'sub', render: function (s) { return money(s.value); } },
          { key: 'gain', label: __('eqDiscountGain', 'Discount + lookback'), align: 'right', priority: 3, render: function (s) { return money(s.rows.reduce(function (a, r) { return a + (r.discountGainBase || 0); }, 0)); } }],
        rows: names.filter(function (n) { return by[n]; }).map(function (n) { return Object.assign({ id: n }, by[n]); })
      }) : null,
      f && f.mc ? h('p', { className: 'ui-note' }, __('eqMcSeed', 'Simulation: {n} paths, seed {seed}', { n: f.mc.paths, seed: f.mc.seed }), ' ',
        h('input', { className: 'ui-input', type: 'number', 'aria-label': __('eqSeed', 'Seed'), value: c.seed, style: { width: '6em' }, onChange: function (e) { put('seed', Number(e.target.value) || 1); } })) : null);
  }

  // ---- employer match rules (Package 5) ------------------------------------------------
  function MatchRules(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n, EM = W.MaerminEquityMatch;
    var plan = props.plan, rules = EM.rules(plan);
    var blank = { from: today(), pct: '25', basis: 'purchase_value', ratioFree: '1', ratioPer: '3', delivery: 'vesting', years: '2', cliffMonths: '24', freqMonths: '24',
      capYear: '', capPeriod: '', capShares: '', forfeitOnLeave: true, forfeitOnSale: true, fractional: false };
    var _f = React.useState(null), form = _f[0], setForm = _f[1];
    var upd = function (k) { return function (e) { var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm(function (o) { var n = Object.assign({}, o); n[k] = v; return n; }); }; };
    var describe = function (r) {
      var what = r.basis === 'ratio' ? __('eqMatchRatioText', '{free} free per {per} bought', { free: I.num(r.ratioFree, { min: 0, max: 2 }), per: I.num(r.ratioPer, { min: 0, max: 2 }) })
        : r.basis === 'own_contribution' ? __('eqMatchOwnText', '{pct} of your own contribution', { pct: I.pct(r.pct, 1) })
          : __('eqMatchValueText', '{pct} of the purchase value', { pct: I.pct(r.pct, 1) });
      var how = r.delivery === 'vesting' ? __('eqMatchVestText', 'vests after {months} months', { months: r.vest.cliffMonths }) : __('eqMatchNowText', 'delivered at the purchase');
      var lose = [r.forfeitOnLeave ? __('eqMatchLoseLeave', 'lost when you leave before') : null, r.forfeitOnSale ? __('eqMatchLoseSale', 'lost when the bought shares are sold before') : null].filter(Boolean).join(', ');
      return __('eqFrom', 'From') + ' ' + I.date(r.from) + ': ' + what + ' · ' + how + (lose ? ' · ' + lose : '');
    };
    var save = function () {
      var r = { from: form.from, pct: num(form.pct), basis: form.basis, ratioFree: num(form.ratioFree), ratioPer: num(form.ratioPer), delivery: form.delivery,
        vest: { years: num(form.years), cliffMonths: num(form.cliffMonths), freqMonths: num(form.freqMonths) },
        caps: { yearAmount: num(form.capYear), periodAmount: num(form.capPeriod), periodShares: num(form.capShares) },
        forfeitOnLeave: !!form.forfeitOnLeave, forfeitOnSale: !!form.forfeitOnSale, rounding: form.fractional ? 'none' : 'floor' };
      props.onSave(Object.assign({}, plan, { matchRules: (plan.matchRules || []).concat([r]) }));
      setForm(null);
    };
    return h('div', { className: 'ui-card', 'data-testid': 'eq-match-rules-' + plan.id },
      h('b', null, __('eqMatchRules', 'Employer match')),
      rules.length ? h('ul', { className: 'ui-note' }, rules.map(function (r, i) {
        return h('li', { key: i }, describe(r), ' ', h(UIC.Button, { size: 'sm', variant: 'quiet', onClick: function () {
          props.onSave(Object.assign({}, plan, { matchRules: (plan.matchRules || []).filter(function (x, j) { return j !== i; }) }));
        } }, __('eqRemove', 'Remove')));
      })) : h('p', { className: 'ui-note' }, __('eqMatchNone', 'No match: add the rule from your plan documents.')),
      form ? h('div', { 'data-testid': 'eq-match-form' },
        h('div', { className: 'ui-form-grid' },
          h(UIC.Input, { label: __('eqFrom', 'From'), type: 'date', value: form.from, onChange: upd('from') }),
          h(UIC.Select, { label: __('eqMatchBasis', 'Match on'), value: form.basis, onChange: upd('basis'), options: [
            { value: 'purchase_value', label: __('eqMatchBasisValue', '% of the purchase value') }, { value: 'own_contribution', label: __('eqMatchBasisOwn', '% of my contribution') },
            { value: 'ratio', label: __('eqMatchBasisRatio', 'X free per Y bought') }] }),
          form.basis !== 'ratio' ? h(UIC.Input, { label: __('eqMatchPct', 'Match (%)'), inputMode: 'decimal', value: form.pct, onChange: upd('pct') }) : null,
          form.basis === 'ratio' ? h(UIC.Input, { label: __('eqMatchFree', 'Free shares (X)'), inputMode: 'decimal', value: form.ratioFree, onChange: upd('ratioFree') }) : null,
          form.basis === 'ratio' ? h(UIC.Input, { label: __('eqMatchPer', 'per shares bought (Y)'), inputMode: 'decimal', value: form.ratioPer, onChange: upd('ratioPer') }) : null,
          h(UIC.Select, { label: __('eqMatchDelivery', 'Delivery'), value: form.delivery, onChange: upd('delivery'), options: [
            { value: 'immediate', label: __('eqMatchImmediate', 'at the purchase') }, { value: 'vesting', label: __('eqMatchVesting', 'own vesting / holding period') }] }),
          form.delivery === 'vesting' ? h(UIC.Input, { label: __('eqCliff', 'Cliff (months)'), inputMode: 'numeric', value: form.cliffMonths, onChange: upd('cliffMonths') }) : null,
          form.delivery === 'vesting' ? h(UIC.Input, { label: __('eqYears', 'Years'), inputMode: 'decimal', value: form.years, onChange: upd('years') }) : null,
          form.delivery === 'vesting' ? h(UIC.Input, { label: __('eqFreq', 'Then every (months)'), inputMode: 'numeric', value: form.freqMonths, onChange: upd('freqMonths') }) : null,
          h(UIC.Input, { label: __('eqMatchCapYear', 'Match cap per year (amount)'), inputMode: 'decimal', value: form.capYear, onChange: upd('capYear') }),
          h(UIC.Input, { label: __('eqMatchCapPeriod', 'Match cap per offering (amount)'), inputMode: 'decimal', value: form.capPeriod, onChange: upd('capPeriod') }),
          h(UIC.Input, { label: __('eqMatchCapShares', 'Max match shares per offering'), inputMode: 'decimal', value: form.capShares, onChange: upd('capShares') })),
        h('div', { className: 'ui-view__bar' },
          [['forfeitOnLeave', __('eqMatchForfeitLeave', 'Lost when I leave before it vests')], ['forfeitOnSale', __('eqMatchForfeitSale', 'Lost when I sell the bought shares before')],
            ['fractional', __('eqFractional', 'Fractional shares')]].map(function (x) {
            return h('label', { key: x[0], className: 'ui-check' }, h('input', { type: 'checkbox', checked: !!form[x[0]], onChange: upd(x[0]) }), ' ', x[1]);
          })),
        h('div', { className: 'ui-view__bar' },
          h(UIC.Button, { variant: 'primary', 'data-testid': 'eq-match-save', disabled: !form.from || (form.basis !== 'ratio' && !(num(form.pct) >= 0)), onClick: save }, __('eqSave', 'Save')),
          h(UIC.Button, { variant: 'quiet', onClick: function () { setForm(null); } }, __('eqCancel', 'Cancel')))) : null,
      !form ? h(UIC.Button, { size: 'sm', onClick: function () { setForm(blank); }, 'data-testid': 'eq-match-add' }, __('eqMatchAdd', '+ Match rule')) : null);
  }

  // Own vs match shares of an ESPP grant: vested (held as lots) and unvested.
  function ownVsMatch(st, grant) {
    var M = E(), purchases = M.eventsOf(st, grant.id).filter(function (e) { return e.kind === 'purchase'; });
    var own = purchases.reduce(function (a, e) { return a + e.netUnits; }, 0);
    var mv = 0, mu = 0, mf = 0;
    purchases.forEach(function (e) {
      st.grants.filter(function (g) { return g.parentEventId === e.id; }).forEach(function (g) {
        M.tranchesOf(st, g.id).forEach(function (t) { if (t.status === 'forfeited') mf += t.units; else if (t.status === 'unvested') mu += t.units; else mv += t.units; });
      });
    });
    return { own: own, matchVested: mv, matchUnvested: mu, matchForfeited: mf };
  }

  // ---- plan card -------------------------------------------------------------------
  function PlanCard(props) {
    var React = W.React, h = React.createElement, UIC = W.MaerminComponents, I = W.MaerminI18n;
    var st = props.state, plan = props.plan, M = E();
    var _g = React.useState(false), addGrant = _g[0], setAddGrant = _g[1];
    var _e = React.useState(false), addEvent = _e[0], setAddEvent = _e[1];
    var _x = React.useState(null), editGrant = _x[0], setEditGrant = _x[1];
    var _o = React.useState(null), openGrant = _o[0], setOpenGrant = _o[1];
    var grants = M.grantsOf(st, plan.id).filter(function (g) { return !(g.type === 'MATCH' && g.parentEventId); });
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
        rowActions: function (r) {
          return [
            { label: openGrant === r.id ? __('eqHideTranches', 'Hide tranches') : __('eqShowTranches', 'Show tranches'), onClick: function () { setOpenGrant(openGrant === r.id ? null : r.id); } },
            { label: __('eqEdit', 'Edit'), onClick: function () { setEditGrant(r.grant); setAddGrant(false); } },
            { label: __('eqDelete', 'Delete'), danger: true, onClick: function () { props.onDeleteGrant(r.grant); } }
          ];
        },
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
      grants.some(function (g) { return g.type === 'ESPP'; }) && W.MaerminEquityMatch ? h(MatchRules, { plan: plan, onSave: props.onSavePlan }) : null,
      grants.filter(function (g) { return g.type === 'ESPP' && g.contribution && W.MaerminEquityEspp && props.equityOpts; }).map(function (g) {
        return h(React.Fragment, { key: g.id },
          h(EsppPanel, { grant: g, plan: plan, state: st, equityOpts: props.equityOpts, baseCurrency: props.baseCurrency, privacy: props.privacy, onUpdateGrant: props.onEditGrantKeep }),
          W.MaerminEquityForecast ? h(EsppForecast, { grant: g, plan: plan, state: st, settings: W.MaerminEquityEspp.normalizeSettings(g.contribution, g.grantDate),
            equityOpts: props.equityOpts, baseCurrency: props.baseCurrency, privacy: props.privacy,
            matchPct: W.MaerminEquityMatch && W.MaerminEquityMatch.ruleAt(plan, today()) ? function (disc) { return W.MaerminEquityMatch.effectiveInclMatch(W.MaerminEquityMatch.ruleAt(plan, today()), 100 - disc, 100); } : null }) : null);
      }),
      grants.filter(function (g) { return g.type === 'PSU' && g.psu; }).map(function (g) {
        return h(PsuPanel, { key: g.id, grant: g, plan: plan, priceEUR: props.priceEUR, money: money, privacy: props.privacy, onSettle: props.onSettlePsu });
      }),
      openGrant ? h(TrancheList, { state: st, plan: plan, grant: M.byId(st.grants, openGrant), transactions: props.transactions, privacy: props.privacy, onSetStatus: props.onSetTrancheStatus }) : null,
      editGrant ? h(GrantForm, { key: editGrant.id, planId: plan.id, grant: editGrant, onCancel: function () { setEditGrant(null); },
        onSave: function (g) { props.onEditGrant(g); setEditGrant(null); } }) : null,
      addGrant ? h(GrantForm, { planId: plan.id, onCancel: function () { setAddGrant(false); }, onSave: function (g) { props.onAddGrant(g); setAddGrant(false); } }) : null,
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

    var curList = (W.MaerminReporting && W.MaerminReporting.all && W.MaerminReporting.all()) || [];
    return h('div', { className: 'ui-view', 'data-testid': 'equity-view' },
      h('datalist', { id: 'eq-cur-list' }, curList.map(function (c) { return h('option', { key: c, value: c }); })),
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
          // a changed schedule or unit count re-creates the AUTO vests of the grant;
          // manual ones stay as entered
          onEditGrant: function (g) {
            commit(Object.assign({}, st, { grants: st.grants.map(function (x) { return x.id === g.id ? g : x; }),
              events: st.events.filter(function (e) { return e.grantId !== g.id || e.source !== 'auto'; }),
              tranches: st.tranches.filter(function (t) { return t.grantId !== g.id || t.status === 'forfeited' || st.events.some(function (e) { return e.trancheId === t.id && e.source !== 'auto'; }); }) }));
          },
          // PSU settlement: the actual multiplier (null = undo) and its date; the
          // auto vests of the grant are re-created from it
          onSettlePsu: function (g, actual, date) {
            var psu = Object.assign({}, g.psu, { actual: actual, settleDate: date || g.psu.settleDate || null });
            commit(Object.assign({}, st, { grants: st.grants.map(function (x) { return x.id === g.id ? Object.assign({}, x, { psu: psu }) : x; }),
              events: st.events.filter(function (e) { return e.grantId !== g.id || e.source !== 'auto'; }),
              tranches: st.tranches.filter(function (t) { return t.grantId !== g.id || st.events.some(function (e) { return e.trancheId === t.id && e.source !== 'auto'; }); }) }));
          },
          // ESPP settings changed (contribution %, payslip amounts, withdrawal):
          // the auto purchases follow on the next regenerate; nothing else is dropped
          onEditGrantKeep: function (g) {
            commit(Object.assign({}, st, { grants: st.grants.map(function (x) { return x.id === g.id ? g : x; }),
              events: st.events.filter(function (e) { return e.grantId !== g.id || e.source !== 'auto' || e.kind !== 'purchase'; }) }));
          },
          equityOpts: props.equityOpts,
          onSavePlan: savePlan,
          onSetTrancheStatus: function (t, status) {
            commit(withList('tranches', st.tranches.map(function (x) { return x.id === t.id ? Object.assign({}, x, { status: status }) : x; })));
          },
          transactions: props.transactions,
          onAddEvent: function (ev) { commit(withList('events', st.events.concat([ev]))); if (props.addToast) props.addToast(__('eqEventBooked', 'Event booked: its lot is in your transactions.'), 'success'); } });
      }),
      st.plans.length && W.MaerminEquityEspp ? h(IncomeCard, { income: props.income, onChange: props.onIncomeChange, privacy: props.privacy,
        defaultCurrency: (st.plans[0] || {}).salaryCurrency }) : null,
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
