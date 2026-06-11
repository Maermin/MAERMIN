// @ts-check
/**
 * MAERMIN — Data Quality & Trust  (window.MaerminDataQuality)
 * ---------------------------------------------------------------------------
 * The #1 complaint about portfolio trackers is silent data errors: wrong prices,
 * opaque FX, stale quotes shown as if live, and missing data rendered as a silent
 * 0. This module is the single source of truth for *how trustworthy a number is*,
 * so the UI can label sources, flag stale/failed quotes, and NEVER show a silent
 * zero.
 *
 * Pure functions + an injectable-fetch worker health check, so it is fully
 * testable in Node.
 */
(function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var DEFAULT_STALE_HOURS = 6;
  var PRICE_META_KEY = 'maermin_price_meta'; // { [symbol]: { at:number, source:string } }

  // Where each asset class's prices come from — shown next to every position.
  var SOURCES = {
    crypto: 'CoinGecko',
    stocks: 'Yahoo Finance',
    commodities: 'Yahoo Finance',
    skins: 'Steam Market',
    fx: 'Yahoo Finance'
  };

  /** Human source label for an asset category. */
  function sourceFor(category) { return SOURCES[category] || 'Unknown'; }

  /** Compact age label: "just now" / "5m ago" / "3h ago" / "2d ago". */
  function ageLabel(ms) {
    if (ms == null || !isFinite(ms)) return 'unknown';
    if (ms < 60 * 1000) return 'just now';
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /**
   * Classify how fresh a quote is.
   * @param {number|null|undefined} fetchedAt  epoch ms the price was fetched
   * @returns {{level:'fresh'|'stale'|'missing', stale:boolean, ageMs:number|null, label:string}}
   */
  function freshness(fetchedAt, now, opts) {
    opts = opts || {};
    var staleMs = (opts.staleHours || DEFAULT_STALE_HOURS) * HOUR;
    var t = typeof now === 'number' ? now : Date.now();
    if (!fetchedAt || !isFinite(fetchedAt)) return { level: 'missing', stale: true, ageMs: null, label: 'no data' };
    var ageMs = Math.max(0, t - fetchedAt);
    var stale = ageMs > staleMs;
    return { level: stale ? 'stale' : 'fresh', stale: stale, ageMs: ageMs, label: ageLabel(ageMs) };
  }

  /**
   * Resolve a price into a trustworthy display state — the guard against silent
   * zeros. A null/undefined/non-finite price is "unavailable", NOT 0.
   * @returns {{available:boolean, value:number|null, source:string, freshness:object, badge:string|null}}
   */
  function priceState(price, opts) {
    opts = opts || {};
    var source = opts.source || (opts.category ? sourceFor(opts.category) : 'Unknown');
    var fresh = freshness(opts.fetchedAt, opts.now, opts);
    var available = typeof price === 'number' && isFinite(price) && price > 0;
    var fallback = !!opts.fallback;
    var badge = null;
    if (!available) badge = opts.fetchFailed ? 'fetch failed' : 'not available';
    else if (fresh.stale) badge = 'stale · ' + fresh.label;
    else if (fallback) badge = 'via ' + source;
    return {
      available: available,
      value: available ? price : null,
      source: source,
      fallback: fallback,
      reason: opts.reason || null,
      freshness: fresh,
      badge: badge
    };
  }

  /**
   * Aggregate freshness across many positions for the top-bar "data health"
   * indicator (e.g. "3 prices stale"). items: [{category,price,fetchedAt,
   * fetchFailed,source}]. → {total,fresh,stale,missing,failed,unknown}
   */
  function summarize(items, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var out = { total: 0, fresh: 0, stale: 0, missing: 0, failed: 0, unknown: 0 };
    (items || []).forEach(function (it) {
      if (!it) return;
      out.total++;
      var st = priceState(it.price, { category: it.category, source: it.source, fetchedAt: it.fetchedAt, fetchFailed: it.fetchFailed, now: now, staleHours: opts.staleHours });
      if (!st.available) { out.missing++; if (it.fetchFailed) out.failed++; }
      else if (st.freshness.level === 'missing') out.unknown++; // age unknown — don't alarm
      else if (st.freshness.stale) out.stale++;
      else out.fresh++;
    });
    return out;
  }

  /**
   * Transparent FX descriptor for display next to a converted value.
   * @returns {{rate:number|null, source:string, freshness:object, label:string}}
   */
  function fx(rate, opts) {
    opts = opts || {};
    var ok = typeof rate === 'number' && isFinite(rate) && rate > 0;
    var fresh = freshness(opts.fetchedAt, opts.now, opts);
    var pair = opts.pair || 'USD→EUR';
    return {
      rate: ok ? rate : null,
      source: opts.source || SOURCES.fx,
      freshness: fresh,
      label: ok ? (pair + ' ' + rate.toFixed(4) + ' · ' + fresh.label) : (pair + ' unavailable')
    };
  }

  // --- price metadata persistence (per-symbol last-fetch) --------------------

  function _store(storage) {
    if (storage) return storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }
  /** Read the saved {symbol:{at,source}} price-meta map. */
  function readMeta(storage) {
    var s = _store(storage); if (!s) return {};
    try { return JSON.parse(s.getItem(PRICE_META_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  /** Record that `symbols` were just fetched from `source` (now or `at`). */
  function recordFetch(symbols, source, opts) {
    opts = opts || {};
    var s = _store(opts.storage); if (!s) return;
    var meta = readMeta(opts.storage);
    var at = opts.at || Date.now();
    (Array.isArray(symbols) ? symbols : [symbols]).forEach(function (sym) {
      if (!sym) return;
      var entry = { at: at, source: source || 'Unknown' };
      if (opts.fallback) entry.fallback = true;       // resolved via a fallback source
      if (opts.reason) entry.reason = opts.reason;     // why the primary was skipped
      meta[sym] = entry;
    });
    try { s.setItem(PRICE_META_KEY, JSON.stringify(meta)); } catch (e) { /* quota: ignore */ }
  }

  // --- worker health ---------------------------------------------------------

  /**
   * Probe whether the user's Cloudflare Worker is reachable — powers the
   * persistent green/red status indicator and "Worker nicht erreichbar"
   * messaging instead of silent null prices.
   * @returns {Promise<{ok:boolean, reachable:boolean, status:number|null, latencyMs:number|null, error:string|null}>}
   */
  async function checkWorkerHealth(url, opts) {
    opts = opts || {};
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!url || !String(url).trim()) return { ok: false, reachable: false, status: null, latencyMs: null, error: 'no-worker-url' };
    if (!fetchImpl) return { ok: false, reachable: false, status: null, latencyMs: null, error: 'no-fetch' };
    var base = String(url).trim().replace(/\/$/, '');
    var probe = base + (opts.action ? ('?action=' + opts.action) : '?action=yfsearch&q=AAPL');
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 8000) : null;
    var t0 = Date.now();
    try {
      var res = await fetchImpl(probe, ctrl ? { signal: ctrl.signal } : {});
      var latency = Date.now() - t0;
      // Reachable = we got an HTTP response at all. ok = it answered successfully.
      return { ok: !!res.ok, reachable: true, status: res.status != null ? res.status : null, latencyMs: latency, error: res.ok ? null : ('http-' + res.status) };
    } catch (e) {
      return { ok: false, reachable: false, status: null, latencyMs: null, error: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
    } finally { if (timer) clearTimeout(timer); }
  }

  var api = {
    SOURCES, PRICE_META_KEY,
    sourceFor, ageLabel, freshness, priceState, fx, summarize,
    readMeta, recordFetch, checkWorkerHealth
  };
  if (typeof window !== 'undefined') window.MaerminDataQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
