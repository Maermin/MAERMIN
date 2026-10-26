// ============================================================================
// MAERMIN — Employee equity: vesting schedules  (window.MaerminEquityVesting)
// ----------------------------------------------------------------------------
// PLAN-EQUITY Package 2 (RSU; PSU reuses it after the performance period).
//
//   schedule = { preset?, start (vesting start, default the grant date),
//                years, cliffMonths, freqMonths,
//                custom: [{ date, pct }] (uneven %, sum 100) | null }
//   PRESETS   4y / 1y cliff monthly or quarterly, 3y yearly, 25/25/25/25
//   steps(schedule, grantDate)          [{ date, pct }] (pct of the grant, sum 100)
//   allocate(total, pcts, rounding)      units per tranche:
//       floor_trueup  floor per tranche, the last one takes the rest (default)
//       round         round per tranche, the last one takes the rest
//       floor_cumulative  floor of the cumulative units minus those already
//                     vested (spreads the remainder; common at plan admins)
//       none          fractional units
//   withheld(gross, grant, actual)       units withheld (sell-to-cover: the
//       actual number when given, else ceil(gross × rate)); payroll / none: 0
//   fmvOn(series, date, source)          FMV from a daily close series (major unit):
//       close      close of the vest day, or the last close before it (weekend,
//                  holiday), with the date it came from
//       prevClose  the close of the trading day before the vest day
//   plan(state, grant, opts)             { tranches, events } for one grant:
//       past tranches become vested with an auto event (FMV and rates of the
//       day), future ones stay projected (never lots). Manual events and
//       manual overrides are kept; a tranche with an event is left alone.
//   regenerate(state, opts)              plan() for every grant with a schedule
//   dividendEquivalents(tranches, dividends, today, grantDate)  cash per unvested unit
//
// opts: { today, closes(ticker) -> { cur, d: [dayNo], p: [close] } | null,
//         fxCtx (equity-fx.js ctx), targets: [currencies an event keeps] }
// Pure + Node-tested (test/equity-vesting.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function efx() { if (W.MaerminEquityFx) return W.MaerminEquityFx; try { return require('./equity-fx.js'); } catch (e) { return null; } }

  var DAY = 86400000;
  var PRESETS = {
    '4y_cliff_monthly': { years: 4, cliffMonths: 12, freqMonths: 1 },
    '4y_cliff_quarterly': { years: 4, cliffMonths: 12, freqMonths: 3 },
    '3y_yearly': { years: 3, cliffMonths: 12, freqMonths: 12 },
    '25_25_25_25': { years: 4, cliffMonths: 12, freqMonths: 12 }
  };

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && isFinite(Date.parse(s + 'T00:00:00Z')) ? s : null; }
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function isoOf(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

  // Month arithmetic that keeps the day, clamped to the month's end
  // (31 January + 1 month = 28/29 February).
  function addMonths(iso, months) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + months, d = +iso.slice(8, 10);
    var ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
  }

  function normalizeSchedule(s) {
    s = s && typeof s === 'object' ? s : {};
    var base = PRESETS[s.preset] || {};
    var years = num(s.years != null ? s.years : base.years), cliff = num(s.cliffMonths != null ? s.cliffMonths : base.cliffMonths);
    var freq = num(s.freqMonths != null ? s.freqMonths : base.freqMonths);
    var custom = Array.isArray(s.custom) ? s.custom.map(function (c) {
      var d = ymd(c && c.date), p = num(c && c.pct);
      return d && p != null && p > 0 ? { date: d, pct: p } : null;
    }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : 1; }) : null;
    return {
      preset: PRESETS[s.preset] ? s.preset : (custom && custom.length ? 'custom' : null),
      start: ymd(s.start),
      years: years > 0 ? years : 4,
      cliffMonths: cliff != null && cliff >= 0 ? Math.round(cliff) : 12,
      freqMonths: freq > 0 ? Math.round(freq) : 3,
      custom: custom && custom.length ? custom : null
    };
  }

  // [{ date, pct }]: a cliff tranche, then one every freqMonths to the end.
  function steps(schedule, grantDate) {
    var s = normalizeSchedule(schedule);
    if (s.custom) return s.custom.map(function (c) { return { date: c.date, pct: c.pct }; });
    var start = s.start || ymd(grantDate);
    if (!start) return [];
    var total = Math.round(s.years * 12), out = [];
    var first = Math.min(Math.max(s.cliffMonths, s.freqMonths), total);
    if (s.cliffMonths === 0) first = s.freqMonths;
    out.push({ date: addMonths(start, first), pct: first / total * 100 });
    for (var m = first + s.freqMonths; m <= total + 1e-9; m += s.freqMonths) out.push({ date: addMonths(start, m), pct: s.freqMonths / total * 100 });
    var covered = out.reduce(function (a, x) { return a + x.pct; }, 0);
    if (covered < 100 - 1e-9) {   // a period that does not divide evenly: the rest at the end
      var lastM = first + (out.length - 1) * s.freqMonths;
      if (lastM < total) out.push({ date: addMonths(start, total), pct: 100 - covered });
      else out[out.length - 1].pct += 100 - covered;
    }
    return out;
  }

  function pctSum(list) { return list.reduce(function (a, x) { return a + (num(x.pct) || 0); }, 0); }

  function allocate(total, pcts, rounding) {
    var t = num(total) || 0, n = pcts.length, out = [], used = 0;
    var sum = pcts.reduce(function (a, p) { return a + p; }, 0) || 1, cum = 0;
    for (var i = 0; i < n; i++) {
      var exact = t * pcts[i] / sum, u;
      cum += pcts[i];
      if (i === n - 1) u = rounding === 'none' ? t - used : Math.round((t - used) * 1e6) / 1e6;
      else if (rounding === 'none') u = exact;
      else if (rounding === 'round') u = Math.round(exact);
      else if (rounding === 'floor_cumulative') u = Math.floor(t * cum / sum + 1e-9) - used;
      else u = Math.floor(exact + 1e-9);
      out.push(u); used += u;
    }
    return out;
  }

  function withheld(gross, grant, actual) {
    var a = num(actual);
    if (!grant || grant.withholding !== 'sell_to_cover') return 0;
    if (a != null && a >= 0) return Math.min(a, gross);
    var r = num(grant.withholdingRate);
    if (!(r > 0)) return 0;
    return Math.min(gross, Math.ceil(gross * r - 1e-9));
  }

  // FMV from a close series in its quote currency, converted to the major unit.
  function fmvOn(series, date, source) {
    if (!series || !Array.isArray(series.d) || !series.d.length) return null;
    var F = efx(), div = F ? F.majorOf(series.cur).div : 1;
    var t = dayNo(date), lo = 0, hi = series.d.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (series.d[mid] <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; } }
    if (source === 'prevClose' && ans > -1 && series.d[ans] === t) ans--;
    if (ans < 0 || t - series.d[ans] > 7) return null;
    return { fmv: series.p[ans] / div, date: isoOf(series.d[ans]), sameDay: series.d[ans] === t };
  }

  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // Tranches and auto events of one grant. Existing tranche ids are kept by
  // position, so a manual event that points at a tranche keeps its link.
  function plan(state, grant, opts) {
    opts = opts || {};
    var today = ymd(opts.today) || isoOf(Math.floor(Date.now() / DAY));
    var pl = byId(state.plans, grant.planId);
    var st = steps(grant.schedule, grant.grantDate);
    var units = allocate(grant.units, st.map(function (x) { return x.pct; }), grant.rounding);
    var prevTr = state.tranches.filter(function (t) { return t.grantId === grant.id; });
    var events = state.events.filter(function (e) { return e.grantId === grant.id; });
    var tranches = [], newEvents = [], missing = [];
    st.forEach(function (s, i) {
      var id = grant.id + '-t' + (i + 1);
      var prev = byId(prevTr, id);
      var past = s.date <= today;
      var ev = events.filter(function (e) { return e.trancheId === id; })[0];
      var status = prev && (prev.status === 'forfeited' || prev.status === 'settled') ? prev.status : past ? 'vested' : 'unvested';
      tranches.push({ id: id, grantId: grant.id, date: s.date, units: units[i], status: status, projected: !past });
      if (!past || ev || status === 'forfeited') return;
      var series = opts.closes && pl ? opts.closes(pl.ticker) : null;
      var px = fmvOn(series, s.date, (grant.schedule && grant.schedule.fmvSource) || 'close');
      if (!px) { missing.push({ trancheId: id, date: s.date, reason: 'price' }); return; }
      var F = efx();
      var targets = (opts.targets || ['EUR']).concat([pl.salaryCurrency, F.taxCurrency(pl.taxCountry) || 'EUR']);
      var fx = F.record(pl.shareCurrency, targets, s.date, opts.fxCtx || {});
      if (pl.shareCurrency !== 'EUR' && !fx.EUR) { missing.push({ trancheId: id, date: s.date, reason: 'fx' }); return; }
      var gross = units[i];
      var w = withheld(gross, grant, null);
      newEvents.push({
        id: id + '-vest', kind: 'vest', grantId: grant.id, trancheId: id, date: s.date,
        fmv: px.fmv, fmvSource: px.sameDay ? 'close' : 'prevClose', fmvDate: px.date, shareCurrency: pl.shareCurrency, fx: fx,
        grossUnits: gross, withheldUnits: w, netUnits: gross - w, coverPrice: null, source: 'auto'
      });
    });
    // tranches outside the new schedule that already have an event stay (history wins)
    prevTr.forEach(function (t) {
      if (!byId(tranches, t.id) && events.some(function (e) { return e.trancheId === t.id; })) tranches.push(t);
    });
    return { tranches: tranches, events: events.concat(newEvents), added: newEvents.length, missing: missing };
  }

  function regenerate(state, opts) {
    var out = Object.assign({}, state), added = 0, missing = [];
    state.grants.forEach(function (g) {
      if (!g.schedule || !(g.units > 0) || (g.type !== 'RSU' && g.type !== 'MATCH')) return;
      var r = plan(out, g, opts);
      out.tranches = out.tranches.filter(function (t) { return t.grantId !== g.id; }).concat(r.tranches);
      out.events = out.events.filter(function (e) { return e.grantId !== g.id; }).concat(r.events);
      added += r.added; missing = missing.concat(r.missing.map(function (m) { return Object.assign({ grantId: g.id }, m); }));
    });
    return { state: out, added: added, missing: missing };
  }

  // Dividend equivalents: per dividend (exDate, amount per share in the share
  // currency) the units still unvested on its ex-date earn the amount. They
  // are wage, not capital income, in Germany (decision 12, unverified): shown,
  // not booked as a dividend.
  function dividendEquivalents(tranches, dividends, today, grantDate) {
    var out = [], t = ymd(today) || '9999-12-31', from = ymd(grantDate) || '0000-01-01';
    (dividends || []).forEach(function (dv) {
      var ex = ymd(dv && dv.exDate), amt = num(dv && dv.amount);
      if (!ex || !(amt > 0) || ex > t || ex < from) return;   // only while the grant exists
      var units = tranches.filter(function (tr) { return tr.status !== 'forfeited' && tr.date > ex; })
        .reduce(function (a, tr) { return a + tr.units; }, 0);
      if (units > 0) out.push({ exDate: ex, perShare: amt, units: units, amount: units * amt });
    });
    return out;
  }

  // Per-share dividends of a ticker from the booked dividend rows (price =
  // amount per share, one per date), as input for dividendEquivalents. Offline
  // and already in the user's data; a ticker the user never received a
  // dividend on gives none.
  function dividendsFromTransactions(transactions, ticker) {
    var t = String(ticker || '').toUpperCase(), seen = {}, out = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.type !== 'dividend' || String(tx.symbol || '').toUpperCase() !== t) return;
      var d = ymd(tx.date), p = num(tx.price);
      if (!d || !(p > 0) || seen[d]) return;
      seen[d] = true;
      out.push({ exDate: d, amount: p, currency: tx.currency || 'EUR' });
    });
    return out.sort(function (a, b) { return a.exDate < b.exDate ? -1 : 1; });
  }

  var api = {
    dividendsFromTransactions: dividendsFromTransactions,
    PRESETS: PRESETS, addMonths: addMonths, normalizeSchedule: normalizeSchedule, steps: steps, pctSum: pctSum,
    allocate: allocate, withheld: withheld, fmvOn: fmvOn, plan: plan, regenerate: regenerate, dividendEquivalents: dividendEquivalents
  };
  if (typeof window !== 'undefined') window.MaerminEquityVesting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
