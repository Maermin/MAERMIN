// ============================================================================
// MAERMIN — CoinGecko request gate  (window.MaerminCoinGecko)
// ----------------------------------------------------------------------------
// CoinGecko's public API allows only a handful of calls a minute per browser.
// The price refresh, the history chart and the daily close history used to
// call it independently - ~40 coins at once - so it refused (429) and the one
// request that matters, the batched price call, failed with the rest. A 429
// arrives WITHOUT CORS headers, so the browser reports it as a CORS / network
// error (status 0), which the callers did not recognise as a rate limit.
//
// The browser no longer calls CoinGecko itself: every request goes to the
// user's Worker (?action=cg), which caches the answers, remembers unknown
// coins and serves its last good copy when CoinGecko refuses. get(path,
// params) builds that URL from the Worker base set with setBase(); without a
// Worker it rejects with { noWorker: true }.
//
// Every CoinGecko call still goes through this queue:
//   - one request at a time, SPACING_MS apart;
//   - priority 'high' (prices) goes before 'low' (charts, history);
//   - a refusal (429 or a network/CORS error) starts a COOLDOWN_MS pause:
//     queued and new 'low' requests are rejected at once (callers fall back to
//     stored closes / a flat line); 'high' requests are still sent (spaced) -
//     a failed chart request must not hold back the prices.
// Rejections carry { status: 429, rateLimited: true }.
//
// Pure scheduling, Node-testable (test/coingecko.test.js) with injectable
// fetch / clock / timer.
// ============================================================================
(function () {
  'use strict';

  var SPACING_MS = 400; // the Worker caches; CoinGecko itself is asked far less often
  var COOLDOWN_MS = 65000;

  function create(opts) {
    opts = opts || {};
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? function (u, o) { return fetch(u, o); } : null);
    var now = opts.now || function () { return Date.now(); };
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var spacing = opts.spacingMs == null ? SPACING_MS : opts.spacingMs;
    var cooldown = opts.cooldownMs == null ? COOLDOWN_MS : opts.cooldownMs;

    var queue = [];          // { url, priority, timeoutMs, resolve, reject }
    var running = false;
    var lastAt = 0;
    var coolUntil = 0;

    function limited() { var e = new Error('CoinGecko rate limit - try again in a minute'); e.status = 429; e.rateLimited = true; return e; }
    function coolingDown() { return now() < coolUntil; }

    function dropLow() {
      queue = queue.filter(function (j) { if (j.priority === 'high') return true; j.reject(limited()); return false; });
    }

    function pump() {
      if (running) return;
      running = true;
      (function next() {
        if (!queue.length) { running = false; return; }
        if (coolingDown()) {
          // Charts/history give way; the price request is still tried (if it
          // is refused too, the caller keeps the last-known prices).
          dropLow();
          if (!queue.length) { running = false; return; }
        }
        var wait = Math.max(0, lastAt + spacing - now());
        if (wait > 0) return sleep(wait).then(next);
        var job = queue.shift();
        lastAt = now();
        var init = {};
        if (job.timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(job.timeoutMs);
        Promise.resolve().then(function () { return fetchFn(job.url, init); }).then(function (r) {
          if (r && r.status === 429) { coolUntil = now() + cooldown; throw limited(); }
          if (!r || !r.ok) { var e = new Error('CoinGecko HTTP ' + (r ? r.status : 0)); e.status = r ? r.status : 0; throw e; }
          return r.json();
        }).then(job.resolve, function (e) {
          // A network/CORS failure from CoinGecko is, in practice, its 429.
          if (!e || e.rateLimited || !e.status) { coolUntil = Math.max(coolUntil, now() + cooldown); return job.reject(e && e.rateLimited ? e : limited()); }
          job.reject(e);
        }).then(next, next);
      })();
    }

    // → Promise<json>. opts: { priority: 'high'|'low' (default low), timeoutMs }
    function getJson(url, o) {
      o = o || {};
      var priority = o.priority === 'high' ? 'high' : 'low';
      if (!fetchFn) return Promise.reject(new Error('no fetch'));
      if (priority === 'low' && coolingDown()) return Promise.reject(limited());
      return new Promise(function (resolve, reject) {
        var job = { url: url, priority: priority, timeoutMs: o.timeoutMs || 15000, resolve: resolve, reject: reject };
        if (priority === 'high') {
          var i = 0; while (i < queue.length && queue[i].priority === 'high') i++;
          queue.splice(i, 0, job);
        } else queue.push(job);
        pump();
      });
    }

    // Worker URL for a CoinGecko endpoint ("simple/price", "search",
    // "coins/<id>/market_chart[/range]") with its parameters, or '' without a Worker.
    var base = '';
    function setBase(url) { base = String(url || '').trim().replace(/\/+$/, ''); if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base; }
    function url(path, params) {
      if (!base) return '';
      var q = ['action=cg', 'p=' + encodeURIComponent(path)];
      Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') q.push(k + '=' + encodeURIComponent(params[k])); });
      return base + (base.indexOf('?') > -1 ? '&' : '?') + q.join('&');
    }
    // → Promise<json>; opts as getJson. Rejects { noWorker: true } without a Worker.
    function get(path, params, o) {
      var u = url(path, params);
      if (!u) { var e = new Error('CoinGecko needs your Worker URL (API Settings)'); e.noWorker = true; return Promise.reject(e); }
      return getJson(u, o);
    }

    return { getJson: getJson, get: get, url: url, setBase: setBase, coolingDown: coolingDown, pending: function () { return queue.length; } };
  }

  var shared = create();
  var api = { SPACING_MS: SPACING_MS, COOLDOWN_MS: COOLDOWN_MS, create: create,
    getJson: shared.getJson, get: shared.get, url: shared.url, setBase: shared.setBase,
    coolingDown: shared.coolingDown, pending: shared.pending };
  if (typeof window !== 'undefined') window.MaerminCoinGecko = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
