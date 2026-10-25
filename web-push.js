// ============================================================================
// MAERMIN — Web push reminders  (window.MaerminPush)
// ----------------------------------------------------------------------------
// P5-5.1. Reminders that arrive with the app closed, through the user's own
// Worker (cf-worker/push.js):
//   - dividend pay dates (the expected schedule), the Vorabpauschale on
//     1 December, crypto lots turning tax-free, the IRA deadline (1 April);
//   - opt-in: price rules, checked by the Worker every 15 minutes. The Worker
//     then sees the rule's symbol and threshold - never quantities or values.
// Every message is encrypted here to this browser's push subscription
// (push-crypto.js, RFC 8291): the Worker and the push service carry only
// ciphertext. The lock screen shows generic text unless "details" is on.
// Each message's send time (`at`) travels in clear: dividend reminders follow
// the expected pay dates, so the Worker can infer roughly which payers are
// held. The Privacy page and docs/WORKER.md say so.
// Weight, value and drawdown rules and the risk monitor need the whole
// portfolio, so they keep notifying only while the app is open.
//
//   plan(input, opts) → [{ at, kind, tag, title, body }]   (pure, next 120 days)
//   priceRules(rulesState, { isCrypto, coinId }) → [{ ruleId, kind, symbol, op, threshold }]
//   syncNow(ctx), enable(ctx), disable(ctx), sendTest(ctx), Panel
// Settings 'maermin_push' (encrypted, device-local: never synced or backed up,
// the subscription belongs to this browser).
// Node-tested in test/web-push.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_push';
  var HORIZON_DAYS = 120, MAX_MESSAGES = 100, HOUR = 9;
  var RESYNC_MS = 12 * 3600000;
  var KINDS = ['dividends', 'vap', 'crypto', 'ira'];
  var BRAND = 'MAERMIN';

  function ymd(d) { return String(d || '').slice(0, 10); }
  function addDays(iso, n) { var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // 09:00 local time on a calendar date, as an ISO instant.
  function at9(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), HOUR).toISOString(); }
  function fmtQty(q) { return String(Math.round(q * 1e8) / 1e8); }

  function normalize(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    raw = raw && typeof raw === 'object' ? raw : {};
    var kinds = {};
    KINDS.forEach(function (k) { kinds[k] = !(raw.kinds && raw.kinds[k] === false); });
    var sub = raw.sub && typeof raw.sub === 'object' && typeof raw.sub.endpoint === 'string'
      ? { endpoint: raw.sub.endpoint, p256dh: String(raw.sub.p256dh || ''), auth: String(raw.sub.auth || '') } : null;
    return { enabled: raw.enabled === true, details: raw.details === true, closedPrices: raw.closedPrices === true, kinds: kinds,
      box: typeof raw.box === 'string' ? raw.box : '', token: typeof raw.token === 'string' ? raw.token : '',
      key: typeof raw.key === 'string' ? raw.key : '', sub: sub, worker: typeof raw.worker === 'string' ? raw.worker : '',
      hash: typeof raw.hash === 'string' ? raw.hash : '', lastAt: Number(raw.lastAt) || 0,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : '', counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : null };
  }
  function load() { try { return normalize(localStorage.getItem(KEY)); } catch (e) { return normalize(null); } }
  function save(s) { var n = normalize(s); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) { /* non-fatal */ } return n; }

  // input: { today, dividends: [{ symbol, date, amount }], vap: { year, tax },
  //          crypto: [{ symbol, date, quantity }], ira: { year, remaining } }
  // opts:  { details, kinds, money(v) }
  function plan(input, opts) {
    input = input || {}; opts = opts || {};
    var today = ymd(input.today) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var end = addDays(today, HORIZON_DAYS);
    var kinds = normalize({ kinds: opts.kinds }).kinds;
    var money = opts.money || function (v) { return (Math.round(v * 100) / 100).toFixed(2); };
    var det = opts.details === true;
    var out = [];
    function inRange(d) { return d && d >= today && d <= end; }
    if (kinds.dividends) {
      var byDate = {};
      (input.dividends || []).forEach(function (x) { var d = ymd(x.date); if (inRange(d)) (byDate[d] = byDate[d] || []).push(x); });
      Object.keys(byDate).forEach(function (d) {
        var list = byDate[d];
        out.push({ at: at9(d), kind: 'dividend', tag: 'maermin-div-' + d, title: __('wpDivTitle', 'Dividend day'),
          body: det ? __('wpDivDetail', 'Expected today: {list}', { list: list.map(function (x) { return x.symbol + ' ~' + money(x.amount, x.currency); }).join(', ') })
            : list.length === 1 ? __('wpDivOne', 'A dividend is expected today.') : __('wpDivMany', '{n} dividends are expected today.', { n: list.length }) });
      });
    }
    if (kinds.vap && input.vap && input.vap.tax > 0) {
      var vd = input.vap.year + '-12-01';
      if (inRange(vd)) out.push({ at: at9(vd), kind: 'vap', tag: 'maermin-vap-' + input.vap.year, title: __('wpVapTitle', 'Vorabpauschale in January'),
        body: det ? __('wpVapDetail', 'About {v} tax on the Vorabpauschale will be debited in January. Keep it on the clearing account.', { v: money(input.vap.tax) })
          : __('wpVapGeneric', 'Tax on the Vorabpauschale is debited in January. Check the cash on your clearing account.') });
    }
    if (kinds.crypto) {
      (input.crypto || []).forEach(function (x) {
        var d = ymd(x.date);
        if (!inRange(d) || !(x.quantity > 0)) return;
        out.push({ at: at9(d), kind: 'crypto', tag: 'maermin-crypto-' + d + '-' + x.symbol, title: __('wpCryptoTitle', 'Crypto tax-free'),
          body: det ? __('wpCryptoDetail', '{q} {sym} tax-free from today (held over one year).', { q: fmtQty(x.quantity), sym: x.symbol })
            : __('wpCryptoGeneric', 'A crypto holding becomes tax-free today.') });
      });
    }
    if (kinds.ira && input.ira && input.ira.remaining > 0) {
      var id = (input.ira.year + 1) + '-04-01';
      if (inRange(id)) out.push({ at: at9(id), kind: 'ira', tag: 'maermin-ira-' + input.ira.year, title: __('wpIraTitle', 'IRA deadline 15 April'),
        body: det ? __('wpIraDetail', 'Room left for {y}: {v}.', { y: input.ira.year, v: money(input.ira.remaining) })
          : __('wpIraGeneric', 'Contributions for {y} close on 15 April.', { y: input.ira.year }) });
    }
    out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    return out.slice(0, MAX_MESSAGES);
  }
  function payload(m) { return { title: BRAND + ' · ' + m.title, body: m.body, tag: m.tag, url: './' }; }

  // The enabled price rules the Worker can check: a stock or fund through
  // Yahoo (quote currency), a coin through its CoinGecko id (EUR) - the units
  // the app's price map and its rules use.
  function priceRules(rulesState, o) {
    o = o || {};
    var rules = (rulesState && rulesState.rules) || [];
    var out = [];
    rules.forEach(function (r) {
      if (!r || r.enabled === false || r.metric !== 'symbol_price' || !isFinite(r.threshold)) return;
      var t = String(r.target || '').trim();
      if (!t) return;
      if (o.isCrypto && o.isCrypto(t.toUpperCase())) {
        var id = (o.coinId && o.coinId(t.toUpperCase())) || (/^[a-z0-9-]+$/.test(t) ? t : null);
        if (id) out.push({ ruleId: r.id, kind: 'coingecko', symbol: id, op: r.op, threshold: r.threshold, rule: r });
      } else if (/^[A-Za-z0-9.^=_-]{1,24}$/.test(t)) {
        out.push({ ruleId: r.id, kind: 'yahoo', symbol: t.toUpperCase(), op: r.op, threshold: r.threshold, rule: r });
      }
    });
    return out.slice(0, 20);
  }

  // ---- browser side -------------------------------------------------------------
  function supported() {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol !== 'file:';
  }
  function PC() { return window.MaerminPushCrypto; }
  function randomId(n) { return PC().toB64u(crypto.getRandomValues(new Uint8Array(n))); }
  function post(workerUrl, body) {
    var base = String(workerUrl || '').replace(/\/+$/, '');
    return fetch(base + '/?action=push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  function hashOf(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) { return PC().toB64u(b); });
  }
  // A push subscription made with the Worker's current VAPID key.
  function subscription(workerUrl, s, force) {
    return post(workerUrl, { op: 'key' }).then(function (r) {
      if (r.status !== 200 || !r.body.publicKey) throw new Error(r.status === 501 ? 'no-storage' : r.status === 400 || r.status === 404 ? 'old-worker' : 'worker');
      var key = r.body.publicKey;
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (cur) {
          if (cur && !force && s.key === key) return cur;
          return (cur ? cur.unsubscribe() : Promise.resolve()).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: PC().fromB64u(key) });
          });
        });
      }).then(function (sub) {
        var j = sub.toJSON();
        return { key: key, sub: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } };
      });
    });
  }

  // ctx: { workerUrl, input, rulesState, isCrypto, coinId, money, describe, force }
  function syncNow(ctx) {
    var s = load();
    if (!s.enabled || !supported() || !ctx || !ctx.workerUrl || !PC()) return Promise.resolve({ skipped: true });
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return Promise.resolve({ skipped: true });
    var msgs = plan(ctx.input, { details: s.details, kinds: s.kinds, money: ctx.money });
    var rules = s.closedPrices ? priceRules(ctx.rulesState, ctx) : [];
    var plainRules = rules.map(function (r) {
      return { title: __('wpPriceTitle', 'Price rule reached'), body: s.details && ctx.describe ? ctx.describe(r.rule) : __('wpPriceGeneric', 'One of your price rules was reached.'), tag: 'maermin-rule-' + r.ruleId };
    });
    var fingerprint = JSON.stringify([ctx.workerUrl, s.details, msgs, rules.map(function (r) { return [r.kind, r.symbol, r.op, r.threshold]; }), plainRules]);
    return hashOf(fingerprint).then(function (h) {
      if (!ctx.force && h === s.hash && s.worker === ctx.workerUrl && Date.now() - s.lastAt < RESYNC_MS && s.sub) return { unchanged: true };
      function attempt(force) {
        return subscription(ctx.workerUrl, s, force).then(function (k) {
          var box = s.box || randomId(18), token = s.token || randomId(32);
          return Promise.all(msgs.map(function (m) { return PC().encrypt(JSON.stringify(payload(m)), k.sub); }))
            .then(function (bodies) {
              return Promise.all(plainRules.map(function (p) { return PC().encrypt(JSON.stringify({ title: BRAND + ' · ' + p.title, body: p.body, tag: p.tag, url: './' }), k.sub); }))
                .then(function (rb) {
                  return post(ctx.workerUrl, { op: 'set', box: box, token: token, key: k.key, endpoint: k.sub.endpoint,
                    messages: msgs.map(function (m, i) { return { at: m.at, body: PC().toB64u(bodies[i]), ttl: 86400 }; }),
                    prices: rules.map(function (r, i) { return { kind: r.kind, symbol: r.symbol, op: r.op, threshold: r.threshold, body: PC().toB64u(rb[i]) }; }) });
                });
            })
            .then(function (r) {
              if (r.status === 409 && !force) return attempt(true);
              if (r.status !== 200) throw new Error(r.body && r.body.error ? r.body.error : 'worker');
              return save(Object.assign({}, s, { box: box, token: token, key: k.key, sub: k.sub, worker: ctx.workerUrl, hash: h, lastAt: Date.now(), lastError: '',
                counts: { messages: r.body.messages, prices: r.body.prices } }));
            });
        });
      }
      return attempt(!!ctx.resubscribe);
    }).catch(function (e) {
      save(Object.assign({}, load(), { lastError: (e && e.message) || 'error' }));
      throw e;
    });
  }
  function enable(ctx) {
    if (!supported()) return Promise.reject(new Error('unsupported'));
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error('denied');
      save(Object.assign({}, load(), { enabled: true, hash: '' }));
      return syncNow(Object.assign({}, ctx, { force: true }));
    });
  }
  function disable(ctx) {
    var s = load();
    var done = function () { return save(Object.assign({}, s, { enabled: false, box: '', token: '', sub: null, key: '', hash: '', counts: null, lastError: '' })); };
    var del = s.box && ctx && (ctx.workerUrl || s.worker) ? post(ctx.workerUrl || s.worker, { op: 'delete', box: s.box, token: s.token }).catch(function () {}) : Promise.resolve();
    var unsub = supported() ? navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (cur) { return cur && cur.unsubscribe(); }).catch(function () {}) : Promise.resolve();
    return Promise.all([del, unsub]).then(done);
  }
  function sendTest(ctx) {
    var s = load();
    if (!s.box || !s.sub) return Promise.reject(new Error('not-enabled'));
    return PC().encrypt(JSON.stringify({ title: 'MAERMIN', body: __('wpTestBody', 'Notifications work. Reminders will arrive here even when MAERMIN is closed.'), tag: 'maermin-test', url: './' }), s.sub)
      .then(function (b) { return post(ctx.workerUrl || s.worker, { op: 'test', box: s.box, token: s.token, body: PC().toB64u(b) }); })
      .then(function (r) { if (r.status !== 200 || !r.body.ok) throw new Error('push-' + (r.body && r.body.status || r.status)); return r.body; });
  }

  // ---- panel (Security & sync) ----------------------------------------------------
  // props: { theme, workerUrl, getCtx(), addToast }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    // R5.1: shared rows, switches, buttons and notes; status with a mark
    var s0 = useState(load); var s = s0[0], setS = s0[1];
    var s1 = useState(false); var busy = s1[0], setBusy = s1[1];
    var toast = props.addToast || function () {};
    function ctx(extra) { return Object.assign({}, props.getCtx ? props.getCtx() : {}, { workerUrl: props.workerUrl }, extra || {}); }
    function errText(err) {
      var m = err && err.message;
      return m === 'denied' ? __('wpDenied', 'Notifications are blocked for this site in the browser settings.')
        : m === 'unsupported' ? __('wpUnsupported', 'This browser does not support push notifications here (on iPhone: add MAERMIN to the home screen first).')
        : m === 'no-storage' ? __('wpNoStorage', 'Your Worker has no KV storage bound (SYNC).')
        : m === 'old-worker' ? __('wpOldWorker', 'Your Worker is older than 2026.10.11: redeploy it to use push.')
        : __('wpFailed', 'Push could not be set up: {msg}', { msg: m || 'error' });
    }
    function run(p, okMsg) {
      setBusy(true);
      p.then(function () { setBusy(false); setS(load()); if (okMsg) toast(okMsg, 'success'); },
        function (err) { setBusy(false); setS(load()); toast(errText(err), 'error'); });
    }
    function setOpt(patch) { var n = save(Object.assign({}, load(), patch, { hash: '' })); setS(n); if (n.enabled) run(syncNow(ctx({ force: true }))); }
    var row = function (label, control, tid) {
      return e('label', { 'data-testid': tid, className: ['ui-sec-row', 'is-label'].join(' ') },
        e('span', { className: 'ui-sec-row__label' }, label), control);
    };
    var box = function (checked, onChange, disabled) {
      return e('input', { type: 'checkbox', checked: checked, disabled: disabled, onChange: function (ev) { onChange(ev.target.checked); }, className: 'ui-st-check' });
    };
    var BTN = ['ui-btn', 'ui-btn--secondary', 'ui-btn--sm'].join(' ');
    var can = supported();
    return e('div', { 'data-testid': 'push-panel' },
      e('p', { className: ['ui-note', 'ui-note--flush'].join(' ') },
        __('wpIntro', 'Reminders for dividend days, the Vorabpauschale, crypto turning tax-free and the IRA deadline, even when MAERMIN is closed. Each message is encrypted on this device before it goes to your Worker, which only stores ciphertext and the send time.')),
      !props.workerUrl ? e('p', { className: ['ui-note', 'tone-warning'].join(' ') }, '! ' + __('wpNeedWorker', 'Needs your own Worker (API Settings).')) : null,
      !can ? e('p', { className: ['ui-note', 'tone-warning'].join(' ') }, '! ' + __('wpUnsupported', 'This browser does not support push notifications here (on iPhone: add MAERMIN to the home screen first).')) : null,
      row(__('wpEnable', 'Push notifications on this device'), box(s.enabled, function (on) {
        run(on ? enable(ctx()) : disable(ctx()), on ? __('wpEnabled', 'Push notifications are on.') : __('wpDisabled', 'Push notifications are off on this device.'));
      }, busy || !can || !props.workerUrl), 'push-enable'),
      s.enabled ? e('div', null,
        KINDS.map(function (k) {
          var lbl = k === 'dividends' ? __('wpKindDiv', 'Dividend days') : k === 'vap' ? __('wpKindVap', 'Vorabpauschale (1 December)') : k === 'crypto' ? __('wpKindCrypto', 'Crypto turning tax-free') : __('wpKindIra', 'IRA deadline (1 April)');
          return row(lbl, box(s.kinds[k], function (on) { var kinds = Object.assign({}, s.kinds); kinds[k] = on; setOpt({ kinds: kinds }); }, busy), 'push-kind-' + k);
        }),
        row(__('wpDetails', 'Show symbols and amounts on the lock screen'), box(s.details, function (on) { setOpt({ details: on }); }, busy), 'push-details'),
        row(__('wpClosedPrices', 'Check price rules while the app is closed'), box(s.closedPrices, function (on) { setOpt({ closedPrices: on }); }, busy), 'push-prices'),
        e('p', { className: 'ui-note' },
          __('wpClosedPricesHint', 'Off: price rules notify only while MAERMIN is open. On: your Worker checks them every 15 minutes and sees each rule\'s symbol and threshold (never quantities or values). Weight, value and drawdown rules always run in the app.')),
        e('div', { className: 'ui-actions' },
          e('button', { 'data-testid': 'push-test', className: BTN, disabled: busy, onClick: function () { run(sendTest(ctx()), __('wpTestSent', 'Test notification sent.')); } }, __('wpTest', 'Send a test notification')),
          e('button', { className: BTN, disabled: busy, onClick: function () { run(syncNow(ctx({ force: true })), __('wpSynced', 'Reminders updated.')); } }, __('wpResync', 'Update reminders')),
          e('span', { 'data-testid': 'push-status', className: ['ui-note', 'ui-note--flush', s.lastError ? 'tone-warning' : 'tone-gain'].join(' ') },
            s.lastError ? '! ' + errText({ message: s.lastError }) : s.counts ? '✓ ' + __('wpCounts', '{n} reminders and {p} price rules scheduled', { n: s.counts.messages || 0, p: s.counts.prices || 0 }) : ''))) : null);
  }

  var api = { KEY: KEY, HORIZON_DAYS: HORIZON_DAYS, plan: plan, payload: payload, priceRules: priceRules, normalize: normalize, load: load, save: save,
    supported: supported, syncNow: syncNow, enable: enable, disable: disable, sendTest: sendTest, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminPush = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
