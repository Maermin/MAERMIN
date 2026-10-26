// ============================================================================
// MAERMIN — Employee equity: data model  (window.MaerminEquity)
// ----------------------------------------------------------------------------
// PLAN-EQUITY § 1 / Package 1. RSU, PSU, ESPP and employer-match shares
// ("Mitarbeiteraktien") as plans, grants, tranches and events:
//
//   plan     { id, employer, ticker, shareCurrency, quoteCurrency, admin, adminLabel,
//              portfolioId, taxCountry, salaryCurrency, blackouts[], note }
//   grant    { id, planId, type RSU|PSU|ESPP|MATCH, grantDate, units, grantPrice,
//              grantPriceCurrency, schedule, rounding, withholding, parentEventId, status }
//   tranche  { id, grantId, date, units, status unvested|vested|forfeited|settled, projected }
//   event    { id, kind vest|purchase|delivery, grantId, trancheId, date, fmv (share
//              currency, major unit), fmvSource, shareCurrency, fx { [cur]: { rate, date,
//              source } }, grossUnits, withheldUnits, netUnits, coverPrice, purchasePrice,
//              contributed { amount, currency }, discountAmount, lookbackGain,
//              effectiveDiscountPct, refund, carry }
//   income   { id, from, to, kind base|bonus|13th|other, amount, period year|month|once,
//              currency, ftePct, note }        (separate key: salary stays apart)
//
// Every vest, purchase or delivery is ALSO a normal `buy` transaction (a lot),
// so the ledger, tax report and analytics need nothing new (`lotsFor`,
// `syncLots`). Its cost basis is the FMV of the event day at the rate stored
// on the event (tx.fx.EUR, read by fx-history.js txAmountToEUR); it is never 0.
// Sell-to-cover (decision 5): the gross units are bought and the withheld
// units sold the same day at the real sale price, so the small gain or loss of
// that sale reaches the tax report and the net units remain.
//
// Unvested tranches form the pipeline (`pipeline`): valued at today's price,
// left out of net worth unless settings.includeUnvested is on.
//
// Storage: maermin_equity and maermin_income (both sensitive: encrypted at
// rest, in the backup, synced only as ciphertext). Demo mode keeps both in
// memory. Pure + Node-tested (test/equity-model.test.js).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  var KEY = 'maermin_equity';
  var INCOME_KEY = 'maermin_income';
  var VERSION = 1;

  var GRANT_TYPES = ['RSU', 'PSU', 'ESPP', 'MATCH'];
  var TRANCHE_STATUS = ['unvested', 'vested', 'forfeited', 'settled'];
  var EVENT_KINDS = ['vest', 'purchase', 'delivery'];
  var ADMINS = ['morgan_stanley', 'etrade', 'schwab', 'fidelity', 'other'];
  var INCOME_KINDS = ['base', 'bonus', '13th', 'other'];
  var INCOME_PERIODS = ['year', 'month', 'once'];
  var FX_SOURCES = ['exact', 'history', 'fallback', 'approx', 'manual'];
  var FMV_SOURCES = ['close', 'prevClose', 'manual'];
  var WITHHOLDING = ['sell_to_cover', 'payroll', 'none'];
  var ROUNDING = ['floor_trueup', 'round', 'none'];
  var DEFAULT_SETTINGS = { includeUnvested: false, concentrationWarnPct: 10, showShareCurrency: false };

  function efx() {
    if (W.MaerminEquityFx) return W.MaerminEquityFx;
    try { return require('./equity-fx.js'); } catch (e) { return null; }
  }

  // ---- small helpers ----------------------------------------------------------
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function pos(v) { var n = num(v); return n != null && n >= 0 ? n : null; }
  function ymd(d) { var s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && isFinite(Date.parse(s + 'T00:00:00Z')) ? s : null; }
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max || 120) : ''; }
  function oneOf(v, list, def) { return list.indexOf(v) > -1 ? v : def; }
  function cur(v) {
    var s = str(v, 8);
    if (/^GBp$/.test(s)) return s;   // pence, as Yahoo writes it
    s = s.toUpperCase();
    return /^[A-Z]{3}$/.test(s) ? s : '';
  }
  var _seq = 0;
  function newId(prefix) { _seq = (_seq + 1) % 1e6; return (prefix || 'e') + '-' + Date.now().toString(36) + '-' + _seq.toString(36) + Math.random().toString(36).slice(2, 6); }
  function idOf(v) { var s = str(v == null ? '' : String(v), 80); return s || null; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // ---- normalisation ----------------------------------------------------------
  function cleanFx(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) {
      var c = cur(k), e = raw[k];
      if (!c || /^GBp$/.test(c) || !e || typeof e !== 'object') return;
      var r = num(e.rate);
      if (!(r > 0)) return;
      out[c] = { rate: r, date: ymd(e.date), source: oneOf(e.source, FX_SOURCES, 'history') };
      if (e.note) out[c].note = str(e.note, 200);
    });
    return out;
  }

  function cleanPlan(p) {
    if (!p || typeof p !== 'object') return null;
    var id = idOf(p.id), ticker = str(p.ticker, 24).toUpperCase();
    if (!id || !ticker) return null;
    var share = cur(p.shareCurrency), quote = cur(p.quoteCurrency) || share;
    var F = efx(), major = F ? F.majorOf(quote || share).cur : share;
    return {
      id: id,
      employer: str(p.employer, 120),
      ticker: ticker,
      shareCurrency: major || 'USD',            // major unit: GBX quotes become GBP
      quoteCurrency: quote || major || 'USD',   // as listed (GBX, ZAc, ILA kept for display)
      admin: oneOf(p.admin, ADMINS, 'other'),
      adminLabel: str(p.adminLabel, 60),
      portfolioId: p.portfolioId != null ? String(p.portfolioId) : null,
      taxCountry: str(p.taxCountry, 2).toUpperCase() || 'DE',
      salaryCurrency: cur(p.salaryCurrency) || 'EUR',
      blackouts: arr(p.blackouts).map(function (b) {
        var from = ymd(b && b.from), to = ymd(b && b.to);
        return from && to && from <= to ? { from: from, to: to, label: str(b.label, 80) } : null;
      }).filter(Boolean),
      esppSettings: p.esppSettings && typeof p.esppSettings === 'object' ? p.esppSettings : null,
      matchRules: arr(p.matchRules).filter(function (r) { return r && typeof r === 'object'; }),
      leaverRules: p.leaverRules && typeof p.leaverRules === 'object' ? p.leaverRules : null,
      note: str(p.note, 500)
    };
  }

  function cleanGrant(g, planIds) {
    if (!g || typeof g !== 'object') return null;
    var id = idOf(g.id), planId = idOf(g.planId), type = oneOf(g.type, GRANT_TYPES, null);
    if (!id || !planId || !planIds[planId] || !type) return null;
    return {
      id: id, planId: planId, type: type,
      name: str(g.name, 80),
      grantDate: ymd(g.grantDate),
      units: pos(g.units),
      grantPrice: pos(g.grantPrice),
      grantPriceCurrency: cur(g.grantPriceCurrency) || null,
      schedule: g.schedule && typeof g.schedule === 'object' ? g.schedule : null,
      psu: g.psu && typeof g.psu === 'object' ? g.psu : null,
      contribution: g.contribution && typeof g.contribution === 'object' ? g.contribution : null,
      rounding: oneOf(g.rounding, ROUNDING, 'floor_trueup'),
      withholding: oneOf(g.withholding, WITHHOLDING, 'sell_to_cover'),
      withholdingRate: pos(g.withholdingRate),
      dividendEquivalents: !!g.dividendEquivalents,
      parentEventId: idOf(g.parentEventId),
      status: oneOf(g.status, ['active', 'closed', 'forfeited'], 'active')
    };
  }

  function cleanTranche(t, grantIds) {
    if (!t || typeof t !== 'object') return null;
    var id = idOf(t.id), grantId = idOf(t.grantId), date = ymd(t.date), units = pos(t.units);
    if (!id || !grantId || !grantIds[grantId] || !date || units == null) return null;
    var status = oneOf(t.status, TRANCHE_STATUS, 'unvested');
    // projected = a future tranche of the schedule, never a real vest
    return { id: id, grantId: grantId, date: date, units: units, status: status, projected: status === 'unvested' && !!t.projected };
  }

  function cleanEvent(ev, grantIds) {
    if (!ev || typeof ev !== 'object') return null;
    var id = idOf(ev.id), grantId = idOf(ev.grantId), date = ymd(ev.date), kind = oneOf(ev.kind, EVENT_KINDS, null);
    var fmv = num(ev.fmv);
    if (!id || !grantId || !grantIds[grantId] || !date || !kind || !(fmv > 0)) return null;
    var gross = pos(ev.grossUnits), withheld = pos(ev.withheldUnits) || 0;
    if (gross == null) return null;
    if (withheld > gross) withheld = gross;
    var net = pos(ev.netUnits);
    if (net == null || net > gross) net = gross - withheld;
    var out = {
      id: id, kind: kind, grantId: grantId, trancheId: idOf(ev.trancheId), date: date,
      fmv: fmv, fmvSource: oneOf(ev.fmvSource, FMV_SOURCES, 'close'),
      shareCurrency: cur(ev.shareCurrency) || 'USD',
      fx: cleanFx(ev.fx),
      grossUnits: gross, withheldUnits: withheld, netUnits: net,
      coverPrice: pos(ev.coverPrice),
      source: oneOf(ev.source, ['manual', 'auto', 'import'], 'manual'),
      note: str(ev.note, 300)
    };
    ['purchasePrice', 'discountAmount', 'lookbackGain', 'effectiveDiscountPct', 'refund', 'carry', 'fmvStart'].forEach(function (k) {
      var v = num(ev[k]); if (v != null) out[k] = v;
    });
    if (ev.offeringStart) out.offeringStart = ymd(ev.offeringStart);
    if (ev.contributed && typeof ev.contributed === 'object' && num(ev.contributed.amount) != null) {
      out.contributed = { amount: num(ev.contributed.amount), currency: cur(ev.contributed.currency) || 'EUR' };
    }
    return out;
  }

  function cleanSettings(s) {
    var o = Object.assign({}, DEFAULT_SETTINGS);
    if (s && typeof s === 'object') {
      if (typeof s.includeUnvested === 'boolean') o.includeUnvested = s.includeUnvested;
      if (typeof s.showShareCurrency === 'boolean') o.showShareCurrency = s.showShareCurrency;
      var c = num(s.concentrationWarnPct);
      if (c != null && c > 0 && c <= 100) o.concentrationWarnPct = c;
    }
    return o;
  }

  function cleanOverrides(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) {
      var m = /^([A-Z]{3})>([A-Z]{3})@(\d{4}-\d{2}-\d{2})$/.exec(k), e = raw[k];
      var r = num(e && typeof e === 'object' ? e.rate : e);
      if (m && ymd(m[3]) && r > 0) out[k] = { rate: r, note: str(e && e.note, 200) };
    });
    return out;
  }

  // Unknown or broken rows are dropped, never repaired into something else;
  // children whose parent is gone go with it.
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var seen = {};
    function uniq(x) { if (!x || seen[x.id]) return null; seen[x.id] = true; return x; }
    var plans = arr(o.plans).map(cleanPlan).map(uniq).filter(Boolean);
    var planIds = {}; plans.forEach(function (p) { planIds[p.id] = true; });
    var grants = arr(o.grants).map(function (g) { return cleanGrant(g, planIds); }).map(uniq).filter(Boolean);
    var grantIds = {}; grants.forEach(function (g) { grantIds[g.id] = true; });
    var tranches = arr(o.tranches).map(function (t) { return cleanTranche(t, grantIds); }).map(uniq).filter(Boolean);
    var events = arr(o.events).map(function (e) { return cleanEvent(e, grantIds); }).map(uniq).filter(Boolean);
    tranches.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { v: VERSION, plans: plans, grants: grants, tranches: tranches, events: events, fxOverrides: cleanOverrides(o.fxOverrides), settings: cleanSettings(o.settings) };
  }

  function cleanIncome(e) {
    if (!e || typeof e !== 'object') return null;
    var id = idOf(e.id), from = ymd(e.from), amount = num(e.amount), c = cur(e.currency);
    if (!id || !from || amount == null || amount < 0 || !c || /^GBp$/.test(c)) return null;
    var to = ymd(e.to);
    var fte = num(e.ftePct);
    return {
      id: id, from: from, to: to && to >= from ? to : null,
      kind: oneOf(e.kind, INCOME_KINDS, 'base'),
      period: oneOf(e.period, INCOME_PERIODS, e.kind === 'base' ? 'year' : 'once'),
      amount: amount, currency: c,
      ftePct: fte != null && fte >= 0 && fte <= 100 ? fte : 100,
      note: str(e.note, 200)
    };
  }
  function normalizeIncome(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var seen = {};
    var entries = arr(o.entries).map(cleanIncome).filter(function (x) { if (!x || seen[x.id]) return false; seen[x.id] = true; return true; });
    entries.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    return { v: VERSION, entries: entries };
  }

  // ---- lookups ------------------------------------------------------------------
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function planOfGrant(state, grant) { return grant ? byId(state.plans, grant.planId) : null; }
  function grantsOf(state, planId) { return state.grants.filter(function (g) { return g.planId === planId; }); }
  function tranchesOf(state, grantId) { return state.tranches.filter(function (t) { return t.grantId === grantId; }); }
  function eventsOf(state, grantId) { return state.events.filter(function (e) { return e.grantId === grantId; }); }

  // ---- lots -----------------------------------------------------------------------
  // The transactions an event stands for. The buy is the lot (gross units at
  // FMV); with sell-to-cover a same-day sell of the withheld units follows.
  // Each carries tx.fx.EUR, the event's own EUR rate, so its basis never
  // depends on a later rate reload. An event without an EUR rate gets no lot:
  // `missingFx` reports it instead of booking a basis of 0 or an unconverted one.
  function lotsFor(state, ev) {
    var grant = byId(state.grants, ev.grantId), plan = planOfGrant(state, grant);
    if (!grant || !plan) return [];
    var eurFx = ev.shareCurrency === 'EUR' ? { rate: 1, date: ev.date, source: 'exact' } : ev.fx.EUR;
    if (!eurFx || !(eurFx.rate > 0)) return [];
    var fx = Object.assign({}, ev.fx, { EUR: eurFx });
    var base = {
      category: 'stocks', symbol: plan.ticker, symbolName: plan.employer || plan.ticker,
      currency: ev.shareCurrency, date: ev.date, fees: 0,
      portfolioId: plan.portfolioId, source: 'equity', equityEventId: ev.id, equityKind: grant.type, fx: fx
    };
    var out = [];
    var units = ev.withheldUnits > 0 ? ev.grossUnits : ev.netUnits;
    if (units > 0) out.push(Object.assign({}, base, { id: 'eq-' + ev.id, type: 'buy', quantity: units, price: ev.fmv, equityRole: 'lot' }));
    if (ev.withheldUnits > 0) {
      out.push(Object.assign({}, base, {
        id: 'eq-' + ev.id + '-cover', type: 'sell', quantity: ev.withheldUnits,
        price: ev.coverPrice != null && ev.coverPrice > 0 ? ev.coverPrice : ev.fmv, equityRole: 'cover'
      }));
    }
    return out;
  }

  function missingFx(state) {
    return state.events.filter(function (ev) { return ev.shareCurrency !== 'EUR' && !(ev.fx.EUR && ev.fx.EUR.rate > 0); })
      .map(function (ev) { return ev.id; });
  }

  function isEquityTx(tx) { return !!(tx && tx.source === 'equity' && tx.equityEventId); }

  // Bring the transaction list in line with the events: add missing lots,
  // replace changed ones, drop lots whose event is gone. Other transactions
  // are kept as they are and in their order. Idempotent; returns the input
  // array itself when nothing changed.
  function syncLots(state, transactions) {
    var list = arr(transactions), want = {}, order = [];
    state.events.forEach(function (ev) { lotsFor(state, ev).forEach(function (tx) { want[tx.id] = tx; order.push(tx.id); }); });
    var changed = false, out = [], placed = {};
    list.forEach(function (tx) {
      if (!isEquityTx(tx)) { out.push(tx); return; }
      var w = want[tx.id];
      if (!w) { changed = true; return; }
      placed[tx.id] = true;
      if (JSON.stringify(w) !== JSON.stringify(tx)) { changed = true; out.push(w); } else out.push(tx);
    });
    order.forEach(function (id) { if (!placed[id]) { changed = true; out.push(want[id]); } });
    return { transactions: changed ? out : list, changed: changed };
  }

  // ---- pipeline (unvested) ----------------------------------------------------------
  // Unvested units per plan, valued at today's price. price(plan) -> price in
  // the share currency (major unit) or null; toBase(amount, cur) -> base amount
  // or null. Forfeited tranches never count; projected ones do (they are the
  // schedule still to come).
  function pipeline(state, price, toBase) {
    var plans = {}, total = { units: 0, base: 0, unpriced: 0 };
    state.tranches.forEach(function (t) {
      if (t.status !== 'unvested') return;
      var g = byId(state.grants, t.grantId), p = planOfGrant(state, g);
      if (!p) return;
      var row = plans[p.id] || (plans[p.id] = { planId: p.id, ticker: p.ticker, currency: p.shareCurrency, units: 0, value: 0, base: 0, byType: {} });
      var px = price ? num(price(p)) : null;
      row.units += t.units;
      row.byType[g.type] = (row.byType[g.type] || 0) + t.units;
      total.units += t.units;
      if (px != null && px > 0) {
        var v = t.units * px, b = toBase ? num(toBase(v, p.shareCurrency)) : null;
        row.value += v;
        if (b != null) { row.base += b; total.base += b; } else total.unpriced++;
      } else total.unpriced++;
    });
    return { plans: Object.keys(plans).map(function (k) { return plans[k]; }), total: total };
  }

  // ---- storage (browser) --------------------------------------------------------------
  var _demo = { equity: null, income: null };
  function demoActive() { return !!(W.MaerminDemo && W.MaerminDemo.isActive && W.MaerminDemo.isActive()); }
  function ls() { return typeof localStorage !== 'undefined' ? localStorage : null; }
  function readKey(key, norm, demoSlot) {
    if (demoActive()) return _demo[demoSlot] || (_demo[demoSlot] = norm(demoSeed(demoSlot)));
    var s = ls(); try { return norm(s ? s.getItem(key) : null); } catch (e) { return norm(null); }
  }
  function writeKey(key, norm, demoSlot, value) {
    if (demoActive()) { _demo[demoSlot] = norm(value); return true; }
    var s = ls(); if (!s) return false;
    try { s.setItem(key, JSON.stringify(norm(value))); return true; } catch (e) { return false; }
  }
  function demoSeed(slot) {
    var D = W.MaerminDemo;
    if (!D) return null;
    if (slot === 'equity' && D.getEquity) return D.getEquity();
    if (slot === 'income' && D.getIncome) return D.getIncome();
    return null;
  }
  function load() { return readKey(KEY, normalize, 'equity'); }
  function save(state) { return writeKey(KEY, normalize, 'equity', state); }
  function loadIncome() { return readKey(INCOME_KEY, normalizeIncome, 'income'); }
  function saveIncome(state) { return writeKey(INCOME_KEY, normalizeIncome, 'income', state); }
  function resetDemo() { _demo = { equity: null, income: null }; }
  function hasPlans(state) { return !!(state && state.plans && state.plans.length); }

  var api = {
    KEY: KEY, INCOME_KEY: INCOME_KEY, VERSION: VERSION,
    GRANT_TYPES: GRANT_TYPES, TRANCHE_STATUS: TRANCHE_STATUS, EVENT_KINDS: EVENT_KINDS, ADMINS: ADMINS,
    INCOME_KINDS: INCOME_KINDS, WITHHOLDING: WITHHOLDING, ROUNDING: ROUNDING, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    newId: newId, normalize: normalize, normalizeIncome: normalizeIncome,
    byId: byId, planOfGrant: planOfGrant, grantsOf: grantsOf, tranchesOf: tranchesOf, eventsOf: eventsOf,
    lotsFor: lotsFor, missingFx: missingFx, isEquityTx: isEquityTx, syncLots: syncLots, pipeline: pipeline,
    load: load, save: save, loadIncome: loadIncome, saveIncome: saveIncome, resetDemo: resetDemo, hasPlans: hasPlans
  };
  if (typeof window !== 'undefined') window.MaerminEquity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
